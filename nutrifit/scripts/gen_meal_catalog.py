#!/usr/bin/env python3
"""Generate src/data/mealCatalog.json from "Meal Breakdown.xlsx".

The export has three sheets joined by Meal ID:
  Meals          — Meal ID, Dish Name, Quantity (serving g), Calories Per Serving
  Ingredients    — Meal ID, Ingredient Name, Quantity (g), Alternative Ingredient
  Macronutrients — Meal ID, Macronutrient Name, Quantity Per Serve

Output entry shape matches the editor's plan-option model (planModel.js):
  { id, name_en, name_ar, kcal, servingGrams, ingredientCount,
    macros:{protein,carbs,fats},
    ingredients:[{name_en, name_ar, grams, uom, alt_en}] }

Arabic names are filled from i18n/plan-ar.json where present (same maps the
generated plans already use); missing ones stay '' and surface the editor's
normal "missing Arabic" affordance.
"""
import json, os, sys

try:
    import openpyxl
except ImportError:
    sys.exit("pip install openpyxl")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(os.path.dirname(ROOT), "Meal Breakdown.xlsx")  # project root
PLAN_AR = os.path.join(ROOT, "src", "i18n", "plan-ar.json")
DESCS = os.path.join(ROOT, "scripts", "dish_descriptions.json")  # harvested from API
CATS = os.path.join(ROOT, "scripts", "dish_categories.json")     # harvested from API
DIETS_FILE = os.path.join(ROOT, "scripts", "dish_diets.json")    # harvested from API
CUSTOM = os.path.join(ROOT, "scripts", "custom_meals.json")      # hand-authored meals
OUT = os.path.join(ROOT, "src", "data", "mealCatalog.json")

MACRO_KEYS = {"Protein": "protein", "Carbohydrates": "carbs", "Healthy Fats": "fats"}


def num(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
        return int(f) if f == int(f) else round(f, 2)
    except (ValueError, TypeError):
        return None


def main():
    ar = json.load(open(PLAN_AR, encoding="utf-8"))
    food_ar, ing_ar, desc_ar_map = ar.get("food", {}), ar.get("ingredients", {}), ar.get("descriptions", {})
    # Descriptions + meal-time categories + dietary types harvested from the API.
    descs = json.load(open(DESCS, encoding="utf-8")) if os.path.exists(DESCS) else {}
    cats = json.load(open(CATS, encoding="utf-8")) if os.path.exists(CATS) else {}
    diets = json.load(open(DIETS_FILE, encoding="utf-8")) if os.path.exists(DIETS_FILE) else {}

    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    meals = list(wb["Meals"].iter_rows(min_row=2, values_only=True))
    ing_rows = list(wb["Ingredients"].iter_rows(min_row=2, values_only=True))
    mac_rows = list(wb["Macronutrients"].iter_rows(min_row=2, values_only=True))
    wb.close()

    ings = {}
    for mid, name, qty, alt in ((r + (None,) * 4)[:4] for r in ing_rows):
        if mid is None or not name:
            continue
        ings.setdefault(str(mid), []).append({
            "name_en": str(name).strip(),
            "name_ar": ing_ar.get(str(name).strip(), ""),
            "grams": num(qty) or 0,
            "uom": "g",
            "alt_en": str(alt).strip() if alt else "",
        })

    macs = {}
    for mid, mname, qty in ((r + (None,) * 3)[:3] for r in mac_rows):
        if mid is None or mname not in MACRO_KEYS:
            continue
        macs.setdefault(str(mid), {})[MACRO_KEYS[mname]] = num(qty)

    catalog = []
    for mid, name, qty, kcal in ((r + (None,) * 4)[:4] for r in meals):
        if mid is None or not name:
            continue
        key = str(mid)
        nm = str(name).strip()
        m = macs.get(key, {})
        entry_ings = sorted(ings.get(key, []), key=lambda x: -(x["grams"] or 0))
        desc_en = descs.get(nm, "")
        catalog.append({
            "id": key,
            "name_en": nm,
            "name_ar": food_ar.get(nm, ""),
            "desc_en": desc_en,
            "desc_ar": desc_ar_map.get(desc_en, "") if desc_en else "",
            # meal-time slots this dish is allowed in (empty = not yet harvested;
            # the picker treats empty as "allowed everywhere" until filled in).
            "categories": sorted(cats.get(nm, [])),
            # dietary types this dish is served under (empty = treated as "any").
            "diets": sorted(diets.get(nm, [])),
            "kcal": num(kcal) or 0,
            "servingGrams": num(qty) or 0,
            "ingredientCount": len(entry_ings),
            "macros": {
                "protein": m.get("protein"),
                "carbs": m.get("carbs"),
                "fats": m.get("fats"),
            },
            "ingredients": entry_ings,
        })

    # Only real composed meals (>=2 ingredients) — the single-ingredient rows
    # in the export are ingredients, not meals, so they're excluded.
    catalog = [e for e in catalog if e["ingredientCount"] >= 2]

    # Merge hand-authored meals (e.g. extra keto options) — full catalog shape.
    custom = json.load(open(CUSTOM, encoding="utf-8")) if os.path.exists(CUSTOM) else []
    have = {e["name_en"] for e in catalog}
    added = [c for c in custom if c["name_en"] not in have]
    catalog.extend(added)

    catalog.sort(key=lambda e: e["name_en"].lower())

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(catalog, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"Wrote {len(catalog)} meals ({len(added)} custom) → {OUT}")


if __name__ == "__main__":
    main()
