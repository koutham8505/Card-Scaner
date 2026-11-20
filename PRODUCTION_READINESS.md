# Production Readiness Report

## Current status: Blocked for production integration

The repository can build and exercise the core capture contract locally, but DIDAC production readiness is not claimed. Credentials and approvals are missing for required external systems.

## Evidence

- `npm run lint` and `npm run build`: pass with the auth/session, offline, QR gating, and frontend changes.
- Next.js is upgraded to 16.4.6 and `npm audit --omit=dev` reports no production dependency vulnerabilities.
- Supabase project `awsztmuuubarbqajdvzp` accepted publishable and secret API-key checks; local environment files were created under ignored `.env*` paths.
- Both Supabase migrations were applied to the production project after explicit approval. Remote migration history and the `events`, `captures`, `leads`, `tasks`, `app_sync_jobs`, and private bucket endpoints were verified.
- The backend's local `DATABASE_URL` remains blank; API persistence is therefore still SQLite locally, and PostgreSQL runtime/restart behavior has not been validated.
- Role-specific API authorization and mutation audit recording are implemented for capture, OCR, verification, qualification, QR, lead, task, dashboard, and sync routes.
- `python -m pytest -q` from `backend`: 18 tests pass, including capture lifecycle, event directory, auth requirements, QR default-off enforcement, and mocked Zoho metadata validation.
- Docker image build was not verified because Docker Desktop is unavailable in this environment.
- Web Crypto session round-trip, tampering/oversize rejection, and unauthenticated production route smoke checks pass locally.
- Browser login uses Supabase Auth; FastAPI verifies the access token and requires a matching active staff profile.
- PostgreSQL store and private Supabase Storage adapters are implemented; production backend startup refuses missing PostgreSQL/Supabase configuration.
- Dashboard metrics read from the application API, with SQLite used only for local development and PostgreSQL required in production. Offline queueing is disabled by default; QR capture is disabled in both frontend and backend until a sanitized real payload is validated.
- The standalone end-to-end smoke test now requires the backend proxy token and is excluded from automatic side-effectful execution during pytest collection.
- Migrations are applied to production, but no separate staging project exists in this setup and the backend has not yet been connected to PostgreSQL with `DATABASE_URL`.
- Google Drive: not connected or tested.
- Zoho CRM: read-only metadata verification command implemented but not run; CRM writes remain disabled.
- Role-specific API permissions are implemented; live staff account provisioning and staging role testing remain outstanding.
- Event directory persistence and event creation API are implemented; PostgreSQL staging validation remains outstanding.
- Core migration direct-table privileges are revoked from anonymous/authenticated roles; backend access remains restricted to the service role and staff middleware.
- PostgreSQL and private Storage adapters are unverified against the available staging project.
- OCR depends on Tesseract and has not been evaluated against an authorized card dataset.
- Offline queue retry is implemented in the browser and disabled by default at build time, but device-restart/storage-eviction recovery, browser compatibility, and protection of queued images have not been validated. QR scanning/registration is gated off in both frontend and backend until a sanitized real payload is validated.
- Google Drive/Zoho adapters, background integration workers, and provider retry execution are not implemented.
- Full browser-to-backend live smoke test, staging UAT, backup/restore, and production security review remain outstanding.

## Required before approval

1. Configure `DATABASE_URL` on the backend host and run PostgreSQL persistence, private storage, and restart/recovery tests; establish a separate staging project before future schema changes.
2. Provision Supabase Auth users and matching active staff profiles; test login, expiration, inactive accounts, and enforce role-specific permissions.
3. Configure Zoho OAuth secrets in Secret Manager, run the read-only module/field metadata verifier, resolve missing API names (including the Drive URL custom field), and approve the verified mapping.
4. Provision the approved Drive service account and verify access to the designated Shared Drive.
5. Implement and test Google Drive/Zoho write adapters, duplicate-safe updates, tasks, audit export, and integration job/retry workers against sandbox systems.
6. Benchmark Tesseract on at least 200–300 authorized cards.
7. Test offline queue recovery, duplicate replay, storage eviction, and supported browsers; approve the unencrypted local image storage risk or implement an approved protection policy.
8. Validate real QR payloads and target mobile browsers, and decide whether lead registration is sufficient or a separate attendance/check-in model is required.
9. Run end-to-end staging tests covering capture, OCR review, qualification, Drive, CRM, follow-up, and dashboards.
10. Complete security review, retention controls, backup/restore, monitoring, and deployment rollback.
11. Obtain explicit approval for CRM field mapping and all production writes.
12. Deploy and validate the frontend on Netlify; deploy/test FastAPI on a selected container-capable host. Neither service has been deployed or tested.

## Deploy order

1. Build and test frontend and backend in CI.
2. Apply migrations to staging with a reviewed service account.
3. Deploy backend and run `/api/v1/health`.
4. Configure staging secrets through the hosting platform only.
5. Exercise integration adapters using test records and explicit staging owners.
6. Review logs and audit output.
7. Run UAT and security checklist.
8. Promote only after production-owner signoff.

## Rollback

- Frontend: deploy the prior immutable build artifact.
- Backend: deploy the prior immutable image tag.
- Database: do not destructively roll back business tables automatically; restore only from a reviewed backup and coordinate with CRM/Drive reconciliation.
