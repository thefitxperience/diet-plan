#!/usr/bin/env python3
"""Harvest dish descriptions from the FIT /v3/generate API.

The Meal Breakdown export has no descriptions, but the generation API returns
one per dish (and its foodDishName matches our catalog names exactly). This
runs many generate calls across goal/diet/gender combos, accumulates a
{dish name -> description} map, and writes scripts/dish_descriptions.json.

Re-runnable: merges with the existing cache so coverage grows each run.
gen_meal_catalog.py then folds these descriptions into mealCatalog.json.

Usage:  python3 scripts/harvest_descriptions.py [max_calls]
"""
import json, os, sys, time, urllib.request, base64, itertools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", "dish_descriptions.json")
CATS = os.path.join(ROOT, "scripts", "dish_categories.json")
DIETS_FILE = os.path.join(ROOT, "scripts", "dish_diets.json")
CATALOG = os.path.join(ROOT, "src", "data", "mealCatalog.json")

# API category key -> the meal-slot id used in the app (planModel MEAL_DEFS).
CAT_ID = {"Breakfast": "breakfast", "Lunch": "lunch", "Dinner": "dinner", "Snack": "snack"}

BASE = "https://fit-proxy.andyayas27.workers.dev/rest/s1/fit/dietPlan"
AUTH = "Basic " + base64.b64encode(b"fit:Fit@2024").decode()
# The proxy 403s the default Python-urllib User-Agent — send a browser one.
UA = "Mozilla/5.0"

TYPES = ["Maintenance", "WeightGain", "WeightLoss"]
SECONDARY = ["Default", "IntermittentFasting"]
DIETS = ["Omnivore", "Halal", "Kosher", "Pescatarian", "Vegetarian", "Vegan", "Keto"]
GENDERS = ["M", "F"]


def generate(typeId, secondaryTypeId, diet, gender, retries=4):
    body = {
        "firstName": "H", "lastName": "T", "gender": gender,
        "dateOfBirth": "1990-01-01", "age": 35,
        "activityLevelTypeEnumId": "AltModeratelyActive",
        "dietaryTypeId": diet, "typeId": typeId, "secondaryTypeId": secondaryTypeId,
        "height": 175, "weight": 80, "muscleMass": 35, "fatMass": 18,
        "bmr": "1700", "lbm": "62", "kilocalorieNeeded": 2200,
    }
    for attempt in range(retries):
        req = urllib.request.Request(
            f"{BASE}/v3/generate", data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "Authorization": AUTH, "User-Agent": UA}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (403, 429) and attempt < retries - 1:
                time.sleep(8 * (attempt + 1))  # back off on rate-limit
                continue
            raise


def dishes(resp):
    # yield (category_id, name, desc) — top-level map key is the meal category
    for cat_key, groups in (resp.get("foodDishByCategoryMap") or {}).items():
        cat_id = CAT_ID.get(cat_key)
        for cls in (groups or {}).values():
            for items in (cls or {}).values():
                for it in items:
                    name, desc = it.get("foodDishName"), it.get("description")
                    if name:
                        yield cat_id, name.strip(), (desc or "").strip()


def main():
    max_calls = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    delay = float(sys.argv[2]) if len(sys.argv) > 2 else 12.0  # slow & steady
    only_diet = sys.argv[3] if len(sys.argv) > 3 else None  # e.g. "Keto" to focus one diet
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    cats = {k: set(v) for k, v in (json.load(open(CATS, encoding="utf-8")).items()
            if os.path.exists(CATS) else [])}
    diets = {k: set(v) for k, v in (json.load(open(DIETS_FILE, encoding="utf-8")).items()
             if os.path.exists(DIETS_FILE) else [])}
    # Repeat the combo grid so non-deterministic responses keep adding new dishes.
    diet_list = [only_diet] if only_diet else DIETS
    grid = list(itertools.product(TYPES, SECONDARY, diet_list, GENDERS))
    combos = (grid * 8)[:max_calls]

    def save():
        json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        json.dump({k: sorted(v) for k, v in cats.items()},
                  open(CATS, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        json.dump({k: sorted(v) for k, v in diets.items()},
                  open(DIETS_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=0)

    calls = 0
    for typeId, sec, diet, gender in combos:
        calls += 1
        try:
            resp = generate(typeId, sec, diet, gender)
            newc = 0
            for cat_id, name, desc in dishes(resp):
                if desc and name not in cache:
                    newc += 1
                if desc:
                    cache[name] = desc
                if cat_id:
                    cats.setdefault(name, set()).add(cat_id)
                diets.setdefault(name, set()).add(diet)  # served under this diet
            save()  # persist after every call so progress is never lost
            print(f"[{calls}/{max_calls}] {typeId}/{sec}/{diet}/{gender}: +{newc} desc (total {len(cache)} desc, {len(cats)} cat, {len(diets)} diet)", flush=True)
        except Exception as e:
            print(f"[{calls}] {typeId}/{sec}/{diet}/{gender}: ERROR {e}", flush=True)
        time.sleep(delay)  # go slow so we don't trip the proxy rate limit

    # Coverage against the catalog
    if os.path.exists(CATALOG):
        cat = json.load(open(CATALOG, encoding="utf-8"))
        haved = sum(1 for e in cat if e["name_en"] in cache)
        havec = sum(1 for e in cat if e["name_en"] in cats)
        print(f"\nCatalog: {haved}/{len(cat)} have a description, {havec}/{len(cat)} have categories")
        missc = [e["name_en"] for e in cat if e["name_en"] not in cats]
        if missc:
            print("No category yet:", ", ".join(missc))
    print(f"Wrote {len(cache)} descriptions, {len(cats)} category maps")


if __name__ == "__main__":
    main()
