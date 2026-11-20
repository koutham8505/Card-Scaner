# Rareminds EventConnect

A mobile-first event lead capture and qualification platform for DIDAC 2026 and reusable Rareminds events.

## Current implementation

- Mobile front/back camera or gallery capture with image type and 15 MB validation
- FastAPI capture, OCR review, qualification, Supabase-backed lead storage, and dashboard
- SQLite/local images for development; PostgreSQL and private Supabase Storage when configured
- Shared-password access gate with a signed, expiring HttpOnly app session
- Server-to-server API token protects the FastAPI service; Supabase Auth is not used for app sign-in
- Production-mode startup guard requires PostgreSQL and Supabase configuration
- IndexedDB offline capture queue with manual/online retry; disabled by default until the organization approves the unencrypted local image storage risk and browser recovery is validated
- QR visitor scan/review with consent capture and backend lead persistence; disabled by default until the actual event payload is validated
- Zoho email matching and Zoho Flow webhook delivery are implemented but disabled until credentials, webhook configuration, and field mapping approval are supplied; EventConnect does not create follow-up tasks
- Google Drive integration and automatic background workers remain unimplemented; failed Zoho Flow jobs can be retried from the Sync Monitor

## Run frontend

```powershell
Set-Location .\rareminds-eventconnect
npm ci
npm run dev
```

Open `http://localhost:3000`. Camera access requires HTTPS or localhost.

## Run backend

```powershell
Set-Location .\rareminds-eventconnect\backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000/docs` for OpenAPI. Local SQLite mode is development-only.

## Tests

```powershell
Set-Location .\rareminds-eventconnect
npm run lint
npm run build
Set-Location .\backend
python -m pytest -q
```

## Staging setup

Apply the migrations in `supabase/migrations/` to a reviewed staging project. Configure the environment variables from `.env.example` in server-side secret stores. The shared access password is common to all staff; rotate it when access should be revoked. Do not expose the access password, session secret, API token, or service-role key through `NEXT_PUBLIC_*`.

The staging connection must be exercised before launch. Google Drive/Zoho integration, browser-level offline recovery, real QR payload validation, access-password rate limiting, privacy/retention procedures, backups, monitoring, and UAT are still release blockers. See [production readiness](PRODUCTION_READINESS.md), [integration status](INTEGRATION_STATUS.md), and the [deployment guide](docs/DEPLOYMENT.md).
