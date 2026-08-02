// Catalog-based plan generation (no FIT API). Builds the whole plan from our
// curated meal catalog + the rule-based scaling engine: deterministic,
// restriction-aware, every meal realistic at the client's calorie level.
//
// This module is intentionally free of any browser/FIT-API dependency (no
// import.meta.env, no fetch) so it can run BOTH in the app and inside a
// Cloudflare Worker (see generator-worker/) that serves other sites.

import {
  optionFromCatalog, scaleOptionToKcal, rankByPortion, MAX_OPTIONS_PER_MEAL,
  MEAL_DEFS, optionWeight, MEAL_WEIGHT_CAP, autofillArabic, formatAmount,
  buildAssessment,
} from './planModel'
import { processOption, canonicalTokens, norm } from './dietaryRules'
import mealCatalog from '../data/mealCatalog.json'

const SLOT_CONTRIB = { breakfast: 0.25, lunch: 0.30, dinner: 0.25, snack: 0.10 }
const SNACK_OPTIONS_EATEN = 2 // the plan tells the client to "choose two" snacks
// Floor for a usable meal. Cross-meal de-duplication may not drop a meal below
// this, even if that means offering a dish that also appears elsewhere.
const MIN_OPTIONS_PER_MEAL = 3

// Per-meal calorie target. Normalised over the meals actually in the plan (so an
// intermittent-fasting plan with no breakfast still sums to the daily total), and
// counting snacks twice since two are eaten.
export function slotTargetKcal(slot, daily, isIF) {
  const included = isIF ? ['lunch', 'dinner', 'snack'] : ['breakfast', 'lunch', 'dinner', 'snack']
  const total = included.reduce((s, k) => s + SLOT_CONTRIB[k] * (k === 'snack' ? SNACK_OPTIONS_EATEN : 1), 0)
  return total ? Math.round((daily * SLOT_CONTRIB[slot]) / total) : 0
}

/**
 * Build a full plan model from the catalog.
 * @param payload {dietaryTypeId, secondaryTypeId} — diet + IF flag
 * @param restrictions {allergyNames?, conditionNames?}
 * @param ctx {dailyKcal (goal-adjusted), fullName?, dob?, testDate?, nextCheckup?, goalText?}
 */
export async function generateCatalogPlan(payload, { allergyNames = [], conditionNames = [] } = {}, ctx = {}) {
  const tokens = canonicalTokens([...allergyNames, ...conditionNames])
  const isIF = payload.secondaryTypeId === 'IntermittentFasting'
  const diet = payload.dietaryTypeId
  const daily = ctx.dailyKcal || 0
  const substitutions = []

  // ── Phase 1: rank each meal's candidates against its own calorie target ─────
  // Most catalog dishes belong to more than one category (a steak is both lunch
  // and dinner), so these pools overlap heavily; phase 2 resolves that.
  const slots = MEAL_DEFS.filter((m) => !(isIF && m.id === 'breakfast')).map((m) => {
    const target = slotTargetKcal(m.id, daily, isIF)
    const options = []
    const seen = new Set()
    for (const entry of mealCatalog) {
      if (!(entry.categories || []).includes(m.id)) continue
      // dietary type filter (empty diets = suitable for any diet)
      if (diet && (entry.diets || []).length && !(entry.diets || []).includes(diet)) continue
      const key = norm(entry.name_en)
      if (!key || seen.has(key)) continue
      let opt = optionFromCatalog(entry)
      if (tokens.size) {
        const { swaps, conflicts } = processOption(opt, tokens)
        if (conflicts.length) continue // unfixable for this client — drop it
        opt._swaps = swaps
      }
      // Scale AFTER swaps so macros/kcal reflect the final ingredient set.
      opt = scaleOptionToKcal(opt, target)
      seen.add(key)
      options.push(opt)
    }
    // Surface the options that best hit the meal's calorie target: oversized
    // plates sink to the bottom; among the rest, closest-to-target first (so
    // meals that can't reach a high target — e.g. intermittent-fasting — don't
    // lead the list). Ties keep catalog order, preserving variety.
    const oversized = (o) => optionWeight(o) > MEAL_WEIGHT_CAP
    const sorted = options.sort((a, b) => {
      if (oversized(a) !== oversized(b)) return oversized(a) ? 1 : -1
      return Math.abs(a.kcal - target) - Math.abs(b.kcal - target)
    })
    // Keep only options that land within a tolerance band of the meal target, so
    // every "Choose One" option is interchangeable — picking any keeps the client
    // on the daily total. If too few reach the target (a very high per-meal target
    // on a restrictive/IF plan), fall back to the closest ones so the meal is
    // never thin.
    const tol = Math.max(60, target * 0.12)
    const inBand = sorted.filter((o) => !oversized(o) && Math.abs(o.kcal - target) <= tol)
    return { def: m, target, pool: inBand.length >= 3 ? inBand : sorted, sorted }
  })

  // ── Phase 2: hand dishes out so none repeats across meals ───────────────────
  // A client should not be offered the same dish at lunch and dinner. Meals are
  // served in order of how few candidates they have, so a slot whose pool is
  // largely shared with another (lunch/dinner) isn't left picking over scraps.
  const claimed = new Set()
  for (const slot of [...slots].sort((a, b) => a.pool.length - b.pool.length)) {
    const picked = []
    for (const o of slot.pool) {
      if (picked.length >= MAX_OPTIONS_PER_MEAL) break
      const key = norm(o.name_en)
      if (claimed.has(key)) continue
      claimed.add(key)
      picked.push(o)
    }
    // Uniqueness must never leave a meal thin: if too few survived, top up from
    // this meal's own ranked list, repeats included.
    if (picked.length < MIN_OPTIONS_PER_MEAL) {
      for (const o of slot.sorted) {
        if (picked.length >= MIN_OPTIONS_PER_MEAL) break
        if (!picked.includes(o)) picked.push(o)
      }
    }
    slot.ranked = picked
  }

  // ── Phase 3: emit in plan order (breakfast → lunch → dinner → snack) ────────
  const meals = slots.map(({ def: m, target, ranked }) => {
    for (const o of ranked) {
      if (o._swaps) {
        for (const s of o._swaps) substitutions.push({ mealId: m.id, optionId: o.id, ...s })
      }
    }
    ranked.forEach((o) => delete o._swaps)
    return { id: m.id, targetKcal: ranked.length ? ranked[0].kcal : target, options: ranked }
  })

  const testDate = ctx.testDate || new Date().toISOString().slice(0, 10)
  // Auto follow-up ~10 weeks out (editable in the editor) so the field is never
  // blank; within the reviewer's 2–3 month routine re-assessment window.
  let nextCheckup = ctx.nextCheckup || ''
  if (!nextCheckup) {
    const d = new Date(testDate)
    d.setDate(d.getDate() + 70)
    nextCheckup = d.toISOString().slice(0, 10)
  }

  const model = autofillArabic({
    header: {
      fullName: ctx.fullName || '',
      dob: ctx.dob || '',
      testDate,
      nextCheckup,
      dailyKcal: daily,
      dietType: ctx.goalText || '',
    },
    // Client-facing assessment summary (§4.4) — rendered on the cover page.
    assessment: buildAssessment(payload, ctx),
    isIF,
    meals,
  })
  return { plan: model, apiResponse: { source: 'catalog', mealCount: mealCatalog.length }, substitutions, attempts: 0 }
}

// ── Adapter: our plan model → FIT `/v3/generate` response shape ───────────────
// Lets any site that already renders the FIT API response (e.g. fit-demo) use
// this generator as a drop-in — same JSON structure, realistic meals.
const CATEGORY_KEY = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }

export function toFitDietPlanResponse(plan, { kcalTotalNeeded } = {}) {
  const foodDishByCategoryMap = {}
  for (const meal of plan.meals || []) {
    const key = CATEGORY_KEY[meal.id]
    if (!key) continue
    // Single synthetic group/classification — consumers iterate groups anyway.
    foodDishByCategoryMap[key] = {
      Meals: {
        All: (meal.options || []).map((o) => ({
          foodDishName: o.name_en,
          foodDishNameAr: o.name_ar || '',
          description: o.desc_en || '',
          descriptionAr: o.desc_ar || '',
          kilocaloriePerServe: o.kcal,
          ingredientList: (o.ingredients || []).map((i) => ({
            ingredientName: i.name_en,
            ingredientNameAr: i.name_ar || '',
            quantity: i.grams,
            quantityUomId: i.uom === 'g' ? 'WT_g' : (i.uom || 'WT_g'),
            // Ready-to-display serving ("2 eggs" / "3 slices" / "45 g"), so any
            // consumer renders portions exactly like the app — no local logic.
            displayAmount: formatAmount(i, 'en'),
            displayAmountAr: formatAmount(i, 'ar'),
          })),
          macronutrientList: [
            { macronutrientId: 'Protein', quantityPerServe: o.macros?.protein ?? 0 },
            { macronutrientId: 'Carbohydrates', quantityPerServe: o.macros?.carbs ?? 0 },
            { macronutrientId: 'Healthy_Fats', quantityPerServe: o.macros?.fats ?? 0 },
          ],
        })),
      },
    }
  }
  return {
    foodDishByCategoryMap,
    // Raw TDEE the client entered — consumers that show a header calorie figure
    // apply their own goal ±500 to this; our meals are already at the adjusted level.
    kcalTotalNeeded: kcalTotalNeeded ?? plan.header?.dailyKcal ?? 0,
    fullName: plan.header?.fullName || '',
    source: 'catalog',
  }
}
