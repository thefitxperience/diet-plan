-- Public plan-share page (/#/plan/<delivery_id>). Instead of pasting a huge
-- signed Supabase URL into WhatsApp, we share a short GitHub Pages link to a
-- viewer page. The page resolves the delivery's stored signed URL via a
-- SECURITY DEFINER RPC (SQL can't mint signed URLs, so we store the one the
-- app generated at send time). Run in the Supabase SQL editor.

alter table deliveries add column if not exists pdf_url text;

create or replace function get_shared_plan(p_token uuid)
returns table (client_name text, gym_name text, gym_logo text, pdf_url text, language text)
language sql security definer set search_path = public as $$
  select
    coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), 'Client'),
    g.name, g.logo_url, d.pdf_url, d.language
  from deliveries d
  join plans p on p.id = d.plan_id
  left join clients c on c.id = p.client_id
  left join gyms g on g.id = d.gym_id
  where d.id = p_token and d.pdf_url is not null
  limit 1;
$$;
grant execute on function get_shared_plan(uuid) to anon, authenticated;
