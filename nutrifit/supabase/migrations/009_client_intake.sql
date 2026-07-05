-- Public, no-login client intake flow. A per-gym secret token identifies the
-- gym; a shared link (/#/intake/<token>) lets a client upload their InBody and
-- fill the questionnaire, which creates the client + a GENERATED plan that
-- lands in the nutritionist's approval queue. All writes go through a single
-- SECURITY DEFINER RPC so the anon role never touches the tables directly.

-- Per-gym intake token (unguessable, rotatable).
alter table gyms add column if not exists intake_token uuid not null default gen_random_uuid();
create unique index if not exists gyms_intake_token_key on gyms (intake_token);

-- Intake-created rows have no authoring profile.
alter table clients        alter column created_by drop not null;
alter table inbody_results alter column created_by drop not null;
alter table plans          alter column created_by drop not null;
alter table plan_events    alter column actor      drop not null;

-- Public, safe gym info for branding the intake page.
create or replace function get_intake_gym(p_token uuid)
returns table (gym_id uuid, name text, logo_url text, brand_colors jsonb)
language sql security definer set search_path = public as $$
  select id, name, logo_url, brand_colors from gyms where intake_token = p_token;
$$;
grant execute on function get_intake_gym(uuid) to anon, authenticated;

-- Atomically create the client, (optional) InBody result, and a GENERATED plan
-- awaiting nutritionist approval. Returns the new plan id.
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
  v_client uuid;
  v_inbody uuid;
  v_plan   uuid;
begin
  select id into v_gym from gyms where intake_token = p_token;
  if v_gym is null then
    raise exception 'Invalid or expired intake link';
  end if;

  insert into clients (gym_id, created_by, first_name, last_name, dob, gender, phone, email, consent, notes)
  values (
    v_gym, null,
    coalesce(p_client->>'first_name', ''),
    coalesce(p_client->>'last_name', ''),
    nullif(p_client->>'dob', '')::date,
    nullif(p_client->>'gender', ''),
    p_client->>'phone',
    p_client->>'email',
    coalesce((p_client->>'consent')::boolean, false),
    coalesce(p_client->>'notes', '')
  )
  returning id into v_client;

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
  values (v_gym, v_plan, null, 'generated', null, 'GENERATED', 'Self-service client intake');

  return v_plan;
end $$;
grant execute on function submit_intake(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;
