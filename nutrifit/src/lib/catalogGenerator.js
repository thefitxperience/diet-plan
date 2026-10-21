// Catalog-based plan generation (no FIT API). Builds the whole plan from our
// curated meal catalog + the rule-based scaling engine: deterministic,
// restriction-aware, every meal realistic at the client's calorie level.
//
// This module is intentionally free of any browser/FIT-API dependency (no
// import.meta.env, no fetch) so it can run BOTH in the app and inside a
// Cloudflare Worker (see generator-worker/) that serves other sites.

import {
  optionFromCatalog, scaleOptionToKcal, rankByPortion, MAX_OPTIONS_PER_MEAL,
  MEAL_DEFS, optionWeight, mealWeightCap, autofillArabic, formatAmount,
  buildAssessment, typicalDayProtein, proteinRangeFor, translateIngredient, ingredientMetaFor,
  carbRuleFor, diabeticMaxGrams, VEGAN_PROTEIN_FLOOR, veganProteinFloor, VEGAN_POWDER_MAX, PLANT_PROTEIN_POWDER, PROTEIN_SCOOP_GRAMS,
  fatRuleFor, fatCapFor, goutMaxGrams, PROTEIN_SIDES, proteinFloorFor, hyperkalemiaMaxGrams, POWDER_FITS, LEGUME_SIDES, SOY_SIDES,
} from './planModel'
import { processOption, canonicalTokens, norm, makeDislikeMatcher, isSafeFor, preferredFor } from './dietaryRules'
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
  // past the 2.2 g/kg top of the range. Keep whichever plan has more protein,
  // unless the protein-dense one leaves a meal with fewer options (on a carb or
  // fat range, the protein-dense half can hold only three or four that fit);
  // if neither reaches the floor, validatePlan flags it for the dietitian.
  if (ctx.goal !== 'recomp') return result
  const min = (parseFloat(payload.weight) || 0) * proteinRangeFor('recomp')[0]
  if (!min || typicalDayProtein(result.plan) >= min) return result
  const boosted = buildCatalogPlan(payload, restrictions, ctx, true)
  const count = (plan, id) => plan.meals.find((m) => m.id === id)?.options.length || 0
  const thinner = boosted.plan.meals.some((m) => m.options.length < Math.min(count(result.plan, m.id), VARIETY_FILL))
  return !thinner && typicalDayProtein(boosted.plan) > typicalDayProtein(result.plan) ? boosted : result
}

const RED_MEAT = /\b(steak|lamb|beef|veal|minced meat)\b/
// Legumes, for Wilson's disease (copper): beans, lentils, chickpeas and the
// dishes made of them — not green beans, which are eaten as a vegetable.
const LEGUME = /\b(lentils?|chickpeas?|hummus|falafel|fava|peas)\b|\b(black|white|kidney|red) beans\b/

/**
 * Everything that decides whether a dish suits one client, and the form it takes
 * for them: diet, allergy and condition swaps, portion caps, protein additions,
 * foods to avoid, and the carb/fat limits of their conditions. Shared by plan
 * generation and the editor's meal picker, so a dish added by hand passes
 * exactly the checks a generated one does.
 * @param r {diet?, goal?, allergyNames?, conditionNames?, dislikedIngredients?}
 */
export function clientRules({ diet = '', goal = '', allergyNames = [], conditionNames = [], dislikedIngredients = [] } = {}) {
  const tokens = canonicalTokens([...allergyNames, ...conditionNames])
  const kind = (slot) => (slot === 'snack' ? 'snack' : 'main')
  const sameFood = (a, b) => a === b || (/^tofu/i.test(a) && /^tofu/i.test(b))

  // Review §4.2 — foods to avoid. Matched by food family (avoiding almonds
  // removes almond milk too; see makeDislikeMatcher) and against the ORIGINAL
  // name, so an allergy swap can't smuggle a disliked food back in.
  const avoids = makeDislikeMatcher(dislikedIngredients)
  const isDisliked = (opt) => (opt.ingredients?.length
    ? opt.ingredients.some((ing) => avoids(ing.name_en) || avoids(ing.original_en))
    : avoids(opt.name_en))

  // Blood-sugar conditions (diabetes / hypoglycemia): carbs per option within
  // CARB_RULES, options in a meal close to each other, and — for diabetes —
  // smaller portions of fast carbs (one banana, moderate rice and bread).
  const carbRule = carbRuleFor(conditionNames, diet)
  // Low-fat conditions (GERD, pancreatitis): fat per option capped (FAT_RULES);
  // hypertension: fat within its share of the option's calories.
  const fatRule = fatRuleFor(conditionNames, diet)
  // Per-client portion caps: diabetes (fast carbs), gout (poultry and fish).
  const condText = conditionNames.join(' ')
  // Fatty liver: red meat kept occasional (the condition rules already leave
  // out steak and lamb; this limits the lean cuts that remain).
  const limitRedMeat = /fatty liver/i.test(condText)
  const isRedMeat = (opt) => (opt.ingredients?.length ? opt.ingredients.map((i) => i.name_en) : [opt.name_en])
    .some((n) => RED_MEAT.test(norm(n)))
  const capFns = [
    /diabet/i.test(condText) && diabeticMaxGrams,
    /gout/i.test(condText) && goutMaxGrams,
    /hyperkal/i.test(condText) && hyperkalemiaMaxGrams,
  ].filter(Boolean)
  // Wilson's disease: legumes (high in copper) at one meal of the day only —
  // lunch. Options are alternatives, so the only way to guarantee it is to keep
  // them out of the other meals (review, Maya Mouawad).
  const legumesAtLunchOnly = /wilson/i.test(condText)
  const isLegume = (opt) => (opt.ingredients?.length ? opt.ingredients.map((i) => i.name_en) : [opt.name_en])
    .some((n) => LEGUME.test(norm(n)))
  const legumeAllowed = (opt, slot) => !legumesAtLunchOnly || slot === 'lunch' || !isLegume(opt)
  const scaleOpts = capFns.length
    ? { maxGrams: (name) => capFns.map((f) => f(name)).filter((v) => v != null).reduce((a, b) => Math.min(a, b), Infinity) }
    : {}

  // Vegan plans: plant protein powder on options under the protein floor
  // (dietitian review) — unless the powder isn't safe or is avoided. Only as
  // much as the floor needs (half a scoop to one scoop): options are
  // alternatives, so a full scoop on every one could add five scoops to a day.
  // Only in dishes it blends into (POWDER_FITS); savoury dishes get beans.
  // At most VEGAN_POWDER_MAX in any one option, so a day stays within 2 scoops.
  const veganTopUp = diet === 'Vegan' && isSafeFor(PLANT_PROTEIN_POWDER, tokens) && !avoids(PLANT_PROTEIN_POWDER)
  const veganFloor = veganProteinFloor(goal)
  const powderMax = (slot) => VEGAN_POWDER_MAX[slot] ?? 0
  const powderProteinPerG = (ingredientMetaFor(PLANT_PROTEIN_POWDER)?.per100g.protein || 75) / 100
  // Protein sides (yogurt, egg whites or tofu), sized to reach a floor, capped
  // per side: the first one the client can eat that suits the dish. Vegetarian
  // main meals use the vegan floor; diabetic plans use their own floor on every
  // meal and snack. No suitable side → the dish is left as it is.
  const canHaveSide = ([name]) => isSafeFor(name, tokens) && !avoids(name)
    && (diet !== 'Vegan' || !/yogurt|egg/i.test(name))
  // Kosher keeps meat and dairy apart: a meat dish gets egg whites, not yogurt.
  const hasMeat = (opt) => (opt.ingredients || []).some((i) => /chicken|turkey|beef|steak|lamb|minced meat/i.test(i.name_en))
  const suits = (fits, opt) => fits.test(opt.name_en || '')
  const sideFor = (opt) => PROTEIN_SIDES.find((s) => canHaveSide(s) && suits(s[2], opt)
    && !(diet === 'Kosher' && /yogurt/i.test(s[0]) && hasMeat(opt))) || null
  const legumeSideFor = (opt) => (legumesAtLunchOnly ? null
    : LEGUME_SIDES.find((s) => canHaveSide(s) && suits(s[2], opt)
      && !opt.ingredients?.some((i) => i.name_en === s[0])) || null)
  // Soy (edamame, tofu) for vegan savoury dishes, ahead of beans except on
  // maintenance plans (review, Maya Mouawad: muscle gain needs more protein than
  // beans give, and on low-calorie plans beans fill up with fibre first).
  // A dish that already has tofu gets more of it rather than edamame on top.
  const soySideFor = (opt) => {
    const fits = SOY_SIDES.filter((s) => canHaveSide(s) && suits(s[2], opt))
    return fits.find((s) => opt.ingredients?.some((i) => sameFood(i.name_en, s[0]))) || fits[0] || null
  }
  const veganSideFor = (opt) => (goal === 'maintain' || !goal
    ? legumeSideFor(opt) || soySideFor(opt) || sideFor(opt)
    : soySideFor(opt) || legumeSideFor(opt) || sideFor(opt))
  const diabetesFloor = proteinFloorFor(conditionNames)
  const withSide = (opt, target, side, grams) => scaleOptionToKcal({
    ...opt,
    ingredients: [...opt.ingredients, { name_en: side, name_ar: translateIngredient(side) || '', grams, uom: 'g' }],
  }, target, scaleOpts)
  // Vegan sides are sized in up to three passes: rescaling the dish back to its
  // calories trims the side too, so one pass can land well under the floor (the
  // review asked for 30 g on muscle-gain plans). Other diets keep one pass, so
  // a protein side doesn't crowd out the carbs a blood-sugar range needs. A
  // dish that already has the side's food gets more of it, within its maximum.
  const withProteinSide = (opt, target, floor, side) => {
    if (!side || !opt.ingredients?.length) return opt
    const [name, maxG] = side
    if (!ingredientMetaFor(name)) return opt
    let out = opt
    for (let pass = 0; pass < (diet === 'Vegan' ? 3 : 1); pass++) {
      const short = floor - (out.macros?.protein || 0)
      if (short <= 0) break
      const own = out.ingredients.find((i) => sameFood(i.name_en, name))
      const meta = (own && ingredientMetaFor(own.name_en)) || ingredientMetaFor(name)
      if (!meta?.per100g.protein) break
      const have = own?.grams || 0
      const inDish = opt.ingredients.some((i) => sameFood(i.name_en, name))
      const limit = inDish ? meta.max : Math.min(maxG, meta.max)
      const grams = Math.min(limit, Math.max(own ? have : meta.min, have + Math.ceil(short / (meta.per100g.protein / 100) / 10) * 10))
      if (grams <= have) break
      out = own
        ? scaleOptionToKcal({ ...out, ingredients: out.ingredients.map((i) => (i === own ? { ...i, grams } : i)) }, target, scaleOpts)
        : withSide(out, target, name, grams)
    }
    return out
  }

  // Hypoglycemia (and diabetes off keto): an option under the carb minimum gets
  // a carb side sized to reach it, instead of staying under the floor (review:
  // some options were outside the 45 g minimum). Only one that suits the dish:
  // no second starch where there already is one, fruit with sweet dishes, rice
  // cakes or bread with savoury ones.
  const STARCH = /bread|pita|toast|tortilla|rice|pasta|noodle|potato|quinoa|bulgur|oat|freekeh|couscous|corn/i
  const SWEET = /oat|pancake|fruit|berr|banana|granola|smoothie|shake|pudding|date|apple|peanut butter/i
  const EGGY = /omelet|egg|shakshuka|scramble/i
  const CARB_SIDES = {
    fruit: ['Banana', 'Apple, unpeeled, small', 'Blueberries, Fresh or Frozen', 'Strawberries'],
    savoury: ['Rice Cake, Whole Grain', 'Whole wheat bread'],
    main: ['Rice, boiled', 'Potatoes baked or boiled', 'Quinoa (cooked, plain)', 'Sweet potatoes, baked or boiled'],
    eggs: ['Whole wheat bread', 'Potatoes baked or boiled'],
  }
  const withCarbSide = (opt, slot, target) => {
    const lo = carbRule?.[kind(slot)]?.[0]
    if (lo == null || !opt.ingredients?.length || (opt.macros?.carbs ?? 0) >= lo) return opt
    const hasStarch = opt.ingredients.some((i) => STARCH.test(i.name_en))
    const main = slot === 'lunch' || slot === 'dinner'
    const list = SWEET.test(opt.name_en || '') && !main ? CARB_SIDES.fruit
      : hasStarch ? [] : EGGY.test(opt.name_en || '') ? CARB_SIDES.eggs
        : main ? CARB_SIDES.main : CARB_SIDES.savoury
    const need = lo - (opt.macros?.carbs ?? 0)
    let sided = opt
    if (hasStarch) {
      // The dish already has its starch (rice in a kabsa): a bigger portion of
      // it rather than a second one.
      const starch = opt.ingredients.find((i) => STARCH.test(i.name_en) && ingredientMetaFor(i.name_en))
      const meta = starch && ingredientMetaFor(starch.name_en)
      if (!meta) return opt
      const grams = Math.min(meta.max, starch.grams + Math.ceil(need / (meta.per100g.carbs / 100) / 10) * 10)
      sided = scaleOptionToKcal({
        ...opt, ingredients: opt.ingredients.map((i) => (i === starch ? { ...i, grams } : i)),
      }, target, scaleOpts)
    } else {
      const name = list.map((n) => preferredFor(n, tokens))
        .find((n) => isSafeFor(n, tokens) && !avoids(n) && !opt.ingredients.some((i) => i.name_en === n))
      const meta = name && ingredientMetaFor(name)
      if (!meta) return opt
      const grams = Math.min(meta.max, Math.max(meta.min, Math.ceil(need / (meta.per100g.carbs / 100) / 10) * 10))
      sided = withSide(opt, target, name, grams)
    }
    return (sided.macros?.carbs ?? 0) > (opt.macros?.carbs ?? 0) ? sided : opt
  }

  const withProteinScoop = (opt, target, floor, maxGrams = PROTEIN_SCOOP_GRAMS) => {
    const add = (grams) => scaleOptionToKcal({
      ...opt,
      ingredients: [...opt.ingredients, {
        name_en: PLANT_PROTEIN_POWDER, name_ar: translateIngredient(PLANT_PROTEIN_POWDER) || '', grams, uom: 'g',
      }],
    }, target, scaleOpts)
    const short = floor - (opt.macros?.protein || 0)
    const half = PROTEIN_SCOOP_GRAMS / 2
    const out = add(Math.min(maxGrams, Math.max(half, Math.ceil(short / powderProteinPerG / 5) * 5)))
    // Rescaling trims the dish's other protein a little; if that leaves it just
    // under the floor, as much as the cap allows instead.
    return (out.macros?.protein || 0) < floor && maxGrams > half ? add(maxGrams) : out
  }

  const inCarbRange = (opt, slot) => {
    const [lo, hi] = carbRule?.[kind(slot)] || []
    const c = opt.macros?.carbs ?? 0
    return (lo == null || c >= lo) && (hi == null || c <= hi)
  }

  // Diabetes: no fast-absorbing breakfasts — fruit shakes and smoothies (review:
  // "protein shake and banana almond smoothie").
  const noFruitShakes = /diabet/i.test(condText)
  const isFruitShake = (entry) => /shake|smoothie/i.test(entry.name_en || '')
    && /banana|berr|mango|date|fruit/i.test(`${entry.name_en} ${(entry.ingredients || []).map((i) => i.name_en).join(' ')}`)

  // A catalog (or custom) dish as this client would get it at `target` kcal in
  // `slot`, or null when it doesn't suit their diet or has an unsuitable
  // ingredient with no safe swap.
  function prepare(entry, slot, target) {
    if (diet && (entry.diets || []).length && !(entry.diets || []).includes(diet)) return null
    if (noFruitShakes && isFruitShake(entry)) return null
    let opt = optionFromCatalog(entry)
    if (tokens.size) {
      const { swaps, conflicts } = processOption(opt, tokens)
      if (conflicts.length) return null
      opt._swaps = swaps
    }
    // Vegan: a dish that comes with more powder than this meal allows keeps
    // only the allowance (none at lunch or dinner).
    if (diet === 'Vegan' && opt.ingredients?.some((i) => /protein powder/i.test(i.name_en))) {
      const cap = powderMax(slot)
      opt = {
        ...opt,
        ingredients: opt.ingredients
          .map((i) => (/protein powder/i.test(i.name_en) && i.grams > cap ? { ...i, grams: cap } : i))
          .filter((i) => i.grams > 0),
      }
    }
    // Scale AFTER swaps so macros/kcal reflect the final ingredient set.
    opt = scaleOptionToKcal(opt, target, scaleOpts)
    const proteinFloor = diet === 'Vegan' ? veganFloor[kind(slot)] : VEGAN_PROTEIN_FLOOR[kind(slot)]
    const short = (opt.macros?.protein || 0) < proteinFloor
    if (diet === 'Vegan' && short) {
      const hasPowder = opt.ingredients?.some((i) => /protein powder/i.test(i.name_en))
      if (veganTopUp && !hasPowder && powderMax(slot) > 0 && suits(POWDER_FITS, opt)) {
        opt = withProteinScoop(opt, target, proteinFloor, powderMax(slot))
      }
      if ((opt.macros?.protein || 0) < proteinFloor) opt = withProteinSide(opt, target, proteinFloor, veganSideFor(opt))
    } else if (diet === 'Vegetarian' && slot !== 'snack' && short) {
      opt = withProteinSide(opt, target, proteinFloor, sideFor(opt))
    }
    // Diabetes: every meal and snack up to its protein floor (keto plans are
    // high in protein already, and their carbs are not ranged). A side that
    // would push the option out of the carb range isn't added: on small snacks
    // the two limits can't both fit, and carbs come first.
    const diabetesMin = diabetesFloor?.[kind(slot)]
    if (diabetesMin && diet !== 'Keto' && (opt.macros?.protein || 0) < diabetesMin) {
      const sided = withProteinSide(opt, target, diabetesMin, sideFor(opt))
      if (inCarbRange(sided, slot) || !inCarbRange(opt, slot)) opt = sided
    }
    if (diet !== 'Keto') opt = withCarbSide(opt, slot, target)
    return opt
  }

  // The client's carb (blood-sugar) and fat (GERD, pancreatitis) limits for one
  // option in `slot`.
  const withinLimits = (opt, slot) => (!carbRule || inCarbRange(opt, slot))
    && (opt.macros?.fats ?? 0) <= fatCapFor(fatRule, slot, opt)

  // The protein floor an option is held to in `slot` (vegan/vegetarian, or
  // diabetes), for putting the options that meet it first.
  const proteinFloorAt = (slot) => Math.max(
    diet === 'Vegan' ? veganFloor[kind(slot)] : diet === 'Vegetarian' && slot !== 'snack' ? VEGAN_PROTEIN_FLOOR[kind(slot)] : 0,
    diet !== 'Keto' ? diabetesFloor?.[kind(slot)] || 0 : 0,
  )

  return { isDisliked, carbRule, fatRule, limitRedMeat, isRedMeat, diabetesFloor, prepare, withinLimits, legumeAllowed, proteinFloorAt }
}

// Variety within one meal (review, Maya Mouawad: two za'atar manoushe, three
// falafel, five egg breakfasts, seven chicken dinners). [pattern, where it is
// matched, most options of that kind per meal]. A dish over its limit is held
// back, and only used to bring a thin meal up to VARIETY_FILL options: five
// varied options beat seven repetitive ones.
const VARIETY = [
  [/manoushe/i, 'name', 1], [/falafel/i, 'name', 1], [/shakshuka/i, 'name', 1], [/tabbouleh/i, 'name', 1],
  [/shake|smoothie/i, 'name', 1],
  [/^(egg|whole eggs)/i, 'ingredient', 2], [/chicken/i, 'ingredient', 3], [/tuna/i, 'ingredient', 2],
  [/salmon/i, 'ingredient', 2], [/beef|steak|lamb|minced meat/i, 'ingredient', 2], [/^tofu/i, 'ingredient', 3],
  [/bread|pita|toast|tortilla/i, 'ingredient', 3],
]
const VARIETY_FILL = 5
const FISH_DISH = /salmon|tuna|fish|shrimp|shellfish/i

// → { kept, later }: the pool in order with each kind under its limit, and the
// dishes held back.
function diversify(pool) {
  const kinds = (o) => VARIETY.map(([re, where], k) => ((where === 'name'
    ? re.test(o.name_en || '')
    : (o.ingredients || []).some((i) => re.test(i.name_en))) ? k : -1)).filter((k) => k >= 0)
  const count = new Map()
  const kept = []
  const later = []
  for (const o of pool) {
    const ks = kinds(o)
    if (ks.every((k) => (count.get(k) || 0) < VARIETY[k][2])) {
      ks.forEach((k) => count.set(k, (count.get(k) || 0) + 1))
      kept.push(o)
    } else later.push(o)
  }
  return { kept, later }
}

function buildCatalogPlan(payload, { allergyNames = [], conditionNames = [], dislikedIngredients = [] } = {}, ctx = {}, highProtein = false) {
  const rules = clientRules({ diet: payload.dietaryTypeId, goal: ctx.goal, allergyNames, conditionNames, dislikedIngredients })
  const { isDisliked, carbRule, fatRule, limitRedMeat, isRedMeat, diabetesFloor, legumeAllowed, proteinFloorAt } = rules
  const diet = payload.dietaryTypeId
  // Dishes marked whenNeeded were made to fill gaps for restricted clients (egg-
  // white-only hashes, plain light soups, tiny keto snacks). A client with no
  // condition, allergy or restrictive diet has better choices, so for them these
  // only come in if a meal would otherwise be short.
  const regularClient = !allergyNames.length && !conditionNames.length && !['Vegan', 'Keto'].includes(diet)
  const isIF = payload.secondaryTypeId === 'IntermittentFasting'
  const daily = ctx.dailyKcal || 0
  const substitutions = []
  // Share of the dish's calories that come from protein (4 kcal per gram).
  const proteinDensity = (o) => (o.kcal ? ((o.macros?.protein || 0) * 4) / o.kcal : 0)

  // ── Phase 1: rank each meal's candidates against its own calorie target ─────
  // Most catalog dishes belong to more than one category (a steak is both lunch
  // and dinner), so these pools overlap heavily; phase 2 resolves that.
  // A dish the client avoids is left out; it only returns if the meal would
  // otherwise have no options at all.
  const slots = MEAL_DEFS.filter((m) => !(isIF && m.id === 'breakfast')).map((m) => {
    const target = slotTargetKcal(m.id, daily, isIF)
    const options = []
    const seen = new Set()
    for (const entry of mealCatalog) {
      if (!(entry.categories || []).includes(m.id)) continue
      const key = norm(entry.name_en)
      if (!key || seen.has(key)) continue
      const opt = rules.prepare(entry, m.id, target)
      if (!opt) continue // unsuitable diet, or unfixable for this client — drop it
      if (entry.whenNeeded && regularClient) opt._whenNeeded = true
      seen.add(key)
      options.push(opt)
    }
    // Surface the options that best hit the meal's calorie target: oversized
    // plates sink to the bottom; among the rest, closest-to-target first (so
    // meals that can't reach a high target — e.g. intermittent-fasting — don't
    // lead the list). Ties keep catalog order, preserving variety.
    const oversized = (o) => optionWeight(o) > mealWeightCap(target)
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
    // How many candidates meet the client's limits: phase 2 serves the meal
    // with the fewest first, so another meal can't take the only ones that fit.
    let fitting = Infinity
    if (fatRule) {
      const over = (o) => (o.macros?.fats ?? 0) - fatCapFor(fatRule, m.id, o)
      const lean = pool.filter((o) => over(o) <= 0)
      fitting = Math.min(fitting, lean.length)
      pool = lean.length >= MIN_OPTIONS_PER_MEAL ? lean : [...pool].sort((a, b) => over(a) - over(b))
      // A fat share (hypertension) favours carb-heavy plates; protein-rich ones
      // first, so lean chicken and fish lead rather than bean bowls.
      if (fatRule.share && lean.length >= MIN_OPTIONS_PER_MEAL) pool = [...pool].sort((a, b) => proteinDensity(b) - proteinDensity(a))
    }

    if (carbRule) {
      const [lo, hi] = carbRule[m.id === 'snack' ? 'snack' : 'main']
      const carbs = (o) => o.macros?.carbs ?? 0
      const outBy = (o) => (lo != null && carbs(o) < lo ? lo - carbs(o) : hi != null && carbs(o) > hi ? carbs(o) - hi : 0)
      const inRange = pool.filter((o) => outBy(o) === 0)
      fitting = Math.min(fitting, inRange.length)
      if (inRange.length >= MIN_OPTIONS_PER_MEAL) {
        const sorted = inRange.map(carbs).sort((a, b) => a - b)
        const mid = sorted[Math.floor(sorted.length / 2)]
        pool = inRange.sort((a, b) => Math.abs(carbs(a) - mid) - Math.abs(carbs(b) - mid))
        // Diabetes: options that also meet the protein floor go first, and the
        // rest are dropped when three or more meet it: three or four options
        // that fit beat seven with a low-protein one to flag.
        const proteinMin = diabetesFloor?.[m.id === 'snack' ? 'snack' : 'main']
        if (proteinMin) {
          const meets = (o) => (o.macros?.protein || 0) >= proteinMin
          const strong = pool.filter(meets)
          pool = strong.length >= MIN_OPTIONS_PER_MEAL ? strong : [...strong, ...pool.filter((o) => !meets(o))]
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
      const first = pool.findIndex(isRedMeat)
      if (first >= 0) pool = [...pool.filter((o, i) => !isRedMeat(o) || i === first), ...pool.filter((o, i) => isRedMeat(o) && i !== first)]
    }
    // Wilson's disease: legume dishes only at lunch — elsewhere they're dropped,
    // unless that would leave the meal thin.
    const legumeOk = pool.filter((o) => legumeAllowed(o, m.id))
    if (legumeOk.length < pool.length) {
      pool = legumeOk.length >= MIN_OPTIONS_PER_MEAL ? legumeOk : [...legumeOk, ...pool.filter((o) => !legumeAllowed(o, m.id))]
    }
    // Options that meet the client's protein floor first (soft: the rest follow).
    const floor = proteinFloorAt(m.id)
    if (floor) pool = [...pool.filter((o) => (o.macros?.protein || 0) >= floor), ...pool.filter((o) => (o.macros?.protein || 0) < floor)]
    // Pescatarian plans are built around fish: up to three fish dishes lead the
    // main meals (review: "low fish and seafood").
    if (diet === 'Pescatarian' && (m.id === 'lunch' || m.id === 'dinner')) {
      const fish = pool.filter((o) => (o.ingredients || []).some((i) => FISH_DISH.test(i.name_en))).slice(0, 3)
      pool = [...fish, ...pool.filter((o) => !fish.includes(o))]
    }
    const { kept, later } = diversify(pool.filter((o) => !o._whenNeeded))
    return { def: m, target, pool: kept, later: [...later, ...pool.filter((o) => o._whenNeeded)], sorted, fitting }
  })

  // ── Phase 2: hand dishes out so none repeats across meals ───────────────────
  // A client should not be offered the same dish at lunch and dinner. Meals are
  // served scarcest first, so a slot whose pool is largely shared with another
  // (lunch/dinner) isn't left picking over scraps: first by how many candidates
  // meet the client's carb or fat limits (a hypoglycemic client's lunch, served
  // first on its smaller variety-capped pool, took every dish with enough carbs
  // and left dinner none), then by pool size.
  const claimed = new Set()
  const scarcity = (a, b) => (a.fitting === b.fitting ? 0 : a.fitting < b.fitting ? -1 : 1) || a.pool.length - b.pool.length
  for (const slot of [...slots].sort(scarcity)) {
    const picked = []
    for (const o of slot.pool) {
      if (picked.length >= MAX_OPTIONS_PER_MEAL) break
      const key = norm(o.name_en)
      if (claimed.has(key)) continue
      claimed.add(key)
      picked.push(o)
    }
    for (const o of slot.later) {
      if (picked.length >= VARIETY_FILL) break
      const key = norm(o.name_en)
      if (claimed.has(key)) continue
      claimed.add(key)
      picked.push(o)
    }
    // Too few survived: top up from this meal's whole ranked list — first dishes
    // no other meal has, then (only to reach two options) a repeat from another
    // meal, and a dish the client avoids only if the meal would be empty.
    // Same-dish-at-lunch-and-dinner was a review complaint, so repeats come last.
    if (picked.length < MIN_OPTIONS_PER_MEAL) {
      const rest = slot.sorted.filter((o) => !picked.includes(o) && legumeAllowed(o, slot.def.id))
      const fresh = rest.filter((o) => !isDisliked(o) && !claimed.has(norm(o.name_en)))
      for (const o of fresh) {
        if (picked.length >= MIN_OPTIONS_PER_MEAL) break
        claimed.add(norm(o.name_en))
        picked.push(o)
      }
      for (const o of rest.filter((x) => !isDisliked(x) && !picked.includes(x))) {
        if (picked.length >= 2) break
        picked.push(o)
      }
      if (!picked.length && rest.length) picked.push(rest[0])
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
    ranked.forEach((o) => { delete o._swaps; delete o._whenNeeded })
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
