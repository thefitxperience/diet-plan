-- RLS: with no backend, these policies ARE the security model (plan §7).

-- Helper: current user's profile fields without recursive RLS lookups.
create or replace function auth_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function auth_gym() returns uuid
language sql stable security definer set search_path = public as $$
  select gym_id from profiles where id = auth.uid()
$$;

alter table gyms            enable row level security;
alter table profiles        enable row level security;
alter table clients         enable row level security;
alter table inbody_results  enable row level security;
alter table plans           enable row level security;
alter table plan_events     enable row level security;
alter table deliveries      enable row level security;

-- ── gyms ─────────────────────────────────────────────────────────────
create policy gyms_select on gyms for select using (
  id = auth_gym() or auth_role() = 'platform_admin'
);
create policy gyms_admin_all on gyms for all using (auth_role() = 'platform_admin');
create policy gyms_own_update on gyms for update using (
  id = auth_gym() and auth_role() = 'gym_admin'
);

-- ── profiles ─────────────────────────────────────────────────────────
create policy profiles_self on profiles for select using (id = auth.uid());
create policy profiles_same_gym on profiles for select using (
  gym_id = auth_gym() or auth_role() = 'platform_admin'
);
create policy profiles_self_update on profiles for update
  using (id = auth.uid())
  with check (
    -- users cannot escalate their own role/gym
    role = (select role from profiles p where p.id = auth.uid())
    and gym_id is not distinct from (select gym_id from profiles p where p.id = auth.uid())
  );
create policy profiles_admin_all on profiles for all using (auth_role() = 'platform_admin');

-- ── clients ──────────────────────────────────────────────────────────
-- Nutritionists create/edit; gym admins read-only (plan §2).
create policy clients_select on clients for select using (
  gym_id = auth_gym() or auth_role() = 'platform_admin'
);
create policy clients_write on clients for insert with check (
  (gym_id = auth_gym() and auth_role() = 'nutritionist' and created_by = auth.uid())
  or auth_role() = 'platform_admin'
);
create policy clients_update on clients for update using (
  (gym_id = auth_gym() and auth_role() = 'nutritionist')
  or auth_role() = 'platform_admin'
);

-- ── inbody_results ───────────────────────────────────────────────────
create policy inbody_select on inbody_results for select using (
  gym_id = auth_gym() or auth_role() = 'platform_admin'
);
create policy inbody_insert on inbody_results for insert with check (
  (gym_id = auth_gym() and auth_role() = 'nutritionist' and created_by = auth.uid())
  or auth_role() = 'platform_admin'
);
create policy inbody_update on inbody_results for update using (
  (gym_id = auth_gym() and auth_role() = 'nutritionist')
  or auth_role() = 'platform_admin'
);

-- ── plans ────────────────────────────────────────────────────────────
create policy plans_select on plans for select using (
  gym_id = auth_gym() or auth_role() = 'platform_admin'
);
create policy plans_insert on plans for insert with check (
  (gym_id = auth_gym() and auth_role() = 'nutritionist' and created_by = auth.uid())
  or auth_role() = 'platform_admin'
);
-- Content edits: nutritionist only, and only while the plan is editable.
-- Status changes must go through the transition_plan RPC (003), which is
-- SECURITY DEFINER; direct status updates are blocked by the trigger below.
create policy plans_update on plans for update using (
  (
    gym_id = auth_gym() and auth_role() = 'nutritionist'
    and status in ('DRAFT', 'GENERATED', 'IN_REVIEW', 'CHANGES_REQUESTED')
  )
  or auth_role() = 'platform_admin'
);

-- Block direct status mutation outside the RPC (enforced server-side).
create or replace function plans_block_direct_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('nutrifit.allow_transition', true), '') <> 'on' then
    raise exception 'Plan status must be changed via transition_plan()';
  end if;
  return new;
end $$;

create trigger plans_status_guard before update on plans
  for each row execute function plans_block_direct_status();

-- ── plan_events ──────────────────────────────────────────────────────
create policy events_select on plan_events for select using (
  gym_id = auth_gym() or auth_role() = 'platform_admin'
);
-- inserts happen inside SECURITY DEFINER functions only

-- ── deliveries ───────────────────────────────────────────────────────
create policy deliveries_select on deliveries for select using (
  gym_id = auth_gym() or auth_role() = 'platform_admin'
);
create policy deliveries_insert on deliveries for insert with check (
  gym_id = auth_gym() and actor = auth.uid()
  and auth_role() in ('gym_admin', 'platform_admin')
);

-- ── storage policies ─────────────────────────────────────────────────
-- Objects are stored under <gym_id>/... so the first path segment scopes access.
create policy storage_inbody_rw on storage.objects for all using (
  bucket_id = 'inbody' and (
    (storage.foldername(name))[1] = auth_gym()::text or auth_role() = 'platform_admin'
  )
) with check (
  bucket_id = 'inbody' and (
    (storage.foldername(name))[1] = auth_gym()::text or auth_role() = 'platform_admin'
  )
);

create policy storage_pdfs_rw on storage.objects for all using (
  bucket_id = 'plan-pdfs' and (
    (storage.foldername(name))[1] = auth_gym()::text or auth_role() = 'platform_admin'
  )
) with check (
  bucket_id = 'plan-pdfs' and (
    (storage.foldername(name))[1] = auth_gym()::text or auth_role() = 'platform_admin'
  )
);

create policy storage_branding_read on storage.objects for select using (bucket_id = 'branding');
create policy storage_branding_write on storage.objects for insert with check (
  bucket_id = 'branding' and (
    (storage.foldername(name))[1] = auth_gym()::text or auth_role() = 'platform_admin'
  )
);
