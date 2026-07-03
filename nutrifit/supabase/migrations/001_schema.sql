-- NutriFIT Phase 1 schema (plan §9)
-- Run in Supabase SQL editor (or `supabase db push`).

create extension if not exists "pgcrypto";

-- ── Enums ────────────────────────────────────────────────────────────
create type user_role as enum ('nutritionist', 'gym_admin', 'platform_admin');
create type plan_status as enum (
  'DRAFT', 'GENERATED', 'IN_REVIEW',
  'NUTRITIONIST_APPROVED', 'CHANGES_REQUESTED', 'GYM_APPROVED', 'SENT'
);
create type plan_action as enum (
  'created', 'generated', 'edited', 'submitted',
  'approved_gym', 'rejected', 'sent'
);
create type inbody_source as enum ('pdf_text', 'ocr', 'manual');
create type delivery_channel as enum ('download', 'whatsapp_link', 'email');

-- ── Tables ───────────────────────────────────────────────────────────
create table gyms (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  logo_url     text,
  brand_colors jsonb default '{}'::jsonb,
  contact      jsonb default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- One row per auth user. gym_id null only for platform_admin.
create table profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       user_role not null default 'nutritionist',
  gym_id     uuid references gyms (id),
  full_name  text not null default '',
  created_at timestamptz not null default now(),
  constraint gym_required check (role = 'platform_admin' or gym_id is not null)
);

create table clients (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references gyms (id),
  created_by  uuid not null references profiles (id),
  first_name  text not null,
  last_name   text not null,
  dob         date,
  gender      text check (gender in ('M', 'F')),
  phone       text,
  email       text,
  notes       text default '',
  consent     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table inbody_results (
  id             uuid primary key default gen_random_uuid(),
  gym_id         uuid not null references gyms (id),
  client_id      uuid not null references clients (id) on delete cascade,
  created_by     uuid not null references profiles (id),
  file_path      text,                     -- storage path of original upload
  source_type    inbody_source not null default 'pdf_text',
  model          text default 'InBody270',
  extracted      jsonb not null default '{}'::jsonb, -- raw parser output
  confirmed      jsonb not null default '{}'::jsonb, -- nutritionist-confirmed values
  test_date      date,
  created_at     timestamptz not null default now()
);

create table plans (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references gyms (id),
  client_id         uuid not null references clients (id) on delete cascade,
  inbody_result_id  uuid references inbody_results (id),
  created_by        uuid not null references profiles (id),
  status            plan_status not null default 'DRAFT',
  version           int not null default 1,
  questionnaire     jsonb not null default '{}'::jsonb,
  plan_data         jsonb not null default '{}'::jsonb, -- structured editable model (§5), EN+AR
  api_response      jsonb,                              -- raw /v3/generate response
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table plan_events (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references gyms (id),
  plan_id    uuid not null references plans (id) on delete cascade,
  actor      uuid not null references profiles (id),
  action     plan_action not null,
  from_status plan_status,
  to_status   plan_status,
  comment    text default '',
  created_at timestamptz not null default now()
);

create table deliveries (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references gyms (id),
  plan_id    uuid not null references plans (id) on delete cascade,
  actor      uuid not null references profiles (id),
  channel    delivery_channel not null,
  recipient  text default '',
  language   text not null default 'en' check (language in ('en', 'ar', 'both')),
  pdf_path   text,                        -- immutable snapshot in storage
  status     text not null default 'sent',
  created_at timestamptz not null default now()
);

create index on clients (gym_id);
create index on inbody_results (client_id);
create index on plans (gym_id, status);
create index on plans (client_id);
create index on plan_events (plan_id);
create index on deliveries (plan_id);

-- updated_at maintenance
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger clients_touch before update on clients
  for each row execute function touch_updated_at();
create trigger plans_touch before update on plans
  for each row execute function touch_updated_at();

-- ── Storage buckets ─────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('inbody', 'inbody', false), ('plan-pdfs', 'plan-pdfs', false), ('branding', 'branding', true)
on conflict (id) do nothing;
