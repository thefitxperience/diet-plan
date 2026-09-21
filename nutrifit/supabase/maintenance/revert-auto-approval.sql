-- ─────────────────────────────────────────────────────────────────────────────
-- Revert an automatic approval, returning a plan to the review queue.
--
-- Run in the Supabase SQL editor. This cannot be done from the app: the state
-- machine in transition_plan() only moves forward (nothing leaves
-- NUTRITIONIST_APPROVED except 'sent'), and the plans_status_guard trigger
-- rejects any direct status write that is not wrapped in the transition flag.
--
-- WHAT THIS DOES NOT DO
--   * It does not retract a plan that was already delivered. If STEP 1 shows a
--     delivery, the client already has that PDF — reverting the status only
--     controls what happens next.
--   * It does not stop the plan being auto-approved again. The 24-hour clock
--     restarts from the event this writes, so the same release will happen
--     roughly 24 hours from now unless you turn the gym's auto-approval off
--     on the Gyms admin page (migration 017).
-- ─────────────────────────────────────────────────────────────────────────────


-- ══ STEP 1 — INSPECT. Run this on its own first; it changes nothing. ════════
-- Check the client names, that the status is what you expect, and above all
-- whether the plan has already been sent.

select c.first_name || ' ' || c.last_name          as client,
       g.name                                      as gym,
       p.status,
       p.updated_at,
       (select count(*) from deliveries d where d.plan_id = p.id) as deliveries_sent,
       p.id                                        as plan_id
  from plans p
  join clients c on c.id = p.client_id
  join gyms    g on g.id = p.gym_id
 where p.status in ('NUTRITIONIST_APPROVED', 'SENT')
   -- The auto-approval signature: the system acted, so there is no actor.
   and exists (
     select 1 from plan_events e
      where e.plan_id = p.id
        and e.actor is null
        and e.action = 'submitted'
   )
   -- ↓↓ EDIT THIS LIST ↓↓
   and (c.first_name || ' ' || c.last_name) in ('Rayne Milan', 'Habib Kazzi')
 order by c.last_name;


-- ══ STEP 2 — REVERT. Only run once STEP 1 shows the right rows. ═════════════
-- Wrapped in a transaction: if anything below fails, nothing is written.

begin;

-- Who is performing the reversal. Recorded against the event so the plan's
-- history shows a person, not "Unknown user".
-- ↓↓ EDIT: your login email ↓↓
create temp table _actor on commit drop as
  select id from auth.users where email = 'andy.ayas@thefitxperience.com';

-- The plans to revert — same filter as STEP 1.
create temp table _targets on commit drop as
  select p.id, p.gym_id, p.status as from_status
    from plans p
    join clients c on c.id = p.client_id
   where p.status in ('NUTRITIONIST_APPROVED', 'SENT')
     and exists (
       select 1 from plan_events e
        where e.plan_id = p.id and e.actor is null and e.action = 'submitted'
     )
     -- ↓↓ EDIT THIS LIST (keep it identical to STEP 1) ↓↓
     and (c.first_name || ' ' || c.last_name) in ('Rayne Milan', 'Habib Kazzi');

-- Refuse to run if the filter matched nothing, or if the actor lookup failed —
-- an empty update here would look like success.
do $$
declare n int; a int;
begin
  select count(*) into n from _targets;
  select count(*) into a from _actor;
  if n = 0 then raise exception 'No matching plans — check the names in STEP 1'; end if;
  if a = 0 then raise exception 'No auth.users row for that email — fix the actor email'; end if;
  raise notice 'Reverting % plan(s)', n;
end $$;

-- The guard trigger allows a status write only while this flag is set.
select set_config('nutrifit.allow_transition', 'on', true);

update plans p
   set status     = 'IN_REVIEW',   -- editable again, and back in the approvals queue
       updated_at = now()
  from _targets t
 where p.id = t.id;

select set_config('nutrifit.allow_transition', '', true);

-- Audit trail. 'rejected' is the state machine's "needs changes" action and is
-- what the timeline renders as "requested changes"; the comment says why.
insert into plan_events (gym_id, plan_id, actor, action, from_status, to_status, comment)
select t.gym_id, t.id, (select id from _actor), 'rejected', t.from_status, 'IN_REVIEW',
       'Automatic approval reverted — returned for dietitian review'
  from _targets t;

-- Confirm before committing.
select c.first_name || ' ' || c.last_name as client, p.status, p.updated_at
  from plans p join clients c on c.id = p.client_id
 where p.id in (select id from _targets);

commit;
