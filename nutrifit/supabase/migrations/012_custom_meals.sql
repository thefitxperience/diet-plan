-- Reusable custom meals a nutritionist saves from the plan editor. Gym-scoped,
-- shaped to match mealCatalog.json entries so the editor's meal picker can offer
-- them alongside the built-in catalog.

create table custom_meals (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references gyms (id) on delete cascade,
  created_by  uuid references profiles (id),
  slot        text,                       -- breakfast | lunch | dinner | snack | custom_*
  name_en     text not null default '',
  name_ar     text not null default '',
  desc_en     text not null default '',
  desc_ar     text not null default '',
  diets       text[] not null default '{}',
  ingredients jsonb  not null default '[]',
  macros      jsonb  not null default '{}',
  kcal        integer not null default 0,
  created_at  timestamptz not null default now()
);

create index on custom_meals (gym_id, slot);

alter table custom_meals enable row level security;

-- Anyone in the gym may read the gym's saved meals; platform admins see all.
create policy custom_meals_select on custom_meals for select using (
  gym_id = auth_gym() or auth_role() = 'platform_admin'
);
-- Nutritionists create/manage their gym's meals; platform admins may do anything.
create policy custom_meals_insert on custom_meals for insert with check (
  (gym_id = auth_gym() and auth_role() = 'nutritionist' and created_by = auth.uid())
  or auth_role() = 'platform_admin'
);
create policy custom_meals_update on custom_meals for update using (
  (gym_id = auth_gym() and auth_role() = 'nutritionist')
  or auth_role() = 'platform_admin'
);
create policy custom_meals_delete on custom_meals for delete using (
  (gym_id = auth_gym() and auth_role() = 'nutritionist')
  or auth_role() = 'platform_admin'
);
