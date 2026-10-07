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
  buildAssessment, typicalDayProtein, proteinRangeFor, translateIngredient, ingredientMetaFor,
  carbRuleFor, diabeticMaxGrams, VEGAN_PROTEIN_FLOOR, PLANT_PROTEIN_POWDER, PROTEIN_SCOOP_GRAMS,
  fatRuleFor, goutMaxGrams, PROTEIN_SIDES, proteinFloorFor,
} from './planModel'
import { processOption, canonicalTokens, norm, makeDislikeMatcher, isSafeFor } from './dietaryRules'
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
 * @param ctx {dailyKcal (goal-adjusted), goal?, fullName?, dob?, testDate?, nextCheckup?, goalText?}
 */
export async function generateCatalogPlan(payload, restrictions = {}, ctx = {}) {
  const result = buildCatalogPlan(payload, restrictions, ctx, false)
  // Shape Up (recomposition) needs ≥1.6 g protein per kg. The catalog usually
  // gets there on its own, so only when it doesn't, rebuild favouring
  // protein-dense dishes — always favouring them would push most plans well
  // past the 2.2 g/kg top of the range. Keep whichever plan has more protein;
  // if neither reaches the floor, validatePlan flags it for the dietitian.
  if (ctx.goal !== 'recomp') return result
  const min = (parseFloat(payload.weight) || 0) * proteinRangeFor('recomp')[0]
  if (!min || typicalDayProtein(result.plan) >= min) return result
  const boosted = buildCatalogPlan(payload, restrictions, ctx, true)
  return typicalDayProtein(boosted.plan) > typicalDayProtein(result.plan) ? boosted : result
}

const RED_MEAT = /\b(steak|lamb|beef|veal|minced meat)\b/

function buildCatalogPlan(payload, { allergyNames = [], conditionNames = [], dislikedIngredients = [] } = {}, ctx = {}, highProtein = false) {
  const tokens = canonicalTokens([...allergyNames, ...conditionNames])
  const isIF = payload.secondaryTypeId === 'IntermittentFasting'
  const diet = payload.dietaryTypeId
  const daily = ctx.dailyKcal || 0
  const substitutions = []
  // Share of the dish's calories that come from protein (4 kcal per gram).
  const proteinDensity = (o) => (o.kcal ? ((o.macros?.protein || 0) * 4) / o.kcal : 0)

  // Review §4.2 — foods to avoid. Matched by food family (avoiding almonds
  // removes almond milk too; see makeDislikeMatcher) and against the ORIGINAL
  // name, so an allergy swap can't smuggle a disliked food back in. A dish
  // containing one is left out; it only returns as a last resort, when a meal
  // would otherwise have fewer than MIN_OPTIONS_PER_MEAL options.
  const avoids = makeDislikeMatcher(dislikedIngredients)
  const isDisliked = (opt) => (opt.ingredients?.length
    ? opt.ingredients.some((ing) => avoids(ing.name_en) || avoids(ing.original_en))
    : avoids(opt.name_en))

  // Blood-sugar conditions (diabetes / hypoglycemia): carbs per option within
  // CARB_RULES, options in a meal close to each other, and — for diabetes —
  // smaller portions of fast carbs (one banana, moderate rice and bread).
  const carbRule = carbRuleFor(conditionNames)
  // Low-fat conditions (GERD, pancreatitis): fat per option capped (FAT_RULES).
  const fatRule = fatRuleFor(conditionNames)
  // Per-client portion caps: diabetes (fast carbs), gout (poultry and fish).
  const condText = conditionNames.join(' ')
  // Fatty liver: red meat kept occasional (the condition rules already leave
  // out steak and lamb; this limits the lean cuts that remain).
  const limitRedMeat = /fatty liver/i.test(condText)
  const capFns = [/diabet/i.test(condText) && diabeticMaxGrams, /gout/i.test(condText) && goutMaxGrams].filter(Boolean)
  const scaleOpts = capFns.length
    ? { maxGrams: (name) => capFns.map((f) => f(name)).filter((v) => v != null).reduce((a, b) => Math.min(a, b), Infinity) }
    : {}

  // Vegan plans: plant protein powder on options under the protein floor
  // (dietitian review) — unless the powder isn't safe or is avoided. Only as
  // much as the floor needs (half a scoop to one scoop): options are
  // alternatives, so a full scoop on every one could add five scoops to a day.
  const veganTopUp = diet === 'Vegan' && isSafeFor(PLANT_PROTEIN_POWDER, tokens) && !avoids(PLANT_PROTEIN_POWDER)
  const powderProteinPerG = (ingredientMetaFor(PLANT_PROTEIN_POWDER)?.per100g.protein || 75) / 100
  // Protein sides (yogurt, egg whites or tofu — the first the client can eat),
  // sized to reach a floor, capped per side. Vegetarian main meals use the vegan
  // floor; diabetic plans use their own floor on every meal and snack.
  const canHaveSide = ([name]) => isSafeFor(name, tokens) && !avoids(name)
    && (diet !== 'Vegan' || !/yogurt|egg/i.test(name))
  const vegSide = diet === 'Vegetarian' ? PROTEIN_SIDES.find(canHaveSide) || null : null
  const diabetesFloor = proteinFloorFor(conditionNames)
  // Kosher keeps meat and dairy apart: a meat dish gets egg whites, not yogurt.
  const hasMeat = (opt) => (opt.ingredients || []).some((i) => /chicken|turkey|beef|steak|lamb|minced meat/i.test(i.name_en))
  const sideFor = (opt) => PROTEIN_SIDES.find((s) => canHaveSide(s)
    && !(diet === 'Kosher' && /yogurt/i.test(s[0]) && hasMeat(opt))) || null
  const withProteinSide = (opt, target, floor, side = vegSide) => {
    if (!side || !opt.ingredients?.length) return opt
    const [name, maxG] = side
    const meta = ingredientMetaFor(name)
    if (!meta || opt.ingredients.some((i) => i.name_en === name)) return opt
    const perG = meta.per100g.protein / 100
    const grams = Math.min(maxG, meta.max, Math.max(meta.min, Math.ceil((floor - (opt.macros?.protein || 0)) / perG / 10) * 10))
    return scaleOptionToKcal({
      ...opt,
      ingredients: [...opt.ingredients, { name_en: name, name_ar: translateIngredient(name) || '', grams, uom: 'g' }],
    }, target, scaleOpts)
  }

  const withProteinScoop = (opt, target, floor) => {
    const add = (grams) => scaleOptionToKcal({
      ...opt,
      ingredients: [...opt.ingredients, {
        name_en: PLANT_PROTEIN_POWDER, name_ar: translateIngredient(PLANT_PROTEIN_POWDER) || '', grams, uom: 'g',
      }],
    }, target, scaleOpts)
    const short = floor - (opt.macros?.protein || 0)
    const half = PROTEIN_SCOOP_GRAMS / 2
    const out = add(Math.min(PROTEIN_SCOOP_GRAMS, Math.max(half, Math.ceil(short / powderProteinPerG / 5) * 5)))
    // Rescaling trims the dish's other protein a little; if that leaves it just
    // under the floor, a full scoop instead.
    return (out.macros?.protein || 0) < floor ? add(PROTEIN_SCOOP_GRAMS) : out
  }

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
      opt = scaleOptionToKcal(opt, target, scaleOpts)
      const proteinFloor = VEGAN_PROTEIN_FLOOR[m.id === 'snack' ? 'snack' : 'main']
      if (veganTopUp && (opt.macros?.protein || 0) < proteinFloor) opt = withProteinScoop(opt, target, proteinFloor)
      else if (vegSide && m.id !== 'snack' && (opt.macros?.protein || 0) < proteinFloor) opt = withProteinSide(opt, target, proteinFloor)
      // Diabetes: every meal and snack up to its protein floor (keto plans are
      // high in protein already, and their carbs are not ranged).
      const diabetesMin = diabetesFloor?.[m.id === 'snack' ? 'snack' : 'main']
      // A side that would push the option out of the carb range isn't added:
      // on small snacks the two limits can't both fit, and carbs come first.
      if (diabetesMin && diet !== 'Keto' && (opt.macros?.protein || 0) < diabetesMin) {
        const sided = withProteinSide(opt, target, diabetesMin, sideFor(opt))
        const [lo, hi] = carbRule?.[m.id === 'snack' ? 'snack' : 'main'] || []
        const inCarbs = (o) => (lo == null || (o.macros?.carbs ?? 0) >= lo) && (hi == null || (o.macros?.carbs ?? 0) <= hi)
        if (inCarbs(sided) || !inCarbs(opt)) opt = sided
      }
      seen.add(key)
      options.push(opt)
    }
    // Surface the options that best hit the meal's calorie target: oversized
    // plates sink to the bottom; among the rest, closest-to-target first (so
    // meals that can't reach a high target — e.g. intermittent-fasting — don't
    // lead the list). Ties keep catalog order, preserving variety.
    const oversized = (o) => optionWeight(o) > MEAL_WEIGHT_CAP
    // Preference tiers, best first: 0 = fits and is liked, 1 = oversized plate,
    // 2 = contains something the client dislikes (last resort — only surfaces if
    // the meal would otherwise be thin).
    const rank = (o) => (isDisliked(o) ? 2 : 0) + (oversized(o) ? 1 : 0)
    const sorted = options.sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      return Math.abs(a.kcal - target) - Math.abs(b.kcal - target)
    })
    // Keep only options that land within a tolerance band of the meal target, so
    // every "Choose One" option is interchangeable — picking any keeps the client
    // on the daily total. If too few reach the target (a very high per-meal target
    // on a restrictive/IF plan), fall back to the closest ones so the meal is
    // never thin.
    const tol = Math.max(60, target * 0.12)
    const inBand = sorted.filter((o) => rank(o) === 0 && Math.abs(o.kcal - target) <= tol)
    // Fallback for thin meals: closest first, but never a disliked dish here —
    // phase 2 tops a meal up to MIN_OPTIONS_PER_MEAL from `sorted` if needed.
    let pool = inBand.length >= 3 ? inBand : sorted.filter((o) => !isDisliked(o))

    // Protein-first pass (Shape Up plans that came up short — see
    // generateCatalogPlan). Among dishes that already fit this meal's calories,
    // prefer the most protein-dense, keeping the top half — enough to fill the
    // table and still vary on regenerate. Phase 2 re-sorts the chosen few by
    // calorie fit, so the daily total holds.
    if (highProtein) {
      const fit = pool.filter((o) => rank(o) === 0)
      const rest = pool.filter((o) => rank(o) !== 0)
      fit.sort((a, b) => proteinDensity(b) - proteinDensity(a))
      const keep = Math.max(MAX_OPTIONS_PER_MEAL * 2, Math.ceil(fit.length / 2))
      pool = [...fit.slice(0, keep), ...rest]
    }

    // Regenerating should offer a genuinely different selection, not recompute an
    // identical plan — there are usually far more in-band candidates than the
    // seven we show. The closest-to-target option stays pinned first so the
    // meal's headline calories (and therefore the plan's daily total) don't move;
    // only the alternatives rotate. Stride = the number of alternative rows, so
    // one step swaps the whole set rather than shifting it by one.
    // Only rotate where there is real surplus: on a restrictive diet the pool is
    // barely bigger than the table, and churning it just forces the duplicate
    // fallback below without buying the client any new choices.
    // Blood-sugar conditions: keep options whose carbs sit in range, closest to
    // each other first (phase 2 takes the first few, so the meal stays steady).
    // Too few in range: closest to the range instead — validatePlan flags it.
    // Low-fat conditions: options within the fat cap; too few, the leanest.
    if (fatRule) {
      const cap = fatRule[m.id === 'snack' ? 'snack' : 'main']
      const fat = (o) => o.macros?.fats ?? 0
      const lean = pool.filter((o) => fat(o) <= cap)
      pool = lean.length >= MIN_OPTIONS_PER_MEAL ? lean : [...pool].sort((a, b) => fat(a) - fat(b))
    }

    if (carbRule) {
      const [lo, hi] = carbRule[m.id === 'snack' ? 'snack' : 'main']
      const carbs = (o) => o.macros?.carbs ?? 0
      const outBy = (o) => (lo != null && carbs(o) < lo ? lo - carbs(o) : hi != null && carbs(o) > hi ? carbs(o) - hi : 0)
      const inRange = pool.filter((o) => outBy(o) === 0)
      if (inRange.length >= MIN_OPTIONS_PER_MEAL) {
        const sorted = inRange.map(carbs).sort((a, b) => a - b)
        const mid = sorted[Math.floor(sorted.length / 2)]
        pool = inRange.sort((a, b) => Math.abs(carbs(a) - mid) - Math.abs(carbs(b) - mid))
        // Diabetes: options that also meet the protein floor go first. Snacks,
        // which only need a few options, drop the rest when three or more meet it.
        const proteinMin = diabetesFloor?.[m.id === 'snack' ? 'snack' : 'main']
        if (proteinMin) {
          const meets = (o) => (o.macros?.protein || 0) >= proteinMin
          const strong = pool.filter(meets)
          pool = m.id === 'snack' && strong.length >= MIN_OPTIONS_PER_MEAL
            ? strong : [...strong, ...pool.filter((o) => !meets(o))]
        }
      } else {
        pool = [...pool].sort((a, b) => outBy(a) - outBy(b))
      }
    }

    const variant = Math.max(0, Math.trunc(ctx.variant || 0))
    if (variant > 0 && pool.length > MAX_OPTIONS_PER_MEAL + 1) {
      // Rotate only the plates that fit the weight guideline, keeping oversized
      // ones pinned at the back. Rotating the whole list would promote them into
      // the visible seven and undo the ranking above.
      const fit = pool.filter((o) => rank(o) === 0)
      const over = pool.filter((o) => rank(o) !== 0)
      if (fit.length > 2) {
        const [best, ...rest] = fit
        const off = (variant * (MAX_OPTIONS_PER_MEAL - 1)) % rest.length
        pool = [best, ...rest.slice(off), ...rest.slice(0, off), ...over]
      }
    }
    // At most one red-meat option per meal for fatty liver: the rest move to
    // the back of the pool and only come back if the meal would be thin.
    if (limitRedMeat) {
      const isRed = (o) => (o.ingredients?.length ? o.ingredients.map((i) => i.name_en) : [o.name_en])
        .some((n) => RED_MEAT.test(norm(n)))
      const first = pool.findIndex(isRed)
      if (first >= 0) pool = [...pool.filter((o, i) => !isRed(o) || i === first), ...pool.filter((o, i) => isRed(o) && i !== first)]
    }
    return { def: m, target, pool, sorted }
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
    // De-duplication and rotation can both take a meal's closest-to-target dish
    // (another meal claimed it first), so re-rank what survived. The meal's
    // headline calories come from options[0], and the plan's daily total is the
    // sum of those — this keeps that total on target.
    picked.sort((a, b) => Math.abs(a.kcal - slot.target) - Math.abs(b.kcal - slot.target))
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
    // Which rotation of the candidate pools produced this plan; the editor
    // increments it so each regeneration offers a different selection.
    variant: Math.max(0, Math.trunc(ctx.variant || 0)),
    isIF,
    // Who the plan is for, so the PDF's food-groups page can leave out what this
    // client can't or won't eat (personaliseFoodGroups).
    restrictions: {
      diet: payload.dietaryTypeId || '',
      allergies: allergyNames,
      conditions: conditionNames,
      dislikes: dislikedIngredients,
    },
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
