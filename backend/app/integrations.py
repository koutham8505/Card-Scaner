import argparse
import asyncio
import json
import os
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlparse

import httpx


@dataclass(frozen=True)
class IntegrationResult:
    status: str
    reference: str | None = None
    message: str | None = None
    operation: str | None = None


class IntegrationAdapter(Protocol):
    def execute(self, capture_id: str) -> IntegrationResult: ...


class LocalOCRAdapter:
    def execute(self, capture_id: str) -> IntegrationResult:
        return IntegrationResult("Needs Local OCR Configuration", message="Configure Tesseract before production OCR; no text was fabricated.")


class GoogleDriveAdapter:
    def execute(self, capture_id: str) -> IntegrationResult:
        return IntegrationResult(
            "Disabled pending permission verification",
            message="Verify service-account access to the approved Shared Drive before enabling folder or file writes.",
        )


ZOHO_FIELD_MAPPING: dict[str, tuple[str, ...]] = {"Leads": ("Email",)}
ZOHO_API_DOMAIN_SUFFIXES = (
    ".zohoapis.com",
    ".zohoapis.eu",
    ".zohoapis.in",
    ".zohoapis.com.au",
    ".zohoapis.jp",
    ".zohoapis.ca",
    ".zohoapis.sa",
    ".zohoapis.com.cn",
)


class ZohoIntegrationError(RuntimeError):
    pass


def _zoho_credentials() -> tuple[str, str, str, str]:
    client_id = os.environ.get("ZOHO_CLIENT_ID", "")
    client_secret = os.environ.get("ZOHO_CLIENT_SECRET", "")
    refresh_token = os.environ.get("ZOHO_REFRESH_TOKEN", "")
    accounts_url = os.environ.get("ZOHO_ACCOUNTS_URL", "https://accounts.zoho.in").rstrip("/")
    missing = [
        name
        for name, value in (
            ("ZOHO_CLIENT_ID", client_id),
            ("ZOHO_CLIENT_SECRET", client_secret),
            ("ZOHO_REFRESH_TOKEN", refresh_token),
        )
        if not value
    ]
    if missing:
        raise ZohoIntegrationError("Zoho CRM email matching requires: " + ", ".join(missing))

    accounts = urlparse(accounts_url)
    if (
        accounts.scheme != "https"
        or not accounts.netloc
        or accounts.username
        or accounts.password
        or accounts.path not in ("", "/")
        or accounts.query
        or accounts.fragment
    ):
        raise ZohoIntegrationError("ZOHO_ACCOUNTS_URL must be an HTTPS origin.")
    return client_id, client_secret, refresh_token, accounts_url


async def _refresh_zoho_access_token(
    client: httpx.AsyncClient,
    client_id: str,
    client_secret: str,
    refresh_token: str,
    accounts_url: str,
) -> tuple[str, str]:
    try:
        response = await client.post(
            f"{accounts_url}/oauth/v2/token",
            data={
                "grant_type": "refresh_token",
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
            },
        )
        response.raise_for_status()
        body = response.json()
    except httpx.TimeoutException as exc:
        raise ZohoIntegrationError("Zoho OAuth timed out.") from exc
    except httpx.HTTPStatusError as exc:
        raise ZohoIntegrationError(f"Zoho OAuth failed (HTTP {exc.response.status_code}).") from exc
    except httpx.RequestError as exc:
        raise ZohoIntegrationError("Zoho OAuth is unavailable.") from exc
    except ValueError as exc:
        raise ZohoIntegrationError("Zoho OAuth returned invalid JSON.") from exc

    access_token = body.get("access_token") if isinstance(body, dict) else None
    api_domain = body.get("api_domain") if isinstance(body, dict) else None
    parsed_domain = urlparse(api_domain) if isinstance(api_domain, str) else None
    if (
        not isinstance(access_token, str)
        or not access_token
        or parsed_domain is None
        or parsed_domain.scheme != "https"
        or not parsed_domain.netloc
        or parsed_domain.username
        or parsed_domain.password
        or parsed_domain.path not in ("", "/")
        or parsed_domain.query
        or parsed_domain.fragment
        or parsed_domain.hostname is None
        or not any(parsed_domain.hostname.endswith(suffix) for suffix in ZOHO_API_DOMAIN_SUFFIXES)
    ):
        raise ZohoIntegrationError("Zoho OAuth response did not contain a valid access token and API domain.")
    return access_token, api_domain.rstrip("/")


def compare_zoho_field_metadata(
    metadata: dict[str, list[dict]],
    available_modules: set[str] | None = None,
) -> dict:
    if available_modules is None:
        available_modules = set(metadata)
    modules: dict[str, dict] = {}
    for module, required_fields in ZOHO_FIELD_MAPPING.items():
        fields = metadata.get(module, [])
        api_names = {
            field.get("api_name")
            for field in fields
            if isinstance(field, dict) and isinstance(field.get("api_name"), str)
        }
        missing = (
            [field for field in required_fields if field not in api_names]
            if module in available_modules
            else list(required_fields)
        )
        modules[module] = {
            "available": module in available_modules,
            "verified": module in available_modules and not missing,
            "missing_fields": missing,
        }
    return {
        "modules": modules,
        "mapping_verified": all(item["verified"] for item in modules.values()),
    }


class ZohoCRMMetadataVerifier:
    async def verify(self) -> dict:
        client_id, client_secret, refresh_token, accounts_url = _zoho_credentials()
        async with httpx.AsyncClient(timeout=20) as client:
            access_token, api_domain = await _refresh_zoho_access_token(
                client, client_id, client_secret, refresh_token, accounts_url
            )
            headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
            try:
                modules_response = await client.get(
                    f"{api_domain}/crm/v6/settings/modules",
                    headers=headers,
                )
                modules_response.raise_for_status()
                modules_body = modules_response.json()
            except httpx.TimeoutException as exc:
                raise ZohoIntegrationError("Zoho CRM metadata request timed out.") from exc
            except httpx.HTTPStatusError as exc:
                raise ZohoIntegrationError(f"Zoho CRM metadata request failed (HTTP {exc.response.status_code}).") from exc
            except httpx.RequestError as exc:
                raise ZohoIntegrationError("Zoho CRM metadata is unavailable.") from exc
            except ValueError as exc:
                raise ZohoIntegrationError("Zoho CRM returned invalid module metadata.") from exc

            module_items = modules_body.get("modules") if isinstance(modules_body, dict) else None
            available_modules = {
                module.get("api_name")
                for module in module_items
                if isinstance(module, dict) and isinstance(module.get("api_name"), str)
            } if isinstance(module_items, list) else set()

            metadata: dict[str, list[dict]] = {}
            for module in ZOHO_FIELD_MAPPING:
                if module not in available_modules:
                    metadata[module] = []
                    continue
                try:
                    response = await client.get(
                        f"{api_domain}/crm/v6/settings/fields",
                        params={"module": module},
                        headers=headers,
                    )
                    response.raise_for_status()
                    body = response.json()
                except httpx.TimeoutException as exc:
                    raise ZohoIntegrationError(f"Zoho {module} field metadata request timed out.") from exc
                except httpx.HTTPStatusError as exc:
                    raise ZohoIntegrationError(f"Zoho {module} field metadata request failed (HTTP {exc.response.status_code}).") from exc
                except httpx.RequestError as exc:
                    raise ZohoIntegrationError(f"Zoho {module} field metadata is unavailable.") from exc
                except ValueError as exc:
                    raise ZohoIntegrationError(f"Zoho returned invalid {module} field metadata.") from exc
                fields = body.get("fields") if isinstance(body, dict) else None
                if not isinstance(fields, list):
                    raise ZohoIntegrationError(f"Zoho returned invalid field metadata for module {module}.")
                metadata[module] = [field for field in fields if isinstance(field, dict)]

        result = compare_zoho_field_metadata(metadata, available_modules)
        result["flow_delivery_ready"] = (
            os.environ.get("ZOHO_FLOW_ENABLED") == "true"
            and os.environ.get("ZOHO_MAPPING_APPROVED") == "true"
            and bool(os.environ.get("ZOHO_FLOW_WEBHOOK_URL"))
            and result["mapping_verified"]
        )
        result["direct_crm_writes_enabled"] = False
        return result


def _build_flow_payload(capture: dict, qualification: dict) -> tuple[dict, str | None]:
    source_fields = capture.get("manual_fields") or capture.get("extracted_fields") or {}
    if not isinstance(source_fields, dict):
        raise ZohoIntegrationError("Lead fields are not available for Zoho Flow.")

    full_name = source_fields.get("full_name") or " ".join(
        str(value).strip()
        for value in (source_fields.get("first_name"), source_fields.get("last_name"))
        if value
    )
    name_parts = str(full_name).strip().split()
    if not name_parts:
        raise ZohoIntegrationError("A lead name is required before sending to Zoho Flow.")
    email = source_fields.get("email")
    normalized_email = email.strip().casefold() if isinstance(email, str) and email.strip() else None
    operation = "update" if capture.get("zoho_lead_id") else "create"
    payload = {
        "schema_version": 1,
        "capture_id": capture["id"],
        "capture_code": capture["capture_code"],
        "event_code": capture["event_code"],
        "capture_method": capture["capture_method"],
        "captured_at": capture["created_at"],
        "operation": operation,
        "zoho_lead_id": capture.get("zoho_lead_id"),
        "match_email": normalized_email,
        "lead": {
            "full_name": " ".join(name_parts),
            "first_name": source_fields.get("first_name") or (name_parts[0] if len(name_parts) > 1 else None),
            "last_name": source_fields.get("last_name") or (name_parts[-1] if len(name_parts) > 1 else name_parts[0]),
            "institution": source_fields.get("institution"),
            "designation": source_fields.get("designation"),
            "email": normalized_email,
            "mobile": source_fields.get("mobile"),
            "alternate_phone": source_fields.get("alternate_phone"),
            "website": source_fields.get("website"),
            "city": source_fields.get("city"),
            "state": source_fields.get("state"),
            "country": source_fields.get("country"),
            "address": source_fields.get("address"),
        },
        "qualification": qualification,
    }
    return payload, operation


class ZohoFlowLeadAdapter:
    async def execute(self, capture: dict, qualification: dict) -> IntegrationResult:
        if os.environ.get("ZOHO_FLOW_ENABLED") != "true":
            raise ZohoIntegrationError("Zoho Flow delivery is disabled.")
        if os.environ.get("ZOHO_MAPPING_APPROVED") != "true":
            raise ZohoIntegrationError("The Zoho Flow field mapping has not been approved.")
        flow_url = os.environ.get("ZOHO_FLOW_WEBHOOK_URL", "")
        parsed_flow_url = urlparse(flow_url)
        if (
            parsed_flow_url.scheme != "https"
            or not parsed_flow_url.netloc
            or parsed_flow_url.username
            or parsed_flow_url.password
            or parsed_flow_url.fragment
        ):
            raise ZohoIntegrationError("ZOHO_FLOW_WEBHOOK_URL must be an HTTPS webhook URL.")
        client_id, client_secret, refresh_token, accounts_url = _zoho_credentials()

        async with httpx.AsyncClient(timeout=20) as client:
            access_token, api_domain = await _refresh_zoho_access_token(
                client, client_id, client_secret, refresh_token, accounts_url
            )
            source_fields = capture.get("manual_fields") or capture.get("extracted_fields") or {}
            email = source_fields.get("email") if isinstance(source_fields, dict) else None
            normalized_email = email.strip().casefold() if isinstance(email, str) and email.strip() else None
            matched_lead_id: str | None = None
            if normalized_email:
                try:
                    search_response = await client.get(
                        f"{api_domain}/crm/v6/Leads/search",
                        params={"email": normalized_email},
                        headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
                    )
                    if search_response.status_code != 204:
                        search_response.raise_for_status()
                        search_body = search_response.json()
                        matches = search_body.get("data") if isinstance(search_body, dict) else None
                        if not isinstance(matches, list):
                            raise ZohoIntegrationError("Zoho email search returned invalid lead data.")
                        exact_matches = [
                            item for item in matches
                            if isinstance(item, dict)
                            and isinstance(item.get("Email"), str)
                            and item["Email"].strip().casefold() == normalized_email
                        ]
                        if len(exact_matches) > 1:
                            raise ZohoIntegrationError("Multiple Zoho Leads use this email; resolve the duplicate before sending.")
                        if exact_matches:
                            lead_id = exact_matches[0].get("id")
                            if not isinstance(lead_id, str) or not lead_id:
                                raise ZohoIntegrationError("The matching Zoho Lead has no record ID.")
                            matched_lead_id = lead_id
                except ZohoIntegrationError:
                    raise
                except httpx.TimeoutException as exc:
                    raise ZohoIntegrationError("Zoho CRM email search timed out.") from exc
                except httpx.HTTPStatusError as exc:
                    raise ZohoIntegrationError(f"Zoho CRM email search failed (HTTP {exc.response.status_code}).") from exc
                except httpx.RequestError as exc:
                    raise ZohoIntegrationError("Zoho CRM email search is unavailable.") from exc
                except ValueError as exc:
                    raise ZohoIntegrationError("Zoho CRM email search returned invalid JSON.") from exc

            flow_capture = dict(capture)
            flow_capture["zoho_lead_id"] = matched_lead_id
            payload, operation = _build_flow_payload(flow_capture, qualification)
            try:
                flow_response = await client.post(
                    flow_url,
                    json=payload,
                    headers={"Idempotency-Key": str(capture["id"])},
                )
                flow_response.raise_for_status()
            except httpx.TimeoutException as exc:
                raise ZohoIntegrationError("Zoho Flow webhook timed out.") from exc
            except httpx.HTTPStatusError as exc:
                raise ZohoIntegrationError(f"Zoho Flow webhook rejected the lead (HTTP {exc.response.status_code}).") from exc
            except httpx.RequestError as exc:
                raise ZohoIntegrationError("Zoho Flow webhook is unavailable.") from exc

        return IntegrationResult(
            status="Sent to Zoho Flow",
            reference=matched_lead_id,
            message="Zoho Flow received the lead payload.",
            operation=operation,
        )


async def _verify_zoho() -> int:
    result = await ZohoCRMMetadataVerifier().verify()
    print(json.dumps(result, indent=2))
    return 0 if result["mapping_verified"] else 2


def main() -> None:
    parser = argparse.ArgumentParser(description="EventConnect integration administration")
    parser.add_argument("command", choices=["verify-zoho-metadata"])
    args = parser.parse_args()
    if args.command == "verify-zoho-metadata":
        raise SystemExit(asyncio.run(_verify_zoho()))


if __name__ == "__main__":
    main()
