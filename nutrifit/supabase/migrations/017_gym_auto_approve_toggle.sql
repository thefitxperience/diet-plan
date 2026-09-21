-- Per-gym switch for the 24-hour auto-approval added in 016.
--
-- Auto-releasing a clinical document without a dietitian's sign-off is a policy
-- decision that differs per gym, so it stops being a platform-wide behaviour and
-- becomes something a platform admin turns on for a specific gym.

-- The backfill is inside the "column did not exist" branch on purpose: these
-- migrations are pasted into the SQL editor by hand, and an unguarded
-- `update gyms set auto_approve_enabled = true` would silently switch the
-- feature back on for every gym an admin had deliberately turned off.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'gyms'
       and column_name = 'auto_approve_enabled'
  ) then
    alter table gyms add column auto_approve_enabled boolean not null default false;
    -- First install only: existing gyms keep the behaviour they have today
    -- (016 applied to everyone). Gyms created from here on are opt-in, because
    -- the safe default for releasing a plan with no sign-off is "don't".
    update gyms set auto_approve_enabled = true;
  end if;
end $$;

comment on column gyms.auto_approve_enabled is
  'When true, auto_approve_stale_plans() may release this gym''s clean plans '
  'after the stale window. Platform admins only — see guard_gym_auto_approve().';

-- ── Column guard ────────────────────────────────────────────────────────────
-- RLS is row-level, and gyms_own_update (002) lets a gym_admin update their own
-- gym row. Without this a gym could switch off its own review gate. A NULL
-- auth.uid() is the service role or a direct SQL session — both already trusted
-- and both needed for migrations and support work.
create or replace function guard_gym_auto_approve() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.auto_approve_enabled is distinct from old.auto_approve_enabled
     and auth.uid() is not null
     and coalesce(auth_role()::text, '') <> 'platform_admin' then
    raise exception 'auto_approve_enabled can only be changed by a platform admin';
  end if;
  return new;
end $$;

drop trigger if exists gyms_guard_auto_approve on gyms;
create trigger gyms_guard_auto_approve
  before update on gyms
  for each row execute function guard_gym_auto_approve();

-- ── Honour the switch in the scheduled job ─────────────────────────────────
-- Same body as 016 apart from the gyms join: plans belonging to a gym with the
-- feature off are not considered at all.
create or replace function auto_approve_stale_plans(p_hours int default 24)
returns TABLE (plan_id uuid, released boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_floor int;
  v_target int;
  v_checks int;
begin
  for r in
    select p.*,
           coalesce((select max(e.created_at) from plan_events e where e.plan_id = p.id), p.created_at) as last_activity
      from plans p
      join gyms g on g.id = p.gym_id
     where p.status in ('GENERATED', 'IN_REVIEW')
       and g.auto_approve_enabled
  loop
    if r.last_activity > now() - make_interval(hours => p_hours) then
      continue;  -- still fresh, or being worked on
    end if;

    -- Unattended job: a single malformed plan_data must not abort the batch.
    begin
      v_checks := nullif(r.plan_data -> 'checks' ->> 'count', '')::int;
      v_target := round(nullif(r.plan_data -> 'header' ->> 'dailyKcal', '')::numeric)::int;
    exception when others then
      return query select r.id, false, 'unreadable plan data'::text; continue;
    end;
    -- created_by is NULL for self-service intake plans, so no practitioner
    -- minimum exists — fall back to the application default.
    select coalesce(pr.min_kcal, 1450) into v_floor from profiles pr where pr.id = r.created_by;

    -- Fail closed: no verdict recorded means we cannot vouch for the plan.
    if v_checks is null then
      return query select r.id, false, 'no checks recorded'::text; continue;
    end if;
    if v_checks > 0 then
      return query select r.id, false, format('%s issue(s) flagged', v_checks); continue;
    end if;
    if v_target is null or v_target <= 0 then
      return query select r.id, false, 'no daily target'::text; continue;
    end if;
    if v_target < coalesce(v_floor, 1450) then
      return query select r.id, false,
        format('target %s below the %s minimum', v_target, coalesce(v_floor, 1450)); continue;
    end if;

    perform set_config('nutrifit.allow_transition', 'on', true);
    update plans
       set status = 'NUTRITIONIST_APPROVED',
           version = version + 1,
           updated_at = now()
     where id = r.id;
    perform set_config('nutrifit.allow_transition', '', true);

    -- actor NULL = the system (plan_events.actor was made nullable in 009). The
    -- UI keys off that NULL to label the entry as an automatic release rather
    -- than attributing it to a person.
    insert into plan_events (gym_id, plan_id, actor, action, from_status, to_status, comment)
    values (r.gym_id, r.id, null, 'submitted', r.status, 'NUTRITIONIST_APPROVED',
            format('Auto-approved after %s h with no issues flagged', p_hours));

    return query select r.id, true, 'auto-approved'::text;
  end loop;
end $$;

revoke all on function auto_approve_stale_plans(int) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function auto_approve_stale_plans(int) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function auto_approve_stale_plans(int) from authenticated;
  end if;
end $$;
