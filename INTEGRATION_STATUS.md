# Integration Status

| Integration | Status | Evidence | Remaining issue |
|---|---|---|---|
| Durable application persistence | Implemented; staging validation pending | Store selects PostgreSQL when `DATABASE_URL` is configured; production startup rejects SQLite; SQLite lifecycle tests pass | Apply runtime migration and run persistence/restart tests against the approved staging database |
| Supabase connection | Schema applied; backend database connection pending | Project `awsztmuuubarbqajdvzp` accepted API-key checks; both migrations are recorded remotely; `events`, `captures`, `leads`, `tasks`, `app_sync_jobs`, and the private bucket returned HTTP 200 | Configure `DATABASE_URL` on the FastAPI host; validate PostgreSQL persistence, restart recovery, and image lifecycle end to end |
| Google Drive authentication | Service-account strategy selected; implementation pending | Service account with Shared Drive access approved; no credentials or access check available | Implement credential loading/token exchange and verify membership against the designated Shared Drive |
| Drive folder creation | Disabled | No Drive API request is made; write flag is false | Implement idempotent creation and verify permissions before enabling writes |
| OCR evidence parsing | Implemented adapter | Evidence-only email/phone/URL/name parsing with front/back merge and conflicts; Tesseract included in Docker image | Benchmark OCR on authorized representative cards and tune languages/image handling |
| Front image upload | Implemented | Capture route validates and uploads to private Supabase Storage when configured; SQLite/local adapter for development | Validate bucket policy, lifecycle, backups, and Drive upload once adapter exists |
| Back image upload | Implemented | Optional back image is uploaded to private Supabase Storage when configured | Validate bucket policy, lifecycle, backups, and Drive upload once adapter exists |
| Zoho CRM authentication | Metadata verifier implemented; live verification pending | Read-only CLI refreshes OAuth token and fetches Leads/Contacts/Accounts/Tasks field metadata | Configure OAuth secrets in Secret Manager and run verifier |
| CRM duplicate checking | Not implemented; writes disabled | Proposed priority is normalized +91 mobile, email, then existing Zoho Lead ID | Validate mappings/normalization and implement match/update without duplicate creation |
| CRM record creation | Not implemented | No CRM API call is made | Requires approved field mapping, adapter, and staging account |
| CRM follow-up task creation | Not implemented | No CRM API call is made | Confirm task workflow/module schema and implement |
| CRM Drive link update | Not implemented | No CRM API call is made | Approve folder URL field/module and implement |
| Browser-to-backend authentication | Implemented; staging validation pending | Supabase Auth email/password, signed expiring HttpOnly session, FastAPI token validation and active staff profile check | Provision/test real profiles; implement role-specific authorization; configure rate limiting and private ingress |
| Offline capture | Implemented baseline; browser validation pending | IndexedDB queue retries through the capture API with stable capture IDs | Test target browsers, restart/eviction recovery, and duplicate replay; obtain approval for unencrypted local image storage |
| QR visitor capture | Disabled pending payload validation | Frontend and backend gates default off; current parser supports JSON or query-string fields only | Provide a sanitized real payload, validate browser support and consent, then explicitly enable both flags; attendee-ID-only codes and dedicated attendance are unsupported |

Local capture persistence is deliberately non-authoritative. External operations must not be marked live without end-to-end integration evidence.
