-- Auto-approve plans that have sat unapproved for 24 hours — but ONLY plans the
-- system already considers clean. Anything with a flagged issue stays pending.
--
-- Deliberately conservative, because this relaxes the clinical review's §2.5
-- ("require dietitian approval before releasing any generated plan"):
--
--   * plan_data.checks.count must be 0. The app writes that verdict (validatePlan
--     + allergen checks) every time a plan is saved. NO STAMP = NOT ELIGIBLE, so
--     plans created before this migration are never auto-released.
--   * The daily target must be at or above the creating dietitian's own minimum
--     (profiles.min_kcal, default 1450) — the same floor the approval dialog
--     enforces interactively.
--   * The 24 hours runs from the plan's most recent activity, so a plan someone
--     is actively editing does not go stale.
--   * No dietitian name is stamped. The PDF sign-off block only renders when a
--     name is present, so an auto-released plan simply carries no sign-off rather
--     than asserting a review that did not happen.

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
     where p.status in ('GENERATED', 'IN_REVIEW')
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

    -- actor NULL = the system (plan_events.actor was made nullable in 009).
    insert into plan_events (gym_id, plan_id, actor, action, from_status, to_status, comment)
    values (r.gym_id, r.id, null, 'submitted', r.status, 'NUTRITIONIST_APPROVED',
            format('Auto-approved after %s h with no issues flagged', p_hours));

    return query select r.id, true, 'auto-approved'::text;
  end loop;
end $$;

-- Only the scheduler (or an admin) runs this; never the browser.
revoke all on function auto_approve_stale_plans(int) from public;
do $$
begin
  -- anon/authenticated exist on Supabase but not on a plain Postgres, so guard
  -- this rather than aborting the migration.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function auto_approve_stale_plans(int) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function auto_approve_stale_plans(int) from authenticated;
  end if;
end $$;

-- Schedule hourly if pg_cron is available; otherwise call the function from an
-- external scheduler (e.g. a Cloudflare Worker cron) using the service role.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'nutrifit-auto-approve') then
      perform cron.unschedule('nutrifit-auto-approve');
    end if;
    perform cron.schedule('nutrifit-auto-approve', '17 * * * *',
                          $cron$select auto_approve_stale_plans(24)$cron$);
  else
    raise notice 'pg_cron unavailable — schedule auto_approve_stale_plans(24) externally';
  end if;
exception when others then
  raise notice 'Could not schedule auto-approval (%). Schedule it externally.', sqlerrm;
end $$;
