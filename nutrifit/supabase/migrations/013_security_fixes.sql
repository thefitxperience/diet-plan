-- Security fixes found in the 2026-08-03 audit.
--
-- MUST BE APPLIED TO THE HOSTED DATABASE. Finding 1 is a live privilege
-- escalation exploitable by anyone holding the (public) anon key.
--
--   1. profiles_self_update did not pin `status`, so a self-signed-up user could
--      PATCH themselves from 'pending' to 'active' and land inside any gym.
--   2. reject_profile had no else-branch for a platform_admin target, so any
--      active member could disable every platform administrator.
--   3. transition_plan / log_plan_event resolved the caller's role straight from
--      profiles without the `status = 'active'` filter that auth_role() and
--      auth_gym() apply, so pending/rejected users could still drive the plan
--      state machine.
--   4. deliveries_insert required gym_id = auth_gym(), which is NULL for a
--      platform_admin, making its own platform_admin branch unreachable.

-- ── 1. Pin status (and the review audit columns) on self-update ──────────────
-- role/gym_id were already pinned; status is what auth_role()/auth_gym() gate
-- on, so leaving it writable defeated the whole approval flow.
drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles for update
  using (id = auth.uid())
  with check (
    -- users cannot escalate their own role/gym/approval state
    role = (select role from profiles p where p.id = auth.uid())
    and gym_id is not distinct from (select gym_id from profiles p where p.id = auth.uid())
    and status = (select status from profiles p where p.id = auth.uid())
    and reviewed_by is not distinct from (select reviewed_by from profiles p where p.id = auth.uid())
    and reviewed_at is not distinct from (select reviewed_at from profiles p where p.id = auth.uid())
  );

-- ── 2. reject_profile: refuse unknown/privileged target roles ────────────────
create or replace function reject_profile(p_profile_id uuid) returns profiles
language plpgsql security definer set search_path = public as $$
declare
  v_role   user_role;
  v_gym    uuid;
  v_target profiles;
begin
  select role, gym_id into v_role, v_gym from profiles where id = auth.uid() and status = 'active';
  if v_role is null then raise exception 'Not authorized'; end if;

  select * into v_target from profiles where id = p_profile_id for update;
  if v_target.id is null then raise exception 'Profile not found'; end if;

  if v_target.role = 'gym_admin' then
    if v_role <> 'platform_admin' then raise exception 'Only the platform admin can reject gym admins'; end if;
  elsif v_target.role = 'nutritionist' then
    if not (v_role = 'platform_admin' or (v_role = 'gym_admin' and v_gym = v_target.gym_id)) then
      raise exception 'Not authorized';
    end if;
  else
    -- mirrors approve_profile: never fall through to the update
    raise exception 'Cannot reject role %', v_target.role;
  end if;

  update profiles set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_profile_id returning * into v_target;
  return v_target;
end $$;

-- ── 3a. transition_plan: only active profiles may drive the state machine ────
create or replace function transition_plan(
  p_plan_id uuid,
  p_action  plan_action,
  p_comment text default ''
) returns plans
language plpgsql security definer set search_path = public as $$
declare
  v_plan   plans;
  v_role   user_role;
  v_gym    uuid;
  v_from   plan_status;
  v_next   plan_status;
begin
  -- status = 'active' added: matches auth_role()/auth_gym() and the RLS policies,
  -- so the RPC can no longer accept a caller that RLS would reject.
  select role, gym_id into v_role, v_gym from profiles where id = auth.uid() and status = 'active';
  if v_role is null then
    raise exception 'No profile for current user';
  end if;

  select * into v_plan from plans where id = p_plan_id for update;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;
  if v_role <> 'platform_admin' and v_plan.gym_id <> v_gym then
    raise exception 'Plan belongs to another gym';
  end if;

  if p_action = 'generated' then
    if v_role not in ('nutritionist', 'platform_admin') then raise exception 'Only nutritionists generate plans'; end if;
    if v_plan.status not in ('DRAFT', 'GENERATED', 'IN_REVIEW', 'CHANGES_REQUESTED') then
      raise exception 'Cannot regenerate a plan in status %', v_plan.status;
    end if;
    v_next := 'GENERATED';
  elsif p_action = 'edited' then
    if v_role not in ('nutritionist', 'platform_admin') then raise exception 'Only nutritionists edit plans'; end if;
    -- DRAFT added: the editor and the to-submit queue both treat DRAFT as
    -- editable (and plans_update allows it), but this RPC used to reject it, so
    -- saving a DRAFT persisted the content and then reported an error.
    if v_plan.status not in ('DRAFT', 'GENERATED', 'IN_REVIEW', 'CHANGES_REQUESTED') then
      raise exception 'Cannot edit a plan in status %', v_plan.status;
    end if;
    v_next := 'IN_REVIEW';
  elsif p_action = 'submitted' then
    -- Nutritionist approval (final). Deliverable afterwards.
    if v_role not in ('nutritionist', 'platform_admin') then raise exception 'Only nutritionists approve plans'; end if;
    if v_plan.status not in ('DRAFT', 'GENERATED', 'IN_REVIEW', 'CHANGES_REQUESTED') then
      raise exception 'Cannot approve a plan in status %', v_plan.status;
    end if;
    v_next := 'NUTRITIONIST_APPROVED';
  elsif p_action = 'sent' then
    if v_role not in ('gym_admin', 'platform_admin', 'nutritionist') then raise exception 'Not allowed to send plans'; end if;
    -- GYM_APPROVED kept so any legacy plans already in that state stay deliverable.
    if v_plan.status not in ('NUTRITIONIST_APPROVED', 'GYM_APPROVED', 'SENT') then
      raise exception 'Plan is not approved for sending (status %)', v_plan.status;
    end if;
    v_next := 'SENT';
  else
    raise exception 'Unknown or retired action %', p_action;
  end if;

  v_from := v_plan.status;
  perform set_config('nutrifit.allow_transition', 'on', true);
  update plans
     set status = v_next,
         version = case when p_action = 'submitted' then version + 1 else version end
   where id = p_plan_id
   returning * into v_plan;
  perform set_config('nutrifit.allow_transition', '', true);

  insert into plan_events (gym_id, plan_id, actor, action, from_status, to_status, comment)
  values (v_plan.gym_id, p_plan_id, auth.uid(), p_action, v_from, v_next, coalesce(p_comment, ''));

  return v_plan;
end $$;

-- ── 3b. log_plan_event: same active-profile requirement ──────────────────────
create or replace function log_plan_event(
  p_plan_id uuid,
  p_action  plan_action,
  p_comment text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role     user_role;
  v_gym      uuid;
  v_plan_gym uuid;
begin
  select role, gym_id into v_role, v_gym from profiles where id = auth.uid() and status = 'active';
  if v_role is null then raise exception 'Not authorized'; end if;
  select gym_id into v_plan_gym from plans where id = p_plan_id;
  if v_plan_gym is null then raise exception 'Plan not found'; end if;
  if v_gym is distinct from v_plan_gym and v_role <> 'platform_admin' then
    raise exception 'Plan belongs to another gym';
  end if;
  insert into plan_events (gym_id, plan_id, actor, action, comment)
  values (v_plan_gym, p_plan_id, auth.uid(), p_action, coalesce(p_comment, ''));
end $$;

-- ── 4. deliveries_insert: give platform_admin a reachable branch ─────────────
-- A platform_admin has gym_id NULL, so `gym_id = auth_gym()` was never true and
-- delivery failed with an RLS error *after* the PDF had been uploaded.
drop policy if exists deliveries_insert on deliveries;
create policy deliveries_insert on deliveries for insert with check (
  actor = auth.uid()
  and (
    (gym_id = auth_gym() and auth_role() in ('gym_admin', 'nutritionist'))
    or auth_role() = 'platform_admin'
  )
);
