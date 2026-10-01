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

function entryFor(name) {
  return data.ingredients[norm(name)] || null
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

// Every restriction an ingredient is unsuitable for: the FIT table's, plus ours.
function restrictionsOf(name, listed = entryFor(name)?.restrictions || []) {
  const n = norm(name)
  const local = Object.keys(LOCAL_ALLERGENS).filter((tok) => LOCAL_ALLERGENS[tok](n))
  return local.length ? [...listed, ...local] : listed
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

/** (name) => true when the named food or ingredient is one the client avoids. */
export function makeDislikeMatcher(dislikes = []) {
  const keys = dislikes.map(dislikeKey).filter((k) => k.length)
  if (!keys.length) return () => false
  return (name) => {
    if (!name) return false
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
    ? opt.ingredients.map((ing) => ({ get: () => ing.name_en, set: (v) => { ing.name_en = v; ing.name_ar = translateIngredient(v) || '' }, mark: (r) => { ing.substituted = true; ing.sub_reasons = r }, flag: (r) => { ing.conflict_reasons = r }, orig: (v) => { if (!ing.original_en) ing.original_en = v } }))
    : [{ get: () => opt.name_en, set: (v) => { opt.name_en = v; opt.name_ar = translateFood?.(v) || opt.name_ar }, mark: () => {}, flag: () => {}, orig: () => {} }]

  for (const slot of slots) {
    const name = slot.get()
    const entry = entryFor(name)
    const violated = conflicts(restrictionsOf(name, entry?.restrictions || []))
    if (!violated.length) continue
    const safeAlt = (entry?.alternatives || []).find((alt) => conflicts(restrictionsOf(alt.name, alt.restrictions)).length === 0)
    if (safeAlt) {
      slot.orig(name)
      slot.set(safeAlt.name)
      slot.mark(violated)
      swaps.push({ from: name, to: safeAlt.name, reasons: violated })
    } else {
      slot.flag(violated)
      blockers.push({ ingredient: name, reasons: violated })
    }
  }
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
