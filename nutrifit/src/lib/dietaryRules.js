// Dietary substitution engine (client-side workaround).
//
// The FIT generation API is supposed to swap ingredients that are unsuitable
// for a client's medical conditions / allergies for a safe alternative, but
// that step is currently malfunctioning. Until it's fixed upstream we do it
// here, using two exports from the FIT database (see scripts/gen_dietary_data.py):
//
//   • Ingredients.xlsx      → which ingredients are unsuitable for which
//                             allergies / medical conditions
//   • Meal Breakdown.xlsx   → the designed alternative ingredient for a swap
//
// baked into src/data/dietaryData.json. Rule: an ingredient flagged for one of
// the client's restrictions is replaced by its alternative ONLY IF that
// alternative is itself safe for ALL of the client's restrictions. If no safe
// alternative exists the ingredient is left in place and reported as an
// unresolved conflict for the nutritionist to handle manually.

import data from '../data/dietaryData.json'
import { translateIngredient, translateFood, MAX_OPTIONS_PER_MEAL } from './planModel'
import { rewriteDishText } from './swapText'

// Must match norm() in scripts/gen_dietary_data.py exactly.
export function norm(s) {
  if (s == null) return ''
  return String(s).trim().toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim().replace(/\.+$/, '')
}

// Map the client's selected restriction display names (allergies + conditions,
// in the API's spelling) to the canonical tokens used inside dietaryData.json.
export function canonicalTokens(names = []) {
  const set = new Set()
  for (const nm of names) {
    const n = norm(nm)
    if (!n) continue
    const expand = data.restrictionExpand[n]
    if (expand) expand.forEach((tok) => set.add(tok))
    else set.add(data.restrictionCanonical[n] ?? n)
  }
  return set
}

// Ingredients we introduced as swap targets or additions, with the restrictions
// they still carry (low-salt feta is still dairy; rice noodles are gluten-free).
const LOCAL_INGREDIENTS = {
  'cheese feta, low-salt': { restrictions: ['ibs', 'lactose intolerance', 'phenylketonuria'] },
  'cheddar, lactose-free': { restrictions: ['cardiovascular disease', 'diabetes', 'phenylketonuria'] },
  'rice noodles, cooked': { restrictions: [] },
  'plant protein powder': { restrictions: [] },
  "za'atar": { restrictions: ['sesame allergy'] }, // the blend contains sesame seeds
}

function entryFor(name) {
  return data.ingredients[norm(name)] || LOCAL_INGREDIENTS[norm(name)] || null
}

// Allergens the FIT restriction table doesn't cover: peanut, milk (a protein
// allergy, unlike lactose intolerance, so lactose-free dairy is unsafe too) and
// fish (the table's "seafood allergy" lumps fish with shellfish). Matched on
// the ingredient name; there is no designed swap, so a dish containing one is
// dropped for that client. Tokens are the normalised allergy names.
const PLANT_BASED = /\b(almond|oat|soy|soya|coconut|cashew|rice|peanut|hazelnut|vegan)\b/
const DAIRY = /\b(milk|cheese|cheddar|feta|halloum|halloumi|mozzarella|mozarella|parmesan|ricotta|labneh|labne|yogh?urt|butter|buttermilk|cream|crème|whey|ghee|cottage|latte|kefir|akkawi|kashkaval|paneer|gorgonzola|brie|jameed|caesar)\b/
const FISH = /\b(fish|salmon|tuna|cod|sardines?|anchov(y|ies)|mackerel|hammour|tilapia|trout|halibut|sea bass|caesar)\b/
export const LOCAL_ALLERGENS = {
  'peanut allergy': (n) => /\bpeanuts?\b/.test(n),
  'milk allergy': (n) => DAIRY.test(n) && !PLANT_BASED.test(n),
  'fish allergy': (n) => FISH.test(n),
}

// Condition rules the FIT table is missing, from the dietitian review (Myriam
// Chehab, 28.09.2026). Each entry is [pattern on the normalised ingredient name,
// action]. The action is one of:
//   'Name'  swap to that ingredient, same grams. Only like-for-like swaps (the
//           dish must still be what its name says), and the target needs
//           nutrition in ingredientMeta.json or the same nutrition as the
//           original (scaling falls back to the original's figures).
//   REMOVE  take the ingredient out and keep the dish — for minor flavourings
//           (onion, honey, olives) whose removal doesn't change the dish.
//   null    no suitable swap: the dish is left out for this client.
export const REMOVE = '(remove)'
const REDS = /^(grilled steak|lamb, cooked|beef strips|lean minced meat)/
const NUTS = /^(almonds|almond butter|almond flour|cashews|walnuts|mixed nuts)/
const LOCAL_CONDITION_RULES = {
  // Plant protein powder (added to vegan plans) is usually pea protein: a
  // legume, and far too much protein for PKU. Never added for those clients.
  'legume family cross-reactivity': [[/plant protein powder/, null]],
  'phenylketonuria': [[/plant protein powder/, null]],
  // Fatty liver: lower-fat dairy. Feta and labneh are acceptable per the review;
  // cheddar is too fatty, and halloumi has no lower-fat equivalent in the data.
  // Favism: fava beans (the FIT table flagged green beans instead), and falafel,
  // which in Lebanon is often made with fava beans.
  'favism': [[/fava/, null], [/falafel/, null]],
  // IBS (low-FODMAP): onion and honey out, low-FODMAP swaps for apple and wheat.
  'ibs': [
    [/^(onions raw|onions cooked|red onion)$/, REMOVE],
    [/^honey$/, REMOVE],
    [/^apple/, 'Strawberries'],
    [/^bulgur/, 'Quinoa (cooked, plain)'],
    [/^cooked pasta$/, 'Pasta, Gluten Free, boiled'],
    [/^cooked noodles$/, 'Rice noodles, cooked'],
  ],
  // Hypertension: low-salt cheese, no olives, no salty sauces.
  'hypertension': [
    [/^cheese feta$/, 'Cheese Feta, Low-Salt'],
    [/^olives/, REMOVE],
    [/^(teriyaki sauce|caesar dressing)$/, null],
  ],
  // Hyperkalemia: potato dishes out (tomatoes are already in the FIT table).
  'hyperkalemia': [[/potatoes/, null]],
  // Histamine intolerance: aged cheese out, fresh cheese in.
  'histamine intolerance': [[/^cheddar$/, 'Cheese Mozzarella']],
  // Egg allergy: egg noodles become rice noodles.
  'egg allergy': [[/^cooked noodles$/, 'Rice noodles, cooked']],
  // Lactose intolerance: lactose-free cheddar.
  'lactose intolerance': [[/^cheddar$/, 'Cheddar, Lactose-Free']],
  // Gout: no shellfish or red meat (poultry/fish portions are capped separately).
  'gout': [[/^shellfish/, null], [REDS, null]],
  // Wilson's disease: copper-rich foods out.
  "wilson's disease": [
    [/^(peanut butter|salmon|cocoa)$/, null], [/^shellfish/, null], [NUTS, null], [/^mushrooms/, REMOVE],
  ],
  // Kidney stones (oxalate): nuts, peanut butter and cocoa out (spinach is
  // already in the FIT table).
  'kidney stones': [[NUTS, null], [/^almond milk/, null], [/^(peanut butter|cocoa)$/, null]],
  // High triglycerides: no added sugar or sweets, less saturated fat.
  'hypertriglyceridemia': [
    [/^honey$/, REMOVE],
    [/^(dates|granola|coconut oil)/, null],
    [/^cheddar$/, 'Cheese Feta'],
    [/^(greek yogurt full fat|plain greek yogurt)$/, 'Greek Yogurt 0% Fat'],
    [/^milk, full fat$/, 'Milk, half Skimmed'],
    [/^butter$/, 'Butter, Reduced-fat'],
    [/^(lamb, cooked|grilled steak)$/, null],
  ],
  // High cholesterol: lower-fat dairy, no lamb or steak.
  'hypercholesterolemia': [
    [/^cheddar$/, 'Cheese Feta'],
    [/^(greek yogurt full fat|plain greek yogurt)$/, 'Greek Yogurt 0% Fat'],
    [/^milk, full fat$/, 'Milk, half Skimmed'],
    [/^(lamb, cooked|grilled steak)$/, null],
  ],
  // Pancreatitis: low fat — fat-free dairy, no full-fat cheese or butter
  // (fat per option is also capped, see FAT_RULES).
  'pancreatitis': [
    [/^(cheddar|cheese halloum|cream cheese|butter)/, null],
    [/^(greek yogurt full fat|plain greek yogurt)$/, 'Greek Yogurt 0% Fat'],
    [/^milk, full fat$/, 'Milk, half Skimmed'],
  ],
  // Fatty liver: lower-fat dairy, less saturated fat (no coconut oil, so no fat
  // bombs; reduced-fat butter) and red meat cut back to its lean forms (lean
  // minced meat and beef strips stay; steak and lamb go).
  'fatty liver disease': [
    [/^cheddar$/, 'Cheese Feta'],
    [/^cheese halloum/, null],
    [/^greek yogurt full fat$/, 'Greek Yogurt 0% Fat'],
    [/^plain greek yogurt$/, 'Greek Yogurt 0% Fat'],
    [/^milk, full fat$/, 'Milk, half Skimmed'],
    [/^butter$/, 'Butter, Reduced-fat'],
    [/^coconut oil/, null],
    [/^(lamb, cooked|grilled steak)$/, null],
  ],
}
const localRulesFor = (n) => Object.entries(LOCAL_CONDITION_RULES)
  .flatMap(([tok, rules]) => rules.filter(([re]) => re.test(n)).map(([, alt]) => ({ tok, alt })))

// Every restriction an ingredient is unsuitable for: the FIT table's, plus ours.
function restrictionsOf(name, listed = entryFor(name)?.restrictions || []) {
  const n = norm(name)
  const local = [
    ...Object.keys(LOCAL_ALLERGENS).filter((tok) => LOCAL_ALLERGENS[tok](n)),
    ...localRulesFor(n).map((r) => r.tok),
  ]
  return local.length ? [...new Set([...listed, ...local])] : listed
}

/** True when the named ingredient breaks none of the client's restrictions. */
export function isSafeFor(name, tokens) {
  return !restrictionsOf(name).some((tok) => tokens.has(tok))
}

// Candidate swaps for an ingredient: our condition swaps for the restrictions
// it breaks, then the FIT table's designed alternatives.
function alternativesOf(name, entry, violated) {
  const local = localRulesFor(norm(name))
    .filter((r) => r.alt && r.alt !== REMOVE && violated.includes(r.tok))
    .map((r) => ({ name: r.alt, restrictions: entryFor(r.alt)?.restrictions || [] }))
  return [...local, ...(entry?.alternatives || [])]
}

// ── Foods to avoid ───────────────────────────────────────────────────────────
// Dislikes are picked as exact catalog names ("Almonds", "Eggs, whole"), but a
// client who avoids almonds means almond milk and almond butter too. So each
// dislike is reduced to its food — the name before the first comma, minus
// cooking/portion words, singular — and any ingredient naming that food matches.
// "Black beans" stays black beans; "Fish, salmon" means salmon, not all fish.
const QUALIFIERS = new Set(['whole', 'cooked', 'raw', 'boiled', 'grilled', 'baked', 'roasted', 'steamed', 'fried',
  'fresh', 'frozen', 'dried', 'canned', 'drained', 'or', 'and', 'with', 'without', 'plain', 'unsweetened', 'small',
  'medium', 'large', 'full', 'fat', 'low', 'free', 'skimmed', 'half', 'reduced', 'light', 'lean', 'skinless', 'skin',
  'breast', 'thigh', 'fillet', 'strip', 'slice', 'sliced', 'minced', 'ground', 'chopped', 'scrambled', 'unpeeled'])
// Generic heads that need the next part of the name to say which food it is.
const CATEGORY_HEADS = new Set(['fish', 'shellfish', 'oil', 'cheese'])
// One-word foods that plant products borrow ("almond milk" is not milk).
const BORROWED = new Set(['milk', 'butter', 'cream', 'yogurt', 'latte', 'cheese', 'flour'])
// Words that make a different food of the same name (sweet potato ≠ potato).
const DISTINCT = new Set(['sweet'])

const singular = (w) => (w.endsWith('ies') ? `${w.slice(0, -3)}y`
  : w.endsWith('oes') ? w.slice(0, -2)
    : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
export const foodWords = (text) => norm(text).replace(/[^a-z\u00c0-\u024f\s]/g, ' ').split(/\s+/).filter(Boolean).map(singular)

function dislikeKey(name) {
  const segments = norm(name).split(',').map((s) => foodWords(s))
  let words = segments[0] || []
  if (words.length === 1 && CATEGORY_HEADS.has(words[0]) && segments[1]) words = [...words, ...segments[1]]
  words = words.filter((w) => !QUALIFIERS.has(w))
  // "Fish, salmon" → salmon: the generic word goes once something specific remains.
  const specific = words.filter((w) => w !== 'fish' && w !== 'shellfish')
  return specific.length ? specific : words
}

// Whole food families a client can avoid in one pick ("All fish") instead of
// choosing each fish. Stored in dislikes under `id`, like any other pick; the
// pattern is tested against ingredient names, dish names and the food groups
// page's items. Peanuts are not in "All nuts" (a legume, and its own allergy).
export const AVOID_GROUPS = [
  { id: 'All fish', ar: 'كل أنواع السمك', hint: 'Salmon, tuna, white fish', hintAr: 'السلمون، التونة، السمك الأبيض',
    match: /\b(fish|salmon|tuna|cod|sardines?|mackerel|tilapia|sea ?bass|trout|anchov(y|ies)|hammour|seafood)\b/ },
  { id: 'All shellfish', ar: 'كل ثمار البحر', hint: 'Shrimp, crab, calamari', hintAr: 'القريدس، السلطعون، الحبار',
    match: /\b(shellfish|shrimps?|prawns?|crabs?|lobsters?|mussels?|clams?|oysters?|scallops?|squid|calamari|octopus|seafood)\b/ },
  { id: 'All red meat', ar: 'كل اللحوم الحمراء', hint: 'Beef, steak, lamb, minced meat', hintAr: 'لحم البقر، الستيك، الغنم، اللحم المفروم',
    match: /\b(beef|steaks?|lamb|veal|mutton|goat|minced meat|red meat)\b/ },
  { id: 'All poultry', ar: 'كل أنواع الدواجن', hint: 'Chicken, turkey', hintAr: 'الدجاج، الحبش',
    match: /\b(chicken|turkey|duck|poultry)\b/ },
  { id: 'All nuts', ar: 'كل المكسرات', hint: 'Almonds, walnuts, cashews', hintAr: 'اللوز، الجوز، الكاجو',
    match: /\b(nuts?|almonds?|walnuts?|cashews?|pistachios?|hazelnuts?|pecans?|macadamias?)\b/ },
]
export const avoidGroup = (id) => AVOID_GROUPS.find((g) => g.id === id)

/** (name) => true when the named food or ingredient is one the client avoids. */
export function makeDislikeMatcher(dislikes = []) {
  const groups = dislikes.map(avoidGroup).filter(Boolean)
  const keys = dislikes.filter((d) => !avoidGroup(d)).map(dislikeKey).filter((k) => k.length)
  if (!keys.length && !groups.length) return () => false
  return (name) => {
    if (!name) return false
    if (groups.some((g) => g.match.test(norm(name)))) return true
    const have = new Set(foodWords(name))
    return keys.some((key) => key.every((w) => have.has(w))
      && !(key.length === 1 && BORROWED.has(key[0]) && PLANT_BASED.test(norm(name)))
      && ![...DISTINCT].some((w) => have.has(w) && !key.includes(w)))
  }
}

// Swap the unsuitable ingredients of one option in place (targeted, quantity-
// preserving). Returns { swaps, conflicts } for the option:
//   swaps     – substitutions applied to ingredients that had a safe alternative
//   conflicts – unsuitable items with NO safe alternative (dish is not salvageable)
export function processOption(opt, tokens) {
  const conflicts = (restrs = []) => restrs.filter((tok) => tokens.has(tok))
  const swaps = []
  const blockers = []

  // Composite dishes carry an ingredient list; single-food options don't — for
  // those the dish name itself is the "ingredient" to vet.
  const slots = (opt.ingredients && opt.ingredients.length)
    ? opt.ingredients.map((ing) => ({ get: () => ing.name_en, set: (v) => { ing.name_en = v; ing.name_ar = translateIngredient(v) || '' }, mark: (r) => { ing.substituted = true; ing.sub_reasons = r }, flag: (r) => { ing.conflict_reasons = r }, orig: (v) => { if (!ing.original_en) ing.original_en = v }, remove: () => { ing._remove = true } }))
    : [{ get: () => opt.name_en, set: (v) => { opt.name_en = v; opt.name_ar = translateFood?.(v) || opt.name_ar }, mark: () => {}, flag: () => {}, orig: () => {} }]

  for (const slot of slots) {
    const name = slot.get()
    const entry = entryFor(name)
    const violated = conflicts(restrictionsOf(name, entry?.restrictions || []))
    if (!violated.length) continue
    const safeAlt = alternativesOf(name, entry, violated).find((alt) => conflicts(restrictionsOf(alt.name, alt.restrictions)).length === 0)
    const removable = slot.remove && opt.ingredients.length > 1
      && localRulesFor(norm(name)).some((r) => r.alt === REMOVE && violated.includes(r.tok))
    if (safeAlt) {
      slot.orig(name)
      slot.set(safeAlt.name)
      slot.mark(violated)
      swaps.push({ from: name, to: safeAlt.name, reasons: violated })
    } else if (removable) {
      slot.remove()
      swaps.push({ from: name, to: null, removed: true, reasons: violated })
    } else {
      slot.flag(violated)
      blockers.push({ ingredient: name, reasons: violated })
    }
  }
  if (opt.ingredients?.some((i) => i._remove)) opt.ingredients = opt.ingredients.filter((i) => !i._remove)
  // Keep the dish's name and description true to its new ingredients.
  if (swaps.length && !blockers.length) rewriteDishText(opt, swaps)
  return { swaps, conflicts: blockers }
}

/**
 * Make a plan safe for a client's restrictions, in place:
 *  1. swap unsuitable ingredients for their designed alternative (quantity kept);
 *  2. drop any dish that still contains an unsuitable item with no safe swap,
 *     keeping the meal's other (safe) options — i.e. replace it with a dish that
 *     IS good for the client. A meal is never left empty: if every option is
 *     unsuitable we keep them and report the conflicts for manual editing.
 * The final list is capped at MAX_OPTIONS_PER_MEAL.
 *
 * @returns {{plan, substitutions, replacedOptions, unresolved, tokens}}
 *   substitutions   – swaps applied within kept dishes
 *   replacedOptions – dishes dropped because unfixable (a safe option remained)
 *   unresolved      – conflicts left in kept dishes (only when a whole meal was unfixable)
 */
export function applyDietarySubstitutions(plan, { allergyNames = [], conditionNames = [] } = {}) {
  const tokens = canonicalTokens([...allergyNames, ...conditionNames])
  const substitutions = []
  const replacedOptions = []
  const unresolved = []
  if (!plan?.meals) return { plan, substitutions, replacedOptions, unresolved, tokens: [...tokens] }

  for (const meal of plan.meals) {
    const options = meal.options || []

    // No restrictions: just enforce the option cap and move on.
    if (tokens.size === 0) {
      meal.options = options.slice(0, MAX_OPTIONS_PER_MEAL)
      continue
    }

    const safe = []
    const unsafe = []
    for (const opt of options) {
      const { swaps, conflicts } = processOption(opt, tokens)
      opt._pendingSwaps = swaps
      opt._conflicts = conflicts
      ;(conflicts.length ? unsafe : safe).push(opt)
    }

    // Prefer safe/fixed dishes; drop the unfixable ones. Only fall back to the
    // unfixable ones if the meal would otherwise be empty.
    const kept = (safe.length ? safe : unsafe).slice(0, MAX_OPTIONS_PER_MEAL)
    const keptSet = new Set(kept)

    for (const opt of kept) {
      for (const s of opt._pendingSwaps) substitutions.push({ mealId: meal.id, optionId: opt.id, ...s })
      if (safe.length === 0) {
        for (const c of opt._conflicts) unresolved.push({ mealId: meal.id, optionId: opt.id, ...c })
      }
    }
    for (const opt of options) {
      if (!keptSet.has(opt) && opt._conflicts.length) {
        replacedOptions.push({ mealId: meal.id, dish: opt.name_en, reasons: [...new Set(opt._conflicts.flatMap((c) => c.reasons))] })
      }
    }
    for (const opt of options) { delete opt._pendingSwaps; delete opt._conflicts }

    meal.options = kept
    meal.targetKcal = kept.length ? kept[0].kcal : meal.targetKcal
  }
  return { plan, substitutions, replacedOptions, unresolved, tokens: [...tokens] }
}
