-- Dietitian review (19 Aug 2026), item 11: the minimum daily calorie target is a
-- clinical judgement that differs between practitioners, so it must be set per
-- dietitian rather than hard-coded. NULL means "use the application default".
--
-- No new policy needed: profiles_self_update (tightened in 013) already lets a
-- user edit their own row while pinning role, gym and approval status.

alter table profiles add column if not exists min_kcal integer
  check (min_kcal is null or (min_kcal >= 800 and min_kcal <= 4000));

comment on column profiles.min_kcal is
  'Practitioner''s own minimum daily calorie target. Plans below it are flagged for an explicit override before approval. NULL = application default.';
