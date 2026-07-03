-- One-time seed for the login page's demo buttons.
-- The three auth users were already created (email/password sign-up); this
-- gives them active profiles + a shared demo gym so the demo buttons log
-- straight in. Safe to re-run (idempotent).
--
--   nutritionist@demo.thefitxperience.com  → nutritionist (Demo Gym)
--   gymadmin@demo.thefitxperience.com      → gym_admin    (Demo Gym)
--   fitadmin@demo.thefitxperience.com      → platform_admin
--   password for all three: FitDemo2024!

do $$
declare
  v_gym uuid;
begin
  select id into v_gym from gyms where name = 'FIT Demo Gym' limit 1;
  if v_gym is null then
    insert into gyms (name) values ('FIT Demo Gym') returning id into v_gym;
  end if;

  insert into profiles (id, role, gym_id, status, full_name) values
    ('171d715e-328f-4f8e-abb9-3041859b8770', 'platform_admin', null,  'active', 'FIT Admin (Demo)')
  on conflict (id) do update set role = excluded.role, gym_id = excluded.gym_id,
    status = 'active', full_name = excluded.full_name;

  insert into profiles (id, role, gym_id, status, full_name) values
    ('4b5bf18a-0ce1-4ee4-ac21-c6f57697f3a0', 'gym_admin', v_gym, 'active', 'Gym Admin (Demo)')
  on conflict (id) do update set role = excluded.role, gym_id = excluded.gym_id,
    status = 'active', full_name = excluded.full_name;

  insert into profiles (id, role, gym_id, status, full_name) values
    ('32e51cd6-e7bf-438c-9d5f-c96cc7038745', 'nutritionist', v_gym, 'active', 'Nutritionist (Demo)')
  on conflict (id) do update set role = excluded.role, gym_id = excluded.gym_id,
    status = 'active', full_name = excluded.full_name;
end $$;
