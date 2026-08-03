-- Review §4.2: capture the client's preferred language.
--
-- Language lives on the client (it persists across plans and drives which
-- language their PDF is generated and delivered in), so it needs a column.
-- Disliked ingredients are a per-plan answer and live in the existing
-- plans.questionnaire jsonb — no schema change needed for that.
--
-- MUST BE APPLIED TO THE HOSTED DATABASE (submit_intake is recreated below to
-- accept the new field; without it, a self-service client's language is dropped).

alter table clients add column if not exists language text
  check (language is null or language in ('en', 'ar'));

-- submit_intake whitelists the client columns it inserts, so it has to be
-- recreated to carry `language` through. Body is otherwise unchanged from 009.
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

  insert into clients (gym_id, created_by, first_name, last_name, dob, gender, phone, email, consent, notes, language)
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
    -- ignore anything that isn't a supported language rather than failing the
    -- whole intake on a bad value
    case when p_client->>'language' in ('en', 'ar') then p_client->>'language' else null end
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
