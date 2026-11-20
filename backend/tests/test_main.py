import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("EVENTCONNECT_API_TOKEN", "test-token-with-at-least-32-characters")

from app.main import app, store
from app.store import Store

_test_storage = tempfile.TemporaryDirectory(prefix="eventconnect-tests-")
store.path = Path(_test_storage.name) / "test-eventconnect.db"
store._initialize()

client = TestClient(
    app,
    headers={"X-EventConnect-Proxy-Token": os.environ["EVENTCONNECT_API_TOKEN"]},
)


def test_health_reports_disabled_integrations(monkeypatch):
    monkeypatch.delenv("ZOHO_FLOW_ENABLED", raising=False)
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["config"] == {
        "supabase": "Pending Configuration",
        "google_drive": "Writes disabled pending Shared Drive access verification",
        "zoho_crm": "Zoho Flow disabled or pending configuration",
        "qr_registration": "Disabled pending payload validation",
    }


def test_event_directory_is_available_through_frontend_proxy():
    response = client.get("/api/v1/events")

    assert response.status_code == 200
    events = response.json()
    assert any(event["event_code"] == "DIDAC26" for event in events)


def test_capture_api_rejects_missing_proxy_token():
    response = TestClient(app).get("/api/v1/captures")

    assert response.status_code == 401


def test_production_store_refuses_local_sqlite(monkeypatch, tmp_path):
    monkeypatch.setenv("EVENTCONNECT_ENV", "production")
    for name in (
        "DATABASE_URL",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
    ):
        monkeypatch.delenv(name, raising=False)

    with pytest.raises(RuntimeError, match="Production storage configuration is incomplete"):
        Store(tmp_path / "production.db")


def test_api_accepts_backend_token_without_supabase_user_token():
    response = TestClient(app).get(
        "/api/v1/captures",
        headers={"X-EventConnect-Proxy-Token": os.environ["EVENTCONNECT_API_TOKEN"]},
    )

    assert response.status_code == 200


def test_capture_requires_front_image():
    response = client.post("/api/v1/captures", data={"event_code": "DIDAC26"})

    assert response.status_code == 422


def test_schedule_demo_requires_demo_date():
    response = client.post(
        "/api/v1/captures/not-a-capture/qualify",
        json={"next_action": "Schedule Demo"},
    )

    assert response.status_code == 422
    assert "demo date is required" in response.json()["detail"][0]["msg"]


def test_capture_is_idempotent_without_creating_unqualified_sync_jobs():
    payload = {
        "capture_id": "58ef0629-7b6f-4fdf-8ddd-1a8b9c487001",
        "event_code": "DIDAC26",
        "capture_method": "scanner",
    }
    headers = {"Idempotency-Key": "capture-58ef0629"}

    first = client.post(
        "/api/v1/captures",
        data=payload,
        files={"front": ("front.jpg", b"image", "image/jpeg")},
        headers=headers,
    )
    second = client.post(
        "/api/v1/captures",
        data=payload,
        files={"front": ("front.jpg", b"image", "image/jpeg")},
        headers=headers,
    )

    assert first.status_code == 202
    assert second.status_code == 200
    assert second.json() == first.json()
    assert client.get("/api/v1/sync-jobs").json() == []


def test_manual_capture_persists_verified_qualified_lead():
    response = client.post(
        "/api/v1/captures/manual",
        json={
            "capture_id": "58ef0629-7b6f-4fdf-8ddd-1a8b9c487003",
            "fields": {"full_name": "Kiran Nair", "institution": "DIDAC Institute", "email": "kiran@example.com", "city": "Delhi", "state": "Delhi"},
            "qualification": {"lead_priority": "Warm", "next_action": "Call", "consent_status": "granted"},
        },
    )
    assert response.status_code == 200
    assert client.get("/api/v1/leads?q=kiran").json()[0]["institution"] == "DIDAC Institute"
    assert response.json()["crm_sync"]["status"] == "Pending Configuration"
    assert client.get("/api/v1/tasks").json() == []
    assert len(client.get("/api/v1/sync-jobs").json()) == 1


def test_qr_registration_is_disabled_until_payload_validation(monkeypatch):
    monkeypatch.delenv("EVENTCONNECT_QR_ENABLED", raising=False)
    response = client.post(
        "/api/v1/qr/register",
        json={
            "capture_id": "58ef0629-7b6f-4fdf-8ddd-1a8b9c487004",
            "full_name": "QR Test Visitor",
            "consent_status": "granted",
        },
    )
    assert response.status_code == 503


def test_qr_registration_requires_consent_and_persists_lead(monkeypatch):
    monkeypatch.setenv("EVENTCONNECT_QR_ENABLED", "true")
    payload = {
        "capture_id": "58ef0629-7b6f-4fdf-8ddd-1a8b9c487004",
        "event_code": "DIDAC26",
        "full_name": "QR Test Visitor",
        "institution": "Test Academy",
        "email": "qr@example.com",
        "mobile": "+919800000002",
        "consent_status": "granted",
    }

    response = client.post("/api/v1/qr/register", json=payload)

    assert response.status_code == 200
    assert response.json()["capture_method"] == "qr"
    assert response.json()["status"] == "Qualified"
    lead = client.get("/api/v1/leads?q=QR+Test+Visitor").json()[0]
    assert lead["institution"] == "Test Academy"
    assert lead["consent_status"] == "granted"
    assert response.json()["crm_sync"]["status"] == "Pending Configuration"
    assert client.get("/api/v1/tasks").json() == []


def test_qr_registration_rejects_unknown_consent(monkeypatch):
    monkeypatch.setenv("EVENTCONNECT_QR_ENABLED", "true")
    response = client.post(
        "/api/v1/qr/register",
        json={
            "capture_id": "58ef0629-7b6f-4fdf-8ddd-1a8b9c487005",
            "full_name": "QR No Consent",
            "consent_status": "unknown",
        },
    )

    assert response.status_code == 422


def test_capture_verification_and_qualification_create_live_lead():
    capture_id = "58ef0629-7b6f-4fdf-8ddd-1a8b9c487002"
    response = client.post(
        "/api/v1/captures",
        data={"capture_id": capture_id, "event_code": "DIDAC26", "capture_method": "manual"},
        files={"front": ("front.png", b"png", "image/png")},
        headers={"Idempotency-Key": "capture-live-lead"},
    )
    assert response.status_code == 202

    verify = client.patch(
        f"/api/v1/captures/{capture_id}/verify",
        json={"fields": {"full_name": "Anita Rao", "institution": "Skillbridge", "email": "anita@example.com", "city": "Pune", "state": "Maharashtra"}},
    )
    assert verify.status_code == 200
    assert verify.json()["verification_status"] == "verified"

    qualify = client.post(
        f"/api/v1/captures/{capture_id}/qualify",
        json={"lead_priority": "Hot", "next_action": "Schedule Demo", "demo_date": "2026-12-11", "notes": "Requested placement workshop", "follow_up_at": "2026-11-12T16:00:00Z", "consent_status": "granted"},
    )
    assert qualify.status_code == 200
    assert qualify.json()["qualification"]["demo_date"] == "2026-12-11"

    leads = client.get("/api/v1/leads?q=Anita&priority=Hot").json()
    assert len(leads) == 1
    assert leads[0]["institution"] == "Skillbridge"
    assert leads[0]["follow_up_at"] == "2026-12-11"
    assert client.get("/api/v1/tasks").json() == []
    sync_jobs = client.get("/api/v1/sync-jobs").json()
    capture_jobs = [job for job in sync_jobs if job["capture_id"] == capture_id]
    assert len(capture_jobs) == 1
    assert capture_jobs[0]["provider"] == "zoho_crm"
    assert capture_jobs[0]["status"] == "Pending"


def test_qualified_lead_is_backed_up_when_flow_delivery_fails(monkeypatch):
    monkeypatch.setenv("ZOHO_FLOW_ENABLED", "true")
    monkeypatch.setenv("ZOHO_MAPPING_APPROVED", "true")
    monkeypatch.setenv("ZOHO_FLOW_WEBHOOK_URL", "https://flow.zoho.com/hook/test")

    class FailedFlowAdapter:
        async def execute(self, capture, qualification):
            from app.integrations import ZohoIntegrationError

            raise ZohoIntegrationError("Zoho Flow webhook is unavailable.")

    monkeypatch.setattr("app.main.ZohoFlowLeadAdapter", FailedFlowAdapter)
    capture_id = "58ef0629-7b6f-4fdf-8ddd-1a8b9c487006"
    response = client.post(
        "/api/v1/captures/manual",
        json={
            "capture_id": capture_id,
            "fields": {"full_name": "Flow Failure Lead", "email": "flow-failure@example.com"},
            "qualification": {"lead_priority": "Warm", "consent_status": "granted"},
        },
    )

    assert response.status_code == 200
    assert response.json()["crm_sync"]["status"] == "Failed"
    assert len(client.get("/api/v1/leads?q=Flow+Failure+Lead").json()) == 1
    assert client.get("/api/v1/tasks").json() == []
    sync_job = next(
        job for job in client.get("/api/v1/sync-jobs").json()
        if job["capture_id"] == capture_id
    )
    assert sync_job["status"] == "Failed"

    class SuccessfulFlowAdapter:
        async def execute(self, capture, qualification):
            from app.integrations import IntegrationResult

            return IntegrationResult(
                status="Sent to Zoho Flow",
                message="Zoho Flow received the lead payload.",
                operation="create",
            )

    monkeypatch.setattr("app.main.ZohoFlowLeadAdapter", SuccessfulFlowAdapter)
    retry = client.post(f"/api/v1/captures/{capture_id}/sync/zoho-flow")

    assert retry.status_code == 200
    assert retry.json()["crm_sync"]["status"] == "Sent to Zoho Flow"
    retried_job = next(
        job for job in client.get("/api/v1/sync-jobs").json()
        if job["capture_id"] == capture_id
    )
    assert retried_job["status"] == "Completed"
    assert retried_job["attempts"] == 2
    completed_retry = client.post(f"/api/v1/captures/{capture_id}/sync/zoho-flow")
    assert completed_retry.status_code == 409
