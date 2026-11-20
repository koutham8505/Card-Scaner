create extension if not exists pgcrypto;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_code text not null unique,
  venue text,
  start_date date,
  end_date date,
  status text not null default 'draft' check (status in ('draft','active','completed','archived')),
  created_at timestamptz not null default now()
);

create table if not exists public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  full_name text not null,
  email text not null unique,
  role text not null check (role in ('super_admin','event_manager','booth_staff','sales_rep')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.event_staff (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  staff_id uuid not null references public.staff_profiles(id),
  assigned_role text not null,
  unique (event_id, staff_id)
);

create table if not exists public.institutions (
  id uuid primary key default gen_random_uuid(),
  institution_name text not null,
  institution_type text,
  website text,
  address text,
  city text,
  state text,
  country text,
  postal_code text,
  zoho_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  full_name text,
  designation text,
  department text,
  institution_id uuid references public.institutions(id),
  primary_email text,
  primary_mobile text,
  alternate_phone text,
  website text,
  address text,
  city text,
  state text,
  country text,
  postal_code text,
  normalized_email text generated always as (lower(btrim(primary_email))) stored,
  normalized_mobile text generated always as (regexp_replace(coalesce(primary_mobile, ''), '\\D', '', 'g')) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_captures (
  id uuid primary key default gen_random_uuid(),
  client_capture_id uuid not null unique,
  capture_code text not null unique,
  event_id uuid not null references public.events(id),
  contact_id uuid references public.contacts(id),
  captured_by uuid references public.staff_profiles(id),
  capture_method text not null,
  capture_status text not null default 'received',
  verification_status text not null default 'pending',
  captured_at timestamptz,
  verified_at timestamptz,
  offline_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.card_images (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references public.event_captures(id),
  image_side text not null check (image_side in ('front','back')),
  temporary_storage_path text,
  original_filename text,
  mime_type text,
  file_size bigint,
  image_quality_status text,
  drive_file_id text,
  drive_file_url text,
  uploaded_at timestamptz,
  unique (capture_id, image_side)
);

create table if not exists public.ocr_extractions (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references public.event_captures(id),
  front_raw_text text,
  back_raw_text text,
  parsed_fields jsonb not null default '{}'::jsonb,
  field_confidences jsonb not null default '{}'::jsonb,
  field_sources jsonb not null default '{}'::jsonb,
  conflicting_fields jsonb not null default '{}'::jsonb,
  model_version text,
  processing_status text not null default 'pending',
  reviewed_by uuid references public.staff_profiles(id),
  reviewed_at timestamptz,
  unique (capture_id)
);

create table if not exists public.lead_qualifications (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references public.event_captures(id),
  visitor_category text,
  visitor_role text,
  product_interests text[] not null default '{}',
  lead_priority text,
  conversation_outcome text,
  next_action text,
  notes text,
  decision_maker boolean,
  expected_timeline text,
  estimated_value numeric,
  assigned_owner uuid references public.staff_profiles(id),
  follow_up_at timestamptz,
  consent_status text,
  consent_source text,
  consent_timestamp timestamptz,
  unique (capture_id)
);

create table if not exists public.drive_archives (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references public.event_captures(id),
  drive_folder_id text,
  drive_folder_url text,
  front_file_id text,
  back_file_id text,
  sync_status text not null default 'pending',
  last_error text,
  last_synced_at timestamptz,
  unique (capture_id)
);

create table if not exists public.crm_links (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id),
  zoho_module text not null,
  zoho_record_id text not null,
  zoho_account_id text,
  last_synced_at timestamptz,
  unique (zoho_module, zoho_record_id)
);

create table if not exists public.crm_event_interactions (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references public.event_captures(id),
  zoho_module text,
  zoho_record_id text,
  interaction_record_id text,
  task_id text,
  sync_status text not null default 'pending'
);

create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references public.event_captures(id),
  provider text not null check (provider in ('ocr','google_drive','zoho_crm')),
  operation text not null,
  idempotency_key text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_retry_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (idempotency_key)
);

create table if not exists public.follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references public.event_captures(id),
  assigned_owner uuid not null references public.staff_profiles(id),
  action_type text not null,
  due_at timestamptz not null,
  priority text not null,
  status text not null default 'pending',
  notes text,
  zoho_task_id text,
  created_at timestamptz not null default now(),
  unique (capture_id, zoho_task_id)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  timestamp timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index on public.contacts (normalized_email);
create index on public.contacts (normalized_mobile);
create index on public.event_captures (event_id, created_at desc);
create index on public.event_captures (captured_by, created_at desc);
create index on public.sync_jobs (provider, status, next_retry_at);
create index on public.follow_up_tasks (assigned_owner, status, due_at);

alter table public.events enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.event_staff enable row level security;
alter table public.institutions enable row level security;
alter table public.contacts enable row level security;
alter table public.event_captures enable row level security;
alter table public.card_images enable row level security;
alter table public.ocr_extractions enable row level security;
alter table public.lead_qualifications enable row level security;
alter table public.drive_archives enable row level security;
alter table public.crm_links enable row level security;
alter table public.crm_event_interactions enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.follow_up_tasks enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;

create policy "profiles read own record" on public.staff_profiles
  for select using (auth.uid() = auth_user_id);

create policy "event staff read assigned events" on public.events
  for select using (exists (
    select 1 from public.event_staff es
    join public.staff_profiles sp on sp.id = es.staff_id
    where es.event_id = events.id and sp.auth_user_id = auth.uid()
  ) or exists (select 1 from public.staff_profiles sp where sp.auth_user_id = auth.uid() and sp.role = 'super_admin'));

revoke all on public.events, public.staff_profiles, public.event_staff,
  public.institutions, public.contacts, public.event_captures, public.card_images,
  public.ocr_extractions, public.lead_qualifications, public.drive_archives,
  public.crm_links, public.crm_event_interactions, public.sync_jobs,
  public.follow_up_tasks, public.audit_logs, public.app_settings
  from anon, authenticated;

grant select on public.events, public.staff_profiles to authenticated;
grant all on public.events, public.staff_profiles, public.event_staff,
  public.institutions, public.contacts, public.event_captures, public.card_images,
  public.ocr_extractions, public.lead_qualifications, public.drive_archives,
  public.crm_links, public.crm_event_interactions, public.sync_jobs,
  public.follow_up_tasks, public.audit_logs, public.app_settings
  to service_role;
