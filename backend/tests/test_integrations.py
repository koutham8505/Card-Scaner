import asyncio

import httpx
import pytest

from app import integrations
from app.integrations import ZOHO_FIELD_MAPPING, compare_zoho_field_metadata


def test_zoho_mapping_requires_all_verified_fields_and_drive_url():
    metadata = {
        module: [{"api_name": field} for field in fields]
        for module, fields in ZOHO_FIELD_MAPPING.items()
    }
    metadata["Leads"].append({
        "api_name": "Google_Drive_Folder_URL",
        "field_label": "Google Drive Folder URL",
    })

    result = compare_zoho_field_metadata(metadata)

    assert result["mapping_verified"] is True
    assert all(item["available"] for item in result["modules"].values())
    assert result["google_drive_folder_url"]["api_names"] == ["Google_Drive_Folder_URL"]


def test_zoho_mapping_reports_missing_fields_without_guessing_custom_api_name():
    metadata = {
        module: [{"api_name": field} for field in fields]
        for module, fields in ZOHO_FIELD_MAPPING.items()
    }
    metadata["Leads"] = [field for field in metadata["Leads"] if field["api_name"] != "Owner"]

    result = compare_zoho_field_metadata(metadata)

    assert result["mapping_verified"] is False
    assert result["modules"]["Leads"]["missing_fields"] == ["Owner"]
    assert result["google_drive_folder_url"] == {
        "verified": False,
        "api_names": [],
        "message": "Custom field API name is not available yet.",
    }


def test_zoho_mapping_reports_modules_not_available():
    result = compare_zoho_field_metadata({}, set())

    assert result["mapping_verified"] is False
    assert result["modules"]["Leads"]["available"] is False
    assert result["modules"]["Leads"]["missing_fields"] == list(ZOHO_FIELD_MAPPING["Leads"])


def test_zoho_verifier_fetches_module_and_field_metadata_without_enabling_writes(monkeypatch):
    for key, value in {
        "ZOHO_CLIENT_ID": "client-id",
        "ZOHO_CLIENT_SECRET": "client-secret",
        "ZOHO_REFRESH_TOKEN": "refresh-token",
        "ZOHO_WRITE_ENABLED": "true",
        "ZOHO_MAPPING_APPROVED": "true",
    }.items():
        monkeypatch.setenv(key, value)
    requested_modules: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth/v2/token":
            return httpx.Response(
                200,
                json={
                    "access_token": "temporary-access-token",
                    "api_domain": "https://www.zohoapis.com",
                },
                request=request,
            )
        if request.url.path == "/crm/v6/settings/modules":
            return httpx.Response(
                200,
                json={"modules": [{"api_name": module} for module in ZOHO_FIELD_MAPPING]},
                request=request,
            )
        if request.url.path == "/crm/v6/settings/fields":
            module = request.url.params["module"]
            requested_modules.append(module)
            fields = [{"api_name": field} for field in ZOHO_FIELD_MAPPING[module]]
            if module == "Leads":
                fields.append({
                    "api_name": "Google_Drive_Folder_URL",
                    "field_label": "Google Drive Folder URL",
                })
            return httpx.Response(200, json={"fields": fields}, request=request)
        raise AssertionError(f"Unexpected Zoho request: {request.url}")

    transport = httpx.MockTransport(handle)
    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        integrations.httpx,
        "AsyncClient",
        lambda timeout: original_client(transport=transport, timeout=timeout),
    )

    result = asyncio.run(integrations.ZohoCRMMetadataVerifier().verify())

    assert requested_modules == list(ZOHO_FIELD_MAPPING)
    assert result["mapping_verified"] is True
    assert result["write_authorization_ready"] is True
    assert result["writes_enabled"] is False


def test_zoho_verifier_reports_missing_secret_configuration(monkeypatch):
    for key in ("ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"):
        monkeypatch.delenv(key, raising=False)

    with pytest.raises(RuntimeError, match="ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN"):
        asyncio.run(integrations.ZohoCRMMetadataVerifier().verify())
