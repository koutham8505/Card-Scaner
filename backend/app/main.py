from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any
from uuid import UUID

import os
import hmac
import httpx
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

from app.integrations import ZohoFlowLeadAdapter, ZohoIntegrationError
from app.store import Store, utcnow

app = FastAPI(title="Rareminds EventConnect API", version="0.2.0")
store = Store()
UPLOADS = Path(__file__).resolve().parents[1] / "data" / "uploads"
if os.environ.get("EVENTCONNECT_ENV") != "production":
    UPLOADS.mkdir(parents=True, exist_ok=True)

_cors_origins = [origin.strip() for origin in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Idempotency-Key", "Content-Type", "X-EventConnect-Proxy-Token", "X-Supabase-Access-Token"],
)


async def validate_staff_session(access_token: str) -> tuple[bool, int, dict[str, str] | str]:
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not supabase_url or not anon_key or not service_key:
        return False, 503, "Supabase authentication is not configured."

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            user_response = await client.get(
                f"{supabase_url}/auth/v1/user",
                headers={"apikey": anon_key, "Authorization": f"Bearer {access_token}"},
            )
            if user_response.status_code in (401, 403):
                return False, 401, "Authentication required."
            user_response.raise_for_status()
            user = user_response.json()
            user_id = user.get("id") if isinstance(user, dict) else None
            if not isinstance(user_id, str):
                return False, 401, "Authentication required."

            profile_response = await client.get(
                f"{supabase_url}/rest/v1/staff_profiles",
                params={
                    "auth_user_id": f"eq.{user_id}",
                    "select": "role,active",
                    "limit": "1",
                },
                headers={
                    "apikey": service_key,
                    "Authorization": f"Bearer {service_key}",
                },
            )
            profile_response.raise_for_status()
            profiles = profile_response.json()
    except httpx.TimeoutException:
        return False, 503, "Supabase authentication timed out."
    except httpx.HTTPStatusError:
        return False, 503, "Supabase authentication could not be verified."
    except httpx.RequestError:
        return False, 503, "Supabase authentication is unavailable."

    if not isinstance(profiles, list) or not profiles:
        return False, 403, "No staff profile is assigned to this account."
    profile = profiles[0]
    if not isinstance(profile, dict) or profile.get("active") is not True:
        return False, 403, "This staff account is inactive."
    if profile.get("role") not in {"super_admin", "event_manager", "booth_staff", "sales_rep"}:
        return False, 403, "This staff account has no valid role."
    return True, 200, {"user_id": user_id, "role": profile["role"]}


def require_roles(request: Request, allowed_roles: set[str]) -> None:
    role = getattr(request.state, "staff_role", None)
    if role not in allowed_roles:
        raise HTTPException(403, "This staff role cannot perform this operation.")


def record_audit(request: Request, action: str, entity_type: str, entity_id: str, new_values: dict | None = None) -> None:
    store.record_audit(
        actor_id=getattr(request.state, "staff_user_id", None),
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        new_values=new_values,
    )


async def deliver_zoho_flow(capture: dict) -> dict:
    if (
        os.environ.get("ZOHO_FLOW_ENABLED") != "true"
        or os.environ.get("ZOHO_MAPPING_APPROVED") != "true"
        or not os.environ.get("ZOHO_FLOW_WEBHOOK_URL")
    ):
        return {
            "status": "Pending Configuration",
            "message": "Lead is backed up; Zoho Flow delivery is not configured.",
        }

    try:
        result = await ZohoFlowLeadAdapter().execute(capture, capture.get("qualification", {}))
    except ZohoIntegrationError as error:
        store.set_crm_sync_job_status(capture["id"], "Failed", str(error))
        return {"status": "Failed", "message": str(error)}

    store.set_crm_sync_job_status(capture["id"], "Completed")
    return {
        "status": result.status,
        "operation": result.operation,
        "message": result.message,
    }


@app.middleware("http")
async def require_proxy_token(request, call_next):
    if request.url.path.startswith("/api/v1/") and request.url.path != "/api/v1/health":
        expected = os.environ.get("EVENTCONNECT_API_TOKEN", "")
        if len(expected) < 32:
            return JSONResponse(
                {"detail": "Backend authentication is not configured."},
                status_code=503,
            )
        supplied = request.headers.get("X-EventConnect-Proxy-Token", "")
        if not hmac.compare_digest(supplied, expected):
            return JSONResponse({"detail": "Authentication required."}, status_code=401)
        if (
            os.environ.get("EVENTCONNECT_TEST_AUTH_BYPASS") == "true"
            and os.environ.get("EVENTCONNECT_ENV") != "production"
        ):
            request.state.staff_user_id = "test-staff"
            request.state.staff_role = "super_admin"
            return await call_next(request)
        access_token = request.headers.get("X-Supabase-Access-Token", "")
        if not access_token:
            return JSONResponse({"detail": "Authentication required."}, status_code=401)
        valid, status, result = await validate_staff_session(access_token)
        if not valid:
            return JSONResponse({"detail": result}, status_code=status)
        if isinstance(result, dict):
            request.state.staff_user_id = result["user_id"]
            request.state.staff_role = result["role"]
    return await call_next(request)


ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 15 * 1024 * 1024


class Verification(BaseModel):
    fields: dict[str, Any]
    reviewed_by: str | None = None


class Qualification(BaseModel):
    visitor_category: str | None = None
    visitor_role: str | None = None
    product_interests: list[str] = Field(default_factory=list)
    lead_priority: str = "Cold"
    conversation_outcome: str | None = None
    next_action: str | None = None
    notes: str | None = None
    decision_maker: bool | None = None
    expected_timeline: str | None = None
    estimated_value: float | None = None
    assigned_owner: str | None = None
    follow_up_at: str | None = None
    demo_date: date | None = None
    consent_status: str = "unknown"
    consent_source: str | None = None
    consent_timestamp: str | None = None

    @model_validator(mode="after")
    def require_demo_date_for_demo_action(self) -> Qualification:
        if self.next_action == "Schedule Demo" and self.demo_date is None:
            raise ValueError("A demo date is required when the next action is Schedule Demo.")
        return self


class ManualCapture(BaseModel):
    capture_id: UUID
    event_code: str = "DIDAC26"
    fields: dict[str, Any]
    qualification: Qualification


class QRRegistration(BaseModel):
    capture_id: UUID
    event_code: str = "DIDAC26"
    full_name: str
    institution: str | None = None
    designation: str | None = None
    email: str | None = None
    mobile: str | None = None
    city: str | None = None
    state: str | None = None
    country: str = "India"
    consent_status: str
    consent_source: str = "QR check-in"


class OCRInput(BaseModel):
    front_raw_text: str = ""
    back_raw_text: str = ""


class EventCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    event_code: str = Field(min_length=2, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    venue: str | None = Field(default=None, max_length=300)
    start_date: str | None = None
    end_date: str | None = None


async def save_image(capture_id: str, side: str, upload: UploadFile) -> str:
    if upload.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, f"Unsupported image type: {upload.content_type}")
    extension = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[upload.content_type]
    size = 0
    chunks: list[bytes] = []
    while chunk := await upload.read(1024 * 1024):
        size += len(chunk)
        if size > MAX_BYTES:
            raise HTTPException(413, f"{side} image exceeds 15 MB")
        chunks.append(chunk)

    supabase_storage_enabled = (
        os.environ.get("EVENTCONNECT_SUPABASE_STORAGE_ENABLED") == "true"
        or os.environ.get("EVENTCONNECT_ENV") == "production"
    )
    if supabase_storage_enabled and os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        from app.storage import SupabaseStorage

        try:
            return SupabaseStorage().upload(
                f"{capture_id}/{side}.{extension}", b"".join(chunks), upload.content_type
            )
        except RuntimeError as error:
            raise HTTPException(503, str(error)) from error
    if os.environ.get("EVENTCONNECT_ENV") == "production":
        raise HTTPException(503, "Private Supabase image storage is not configured.")

    capture_dir = UPLOADS / capture_id
    capture_dir.mkdir(parents=True, exist_ok=True)
    target = capture_dir / f"{side}.{extension}"
    target.write_bytes(b"".join(chunks))
    return str(target)


@app.get("/api/v1/health")
def health() -> dict:
    database = "PostgreSQL" if store.database_url else "SQLite (local only)"
    zoho_flow_configured = (
        os.environ.get("ZOHO_FLOW_ENABLED") == "true"
        and os.environ.get("ZOHO_MAPPING_APPROVED") == "true"
        and bool(os.environ.get("ZOHO_FLOW_WEBHOOK_URL"))
        and all(os.environ.get(name) for name in ("ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"))
    )
    return {
        "ok": True,
        "service": "rareminds-eventconnect",
        "status": "healthy" if store.database_url else "development-only",
        "persistence": database,
        "config": {
            "supabase": "Configured" if store.database_url and os.environ.get("SUPABASE_SERVICE_ROLE_KEY") else "Pending Configuration",
            "google_drive": "Writes disabled pending Shared Drive access verification",
            "zoho_crm": "Zoho Flow configured" if zoho_flow_configured else "Zoho Flow disabled or pending configuration",
            "qr_registration": "Enabled" if os.environ.get("EVENTCONNECT_QR_ENABLED") == "true" else "Disabled pending payload validation",
        },
    }


@app.post("/api/v1/auth/session")
def verify_auth_session(request: Request) -> dict:
    return {
        "authenticated": True,
        "user_id": request.state.staff_user_id,
        "role": request.state.staff_role,
    }


@app.get("/api/v1/events")
def list_events(request: Request) -> list[dict]:
    require_roles(request, {"super_admin", "event_manager", "booth_staff", "sales_rep"})
    return store.list_events()


@app.post("/api/v1/events", status_code=201)
def create_event(request: Request, payload: EventCreate) -> dict:
    require_roles(request, {"super_admin", "event_manager"})
    try:
        event = store.create_event(
            payload.name.strip(),
            payload.event_code.strip(),
            payload.venue.strip() if payload.venue else None,
            payload.start_date,
            payload.end_date,
        )
        record_audit(request, "event.create", "event", str(event["id"]), payload.model_dump())
        return event
    except ValueError as exc:
        raise HTTPException(409, "An event with this code already exists.") from exc


@app.post("/api/v1/captures", status_code=202)
async def create_capture(request: Request, capture_id: UUID = Form(...), event_code: str = Form(...), capture_method: str = Form(...), front: UploadFile = File(...), back: UploadFile | None = File(default=None), idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")) -> dict:
    require_roles(request, {"super_admin", "event_manager", "booth_staff"})
    key = idempotency_key or str(capture_id)
    existing = store.find_by_idempotency(key)
    if existing:
        return JSONResponse(content=existing, status_code=200)
    front_path = await save_image(str(capture_id), "front", front)
    back_path = await save_image(str(capture_id), "back", back) if back else None
    try:
        capture = store.create_capture(str(capture_id), event_code, capture_method, key, front_path, back_path)
    except ValueError:
        raise HTTPException(409, "Capture ID conflicts with a different idempotency key")
    record_audit(request, "capture.create", "capture", str(capture_id), {"capture_method": capture_method})
    return capture


@app.post("/api/v1/captures/manual")
async def create_manual_capture(request: Request, payload: ManualCapture) -> dict:
    require_roles(request, {"super_admin", "event_manager", "booth_staff", "sales_rep"})
    capture_id = str(payload.capture_id)
    try:
        capture = store.create_manual_capture(
            capture_id,
            payload.event_code,
            payload.fields,
            payload.qualification.model_dump(mode="json", exclude_none=True),
        )
        capture["crm_sync"] = await deliver_zoho_flow(capture)
        record_audit(request, "capture.manual_create", "capture", capture_id)
        return capture
    except ValueError:
        raise HTTPException(409, "A capture with this ID already exists")


@app.get("/api/v1/captures")
def list_captures(request: Request) -> list[dict]:
    require_roles(request, {"super_admin", "event_manager", "booth_staff", "sales_rep"})
    return store.list_captures()


@app.get("/api/v1/captures/{capture_id}")
def get_capture(request: Request, capture_id: str) -> dict:
    require_roles(request, {"super_admin", "event_manager", "booth_staff", "sales_rep"})
    try:
        return store.get_capture(capture_id)
    except KeyError:
        raise HTTPException(404, "Capture not found")


@app.post("/api/v1/captures/{capture_id}/ocr")
def run_ocr(request: Request, capture_id: str, payload: OCRInput) -> dict:
    require_roles(request, {"super_admin", "event_manager", "booth_staff", "sales_rep"})
    from app.ocr import extract_text_from_image, merge
    try:
        capture = store.get_capture(capture_id)
    except KeyError:
        raise HTTPException(404, "Capture not found")

    # If the caller supplied raw text use it directly; otherwise try to read
    # the stored image files with Tesseract.
    front_text = payload.front_raw_text
    back_text = payload.back_raw_text

    try:
        from contextlib import ExitStack
        from app.storage import SupabaseStorage

        with ExitStack() as stack:
            for side, field_name in (("front", "front_path"), ("back", "back_path")):
                image_path = capture.get(field_name)
                if not image_path:
                    continue
                if image_path.startswith("supabase://"):
                    image_path = stack.enter_context(SupabaseStorage().local_copy(image_path))
                if side == "front" and not front_text:
                    front_text = extract_text_from_image(image_path)
                elif side == "back" and not back_text:
                    back_text = extract_text_from_image(image_path)
    except RuntimeError as error:
        raise HTTPException(503, str(error)) from error
    except OSError as error:
        raise HTTPException(422, "Stored card image could not be decoded.") from error

    parsed = merge(front_text, back_text)
    capture = store.update_ocr(
        capture_id,
        front_text,
        back_text,
        parsed["fields"],
        parsed["confidences"],
        parsed["sources"],
        parsed["conflicts"],
    )
    record_audit(request, "capture.ocr", "capture", capture_id)
    return capture


@app.patch("/api/v1/captures/{capture_id}/verify")
def verify_capture(request: Request, capture_id: str, payload: Verification) -> dict:
    require_roles(request, {"super_admin", "event_manager", "booth_staff", "sales_rep"})
    try:
        capture = store.verify_capture(capture_id, payload.fields)
        record_audit(request, "capture.verify", "capture", capture_id, payload.fields)
        return capture
    except KeyError:
        raise HTTPException(404, "Capture not found")


@app.post("/api/v1/captures/{capture_id}/qualify")
async def qualify_capture(request: Request, capture_id: str, payload: Qualification) -> dict:
    require_roles(request, {"super_admin", "event_manager", "booth_staff", "sales_rep"})
    try:
        qualification = payload.model_dump(mode="json", exclude_none=True)
        capture = store.qualify_capture(capture_id, qualification)
        capture["crm_sync"] = await deliver_zoho_flow(capture)
        record_audit(request, "capture.qualify", "capture", capture_id, qualification)
        return capture
    except KeyError:
        raise HTTPException(404, "Capture not found")


@app.get("/api/v1/leads")
def list_leads(request: Request, q: str = "", priority: str = "") -> list[dict]:
    require_roles(request, {"super_admin", "event_manager", "booth_staff", "sales_rep"})
    return store.list_leads(q, priority)


@app.get("/api/v1/tasks")
def list_tasks(request: Request) -> list[dict]:
    require_roles(request, {"super_admin", "event_manager", "booth_staff", "sales_rep"})
    return store.list_tasks()


@app.get("/api/v1/sync-jobs")
def sync_jobs(request: Request) -> list[dict]:
    require_roles(request, {"super_admin", "event_manager"})
    return store.list_sync_jobs()


@app.post("/api/v1/captures/{capture_id}/sync/zoho-flow")
async def retry_zoho_flow_sync(request: Request, capture_id: str) -> dict:
    require_roles(request, {"super_admin", "event_manager"})
    try:
        capture = store.get_capture(capture_id)
    except KeyError as error:
        raise HTTPException(404, "Capture not found") from error
    if capture["status"] != "Qualified":
        raise HTTPException(409, "Only qualified leads can be sent to Zoho Flow.")
    if not store.requeue_crm_sync_job(capture_id):
        raise HTTPException(409, "No retryable Zoho Flow delivery job exists for this lead.")
    result = await deliver_zoho_flow(capture)
    record_audit(request, "lead.zoho_flow_retry", "capture", capture_id, {"status": result["status"]})
    return {"capture_id": capture_id, "crm_sync": result}


@app.get("/api/v1/dashboard/summary")
def dashboard_summary(request: Request) -> dict:
    require_roles(request, {"super_admin", "event_manager", "sales_rep"})
    return store.dashboard()


@app.post("/api/v1/qr/register")
async def qr_register(request: Request, payload: QRRegistration) -> dict:
    require_roles(request, {"super_admin", "event_manager", "booth_staff"})
    if os.environ.get("EVENTCONNECT_QR_ENABLED") != "true":
        raise HTTPException(503, "QR registration is disabled pending event payload validation.")
    if payload.consent_status not in {"granted", "declined", "verbal"}:
        raise HTTPException(422, "A consent status must be recorded before registration.")
    fields = payload.model_dump(
        exclude={"capture_id", "event_code", "consent_status", "consent_source"}
    )
    qualification = {
        "lead_priority": "Warm",
        "next_action": "No Action",
        "consent_status": payload.consent_status,
        "consent_source": payload.consent_source,
        "consent_timestamp": utcnow(),
    }
    try:
        capture = store.create_manual_capture(
            str(payload.capture_id),
            payload.event_code,
            fields,
            qualification,
            method="qr",
        )
        capture["crm_sync"] = await deliver_zoho_flow(capture)
        record_audit(request, "qr.register", "capture", str(payload.capture_id), {"consent_status": payload.consent_status})
        return capture
    except ValueError as error:
        raise HTTPException(409, "This QR registration has already been submitted.") from error
