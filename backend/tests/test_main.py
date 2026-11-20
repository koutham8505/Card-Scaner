import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("EVENTCONNECT_API_TOKEN", "test-token-with-at-least-32-characters")
os.environ.setdefault("EVENTCONNECT_TEST_AUTH_BYPASS", "true")

from app.main import app, store
from app.store import Store

_test_storage = tempfile.TemporaryDirectory(prefix="eventconnect-tests-")
store.path = Path(_test_storage.name) / "test-eventconnect.db"
store._initialize()

client = TestClient(
    app,
    headers={"X-EventConnect-Proxy-Token": os.environ["EVENTCONNECT_API_TOKEN"]},
)


def test_health_reports_unimplemented_integrations():
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["config"] == {
        "supabase": "Pending Configuration",
        "google_drive": "Writes disabled pending Shared Drive access verification",
        "zoho_crm": "Writes disabled pending metadata verification and approval",
        "qr_registration": "Disabled pending payload validation",
    }


def test_event_directory_is_available_to_staff():
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
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
    ):
        monkeypatch.delenv(name, raising=False)

    with pytest.raises(RuntimeError, match="Production storage configuration is incomplete"):
        Store(tmp_path / "production.db")


def test_api_requires_supabase_access_token(monkeypatch):
    monkeypatch.delenv("EVENTCONNECT_TEST_AUTH_BYPASS", raising=False)
    response = TestClient(app).get(
        "/api/v1/captures",
        headers={"X-EventConnect-Proxy-Token": os.environ["EVENTCONNECT_API_TOKEN"]},
    )

    assert response.status_code == 401


def test_production_session_validation_requires_staff_profile(monkeypatch):
    monkeypatch.delenv("EVENTCONNECT_TEST_AUTH_BYPASS", raising=False)

    async def reject_unregistered_staff(_access_token):
        return False, 403, "No staff profile is assigned to this account."

    monkeypatch.setattr("app.main.validate_staff_session", reject_unregistered_staff)
    response = TestClient(app).post(
        "/api/v1/auth/session",
        headers={
            "X-EventConnect-Proxy-Token": os.environ["EVENTCONNECT_API_TOKEN"],
            "X-Supabase-Access-Token": "invalid-user-token",
        },
    )

    assert response.status_code == 403


def test_capture_requires_front_image():
    response = client.post("/api/v1/captures", data={"event_code": "DIDAC26"})

    assert response.status_code == 422


def test_capture_is_idempotent_and_creates_independent_jobs():
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
    assert len(client.get("/api/v1/sync-jobs").json()) >= 3


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
        json={"lead_priority": "Hot", "next_action": "Schedule Demo", "notes": "Requested placement workshop", "follow_up_at": "2026-11-12T16:00:00Z", "consent_status": "granted"},
    )
    assert qualify.status_code == 200

    leads = client.get("/api/v1/leads?q=Anita&priority=Hot").json()
    assert len(leads) == 1
    assert leads[0]["institution"] == "Skillbridge"
    task_actions = [task["action_type"] for task in client.get("/api/v1/tasks").json()]
    assert "Schedule Demo" in task_actions
