import asyncio
import json

import httpx
import pytest

from app import integrations
from app.integrations import ZOHO_FIELD_MAPPING, compare_zoho_field_metadata


def test_zoho_mapping_requires_email_search_field():
    result = compare_zoho_field_metadata({"Leads": [{"api_name": "Email"}]})

    assert result["mapping_verified"] is True
    assert result["modules"]["Leads"]["verified"] is True


def test_zoho_mapping_reports_missing_email_field():
    result = compare_zoho_field_metadata({"Leads": [{"api_name": "Last_Name"}]})

    assert result["mapping_verified"] is False
    assert result["modules"]["Leads"]["missing_fields"] == ["Email"]


def test_zoho_mapping_reports_leads_module_unavailable():
    result = compare_zoho_field_metadata({}, set())

    assert result["mapping_verified"] is False
    assert result["modules"]["Leads"]["available"] is False
    assert result["modules"]["Leads"]["missing_fields"] == ["Email"]


def _configure_zoho(monkeypatch, *, enabled="true"):
    for key, value in {
        "ZOHO_CLIENT_ID": "client-id",
        "ZOHO_CLIENT_SECRET": "client-secret",
        "ZOHO_REFRESH_TOKEN": "refresh-token",
        "ZOHO_ACCOUNTS_URL": "https://accounts.zoho.com",
        "ZOHO_FLOW_ENABLED": enabled,
        "ZOHO_FLOW_WEBHOOK_URL": "https://flow.zoho.com/hook/secret",
        "ZOHO_MAPPING_APPROVED": "true",
    }.items():
        monkeypatch.setenv(key, value)


def _mock_zoho_http(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        integrations.httpx,
        "AsyncClient",
        lambda timeout: original_client(transport=transport, timeout=timeout),
    )


def test_zoho_verifier_checks_only_email_matching_metadata(monkeypatch):
    _configure_zoho(monkeypatch)
    requested_modules: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth/v2/token":
            return httpx.Response(200, json={
                "access_token": "temporary-access-token",
                "api_domain": "https://www.zohoapis.com",
            }, request=request)
        if request.url.path == "/crm/v6/settings/modules":
            return httpx.Response(200, json={"modules": [{"api_name": "Leads"}]}, request=request)
        if request.url.path == "/crm/v6/settings/fields":
            requested_modules.append(request.url.params["module"])
            return httpx.Response(200, json={"fields": [{"api_name": "Email"}]}, request=request)
        raise AssertionError(f"Unexpected Zoho request: {request.url}")

    _mock_zoho_http(monkeypatch, handle)
    result = asyncio.run(integrations.ZohoCRMMetadataVerifier().verify())

    assert requested_modules == list(ZOHO_FIELD_MAPPING)
    assert result["mapping_verified"] is True
    assert result["flow_delivery_ready"] is True
    assert result["direct_crm_writes_enabled"] is False


def test_zoho_verifier_reports_missing_secret_configuration(monkeypatch):
    for key in ("ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"):
        monkeypatch.delenv(key, raising=False)

    with pytest.raises(integrations.ZohoIntegrationError, match="ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN"):
        asyncio.run(integrations.ZohoCRMMetadataVerifier().verify())


def test_flow_adapter_creates_when_email_has_no_exact_match(monkeypatch):
    _configure_zoho(monkeypatch)
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/oauth/v2/token":
            return httpx.Response(200, json={
                "access_token": "temporary-access-token",
                "api_domain": "https://www.zohoapis.com",
            }, request=request)
        if request.url.path == "/crm/v6/Leads/search":
            assert request.url.params["email"] == "person@example.com"
            return httpx.Response(204, request=request)
        if request.url.path == "/hook/secret":
            return httpx.Response(202, request=request)
        raise AssertionError(f"Unexpected Zoho request: {request.url}")

    _mock_zoho_http(monkeypatch, handle)
    capture = {
        "id": "capture-1",
        "capture_code": "DIDAC26-0001",
        "event_code": "DIDAC26",
        "capture_method": "scanner",
        "created_at": "2026-11-20T12:00:00Z",
        "manual_fields": {"full_name": "Taylor Person", "email": " Person@Example.com "},
        "extracted_fields": {},
        "qualification": {"lead_priority": "Warm"},
    }

    result = asyncio.run(integrations.ZohoFlowLeadAdapter().execute(capture, capture["qualification"]))

    assert result.status == "Sent to Zoho Flow"
    assert result.operation == "create"
    flow_request = next(request for request in requests if request.url.path == "/hook/secret")
    assert flow_request.headers["Idempotency-Key"] == "capture-1"
    flow_body = json.loads(flow_request.content)
    assert flow_body["operation"] == "create"
    assert flow_body["match_email"] == "person@example.com"
    assert flow_body["lead"]["last_name"] == "Person"


def test_flow_adapter_updates_exact_email_match(monkeypatch):
    _configure_zoho(monkeypatch)
    flow_body: dict = {}

    def handle(request: httpx.Request) -> httpx.Response:
        nonlocal flow_body
        if request.url.path == "/oauth/v2/token":
            return httpx.Response(200, json={
                "access_token": "temporary-access-token",
                "api_domain": "https://www.zohoapis.com",
            }, request=request)
        if request.url.path == "/crm/v6/Leads/search":
            return httpx.Response(200, json={"data": [
                {"id": "zoho-lead-42", "Email": "PERSON@example.com"},
            ]}, request=request)
        if request.url.path == "/hook/secret":
            flow_body = json.loads(request.content)
            return httpx.Response(200, request=request)
        raise AssertionError(f"Unexpected Zoho request: {request.url}")

    _mock_zoho_http(monkeypatch, handle)
    capture = {
        "id": "capture-2",
        "capture_code": "DIDAC26-0002",
        "event_code": "DIDAC26",
        "capture_method": "manual",
        "created_at": "2026-11-20T12:00:00Z",
        "manual_fields": {"full_name": "Taylor Person", "email": "person@example.com"},
        "extracted_fields": {},
    }

    result = asyncio.run(
        integrations.ZohoFlowLeadAdapter().execute(
            capture, {"demo_date": "2026-12-11", "next_action": "Schedule Demo"}
        )
    )

    assert result.operation == "update"
    assert result.reference == "zoho-lead-42"
    assert flow_body["operation"] == "update"
    assert flow_body["zoho_lead_id"] == "zoho-lead-42"
    assert flow_body["qualification"]["demo_date"] == "2026-12-11"


def test_flow_adapter_rejects_multiple_exact_email_matches(monkeypatch):
    _configure_zoho(monkeypatch)
    flow_called = False

    def handle(request: httpx.Request) -> httpx.Response:
        nonlocal flow_called
        if request.url.path == "/oauth/v2/token":
            return httpx.Response(200, json={
                "access_token": "temporary-access-token",
                "api_domain": "https://www.zohoapis.com",
            }, request=request)
        if request.url.path == "/crm/v6/Leads/search":
            return httpx.Response(200, json={"data": [
                {"id": "lead-1", "Email": "person@example.com"},
                {"id": "lead-2", "Email": "PERSON@example.com"},
            ]}, request=request)
        if request.url.path == "/hook/secret":
            flow_called = True
            return httpx.Response(200, request=request)
        raise AssertionError(f"Unexpected Zoho request: {request.url}")

    _mock_zoho_http(monkeypatch, handle)
    capture = {
        "id": "capture-3",
        "capture_code": "DIDAC26-0003",
        "event_code": "DIDAC26",
        "capture_method": "manual",
        "created_at": "2026-11-20T12:00:00Z",
        "manual_fields": {"full_name": "Taylor Person", "email": "person@example.com"},
        "extracted_fields": {},
    }

    with pytest.raises(integrations.ZohoIntegrationError, match="Multiple Zoho Leads"):
        asyncio.run(integrations.ZohoFlowLeadAdapter().execute(capture, {}))
    assert flow_called is False


def test_flow_adapter_is_disabled_by_default(monkeypatch):
    _configure_zoho(monkeypatch, enabled="false")

    with pytest.raises(integrations.ZohoIntegrationError, match="delivery is disabled"):
        asyncio.run(integrations.ZohoFlowLeadAdapter().execute({}, {}))
