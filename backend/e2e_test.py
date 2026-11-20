"""End-to-end smoke test against an explicitly running local API."""
import json
import os
import sys
import urllib.request
import uuid

BASE = "http://localhost:8000"
API_TOKEN = os.environ.get("EVENTCONNECT_API_TOKEN", "")


def jget(path):
    request = urllib.request.Request(
        f"{BASE}{path}",
        headers={"X-EventConnect-Proxy-Token": API_TOKEN},
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


def jpost(path, payload, method="POST"):
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode(),
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-EventConnect-Proxy-Token": API_TOKEN,
        },
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


def multipart_capture(capture_id):
    boundary = b"TestBoundary99"
    jpeg = bytes([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
    ])

    def part(name, value, filename=None, content_type=None):
        disposition = f'Content-Disposition: form-data; name="{name}"'
        if filename:
            disposition += f'; filename="{filename}"'
        headers = disposition.encode() + b"\r\n"
        if content_type:
            headers += f"Content-Type: {content_type}\r\n".encode()
        return b"--" + boundary + b"\r\n" + headers + b"\r\n" + value + b"\r\n"

    body = b"".join([
        part("capture_id", capture_id.encode()),
        part("event_code", b"DIDAC26"),
        part("capture_method", b"scanner"),
        part("front", jpeg, filename="front.jpg", content_type="image/jpeg"),
        b"--" + boundary + b"--\r\n",
    ])
    request = urllib.request.Request(
        f"{BASE}/api/v1/captures",
        data=body,
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary.decode()}",
            "Idempotency-Key": capture_id,
            "X-EventConnect-Proxy-Token": API_TOKEN,
        },
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


def main():
    if len(API_TOKEN) < 32:
        raise SystemExit(
            "Set EVENTCONNECT_API_TOKEN (at least 32 characters) before running this smoke test."
        )

    results = {"ok": True}

    def check(label, condition, got=""):
        if condition:
            print(f"  PASS  {label}")
        else:
            print(f"  FAIL  {label} -> {got}")
            results["ok"] = False

    print("\n1. Health")
    health = jget("/api/v1/health")
    check("ok=true", health["ok"] is True)
    check("status=healthy", health["status"] == "healthy")

    print("\n2. Manual capture -> lead")
    capture_id = str(uuid.uuid4())
    capture = jpost("/api/v1/captures/manual", {
        "capture_id": capture_id,
        "event_code": "DIDAC26",
        "fields": {
            "full_name": "E2E Manual User",
            "institution": "Test College",
            "email": "e2e@example.com",
            "mobile": "+919800000001",
            "city": "Bengaluru",
            "state": "Karnataka",
        },
        "qualification": {
            "lead_priority": "Hot",
            "next_action": "Call",
            "consent_status": "granted",
            "notes": "E2E manual test",
        },
    })
    check("capture created", capture.get("capture_code", "").startswith("DIDAC26-"))
    check("status=Qualified", capture["status"] == "Qualified", capture["status"])
    check("verification=qualified", capture["verification_status"] == "qualified")
    leads = jget("/api/v1/leads?q=E2E+Manual+User")
    check("lead in directory", bool(leads))
    check("lead priority=Hot", leads[0]["priority"] == "Hot" if leads else False)

    print("\n3. Scanner capture and OCR review flow")
    scan_id = str(uuid.uuid4())
    scan = multipart_capture(scan_id)
    check("capture received", scan.get("capture_code", "").startswith("DIDAC26-"))
    check("status=Received", "Received" in scan.get("status", ""))
    ocr_text = "Priya Menon\nDirector\nSkillBridge Technologies\npriya@skillbridge.in\n+919800012345"
    ocr = jpost(f"/api/v1/captures/{scan_id}/ocr", {
        "front_raw_text": ocr_text,
        "back_raw_text": "",
    })
    check("OCR extracted name", ocr["extracted_fields"].get("full_name") == "Priya Menon")
    check("OCR extracted email", "email" in ocr["extracted_fields"])
    verified = jpost(
        f"/api/v1/captures/{scan_id}/verify",
        {"fields": ocr["extracted_fields"]},
        method="PATCH",
    )
    check("verification_status=verified", verified["verification_status"] == "verified")
    qualified = jpost(f"/api/v1/captures/{scan_id}/qualify", {
        "lead_priority": "Warm",
        "next_action": "Schedule Demo",
        "consent_status": "granted",
    })
    check("status=Qualified after qualify", qualified["status"] == "Qualified")

    print("\n4. Dashboard and sync state")
    dashboard = jget("/api/v1/dashboard/summary")
    check("dashboard totals present", "totals" in dashboard)
    check("captures include test data", dashboard["totals"]["captures"] >= 2)
    check(
        "no local follow-up task created",
        not any(task.get("capture_id") == scan_id for task in jget("/api/v1/tasks")),
    )
    check(
        "Zoho Flow job created after qualification",
        any(
            job.get("capture_id") == scan_id and job.get("provider") == "zoho_crm"
            for job in jget("/api/v1/sync-jobs")
        ),
    )

    print("\n5. Idempotency")
    repeated = multipart_capture(scan_id)
    check("same capture returned", repeated.get("capture_code") == scan.get("capture_code"))
    if results["ok"]:
        print("\nALL CHECKS PASSED")
        return 0
    print("\nSOME CHECKS FAILED")
    return 1


if __name__ == "__main__":
    sys.exit(main())
