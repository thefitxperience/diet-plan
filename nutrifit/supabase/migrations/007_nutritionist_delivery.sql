-- Let nutritionists deliver plans too (after gym approval), not just gym admins.
-- Backend counterpart to the PlanView delivery panel now showing for nutritionists.

-- 1) Allow the 'sent' transition for nutritionists.
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
  select role, gym_id into v_role, v_gym from profiles where id = auth.uid();
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
    if v_plan.status not in ('GENERATED', 'IN_REVIEW', 'CHANGES_REQUESTED') then
      raise exception 'Cannot edit a plan in status %', v_plan.status;
    end if;
    v_next := 'IN_REVIEW';
  elsif p_action = 'submitted' then
    if v_role not in ('nutritionist', 'platform_admin') then raise exception 'Only nutritionists submit plans'; end if;
    if v_plan.status not in ('GENERATED', 'IN_REVIEW', 'CHANGES_REQUESTED') then
      raise exception 'Cannot submit a plan in status %', v_plan.status;
    end if;
    v_next := 'NUTRITIONIST_APPROVED';
  elsif p_action = 'approved_gym' then
    if v_role <> 'gym_admin' then raise exception 'Only gym admins approve stage 2'; end if;
    if v_plan.status <> 'NUTRITIONIST_APPROVED' then
      raise exception 'Plan is not awaiting gym approval (status %)', v_plan.status;
    end if;
    v_next := 'GYM_APPROVED';
  elsif p_action = 'rejected' then
    if v_role <> 'gym_admin' then raise exception 'Only gym admins reject'; end if;
    if v_plan.status <> 'NUTRITIONIST_APPROVED' then
      raise exception 'Plan is not awaiting gym approval (status %)', v_plan.status;
    end if;
    if coalesce(trim(p_comment), '') = '' then
      raise exception 'A comment is required when requesting changes';
    end if;
    v_next := 'CHANGES_REQUESTED';
  elsif p_action = 'sent' then
    if v_role not in ('gym_admin', 'platform_admin', 'nutritionist') then raise exception 'Not allowed to send plans'; end if;
    if v_plan.status not in ('GYM_APPROVED', 'SENT') then
      raise exception 'Plan is not approved for sending (status %)', v_plan.status;
    end if;
    v_next := 'SENT';
  else
    raise exception 'Unknown action %', p_action;
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

-- 2) Allow nutritionists to insert delivery records for their gym.
drop policy if exists deliveries_insert on deliveries;
create policy deliveries_insert on deliveries for insert with check (
  gym_id = auth_gym() and actor = auth.uid()
  and auth_role() in ('gym_admin', 'platform_admin', 'nutritionist')
);
