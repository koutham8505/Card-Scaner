# Rareminds EventConnect

A mobile-first event lead capture and qualification platform for DIDAC 2026 and reusable Rareminds events.

## Current implementation

- Mobile front/back camera or gallery capture with image type and 15 MB validation
- FastAPI capture, OCR review, qualification, lead/task projections, and dashboard
- SQLite/local images for development; PostgreSQL and private Supabase Storage when configured
- Supabase Auth email/password sign-in, signed HttpOnly app session, and active staff profile validation
- Production-mode startup guard requires PostgreSQL and Supabase configuration
- IndexedDB offline capture queue with manual/online retry; disabled by default until the organization approves the unencrypted local image storage risk and browser recovery is validated
- QR visitor scan/review with consent capture and backend lead persistence; disabled by default until the actual event payload is validated
- Google Drive and Zoho CRM adapters, background integration workers, and role-specific API permissions remain unimplemented

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

Apply the core and runtime migrations in `supabase/migrations/` to a reviewed staging project. Configure the environment variables from `.env.example` in server-side secret stores, create individual Supabase Auth users, and provision matching active `staff_profiles` rows. Never expose service-role keys or auth tokens through `NEXT_PUBLIC_*`.

The staging connection must be exercised before launch. Google Drive/Zoho integration, browser-level offline recovery, real QR payload validation, role-specific authorization, privacy/retention procedures, backups, monitoring, and UAT are still release blockers. See [production readiness](PRODUCTION_READINESS.md), [integration status](INTEGRATION_STATUS.md), and the [deployment guide](docs/DEPLOYMENT.md).
