// Personalises the PDF's "Food groups to build from" page. The content in
// deepfitGuidelines.js is written for everyone; this leaves out each food the
// client can't or won't eat — by diet, allergy, a few clear-cut conditions, and
// their foods to avoid — so the page never recommends eggs to an egg allergy or
// chicken to a vegetarian.
//
// An item can name several foods ("Zucchini, eggplant"); each food is judged on
// its own and the item keeps the rest ("Zucchini"). The Arabic item is split the
// same way — the dictionary entries list the foods in the same order.

import { canonicalTokens, makeDislikeMatcher } from './dietaryRules'

// What each food on the page is, keyed by the food's English text (lowercase).
const FOOD_TAGS = {
  'eggs': ['egg', 'animal'],
  'egg whites': ['egg', 'animal'],
  'chicken': ['meat', 'animal'],
  'turkey': ['meat', 'animal'],
  'beef': ['meat', 'purine', 'animal'],
  'steak': ['meat', 'purine', 'animal'],
  'salmon': ['fish', 'animal'],
  'tuna': ['fish', 'animal'],
  'white fish': ['fish', 'animal'],
  'fatty fish': ['fish', 'animal'],
  'shrimp': ['shellfish', 'purine', 'animal'],
  'seafood': ['shellfish', 'fish', 'purine', 'animal'],
  'greek yogurt': ['dairy', 'animal'],
  'labneh': ['dairy', 'animal'],
  'cottage cheese': ['dairy', 'animal'],
  'cheese (non-processed)': ['dairy', 'animal'],
  'lentils': ['legume', 'highcarb', 'fodmap'],
  'chickpeas': ['legume', 'highcarb', 'fodmap'],
  'beans': ['legume', 'fava', 'highcarb', 'fodmap', 'potassium'],
  'tofu': ['legume', 'soy'],
  'tempeh': ['legume', 'soy'],
  'edamame': ['legume', 'soy'],
  'quinoa': ['highcarb'],
  'nuts': ['nuts'],
  'seeds': ['sesame'],
  'nut butters': ['nuts', 'peanut'],
  'rice (white, brown, black)': ['highcarb'],
  'potatoes': ['highcarb', 'potassium'],
  'sweet potatoes': ['highcarb', 'potassium'],
  'bulgur': ['highcarb', 'gluten', 'wheat'],
  'oats': ['highcarb', 'gluten'],
  'pasta (moderate portions)': ['highcarb', 'gluten', 'wheat'],
  'whole-grain bread': ['highcarb', 'gluten', 'wheat'],
  'avocado': ['potassium', 'latex'],
  'spinach': ['potassium'],
  'cauliflower': ['fodmap'],
  'mushrooms': ['fodmap'],
  'tomatoes': ['potassium'],
  'onions': ['fodmap'],
  'garlic': ['fodmap'],
  'apples': ['fodmap', 'highcarb'],
  'pears': ['fodmap', 'highcarb'],
  'oranges': ['potassium', 'highcarb'],
  'mandarins': ['highcarb'],
  'banana': ['potassium', 'latex', 'highcarb'],
  'mango': ['fodmap', 'highcarb'],
  'pineapple': ['highcarb'],
  'grapes': ['highcarb'],
  'cherries': ['fodmap', 'highcarb'],
  'melon': ['highcarb'],
}

// Tags each diet rules out. Halal and Omnivore rule out nothing on this page.
const DIET_EXCLUDES = {
  Vegan: ['animal'],
  Vegetarian: ['meat', 'fish', 'shellfish'],
  Pescatarian: ['meat'],
  Keto: ['highcarb'],
  Kosher: ['shellfish'],
}

// Tags each allergy / condition rules out (canonical tokens, see canonicalTokens).
// Conditions are limited to clear-cut food rules; the rest are the dietitian's.
const RESTRICTION_EXCLUDES = {
  'egg allergy': ['egg'],
  'seafood allergy': ['fish', 'shellfish'],
  'fish allergy': ['fish'],
  'milk allergy': ['dairy'],
  'nut allergy': ['nuts'],
  'peanut allergy': ['peanut'],
  'sesame allergy': ['sesame'],
  'soy allergy': ['soy'],
  'wheat allergy': ['wheat'],
  'gluten sensitivity': ['gluten'],
  'celiac disease': ['gluten'],
  'legume family cross-reactivity': ['legume'],
  'latex-fruit cross-reactivity': ['latex'],
  'latex-fruit syndrome': ['latex'],
  'gout': ['purine'],
  'favism': ['fava'],
  'hyperkalemia': ['potassium'],
  'ibs': ['fodmap'],
  'hyperthyroidism': ['shellfish'],
}

const EN_SEP = /(, | \/ | & )/
const AR_SEP = /(، | \/ | و)/

// [{ text, sep }] — the separator is the one that preceded this food.
function splitItem(text, sepRe) {
  if (text.includes('(')) return [{ text, sep: '' }] // "Rice (white, brown, black)" is one food
  const bits = text.split(sepRe)
  const parts = [{ text: bits[0], sep: '' }]
  for (let i = 1; i < bits.length; i += 2) parts.push({ text: bits[i + 1], sep: bits[i] })
  return parts
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * @param restrictions {diet, allergies, conditions, dislikes} — plan.restrictions
 * @param arItems      plan-ar.json listItems (English item → Arabic)
 * @returns {groups, vegFruit} with every item as { en, ar }, or null when the
 *          plan carries no restrictions (callers keep the generic page).
 */
export function personaliseFoodGroups(groups, vegFruit, restrictions, arItems = {}) {
  if (!restrictions) return null
  const excluded = new Set(DIET_EXCLUDES[restrictions.diet] || [])
  for (const tok of canonicalTokens([...(restrictions.allergies || []), ...(restrictions.conditions || [])])) {
    for (const tag of RESTRICTION_EXCLUDES[tok] || []) excluded.add(tag)
  }
  const avoids = makeDislikeMatcher(restrictions.dislikes || [])
  const keep = (food) => !avoids(food)
    && !(FOOD_TAGS[food.toLowerCase()] || []).some((tag) => excluded.has(tag))

  const personalise = (item) => {
    if (!item) return null
    const ar = arItems[item] || item
    const en = splitItem(item, EN_SEP)
    const kept = en.map((p) => keep(p.text))
    if (kept.every(Boolean)) return { en: item, ar }
    if (!kept.some(Boolean)) return null
    const arParts = splitItem(ar, AR_SEP)
    // Unexpected dictionary shape: drop the whole item rather than mistranslate.
    if (arParts.length !== en.length) return null
    const rebuild = (parts) => parts.filter((_, i) => kept[i])
      .map((p, i) => (i === 0 ? p.text : `${p.sep}${p.text}`)).join('')
    return { en: capitalise(rebuild(en)), ar: rebuild(arParts) }
  }

  const items = (list) => list.map(personalise).filter(Boolean)
  return {
    groups: groups
      .map((g) => {
        const list = items(g.items)
        // The design keeps each card's two item columns even.
        return { ...g, items: list.length % 2 ? [...list, null] : list }
      })
      .filter((g) => g.items.some(Boolean)),
    vegFruit: {
      ...vegFruit,
      columns: vegFruit.columns.map((c) => ({ ...c, items: items(c.items) })).filter((c) => c.items.length),
    },
  }
}

/** plan.restrictions, or the same thing rebuilt from the plan's questionnaire
 *  for plans generated before plans carried it. */
export function planRestrictions(plan, questionnaire) {
  if (plan?.restrictions) return plan.restrictions
  if (!questionnaire) return null
  return {
    diet: questionnaire.dietaryTypeId || '',
    allergies: questionnaire.allergyNames || [],
    conditions: questionnaire.conditionNames || [],
    dislikes: questionnaire.dislikes || [],
  }
}
