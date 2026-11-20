create table if not exists public.captures (
  id text primary key,
  capture_code text not null unique,
  event_code text not null,
  capture_method text not null,
  status text not null,
  verification_status text not null default 'pending',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  front_path text,
  back_path text,
  raw_text_front text,
  raw_text_back text,
  extracted_fields text not null default '{}',
  field_confidences text not null default '{}',
  field_sources text not null default '{}',
  conflicts text not null default '[]',
  manual_fields text not null default '{}',
  qualification text not null default '{}',
  idempotency_key text not null unique
);

create table if not exists public.leads (
  id text primary key,
  capture_id text not null unique references public.captures(id) on delete cascade,
  full_name text,
  institution text,
  designation text,
  email text,
  mobile text,
  city text,
  state text,
  country text,
  address text,
  priority text not null default 'Cold',
  status text not null default 'Needs Verification',
  capture_method text not null,
  captured_at timestamptz not null,
  assigned_owner text,
  follow_up_at text,
  consent_status text not null default 'unknown',
  search_key text not null
);

create table if not exists public.tasks (
  id text primary key,
  capture_id text references public.captures(id) on delete cascade,
  lead_name text,
  assigned_owner text,
  action_type text not null,
  due_at text not null,
  priority text not null,
  status text not null default 'Pending',
  notes text,
  created_at timestamptz not null
);

create table if not exists public.app_sync_jobs (
  id text primary key,
  capture_id text not null references public.captures(id) on delete cascade,
  provider text not null check (provider in ('ocr','google_drive','zoho_crm')),
  status text not null default 'Pending',
  attempts integer not null default 0,
  last_error text,
  next_retry_at text,
  idempotency_key text not null unique,
  created_at timestamptz not null,
  completed_at text
);

create table if not exists public.audit_logs (
  id text primary key,
  actor_id text,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_values text,
  new_values text,
  timestamp timestamptz not null
);

create index if not exists idx_eventconnect_leads_search
  on public.leads (search_key);
create index if not exists idx_eventconnect_sync_status
  on public.app_sync_jobs (status, provider);
create index if not exists idx_eventconnect_captures_created
  on public.captures (created_at desc);
create index if not exists idx_eventconnect_audit_timestamp
  on public.audit_logs (timestamp desc);

alter table public.captures enable row level security;
alter table public.leads enable row level security;
alter table public.tasks enable row level security;
alter table public.app_sync_jobs enable row level security;

alter table public.audit_logs enable row level security;

revoke all on public.audit_logs from anon, authenticated;
grant all on public.audit_logs to service_role;

revoke all on public.captures, public.leads, public.tasks, public.app_sync_jobs
  from anon, authenticated;
grant all on public.captures, public.leads, public.tasks, public.app_sync_jobs
  to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'eventconnect-cards',
  'eventconnect-cards',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 15728640,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
