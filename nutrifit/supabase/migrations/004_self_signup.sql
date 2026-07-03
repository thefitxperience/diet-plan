-- Self-service signup + approval — no more manual SQL to add people.
--
--   • Sign up → pick role (gym_admin | nutritionist)
--       nutritionist → pick their gym            → that gym's admin approves
--       gym_admin    → name a new gym (or pick)  → the platform admin approves
--   • Until approved, the account is 'pending' and has no effective role, so
--     RLS blocks it from all gym data.
--
-- Run in the Supabase SQL editor AFTER 001–003.

-- 1. Approval status ---------------------------------------------------
do $$ begin
  create type profile_status as enum ('pending', 'active', 'rejected');
exception when duplicate_object then null; end $$;

alter table profiles add column if not exists status profile_status not null default 'pending';
alter table profiles add column if not exists requested_gym_name text;
alter table profiles add column if not exists reviewed_by uuid references profiles (id);
alter table profiles add column if not exists reviewed_at timestamptz;

-- Anyone provisioned before this migration is trusted → activate them.
update profiles set status = 'active' where status = 'pending';

-- A gym_admin awaiting approval for a brand-new gym has no gym_id yet, so only
-- require a gym once the account is active (and not a platform admin).
alter table profiles drop constraint if exists gym_required;
alter table profiles add constraint gym_required
  check (role = 'platform_admin' or status <> 'active' or gym_id is not null);

-- 2. Effective role/gym only count when active (pending ⇒ no RLS access) --
create or replace function auth_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and status = 'active'
$$;

create or replace function auth_gym() returns uuid
language sql stable security definer set search_path = public as $$
  select gym_id from profiles where id = auth.uid() and status = 'active'
$$;

-- 3. Signup helpers ----------------------------------------------------
-- Gym list for the signup picker: a pending user has no gym yet and can't read
-- the gyms table under RLS, so expose id+name through a definer function.
create or replace function list_gyms() returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select id, name from gyms order by name
$$;

create or replace function system_has_users() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles)
$$;

-- Register the calling auth user. First account ever → platform_admin (active).
-- Everyone else → pending, awaiting approval.
create or replace function register_profile(
  p_full_name     text,
  p_role          text default null,
  p_gym_id        uuid default null,
  p_new_gym_name  text default null
) returns profiles
language plpgsql security definer set search_path = public as $$
declare
  v_profile profiles;
  v_name    text := coalesce(nullif(trim(p_full_name), ''), '');
begin
  select * into v_profile from profiles where id = auth.uid();
  if v_profile.id is not null then return v_profile; end if;

  -- Bootstrap: the very first user runs the platform.
  if not exists (select 1 from profiles) then
    insert into profiles (id, role, status, full_name)
    values (auth.uid(), 'platform_admin', 'active', v_name)
    returning * into v_profile;
    return v_profile;
  end if;

  if p_role not in ('gym_admin', 'nutritionist') then
    raise exception 'Choose a role: gym_admin or nutritionist';
  end if;

  if p_role = 'nutritionist' then
    if p_gym_id is null then raise exception 'Select your gym'; end if;
    if not exists (select 1 from gyms where id = p_gym_id) then raise exception 'Gym not found'; end if;
    insert into profiles (id, role, gym_id, status, full_name)
    values (auth.uid(), 'nutritionist', p_gym_id, 'pending', v_name)
    returning * into v_profile;

  else -- gym_admin
    if p_gym_id is not null then
      if not exists (select 1 from gyms where id = p_gym_id) then raise exception 'Gym not found'; end if;
      insert into profiles (id, role, gym_id, status, full_name)
      values (auth.uid(), 'gym_admin', p_gym_id, 'pending', v_name)
      returning * into v_profile;
    elsif coalesce(trim(p_new_gym_name), '') <> '' then
      insert into profiles (id, role, requested_gym_name, status, full_name)
      values (auth.uid(), 'gym_admin', trim(p_new_gym_name), 'pending', v_name)
      returning * into v_profile;
    else
      raise exception 'Enter a gym name or select an existing gym';
    end if;
  end if;

  return v_profile;
end $$;

-- 4. Approve / reject --------------------------------------------------
-- platform_admin approves gym_admins (creating the requested gym if needed);
-- gym_admin approves nutritionists in their own gym.
create or replace function approve_profile(p_profile_id uuid) returns profiles
language plpgsql security definer set search_path = public as $$
declare
  v_role   user_role;
  v_gym    uuid;
  v_target profiles;
  v_new    uuid;
begin
  select role, gym_id into v_role, v_gym from profiles where id = auth.uid() and status = 'active';
  if v_role is null then raise exception 'Not authorized'; end if;

  select * into v_target from profiles where id = p_profile_id for update;
  if v_target.id is null then raise exception 'Profile not found'; end if;
  if v_target.status = 'active' then return v_target; end if;

  if v_target.role = 'gym_admin' then
    if v_role <> 'platform_admin' then raise exception 'Only the platform admin approves gym admins'; end if;
    v_new := v_target.gym_id;
    if v_new is null and coalesce(v_target.requested_gym_name, '') <> '' then
      insert into gyms (name) values (v_target.requested_gym_name) returning id into v_new;
    end if;
    if v_new is null then raise exception 'This gym admin has no gym to assign'; end if;
    update profiles set status = 'active', gym_id = v_new, requested_gym_name = null,
      reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_profile_id returning * into v_target;

  elsif v_target.role = 'nutritionist' then
    if not (v_role = 'platform_admin' or (v_role = 'gym_admin' and v_gym = v_target.gym_id)) then
      raise exception 'Only this gym''s admin approves its nutritionists';
    end if;
    update profiles set status = 'active', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_profile_id returning * into v_target;

  else
    raise exception 'Cannot approve role %', v_target.role;
  end if;

  return v_target;
end $$;

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
  end if;

  update profiles set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_profile_id returning * into v_target;
  return v_target;
end $$;
