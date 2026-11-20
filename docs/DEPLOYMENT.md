# Deployment Guide

## Required server secrets

Configure these only in the hosting platform's secret manager. Do not send secret values in chat or commit them to the repository.

### Next.js

```dotenv
EVENTCONNECT_SESSION_SECRET=<random secret, at least 32 characters>
EVENTCONNECT_API_URL=https://<cloud-run-service-url>
EVENTCONNECT_API_TOKEN=<same random secret as backend, at least 32 characters>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<Supabase anon key>
NEXT_PUBLIC_ENABLE_OFFLINE_CAPTURE=false
NEXT_PUBLIC_ENABLE_QR_REGISTRATION=false
```

### FastAPI

```dotenv
EVENTCONNECT_ENV=production
EVENTCONNECT_API_TOKEN=<same random secret as frontend, at least 32 characters>
DATABASE_URL=<Supabase PostgreSQL connection string with sslmode=require>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<Supabase anon key>
SUPABASE_SERVICE_ROLE_KEY=<Supabase service-role key>
SUPABASE_STORAGE_BUCKET=eventconnect-cards
EVENTCONNECT_QR_ENABLED=false
ZOHO_WRITE_ENABLED=false
GOOGLE_DRIVE_WRITE_ENABLED=false
GOOGLE_DRIVE_SHARED_DRIVE_ID=<approved-shared-drive-id>
ZOHO_MAPPING_APPROVED=false
CORS_ORIGINS=https://<frontend-host>
```

The backend refuses production startup if PostgreSQL or Supabase auth/storage configuration is missing. The checked-in migration creates only the `eventconnect-cards` bucket. Keep the service-role key backend-only. Cloud Run is publicly reachable with the current Cloudflare-to-Run authentication design; protect data routes with both the proxy token and staff access token, and apply Cloudflare rate limits/WAF controls.

## Supabase setup

1. Create a staging Supabase project and review both migrations:
   - `supabase/migrations/202610260001_eventconnect_core.sql`
   - `supabase/migrations/202611100001_eventconnect_runtime.sql`
2. Apply migrations to staging with a reviewed deployment identity.
3. Configure Supabase Auth email/password and create individual staff accounts.
4. For each enabled Auth user, create an active `staff_profiles` row with matching `auth_user_id`, unique email, and one of `super_admin`, `event_manager`, `booth_staff`, or `sales_rep`.
5. Test that unknown, unprofiled, inactive, and invalid-role accounts are rejected by the backend.
6. Confirm the private bucket is not public; only the backend service role may upload/download.
7. Test a full capture/restart/read/OCR flow against staging before any real lead data is entered.

The backend currently checks that a user has an active staff profile; it does not yet enforce a distinct permission matrix for each role. Review that requirement before production.

## Netlify frontend and separate API backend

Netlify is the frontend host. The repository root contains the Next.js app; use `npm run build` and allow Netlify's Next.js adapter to handle the output. Do not set `.next` as a static publish directory. Netlify environment variables required at runtime are listed above; configure them in Netlify site settings, not in Git.

The Python FastAPI service is separate from the Netlify frontend. Deploy `backend/` to a container-capable host that can run the checked-in Dockerfile, Python dependencies, and Tesseract OCR. Set `EVENTCONNECT_API_URL` in Netlify to that service's HTTPS URL. Set the same randomly generated `EVENTCONNECT_API_TOKEN` on both services. Keep `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the API host only. Restrict ingress where possible, use HTTPS, and apply rate limiting; CORS is not access control.

Netlify and the API host have not yet been deployed or preview-tested. Test login, cookie sessions, proxied API calls, image capture, OCR, and logout in a Netlify deploy preview connected to a staging Supabase project before using real lead data.

## Local development

SQLite and local images are development-only. Do not set `EVENTCONNECT_ENV=production` for a local SQLite run. For local Supabase integration, configure secrets from a private `.env` file and apply the migrations to a disposable staging project.

```powershell
Set-Location .\rareminds-eventconnect\backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Frontend:

```powershell
Set-Location .\rareminds-eventconnect
npm ci
npm run dev
```

## Build and test gate

- `npm ci`
- `npm run lint`
- `npm run build`
- `python -m pytest` from `backend`
- Docker image build
- Secret scan
- Migration dry-run against a disposable staging database
- Browser login and full capture/qualification flow against configured staging
- Verify no unauthenticated API operation can access or mutate lead data

## OCR, Drive, CRM, offline, and QR

- OCR uses Tesseract. Install required language data in the runtime and benchmark against an authorized, representative card set; always require human verification.
- Google Drive service-account use is approved, but folder/file writes remain disabled until the credentials are provisioned in Secret Manager and access to the approved Shared Drive is verified. The adapter, folder/file upload flow, and CRM Drive-link update are not implemented.
- Zoho writes remain disabled. The backend includes a read-only metadata verifier for the proposed Leads/Contacts/Accounts/Tasks mapping. With Zoho OAuth secrets supplied through a protected runtime, run `python -m app.integrations verify-zoho-metadata`; it fetches actual module fields, reports missing API names, and discovers the Drive URL field only by the exact approved label. It never writes CRM records. Do not set mapping approval or enable writes until metadata is reviewed; CRM record creation/update, duplicate handling, idempotency, tasks, audit, and retries still require implementation and staging tests.
- Offline capture is implemented as an IndexedDB queue that retries through the normal capture endpoint with stable idempotency keys. It is disabled unless `NEXT_PUBLIC_ENABLE_OFFLINE_CAPTURE=true` is set at frontend build time. Keep it disabled until the organization explicitly approves the unencrypted local image storage risk; the queue has not been tested across target browsers, device restarts, storage eviction, or real offline/online transitions.
- QR scanning uses the browser `BarcodeDetector` and submits reviewed visitor details as a qualified lead, but is disabled in both frontend and backend by default. Keep `NEXT_PUBLIC_ENABLE_QR_REGISTRATION=false` and `EVENTCONNECT_QR_ENABLED=false` until a sanitized event sample is validated; attendee-ID-only codes are unsupported, and this is not a dedicated attendance system.
- The service worker provides best-effort app-shell caching only. Confirm offline startup and recovery on every supported browser/device; do not treat it as a guarantee that the app shell or queued data will survive browser eviction.

## Operations and rollout

Use HTTPS for the frontend and backend. Keep the backend private. Configure health monitoring, error alerts, log retention, database backups, restore drills, storage lifecycle/retention, and an incident owner. Probe `/api/v1/health`, but treat its response as liveness only; it does not prove that integrations are connected.

Promote only after staging UAT and security review. Roll back frontend/backend using prior immutable artifacts. Do not destructively roll back business tables; restore from an approved backup and reconcile external writes.
