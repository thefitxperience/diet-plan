-- Mock data for the demo accounts (all under "FIT Demo Gym").
-- Re-runnable: wipes the demo gym's clients (cascades to inbody/plans/events/
-- deliveries) then reseeds. Run AFTER 005.

do $$
declare
  v_gym      uuid;
  v_nut      uuid := '32e51cd6-e7bf-438c-9d5f-c96cc7038745'; -- nutritionist (Demo)
  v_gymadmin uuid := '4b5bf18a-0ce1-4ee4-ac21-c6f57697f3a0'; -- gym admin (Demo)
  v_meals    jsonb;
  c_sara uuid; c_omar uuid; c_layla uuid; c_khaled uuid; c_nour uuid; c_yousef uuid;
  ib_sara uuid; ib_omar uuid;
  p_id uuid;
begin
  select id into v_gym from gyms where name = 'FIT Demo Gym' limit 1;
  if v_gym is null then insert into gyms (name) values ('FIT Demo Gym') returning id into v_gym; end if;

  delete from clients where gym_id = v_gym;

  -- shared meal set (ids MUST be breakfast/lunch/dinner/snack for the template)
  v_meals := $json$[
    {"id":"breakfast","targetKcal":420,"options":[
      {"id":"o1","name_en":"Oatmeal with Berries","name_ar":"شوفان مع التوت","desc_en":"Rolled oats cooked with milk, topped with mixed berries and honey","desc_ar":"شوفان مطبوخ بالحليب مع التوت والعسل","ingredients":[{"name_en":"Oats","name_ar":"شوفان","grams":50,"uom":"g"},{"name_en":"Milk","name_ar":"حليب","grams":200,"uom":"g"},{"name_en":"Mixed Berries","name_ar":"توت مشكل","grams":80,"uom":"g"}],"macros":{"protein":18,"carbs":62,"fats":9},"kcal":420},
      {"id":"o2","name_en":"Egg White Omelette","name_ar":"أومليت بياض البيض","desc_en":"Egg whites with spinach and low-fat cheese","desc_ar":"بياض بيض مع السبانخ وجبن قليل الدسم","ingredients":[{"name_en":"Egg Whites","name_ar":"بياض البيض","grams":180,"uom":"g"},{"name_en":"Spinach","name_ar":"سبانخ","grams":60,"uom":"g"},{"name_en":"Low-fat Cheese","name_ar":"جبن قليل الدسم","grams":30,"uom":"g"}],"macros":{"protein":28,"carbs":6,"fats":8},"kcal":220}
    ]},
    {"id":"lunch","targetKcal":620,"options":[
      {"id":"o3","name_en":"Grilled Chicken & Rice","name_ar":"دجاج مشوي مع الأرز","desc_en":"Grilled chicken breast with white rice and steamed vegetables","desc_ar":"صدر دجاج مشوي مع أرز أبيض وخضار مطهوة على البخار","ingredients":[{"name_en":"Chicken Breast","name_ar":"صدر دجاج","grams":180,"uom":"g"},{"name_en":"White Rice","name_ar":"أرز أبيض","grams":150,"uom":"g"},{"name_en":"Mixed Vegetables","name_ar":"خضار مشكلة","grams":120,"uom":"g"}],"macros":{"protein":48,"carbs":58,"fats":10},"kcal":600},
      {"id":"o4","name_en":"Salmon & Quinoa","name_ar":"سلمون مع الكينوا","desc_en":"Baked salmon fillet with quinoa and asparagus","desc_ar":"شريحة سلمون مخبوزة مع الكينوا والهليون","ingredients":[{"name_en":"Salmon","name_ar":"سلمون","grams":170,"uom":"g"},{"name_en":"Quinoa","name_ar":"كينوا","grams":120,"uom":"g"},{"name_en":"Asparagus","name_ar":"هليون","grams":100,"uom":"g"}],"macros":{"protein":42,"carbs":40,"fats":22},"kcal":600}
    ]},
    {"id":"dinner","targetKcal":540,"options":[
      {"id":"o5","name_en":"Beef Steak & Veggies","name_ar":"شريحة لحم مع الخضار","desc_en":"Lean beef steak with roasted vegetables","desc_ar":"شريحة لحم قليلة الدهن مع خضار مشوية","ingredients":[{"name_en":"Beef Steak","name_ar":"لحم بقري","grams":160,"uom":"g"},{"name_en":"Broccoli","name_ar":"بروكلي","grams":120,"uom":"g"},{"name_en":"Olive Oil","name_ar":"زيت زيتون","grams":10,"uom":"g"}],"macros":{"protein":44,"carbs":14,"fats":24},"kcal":430},
      {"id":"o6","name_en":"Baked Fish & Sweet Potato","name_ar":"سمك مخبوز مع البطاطا الحلوة","desc_en":"White fish with baked sweet potato and salad","desc_ar":"سمك أبيض مع بطاطا حلوة مخبوزة وسلطة","ingredients":[{"name_en":"White Fish","name_ar":"سمك أبيض","grams":180,"uom":"g"},{"name_en":"Sweet Potato","name_ar":"بطاطا حلوة","grams":150,"uom":"g"},{"name_en":"Green Salad","name_ar":"سلطة خضراء","grams":100,"uom":"g"}],"macros":{"protein":38,"carbs":34,"fats":8},"kcal":380}
    ]},
    {"id":"snack","targetKcal":220,"options":[
      {"id":"o7","name_en":"Greek Yogurt & Nuts","name_ar":"زبادي يوناني مع المكسرات","desc_en":"Greek yogurt topped with almonds","desc_ar":"زبادي يوناني مع اللوز","ingredients":[{"name_en":"Greek Yogurt","name_ar":"زبادي يوناني","grams":170,"uom":"g"},{"name_en":"Almonds","name_ar":"لوز","grams":20,"uom":"g"}],"macros":{"protein":18,"carbs":12,"fats":11},"kcal":220},
      {"id":"o8","name_en":"Apple & Peanut Butter","name_ar":"تفاح مع زبدة الفول السوداني","desc_en":"Apple slices with natural peanut butter","desc_ar":"شرائح تفاح مع زبدة فول سوداني طبيعية","ingredients":[{"name_en":"Apple","name_ar":"تفاح","grams":150,"uom":"g"},{"name_en":"Peanut Butter","name_ar":"زبدة فول سوداني","grams":20,"uom":"g"}],"macros":{"protein":6,"carbs":26,"fats":10},"kcal":220}
    ]}
  ]$json$::jsonb;

  -- ── clients ─────────────────────────────────────────────────────────
  insert into clients (gym_id, created_by, first_name, last_name, dob, gender, phone, email, consent, notes) values
    (v_gym, v_nut, 'Sara',   'Ali',    '1994-03-12', 'F', '+96170111222', 'sara@demo.fit',   true, 'Prefers Mediterranean meals'),
    (v_gym, v_nut, 'Omar',   'Hassan', '1990-08-25', 'M', '+96170333444', 'omar@demo.fit',   true, ''),
    (v_gym, v_nut, 'Layla',  'Ahmed',  '1997-11-02', 'F', '+96170555666', 'layla@demo.fit',  true, 'Lactose sensitive'),
    (v_gym, v_nut, 'Khaled', 'Nasser', '1988-01-19', 'M', '+96170777888', 'khaled@demo.fit', true, ''),
    (v_gym, v_nut, 'Nour',   'Saad',   '1999-06-30', 'F', '+96170999000', 'nour@demo.fit',   true, ''),
    (v_gym, v_nut, 'Yousef', 'Karim',  '1992-09-14', 'M', '+96171123456', 'yousef@demo.fit', true, 'New client, awaiting InBody');

  select id into c_sara   from clients where gym_id = v_gym and first_name = 'Sara';
  select id into c_omar   from clients where gym_id = v_gym and first_name = 'Omar';
  select id into c_layla  from clients where gym_id = v_gym and first_name = 'Layla';
  select id into c_khaled from clients where gym_id = v_gym and first_name = 'Khaled';
  select id into c_nour   from clients where gym_id = v_gym and first_name = 'Nour';
  select id into c_yousef from clients where gym_id = v_gym and first_name = 'Yousef';

  -- ── InBody results ──────────────────────────────────────────────────
  insert into inbody_results (gym_id, client_id, created_by, source_type, model, extracted, confirmed, test_date)
  values (v_gym, c_sara, v_nut, 'pdf_text', 'InBody270', '{}'::jsonb,
    '{"weight":62.4,"height":165,"age":31,"smm":25.1,"fatMass":16.8,"lbm":45.6,"bmr":1360,"pbf":26.9,"bmi":22.9,"score":78}'::jsonb, current_date - 20)
  returning id into ib_sara;
  insert into inbody_results (gym_id, client_id, created_by, source_type, model, extracted, confirmed, test_date)
  values (v_gym, c_omar, v_nut, 'pdf_text', 'InBody270', '{}'::jsonb,
    '{"weight":84.1,"height":178,"age":35,"smm":38.2,"fatMass":18.4,"lbm":65.7,"bmr":1780,"pbf":21.9,"bmi":26.5,"score":82}'::jsonb, current_date - 12)
  returning id into ib_omar;
  insert into inbody_results (gym_id, client_id, created_by, source_type, model, extracted, confirmed, test_date)
  values (v_gym, c_yousef, v_nut, 'ocr', 'InBody270', '{}'::jsonb,
    '{"weight":90.3,"height":182,"age":33,"smm":40.1,"fatMass":22.0,"lbm":68.3,"bmr":1850,"pbf":24.4,"bmi":27.3,"score":75}'::jsonb, current_date - 3);

  -- helper to insert a plan + its lifecycle events
  -- Sara → SENT (full lifecycle, delivered)
  insert into plans (gym_id, client_id, inbody_result_id, created_by, status, version, questionnaire, plan_data, api_response)
  values (v_gym, c_sara, ib_sara, v_nut, 'SENT', 2,
    jsonb_build_object('allergyNames', '[]'::jsonb, 'conditionNames', '[]'::jsonb),
    jsonb_build_object('header', jsonb_build_object('fullName','Sara Ali','dob','1994-03-12','testDate', (current_date-20)::text,'nextCheckup', (current_date+20)::text,'dailyKcal',1800,'dietType','Weight Loss'), 'isIF', false, 'meals', v_meals),
    '{}'::jsonb)
  returning id into p_id;
  insert into plan_events (gym_id, plan_id, actor, action, comment, created_at) values
    (v_gym, p_id, v_nut,      'generated', '',                     now() - interval '18 days'),
    (v_gym, p_id, v_nut,      'edited',    'tuned portions',       now() - interval '17 days'),
    (v_gym, p_id, v_nut,      'submitted', '',                     now() - interval '17 days'),
    (v_gym, p_id, v_gymadmin, 'approved_gym', '',                  now() - interval '16 days'),
    (v_gym, p_id, v_gymadmin, 'sent',      '',                     now() - interval '16 days');
  insert into deliveries (gym_id, plan_id, actor, channel, recipient, language, status, created_at)
  values (v_gym, p_id, v_gymadmin, 'whatsapp_link', '+96170111222', 'en', 'sent', now() - interval '16 days');

  -- Omar → NUTRITIONIST_APPROVED (waiting for gym approval)
  insert into plans (gym_id, client_id, inbody_result_id, created_by, status, version, questionnaire, plan_data, api_response)
  values (v_gym, c_omar, ib_omar, v_nut, 'NUTRITIONIST_APPROVED', 2,
    jsonb_build_object('allergyNames', '[]'::jsonb, 'conditionNames', '[]'::jsonb),
    jsonb_build_object('header', jsonb_build_object('fullName','Omar Hassan','dob','1990-08-25','testDate', (current_date-12)::text,'nextCheckup','','dailyKcal',2400,'dietType','Maintenance'), 'isIF', false, 'meals', v_meals),
    '{}'::jsonb)
  returning id into p_id;
  insert into plan_events (gym_id, plan_id, actor, action, comment, created_at) values
    (v_gym, p_id, v_nut, 'generated', '', now() - interval '4 days'),
    (v_gym, p_id, v_nut, 'edited',    '', now() - interval '3 days'),
    (v_gym, p_id, v_nut, 'submitted', '', now() - interval '3 days');

  -- Layla → CHANGES_REQUESTED (returned to nutritionist)
  insert into plans (gym_id, client_id, created_by, status, version, questionnaire, plan_data, api_response)
  values (v_gym, c_layla, v_nut, 'CHANGES_REQUESTED', 2,
    jsonb_build_object('allergyNames', '["Lactose"]'::jsonb, 'conditionNames', '[]'::jsonb),
    jsonb_build_object('header', jsonb_build_object('fullName','Layla Ahmed','dob','1997-11-02','testDate', current_date::text,'nextCheckup','','dailyKcal',1700,'dietType','Weight Loss'), 'isIF', false, 'meals', v_meals),
    '{}'::jsonb)
  returning id into p_id;
  insert into plan_events (gym_id, plan_id, actor, action, comment, created_at) values
    (v_gym, p_id, v_nut,      'generated', '', now() - interval '6 days'),
    (v_gym, p_id, v_nut,      'submitted', '', now() - interval '5 days'),
    (v_gym, p_id, v_gymadmin, 'rejected',  'Please swap the dairy snack — client is lactose sensitive.', now() - interval '5 days');

  -- Khaled → IN_REVIEW (nutritionist editing)
  insert into plans (gym_id, client_id, created_by, status, version, questionnaire, plan_data, api_response)
  values (v_gym, c_khaled, v_nut, 'IN_REVIEW', 1,
    jsonb_build_object('allergyNames', '[]'::jsonb, 'conditionNames', '[]'::jsonb),
    jsonb_build_object('header', jsonb_build_object('fullName','Khaled Nasser','dob','1988-01-19','testDate', current_date::text,'nextCheckup','','dailyKcal',2600,'dietType','Weight Gain'), 'isIF', false, 'meals', v_meals),
    '{}'::jsonb)
  returning id into p_id;
  insert into plan_events (gym_id, plan_id, actor, action, comment, created_at) values
    (v_gym, p_id, v_nut, 'generated', '', now() - interval '2 days'),
    (v_gym, p_id, v_nut, 'edited',    '', now() - interval '1 days');

  -- Nour → GYM_APPROVED (ready to send)
  insert into plans (gym_id, client_id, created_by, status, version, questionnaire, plan_data, api_response)
  values (v_gym, c_nour, v_nut, 'GYM_APPROVED', 2,
    jsonb_build_object('allergyNames', '[]'::jsonb, 'conditionNames', '[]'::jsonb),
    jsonb_build_object('header', jsonb_build_object('fullName','Nour Saad','dob','1999-06-30','testDate', current_date::text,'nextCheckup','','dailyKcal',1900,'dietType','Maintenance'), 'isIF', false, 'meals', v_meals),
    '{}'::jsonb)
  returning id into p_id;
  insert into plan_events (gym_id, plan_id, actor, action, comment, created_at) values
    (v_gym, p_id, v_nut,      'generated',    '', now() - interval '3 days'),
    (v_gym, p_id, v_nut,      'edited',       '', now() - interval '2 days'),
    (v_gym, p_id, v_nut,      'submitted',    '', now() - interval '2 days'),
    (v_gym, p_id, v_gymadmin, 'approved_gym', '', now() - interval '1 days');
end $$;
