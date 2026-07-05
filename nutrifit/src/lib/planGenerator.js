// Restriction-aware plan generation (client-side workaround).
//
// The FIT API can't be trusted to honour medical conditions / allergies (it
// zeroes quantities, drops ingredients, reshuffles meals). So we generate an
// UNRESTRICTED plan and make it safe ourselves:
//   1. swap unsuitable ingredients for their designed alternative (quantity kept);
//   2. drop dishes that can't be made safe and REPLACE them with suitable dishes
//      pulled from additional API calls — the /v3/generate endpoint is
//      non-deterministic, so each call yields a fresh set of dishes we can pool.
//
// The nutritionist just sees a normal, complete plan; the fixing is invisible.

import { generatePlan } from './fitApi'
import {
  buildPlanModel, autofillArabic, optionFromCatalog, scaleOptionToKcal,
  mealTargetKcal, MAX_OPTIONS_PER_MEAL,
} from './planModel'
import { processOption, canonicalTokens, norm } from './dietaryRules'
import mealCatalog from '../data/mealCatalog.json'

// Upper bound on API calls per generation. The first call plus a couple of
// top-ups is normally enough to backfill every meal; the cap stops us looping
// forever if a very restrictive profile leaves a meal permanently short.
const MAX_ATTEMPTS = 5

// Diets the API under-serves — supplement these from our catalog. Keto returns
// only ~9 dishes total (too few to fill a plan), so it's boosted with the
// curated keto meals in mealCatalog.json.
const SUPPLEMENT_DIETS = new Set(['Keto'])

/**
 * Generate a plan that is already safe for the client's restrictions.
 *
 * @param {object} payload  the /v3/generate body (WITHOUT conditionIdSet/allergyIdSet)
 * @param {{allergyNames?: string[], conditionNames?: string[]}} restrictions
 * @param {object} ctx  buildPlanModel context (fullName, dob, dailyKcal, goalText)
 * @returns {{plan, apiResponse, substitutions, attempts}}
 */
export async function generateSafePlan(payload, { allergyNames = [], conditionNames = [] } = {}, ctx = {}) {
  const tokens = canonicalTokens([...allergyNames, ...conditionNames])
  // Plan style comes from the request, not from what the API happens to return.
  const ctxM = { ...ctx, isIF: payload.secondaryTypeId === 'IntermittentFasting' }

  const firstResponse = await generatePlan(payload)
  const model = autofillArabic(buildPlanModel(firstResponse, ctxM))

  // Per-meal target = how many options the API naturally offers for that meal
  // (so a restricted plan looks identical in shape to an unrestricted one).
  const targets = {}
  const pool = {}
  const seen = {}
  const fallback = {} // original (possibly-flagged) options, used only if a meal can't be filled
  for (const meal of model.meals) {
    targets[meal.id] = Math.min((meal.options || []).length, MAX_OPTIONS_PER_MEAL)
    pool[meal.id] = []
    seen[meal.id] = new Set()
    fallback[meal.id] = meal.options || []
  }

  // Fold one generated model's options into the safe pool (dedup by dish name).
  const ingest = (m) => {
    for (const meal of m.meals) {
      if (!pool[meal.id]) continue // unexpected meal id — ignore
      for (const opt of meal.options || []) {
        const key = norm(opt.name_en)
        if (!key || seen[meal.id].has(key)) continue
        if (tokens.size) {
          const { swaps, conflicts } = processOption(opt, tokens)
          if (conflicts.length) continue // can't be made safe — skip (replaced silently)
          opt._swaps = swaps
        }
        seen[meal.id].add(key)
        pool[meal.id].push(opt)
      }
    }
  }
  ingest(model)

  const short = () => model.meals.some((m) => pool[m.id].length < targets[m.id])

  let attempts = 1
  while (tokens.size && short() && attempts < MAX_ATTEMPTS) {
    const resp = await generatePlan(payload)
    ingest(autofillArabic(buildPlanModel(resp, ctxM)))
    attempts++
  }

  // Supplement diets the API serves too few dishes for (keto especially) with
  // our curated catalog meals for that diet, scaled to each meal's calorie
  // target. Keeps generated keto plans full instead of 1–2 options per meal.
  const diet = payload.dietaryTypeId
  if (SUPPLEMENT_DIETS.has(diet)) {
    for (const meal of model.meals) {
      const target = meal.targetKcal || mealTargetKcal(meal.id, ctx.dailyKcal)
      const extras = mealCatalog.filter((e) =>
        (e.diets || []).includes(diet) && (e.categories || []).includes(meal.id))
      for (const e of extras) {
        const key = norm(e.name_en)
        if (!key || seen[meal.id].has(key)) continue
        const opt = scaleOptionToKcal(optionFromCatalog(e), target)
        if (tokens.size) {
          const { swaps, conflicts } = processOption(opt, tokens)
          if (conflicts.length) continue
          opt._swaps = swaps
        }
        seen[meal.id].add(key)
        pool[meal.id].push(opt)
      }
      // let the assembled plan include the supplemented options
      targets[meal.id] = Math.min(pool[meal.id].length, MAX_OPTIONS_PER_MEAL)
    }
  }

  // Assemble the final plan from the pooled safe options.
  const substitutions = []
  for (const meal of model.meals) {
    let opts = pool[meal.id]
    if (!opts.length) opts = fallback[meal.id] // extreme: nothing safe found, keep originals
    opts = opts.slice(0, targets[meal.id] || MAX_OPTIONS_PER_MEAL)
    for (const o of opts) {
      if (o._swaps) {
        for (const s of o._swaps) substitutions.push({ mealId: meal.id, optionId: o.id, ...s })
        delete o._swaps
      }
    }
    meal.options = opts
    meal.targetKcal = opts.length ? opts[0].kcal : meal.targetKcal
  }

  return { plan: model, apiResponse: firstResponse, substitutions, attempts }
}
