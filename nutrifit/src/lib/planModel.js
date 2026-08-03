// Structured editable plan model (plan §5). The API response is normalized
// into this shape; edits mutate it; the template re-renders from it.

import planAr from '../i18n/plan-ar.json'
import ingredientMeta from '../data/ingredientMeta.json'
import { arDigits } from './digits'

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

// The FIT API shifts a plan's calories by its goal: −500 kcal for weight loss,
// +500 for weight gain, unchanged for maintenance. We SEND the user's TDEE (the
// API applies the shift); this returns the intake the client actually eats — the
// number to show on the plan and to base our own per-meal scaling fallbacks on,
// so catalog/keto-supplement meals line up with the API's goal-adjusted dishes.
export const GOAL_KCAL_SHIFT = { lose: -500, gain: 500, maintain: 0 }
export function goalAdjustedKcal(kcal, goal) {
  return Math.max(0, (parseFloat(kcal) || 0) + (GOAL_KCAL_SHIFT[goal] || 0))
}

// ── Client assessment summary (§4.4) ─────────────────────────────────────────
// A compact, client-readable record of what the plan was calculated from: the
// body-composition inputs, the estimated energy needs, the selected goal, and
// the arithmetic that turns the two into a daily target. Stored on the plan
// itself because the exported PDF must be self-contained — the questionnaire
// row never travels with it.
//
// `recommendedKcal` is what the calculation produces; `header.dailyKcal` is
// what the dietitian ultimately approved. The two can differ (the reviewer
// explicitly asks that any such gap be shown), so the summary compares them at
// render time rather than baking one number in here.
export function buildAssessment(payload = {}, ctx = {}) {
  const num = (v) => {
    const n = parseFloat(v)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const weight = num(payload.weight)
  const fatMass = num(payload.fatMass)
  const goal = ctx.goal || 'maintain'
  const maintenanceKcal = Math.round(num(payload.kilocalorieNeeded))
  return {
    weight,
    height: num(payload.height),
    fatMass,
    muscleMass: num(payload.muscleMass),
    // Body-fat % is derived rather than stored: the intake captures fat mass in
    // kg, but percentage is what a client recognizes from an InBody sheet.
    bodyFatPct: weight && fatMass ? Math.round((fatMass / weight) * 1000) / 10 : 0,
    bmr: Math.round(num(payload.bmr)),
    activityMultiplier: num(ctx.activityMultiplier),
    maintenanceKcal,
    goal,
    goalShift: GOAL_KCAL_SHIFT[goal] || 0,
    recommendedKcal: goalAdjustedKcal(maintenanceKcal, goal),
  }
}

// Per-meal calorie target derived from the daily total (fallback when a meal
// has no API-provided targetKcal, e.g. a manually-built plan).
export function mealTargetKcal(slot, dailyKcal) {
  const r = MEAL_KCAL_RATIO[slot]
  return dailyKcal && r ? Math.round(dailyKcal * r) : 0
}

// Per-meal targets for the meals actually present in a plan, normalized so they
// sum to the daily total: snacks count twice (two are eaten), and unknown/custom
// slots get a default share. Returns { [mealId]: perOptionTargetKcal }.
export function mealTargetsFor(meals, dailyKcal) {
  const weightOf = (id) => MEAL_KCAL_RATIO[id] ?? 0.15
  const eaten = (id) => (id === 'snack' ? 2 : 1)
  const total = (meals || []).reduce((s, m) => s + weightOf(m.id) * eaten(m.id), 0)
  const out = {}
  for (const m of meals || []) out[m.id] = total ? Math.round((dailyKcal * weightOf(m.id)) / total) : 0
  return out
}

// ── Rule-based calorie scaling ("meal generation engine") ────────────────────
// Linear proportional scaling makes unrealistic plates at high/low calories
// (8 eggs, 400 g spinach). Instead we redistribute the calorie change by role:
// carbohydrates absorb most of it, healthy fats are secondary, protein rises
// slowly, vegetables barely move, condiments are fixed — every ingredient
// clamped to a realistic serving range. Per-ingredient nutrition + serving
// bounds live in ingredientMeta.json (keyed by EN name).
const ING_META = {}
for (const [k, v] of Object.entries(ingredientMeta)) ING_META[k.trim().toLowerCase()] = v

// How eagerly each category absorbs a calorie change (relative "pull").
const SCALE_WEIGHT = {
  carb: 6, fat: 3, dairy: 1.6, protein: 1.3, fruit: 1, vegetable: 0.35, condiment: 0, other: 1,
}

export function ingredientMetaFor(name) {
  return ING_META[(name || '').trim().toLowerCase()] || null
}

// Ingredients the editor can add with accurate nutrition (the keys of
// ingredientMeta.json, original casing + Arabic name + role), alphabetical.
export const KNOWN_INGREDIENTS = Object.keys(ingredientMeta)
  .map((name) => ({ name_en: name, name_ar: translateIngredient(name), category: ingredientMeta[name].category }))
  .sort((a, b) => a.name_en.localeCompare(b.name_en))

// Tidy servings: nearest 5 g for real portions, nearest 1 g for tiny amounts.
const roundGrams = (g) => (g >= 40 ? Math.round(g / 5) * 5 : Math.max(0, Math.round(g)))

// Old proportional scaling — kept as the fallback for dishes we don't have
// enough ingredient nutrition for, so behaviour is never worse than before.
function linearScale(option, targetKcal) {
  const base = option.kcal
  if (!targetKcal || !base || base <= 0) return option
  const f = targetKcal / base
  const sc = (v) => (v == null ? null : Math.round(v * f))
  return {
    ...option,
    ingredients: (option.ingredients || []).map((i) => ({ ...i, grams: Math.round((i.grams || 0) * f) })),
    macros: { protein: sc(option.macros?.protein), carbs: sc(option.macros?.carbs), fats: sc(option.macros?.fats) },
    kcal: Math.round(targetKcal),
  }
}

// Redistribute `remaining` kcal (+ add / − remove) across ingredients by role
// weight, clamping each to its [min,max] serving. Mutates `grams`; returns the
// kcal it couldn't place (the meal hit its realistic serving limits).
function redistribute(parts, grams, remaining) {
  const dir = Math.sign(remaining)
  if (dir === 0) return 0
  // Ingredients without metadata (e.g. an allergy/condition swap substitute that
  // isn't in the catalog table) are held fixed — weight 0, never moved.
  const weightOf = (p) => (p.meta ? (SCALE_WEIGHT[p.meta.category] ?? SCALE_WEIGHT.other) : 0)
  const canMove = (i) => {
    if (!parts[i].meta || !parts[i].kcalPerG || weightOf(parts[i]) <= 0) return false
    return dir > 0 ? grams[i] < parts[i].meta.max : grams[i] > parts[i].meta.min
  }
  const active = new Set(parts.map((_, i) => i).filter(canMove))
  for (let iter = 0; iter < 24 && active.size && Math.abs(remaining) > 1; iter++) {
    let totalW = 0
    for (const i of active) totalW += weightOf(parts[i])
    if (totalW <= 0) break
    let moved = false
    for (const i of [...active]) {
      const shareKcal = remaining * (weightOf(parts[i]) / totalW)
      let newG = grams[i] + shareKcal / parts[i].kcalPerG
      const { min, max } = parts[i].meta
      if (newG >= max) { newG = max; active.delete(i) }
      else if (newG <= min) { newG = min; active.delete(i) }
      const applied = (newG - grams[i]) * parts[i].kcalPerG
      if (Math.abs(newG - grams[i]) > 1e-6) moved = true
      grams[i] = newG
      remaining -= applied
    }
    if (!moved) break
  }
  return remaining
}

// Scale / re-portion an option to targetKcal with role-based redistribution.
// Works to scale a catalog base up/down AND to re-portion an already-scaled
// dish into realistic servings (pass its own kcal as the target — the clamp
// step alone pulls "8 eggs" back to a realistic max and frees those calories
// for carbs/fats). Falls back to linear scaling when nutrition is missing for
// most of the dish, so uncovered dishes behave exactly as before.
export function scaleOptionToKcal(option, targetKcal) {
  const ings = option.ingredients || []
  if (!targetKcal || targetKcal <= 0 || !ings.length) return option

  const parts = ings.map((ing) => {
    // Fall back to the pre-swap ingredient's nutrition for allergy/condition
    // substitutes (e.g. gluten-free bread ← whole wheat bread) — they're
    // designed to be like-for-like, so this keeps calories/macros accurate.
    const meta = ingredientMetaFor(ing.name_en) || ingredientMetaFor(ing.original_en)
    return { ing, meta, kcalPerG: meta ? meta.per100g.kcal / 100 : null }
  })
  if (parts.filter((p) => p.meta).length < Math.ceil(ings.length * 0.6)) {
    return linearScale(option, targetKcal)
  }

  // Phase 1 — clamp every ingredient into its realistic serving range. This is
  // what fixes oversized plates even when total calories are already on target.
  const grams = parts.map((p) => (p.meta ? Math.min(Math.max(p.ing.grams, p.meta.min), p.meta.max) : p.ing.grams))
  const clampedTotal = parts.reduce((s, p, i) => s + (p.kcalPerG ? grams[i] * p.kcalPerG : 0), 0)
  if (clampedTotal <= 0) return linearScale(option, targetKcal)

  // Phase 2 — move the remaining calorie gap into the right roles.
  redistribute(parts, grams, targetKcal - clampedTotal)

  // Recompute kcal + macros from the final grams so they are always consistent.
  const macros = { protein: 0, carbs: 0, fats: 0 }
  let kcal = 0
  const outIngs = parts.map((p, i) => {
    const g = roundGrams(grams[i])
    if (p.meta) {
      const per = p.meta.per100g
      kcal += (g / 100) * per.kcal
      macros.protein += (g / 100) * (per.protein || 0)
      macros.carbs += (g / 100) * (per.carbs || 0)
      macros.fats += (g / 100) * (per.fats || 0)
    }
    return { ...p.ing, grams: g }
  })
  return {
    ...option,
    ingredients: outIngs,
    macros: { protein: Math.round(macros.protein), carbs: Math.round(macros.carbs), fats: Math.round(macros.fats) },
    kcal: Math.round(kcal),
  }
}

// Recompute an option's macros + kcal from its CURRENT ingredient grams (no
// clamp, no redistribute) — used when the dietitian edits ingredients/portions
// directly in the editor, so the totals always reflect the plate on screen.
// Ingredients we lack nutrition for contribute nothing; if too few are covered
// to trust the result, the option's existing values are left untouched.
export function recomputeOptionNutrition(option) {
  const ings = option.ingredients || []
  const macros = { protein: 0, carbs: 0, fats: 0 }
  let kcal = 0
  let covered = 0
  for (const ing of ings) {
    const meta = ingredientMetaFor(ing.name_en) || ingredientMetaFor(ing.original_en)
    if (!meta) continue
    covered++
    const g = ing.grams || 0
    const per = meta.per100g
    kcal += (g / 100) * per.kcal
    macros.protein += (g / 100) * (per.protein || 0)
    macros.carbs += (g / 100) * (per.carbs || 0)
    macros.fats += (g / 100) * (per.fats || 0)
  }
  if (ings.length && covered < Math.ceil(ings.length * 0.6)) return option
  return {
    ...option,
    macros: { protein: Math.round(macros.protein), carbs: Math.round(macros.carbs), fats: Math.round(macros.fats) },
    kcal: Math.round(kcal),
  }
}

// True when we have nutrition data for an ingredient (so edits recompute cleanly).
export function ingredientHasMeta(ing) {
  return !!(ingredientMetaFor(ing?.name_en) || ingredientMetaFor(ing?.original_en))
}

// Countable foods: show "2 eggs" / "3 slices" instead of grams. Ordered — the
// first matching pattern wins (egg-white before egg; pita before bread). `g` is
// grams per unit, `step` is the rounding increment (0.5 allows "½ avocado").
const UNIT_FOODS = [
  { re: /egg[,\s]+white/i, g: 33, step: 1, en: ['egg white', 'egg whites'], ar: ['بياض بيضة', 'بياض بيض'] },
  // `\begg` alone also matches "Eggplant" → "4 eggs"; require a word end so only
  // egg/eggs match.
  { re: /\beggs?\b/i, g: 50, step: 1, en: ['egg', 'eggs'], ar: ['بيضة', 'بيضات'] },
  // All bread/pita/toast/tortilla stays in grams — loaf/slice/wrap sizes vary too
  // much to count reliably, so grams are the honest portion.
  { re: /pita|bread|toast|tortilla/i, noUnit: true },
  { re: /rice\s*cake/i, g: 9, step: 1, en: ['rice cake', 'rice cakes'], ar: ['كعكة أرز', 'كعكات أرز'] },
  { re: /banana/i, g: 118, step: 0.5, en: ['banana', 'bananas'], ar: ['موزة', 'موز'] },
  { re: /\bapple/i, g: 120, step: 0.5, en: ['apple', 'apples'], ar: ['تفاحة', 'تفاحات'] },
  { re: /\bdate/i, g: 8, step: 1, en: ['date', 'dates'], ar: ['تمرة', 'تمرات'] },
  // avocado intentionally left in grams (size varies a lot).
]

function fmtCount(n) {
  const whole = Math.trunc(n)
  const hasHalf = Math.abs(n - whole) >= 0.5
  if (hasHalf) return whole > 0 ? `${whole}½` : '½'
  return String(whole)
}

// Human-friendly serving for an ingredient: "2 eggs" / "3 slices" for countable
// foods, otherwise "45 g". Fully localized (Arabic digits + noun).
export function formatAmount(ing, lang = 'en') {
  const grams = ing?.grams || 0
  const u = UNIT_FOODS.find((x) => x.re.test(ing?.name_en || ''))
  if (u && !u.noUnit && grams > 0) {
    const count = Math.round(grams / u.g / u.step) * u.step
    if (count >= u.step) {
      const noun = (lang === 'ar' ? u.ar : u.en)[count <= 1 ? 0 : 1]
      return `${arDigits(fmtCount(count), lang)} ${noun}`
    }
  }
  return `${arDigits(String(grams), lang)} ${lang === 'ar' ? 'غ' : 'g'}`
}

// Realistic max food weight for a single meal (grams). Dishes whose scaled
// portion exceeds this are demoted (see rankByPortion) — a low-calorie-density
// dish stretched to a high calorie target becomes an unrealistic amount of food.
export const MEAL_WEIGHT_CAP = 650

// Total (already-scaled) food weight of an option.
export function optionWeight(option) {
  return (option.ingredients || []).reduce((s, i) => s + (i.grams || 0), 0)
}

// Order options so realistic portions surface first: dishes within the weight
// cap keep their original (variety) order; oversized ones sink to the end,
// least-oversized first. Options are expected to already be scaled to the meal
// target, so optionWeight() is the real serving size.
export function rankByPortion(options, cap = MEAL_WEIGHT_CAP) {
  const over = (o) => optionWeight(o) > cap
  return options
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      if (over(a.o) !== over(b.o)) return over(a.o) ? 1 : -1
      if (over(a.o)) return optionWeight(a.o) - optionWeight(b.o)
      return a.i - b.i
    })
    .map((x) => x.o)
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
      // Re-portion each API dish into realistic servings at its own calorie
      // level (linear-scaled API dishes otherwise show 8 eggs / 400 g spinach).
      // Dishes we lack ingredient nutrition for fall back unchanged.
      const options = flattenMeal(foodData[m.apiKey]).map((o) => scaleOptionToKcal(o, o.kcal))
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

// Reviewer-recommended default floor: don't quietly ship a target below this
// unless a dietitian intentionally approves it.
export const MIN_SAFE_KCAL = 1450

// Non-blocking clinical plausibility checks on a computed daily target. Returns
// { code, ...data } entries the UI renders as warnings (never hard blocks — the
// dietitian stays in control). `maintenanceKcal` is the unadjusted TDEE
// (BMR × activity) before the goal ±500 shift.
export function planCalorieWarnings({ bmr = 0, multiplier = 0, goal = 'maintain', targetKcal = 0, maintenanceKcal = 0 } = {}) {
  const w = []
  const t = Math.round(targetKcal || 0)
  if (t && t < MIN_SAFE_KCAL) w.push({ code: 'belowFloor', floor: MIN_SAFE_KCAL, target: t })
  if (bmr && t && t < Math.round(bmr)) w.push({ code: 'belowBmr', bmr: Math.round(bmr), target: t })
  if (bmr && t && t > bmr * 2.4) w.push({ code: 'implausiblyHigh', bmr: Math.round(bmr), target: t })
  // Very high self-reported activity swings the target a lot — flag it so the
  // dietitian sanity-checks the questionnaire (the "heavy exercise" case).
  if (multiplier && multiplier >= 1.725) w.push({ code: 'highActivity', multiplier })
  return w
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

// Pre-export sanity checks (§11 of the clinical review). Non-blocking — the
// dietitian stays in control — but surfaced so free-form edits never quietly
// ship an inconsistent plan. Returns [{ code, ...data }].
export function validatePlan(plan) {
  const issues = []
  const meals = plan?.meals || []
  if (!meals.length) return issues

  // Recommended day = first option per meal (snacks eaten twice).
  let sum = 0
  for (const m of meals) {
    if (!m.options?.length) { issues.push({ code: 'emptyMeal', meal: m.id }); continue }
    sum += (m.options[0].kcal || 0) * (m.id === 'snack' ? 2 : 1)
  }
  const daily = plan.header?.dailyKcal || 0
  if (daily && sum && Math.abs(sum - daily) > Math.max(60, daily * 0.05)) {
    issues.push({ code: 'dailyMismatch', sum: Math.round(sum), daily: Math.round(daily) })
  }

  // The same dish must not be offered in two different meals of one plan — the
  // generator de-duplicates, but a dietitian adding meals by hand can reintroduce it.
  const placedIn = new Map()
  for (const m of meals) {
    const seenHere = new Set()
    for (const o of m.options || []) {
      const key = (o.name_en || '').trim().toLowerCase()
      if (!key || seenHere.has(key)) continue // same-meal repeats caught below
      seenHere.add(key)
      if (!placedIn.has(key)) placedIn.set(key, [])
      placedIn.get(key).push(m.id)
    }
    // A dish listed twice inside one meal is always a mistake.
    const names = (m.options || []).map((o) => (o.name_en || '').trim().toLowerCase()).filter(Boolean)
    for (const dup of new Set(names.filter((n, i) => names.indexOf(n) !== i))) {
      issues.push({ code: 'duplicateInMeal', meal: m.id, option: dup })
    }
  }
  for (const [name, where] of placedIn) {
    if (where.length > 1) issues.push({ code: 'duplicateAcrossMeals', option: name, meals: where.join(', ') })
  }

  for (const m of meals) {
    // Options within a meal should be interchangeable (comparable calories).
    if ((m.options?.length || 0) >= 2) {
      const kcals = m.options.map((o) => o.kcal || 0)
      const spread = Math.max(...kcals) - Math.min(...kcals)
      const ref = m.targetKcal || kcals[0] || 0
      if (spread > Math.max(120, ref * 0.25)) issues.push({ code: 'optionSpread', meal: m.id, spread: Math.round(spread) })
    }
    for (const o of m.options || []) {
      if (kcalWarning(o)) issues.push({ code: 'macroMismatch', meal: m.id, option: o.name_en || '' })
      for (const ing of o.ingredients || []) {
        if (!ing.grams || ing.grams <= 0) {
          issues.push({ code: 'badGrams', option: o.name_en || '', ingredient: ing.name_en || '' })
          continue
        }
        // Portion outside the realistic serving range for this food. Generation
        // always clamps into [min, max], so this only fires on a hand edit —
        // which is exactly the outlier the reviewer wanted surfaced. The range
        // itself is deliberately NOT shown: the judgement is the dietitian's, and
        // quoting a number invites them to just match it.
        const meta = ingredientMetaFor(ing.name_en) || ingredientMetaFor(ing.original_en)
        if (meta && (ing.grams < meta.min || ing.grams > meta.max)) {
          issues.push({
            code: ing.grams > meta.max ? 'portionHigh' : 'portionLow',
            meal: m.id,
            option: o.name_en || '',
            ingredient: ing.name_en || '',
            grams: Math.round(ing.grams),
          })
        }
      }
      // Total plate weight — a dish can be within its calorie target yet be far
      // more food than anyone would serve.
      const weight = optionWeight(o)
      if (weight > MEAL_WEIGHT_CAP) {
        issues.push({ code: 'heavyPlate', meal: m.id, option: o.name_en || '', grams: Math.round(weight) })
      }
    }
  }
  return issues
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
