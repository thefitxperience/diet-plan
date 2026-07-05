// Structured editable plan model (plan §5). The API response is normalized
// into this shape; edits mutate it; the template re-renders from it.

import planAr from '../i18n/plan-ar.json'

export const MEAL_DEFS = [
  { id: 'breakfast', apiKey: 'Breakfast' },
  { id: 'lunch', apiKey: 'Lunch' },
  { id: 'dinner', apiKey: 'Dinner' },
  { id: 'snack', apiKey: 'Snack' },
]

export const MAX_OPTIONS_PER_MEAL = 7

let optionSeq = 0
const newId = () => `opt_${Date.now().toString(36)}_${optionSeq++}`

export function translateFood(name) {
  return (planAr.food || {})[name] || ''
}
export function translateDescription(desc) {
  return (planAr.descriptions || {})[desc] || ''
}
export function translateIngredient(name) {
  return (planAr.ingredients || {})[name] || ''
}

function normalizeOption(item) {
  const macros = { protein: null, carbs: null, fats: null }
  for (const m of item.macronutrientList || []) {
    if (m.macronutrientId === 'Protein') macros.protein = m.quantityPerServe
    if (m.macronutrientId === 'Carbohydrates') macros.carbs = m.quantityPerServe
    if (m.macronutrientId === 'Healthy_Fats') macros.fats = m.quantityPerServe
  }
  const ingredients = [...(item.ingredientList || [])]
    .sort((a, b) => b.quantity - a.quantity)
    .map((ing) => ({
      name_en: ing.ingredientName || '',
      name_ar: translateIngredient(ing.ingredientName || ''),
      grams: ing.quantity ?? 0,
      uom: ing.quantityUomId === 'WT_g' ? 'g' : ing.quantityUomId || 'g',
    }))
  return {
    id: newId(),
    name_en: item.foodDishName || '',
    name_ar: translateFood(item.foodDishName || ''),
    desc_en: item.description || '',
    desc_ar: translateDescription(item.description || ''),
    ingredients,
    macros,
    kcal: Math.round(item.kilocaloriePerServe || 0),
  }
}

// Flatten the nested group/classification map into a flat option list.
// We keep ALL options the API returned (not just the first 7) so the dietary
// rules can drop unsuitable dishes and backfill from the remaining safe ones;
// the final ≤7 cap is applied after that selection (see dietaryRules.js).
function flattenMeal(mealData) {
  const options = []
  if (!mealData) return options
  for (const groupId of Object.keys(mealData)) {
    for (const classification of Object.keys(mealData[groupId] || {})) {
      const items = mealData[groupId][classification]
      if (!Array.isArray(items)) continue
      for (const item of items) options.push(normalizeOption(item))
    }
  }
  return options
}

export function blankOption() {
  return {
    id: newId(),
    name_en: '', name_ar: '', desc_en: '', desc_ar: '',
    ingredients: [],
    macros: { protein: null, carbs: null, fats: null },
    kcal: 0,
  }
}

export function duplicateOption(opt) {
  return JSON.parse(JSON.stringify({ ...opt, id: newId() }))
}

// Fraction of the daily calories each meal slot carries (matches how the FIT
// API splits a plan: breakfast 25%, lunch 30%, dinner 25%, snack 10%/option).
export const MEAL_KCAL_RATIO = { breakfast: 0.25, lunch: 0.30, dinner: 0.25, snack: 0.10 }

// Per-meal calorie target derived from the daily total (fallback when a meal
// has no API-provided targetKcal, e.g. a manually-built plan).
export function mealTargetKcal(slot, dailyKcal) {
  const r = MEAL_KCAL_RATIO[slot]
  return dailyKcal && r ? Math.round(dailyKcal * r) : 0
}

// Scale an option's ingredient quantities + macros so it hits targetKcal,
// exactly like the API does (factor = targetKcal / baseKcal). Returns a copy;
// leaves the option untouched if it can't be scaled (no base kcal / no target).
export function scaleOptionToKcal(option, targetKcal) {
  const base = option.kcal
  if (!targetKcal || !base || base <= 0) return option
  const f = targetKcal / base
  const sc = (v) => (v == null ? null : Math.round(v * f))
  return {
    ...option,
    ingredients: (option.ingredients || []).map((i) => ({ ...i, grams: Math.round((i.grams || 0) * f) })),
    macros: {
      protein: sc(option.macros?.protein),
      carbs: sc(option.macros?.carbs),
      fats: sc(option.macros?.fats),
    },
    kcal: Math.round(targetKcal),
  }
}

// Build a fully-populated plan option from a mealCatalog.json entry.
export function optionFromCatalog(entry) {
  return {
    id: newId(),
    name_en: entry.name_en || '',
    name_ar: entry.name_ar || '',
    desc_en: entry.desc_en || '',
    desc_ar: entry.desc_ar || '',
    ingredients: (entry.ingredients || []).map((ing) => ({
      name_en: ing.name_en || '',
      name_ar: ing.name_ar || '',
      grams: ing.grams ?? 0,
      uom: ing.uom || 'g',
    })),
    macros: {
      protein: entry.macros?.protein ?? null,
      carbs: entry.macros?.carbs ?? null,
      fats: entry.macros?.fats ?? null,
    },
    kcal: Math.round(entry.kcal || 0),
  }
}

/**
 * Build the editable plan model from the raw /v3/generate response plus
 * questionnaire context.
 */
export function buildPlanModel(apiResponse, ctx = {}) {
  const foodData = apiResponse.foodDishByCategoryMap || {}
  const hasBreakfast = foodData.Breakfast && Object.keys(foodData.Breakfast).length > 0
  // Plan style is known from the request (ctx.isIF); only fall back to inferring
  // it from an empty breakfast when it wasn't provided — otherwise a keto plan
  // that returns no breakfast dishes would be mistaken for intermittent fasting.
  const isIF = ctx.isIF != null ? ctx.isIF : !hasBreakfast

  const meals = MEAL_DEFS
    .filter((m) => !(isIF && m.id === 'breakfast'))
    .map((m) => {
      const options = flattenMeal(foodData[m.apiKey])
      return {
        id: m.id,
        targetKcal: options.length ? options[0].kcal : null,
        options,
      }
    })

  return {
    header: {
      fullName: apiResponse.fullName || ctx.fullName || '',
      dob: ctx.dob || '',
      testDate: apiResponse.testDate || ctx.testDate || new Date().toISOString().slice(0, 10),
      nextCheckup: ctx.nextCheckup || '',
      dailyKcal: ctx.dailyKcal || 0,
      dietType: ctx.goalText || '',
    },
    isIF,
    meals,
  }
}

// kcal estimated from macros (4/4/9) — used for deviation warnings.
export function kcalFromMacros(macros) {
  const p = parseFloat(macros?.protein) || 0
  const c = parseFloat(macros?.carbs) || 0
  const f = parseFloat(macros?.fats) || 0
  if (!p && !c && !f) return null
  return Math.round(p * 4 + c * 4 + f * 9)
}

export function kcalWarning(option) {
  const est = kcalFromMacros(option.macros)
  if (est == null || !option.kcal) return null
  const dev = Math.abs(est - option.kcal) / option.kcal
  if (dev > 0.15) return { estimated: est, stated: option.kcal }
  return null
}

// Allergen flags: naive keyword check of ingredient names vs allergy names.
export function allergenWarnings(plan, allergyNames = []) {
  const warnings = []
  const needles = allergyNames.map((a) => a.toLowerCase()).filter(Boolean)
  if (!needles.length) return warnings
  for (const meal of plan.meals) {
    for (const opt of meal.options) {
      for (const ing of opt.ingredients) {
        const name = (ing.name_en || '').toLowerCase()
        const hit = needles.find((n) => name.includes(n) || n.includes(name))
        if (hit && name) {
          warnings.push({ mealId: meal.id, optionId: opt.id, ingredient: ing.name_en, allergy: hit })
        }
      }
    }
  }
  return warnings
}

// Fields still missing an Arabic translation (editor highlights these).
export function missingTranslations(plan) {
  const missing = []
  for (const meal of plan.meals) {
    for (const opt of meal.options) {
      if (opt.name_en && !opt.name_ar) missing.push({ mealId: meal.id, optionId: opt.id, field: 'name' })
      if (opt.desc_en && !opt.desc_ar) missing.push({ mealId: meal.id, optionId: opt.id, field: 'desc' })
      for (const ing of opt.ingredients) {
        if (ing.name_en && !ing.name_ar) {
          missing.push({ mealId: meal.id, optionId: opt.id, field: 'ingredient', ingredient: ing.name_en })
        }
      }
    }
  }
  return missing
}

// Re-attempt dictionary autofill (e.g. after editing an EN name to a known dish).
export function autofillArabic(plan) {
  for (const meal of plan.meals) {
    for (const opt of meal.options) {
      if (!opt.name_ar) opt.name_ar = translateFood(opt.name_en)
      if (!opt.desc_ar) opt.desc_ar = translateDescription(opt.desc_en)
      for (const ing of opt.ingredients) {
        if (!ing.name_ar) ing.name_ar = translateIngredient(ing.name_en)
      }
    }
  }
  return plan
}
