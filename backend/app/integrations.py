import argparse
import asyncio
import json
import os
from dataclasses import dataclass
from urllib.parse import urlparse
from typing import Protocol

import httpx


@dataclass(frozen=True)
class IntegrationResult:
    status: str
    reference: str | None = None
    message: str | None = None


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


ZOHO_FIELD_MAPPING: dict[str, tuple[str, ...]] = {
    "Leads": (
        "First_Name",
        "Last_Name",
        "Company",
        "Designation",
        "Phone",
        "Mobile",
        "Email",
        "Website",
        "Lead_Source",
        "Lead_Status",
        "Description",
        "Owner",
    ),
    "Contacts": (
        "First_Name",
        "Last_Name",
        "Mobile",
        "Phone",
        "Email",
        "Title",
        "Account_Name",
    ),
    "Accounts": (
        "Account_Name",
        "Phone",
        "Website",
        "Industry",
        "Billing_Street",
        "Billing_City",
        "Billing_State",
        "Billing_Code",
        "Billing_Country",
    ),
    "Tasks": (
        "Subject",
        "Due_Date",
        "Status",
        "Priority",
        "Description",
        "Who_Id",
        "What_Id",
        "Owner",
    ),
}


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

    drive_url_fields = [
        field.get("api_name")
        for field in metadata.get("Leads", [])
        if isinstance(field, dict)
        and isinstance(field.get("api_name"), str)
        and str(field.get("field_label", "")).strip().casefold() == "google drive folder url"
    ]
    drive_url_verified = len(drive_url_fields) == 1
    return {
        "modules": modules,
        "google_drive_folder_url": {
            "verified": drive_url_verified,
            "api_names": drive_url_fields,
            "message": None if drive_url_verified else "Custom field API name is not available yet.",
        },
        "mapping_verified": all(item["verified"] for item in modules.values()) and drive_url_verified,
    }


class ZohoCRMMetadataVerifier:
    def __init__(self) -> None:
        self.client_id = os.environ.get("ZOHO_CLIENT_ID", "")
        self.client_secret = os.environ.get("ZOHO_CLIENT_SECRET", "")
        self.refresh_token = os.environ.get("ZOHO_REFRESH_TOKEN", "")
        self.accounts_url = os.environ.get(
            "ZOHO_ACCOUNTS_URL", "https://accounts.zoho.com"
        ).rstrip("/")

    async def verify(self) -> dict:
        missing = [
            name
            for name, value in (
                ("ZOHO_CLIENT_ID", self.client_id),
                ("ZOHO_CLIENT_SECRET", self.client_secret),
                ("ZOHO_REFRESH_TOKEN", self.refresh_token),
            )
            if not value
        ]
        if missing:
            raise RuntimeError("Zoho metadata verification requires: " + ", ".join(missing))
        accounts = urlparse(self.accounts_url)
        if (
            accounts.scheme != "https"
            or not accounts.netloc
            or accounts.username
            or accounts.password
            or accounts.path not in ("", "/")
        ):
            raise RuntimeError("ZOHO_ACCOUNTS_URL must be an HTTPS origin.")

        async with httpx.AsyncClient(timeout=20) as client:
            token_response = await client.post(
                f"{self.accounts_url}/oauth/v2/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "refresh_token": self.refresh_token,
                },
            )
            token_response.raise_for_status()
            token_data = token_response.json()
            if not isinstance(token_data, dict):
                raise RuntimeError("Zoho OAuth returned an invalid response.")
            access_token = token_data.get("access_token")
            api_domain = token_data.get("api_domain")
            parsed_domain = urlparse(api_domain) if isinstance(api_domain, str) else None
            valid_domain_suffixes = (
                ".zohoapis.com",
                ".zohoapis.eu",
                ".zohoapis.in",
                ".zohoapis.com.au",
                ".zohoapis.jp",
                ".zohoapis.ca",
                ".zohoapis.sa",
                ".zohoapis.com.cn",
            )
            if (
                not isinstance(access_token, str)
                or not access_token
                or parsed_domain is None
                or parsed_domain.scheme != "https"
                or not parsed_domain.netloc
                or parsed_domain.path not in ("", "/")
                or parsed_domain.hostname is None
                or not any(parsed_domain.hostname.endswith(suffix) for suffix in valid_domain_suffixes)
            ):
                raise RuntimeError("Zoho OAuth response did not contain a valid access token and API domain.")

            headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
            modules_response = await client.get(
                f"{api_domain.rstrip('/')}/crm/v6/settings/modules",
                headers=headers,
            )
            modules_response.raise_for_status()
            modules_body = modules_response.json()
            available_modules = {
                module.get("api_name")
                for module in modules_body.get("modules", [])
                if isinstance(module, dict) and isinstance(module.get("api_name"), str)
            } if isinstance(modules_body, dict) and isinstance(modules_body.get("modules"), list) else set()

            metadata: dict[str, list[dict]] = {}
            for module in ZOHO_FIELD_MAPPING:
                if module not in available_modules:
                    metadata[module] = []
                    continue
                response = await client.get(
                    f"{api_domain.rstrip('/')}/crm/v6/settings/fields",
                    params={"module": module},
                    headers=headers,
                )
                response.raise_for_status()
                body = response.json()
                fields = body.get("fields") if isinstance(body, dict) else None
                if not isinstance(fields, list):
                    raise RuntimeError(f"Zoho returned invalid field metadata for module {module}.")
                metadata[module] = [field for field in fields if isinstance(field, dict)]

        result = compare_zoho_field_metadata(metadata, available_modules)
        result["write_authorization_ready"] = (
            os.environ.get("ZOHO_WRITE_ENABLED") == "true"
            and os.environ.get("ZOHO_MAPPING_APPROVED") == "true"
            and result["mapping_verified"]
        )
        result["writes_enabled"] = False
        return result


class ZohoCRMAdapter:
    def execute(self, capture_id: str) -> IntegrationResult:
        return IntegrationResult(
            "Disabled pending metadata verification and approval",
            message="Zoho writes remain disabled until live field metadata is verified and the mapping is approved.",
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
