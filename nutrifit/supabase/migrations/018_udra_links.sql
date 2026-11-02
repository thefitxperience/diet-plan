-- UDRA (the trainer app) sends clients here for their diet plan.
--
-- 1) Clients carry their gym membership number, asked on the intake form, so
--    a plan can be matched to the gym's member (and their VALD / Bodydot /
--    InBody tests in UDRA).
-- 2) Personal intake links: UDRA creates a link for one of its clients
--    (/#/intake/<link token>, same route as the gym link). The form opens
--    pre-filled, the submission lands on that client (one diet-plan client per
--    UDRA client, however many plans they get), and the trainer who sent it is
--    recorded. A link is single-use and expires.
-- 3) udra_plan_status: where each UDRA client's plans stand, so UDRA can tell
--    when the client has received theirs (status SENT).
--
-- Links are created and the view is read by UDRA's backend with the service
-- role key; neither is reachable with the anon key. Re-runnable.

alter table clients add column if not exists membership_id   text;
alter table clients add column if not exists udra_client_id  text;
create unique index if not exists clients_gym_udra_client_key
  on clients (gym_id, udra_client_id) where udra_client_id is not null;

create table if not exists intake_links (
  token          uuid primary key default gen_random_uuid(),
  gym_id         uuid not null references gyms (id),
  udra_client_id text not null,
  trainer_ref    text,                       -- UDRA's trainer id
  trainer_name   text,
  -- first_name, last_name, dob, gender, phone, email, membership_id, language
  prefill        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '30 days',
  used_at        timestamptz,
  plan_id        uuid references plans (id) on delete set null
);
create index if not exists intake_links_client_idx on intake_links (gym_id, udra_client_id);

-- No policies: only the service role (UDRA's backend) reads or writes links.
alter table intake_links enable row level security;

-- The intake page's lookup now takes a gym token or a personal link token. A
-- personal link also returns its pre-fill, and whether it was already used
-- (the page then says so instead of showing the form). The return type
-- changes, so the function is dropped first.
drop function if exists get_intake_gym(uuid);
create function get_intake_gym(p_token uuid)
returns table (gym_id uuid, name text, logo_url text, brand_colors jsonb, personal boolean, prefill jsonb, used boolean)
language sql security definer set search_path = public as $$
  select id, name, logo_url, brand_colors, false, '{}'::jsonb, false
    from gyms where intake_token = p_token
  union all
  select g.id, g.name, g.logo_url, g.brand_colors, true, l.prefill, l.used_at is not null
    from intake_links l join gyms g on g.id = l.gym_id
   where l.token = p_token and l.expires_at > now();
$$;
grant execute on function get_intake_gym(uuid) to anon, authenticated;

-- submit_intake (last in 014) now also takes a personal link token, and saves
-- the membership number. Through a link, the client is the UDRA client's row
-- (created the first time, updated after), and the link is used up.
create or replace function submit_intake(
  p_token         uuid,
  p_client        jsonb,
  p_inbody        jsonb,
  p_questionnaire jsonb,
  p_plan_data     jsonb,
  p_api_response  jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_gym    uuid;
  v_link   intake_links;
  v_client uuid;
  v_inbody uuid;
  v_plan   uuid;
  v_lang   text := case when p_client->>'language' in ('en', 'ar') then p_client->>'language' else null end;
  v_member text := nullif(trim(coalesce(p_client->>'membership_id', '')), '');
begin
  select id into v_gym from gyms where intake_token = p_token;
  if v_gym is null then
    select * into v_link from intake_links
     where token = p_token and expires_at > now() and used_at is null
       for update;
    if v_link.token is null then
      raise exception 'Invalid or expired intake link';
    end if;
    v_gym := v_link.gym_id;
    select id into v_client from clients where gym_id = v_gym and udra_client_id = v_link.udra_client_id;
  end if;

  if v_client is null then
    insert into clients (gym_id, created_by, first_name, last_name, dob, gender, phone, email, consent, notes, language, membership_id, udra_client_id)
    values (
      v_gym, null,
      coalesce(p_client->>'first_name', ''),
      coalesce(p_client->>'last_name', ''),
      nullif(p_client->>'dob', '')::date,
      nullif(p_client->>'gender', ''),
      p_client->>'phone',
      p_client->>'email',
      coalesce((p_client->>'consent')::boolean, false),
      coalesce(p_client->>'notes', ''),
      v_lang,
      v_member,
      v_link.udra_client_id
    )
    returning id into v_client;
  else
    -- Returning UDRA client: keep their row, with what they just entered.
    update clients set
      first_name    = coalesce(nullif(p_client->>'first_name', ''), first_name),
      last_name     = coalesce(nullif(p_client->>'last_name', ''), last_name),
      dob           = coalesce(nullif(p_client->>'dob', '')::date, dob),
      gender        = coalesce(nullif(p_client->>'gender', ''), gender),
      phone         = coalesce(nullif(p_client->>'phone', ''), phone),
      email         = coalesce(nullif(p_client->>'email', ''), email),
      consent       = coalesce((p_client->>'consent')::boolean, consent),
      language      = coalesce(v_lang, language),
      membership_id = coalesce(v_member, membership_id),
      updated_at    = now()
    where id = v_client;
  end if;

  if p_inbody is not null and p_inbody <> 'null'::jsonb then
    insert into inbody_results (gym_id, client_id, created_by, source_type, model, extracted, confirmed, test_date)
    values (
      v_gym, v_client, null,
      coalesce((p_inbody->>'source_type')::inbody_source, 'manual'),
      coalesce(p_inbody->>'model', 'InBody270'),
      coalesce(p_inbody->'extracted', '{}'::jsonb),
      coalesce(p_inbody->'confirmed', '{}'::jsonb),
      nullif(p_inbody->>'test_date', '')::date
    )
    returning id into v_inbody;
  end if;

  insert into plans (gym_id, client_id, inbody_result_id, created_by, status, questionnaire, plan_data, api_response)
  values (
    v_gym, v_client, v_inbody, null, 'GENERATED',
    coalesce(p_questionnaire, '{}'::jsonb),
    coalesce(p_plan_data, '{}'::jsonb),
    p_api_response
  )
  returning id into v_plan;

  insert into plan_events (gym_id, plan_id, actor, action, from_status, to_status, comment)
  values (
    v_gym, v_plan, null, 'generated', null, 'GENERATED',
    case when v_link.trainer_name is not null
      then 'Self-service client intake, sent by ' || v_link.trainer_name
      else 'Self-service client intake' end
  );

  if v_link.token is not null then
    update intake_links set used_at = now(), plan_id = v_plan where token = v_link.token;
  end if;

  return v_plan;
end $$;
grant execute on function submit_intake(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;

-- Each UDRA client's plans: status, and when the first delivery went out
-- (sent_at; the client has their plan). security_invoker keeps RLS in force for
-- anyone but the service role, and the grants keep it off the public API.
create or replace view udra_plan_status with (security_invoker = true) as
  select c.gym_id,
         c.udra_client_id,
         c.membership_id,
         p.id         as plan_id,
         p.status,
         p.created_at as generated_at,
         p.updated_at,
         (select min(d.created_at) from deliveries d where d.plan_id = p.id) as sent_at
    from plans p
    join clients c on c.id = p.client_id
   where c.udra_client_id is not null;
revoke all on udra_plan_status from anon, authenticated;
grant select on udra_plan_status to service_role;
