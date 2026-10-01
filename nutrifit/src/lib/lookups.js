// The questionnaire's option lists — diet types, activity levels, goals and
// plan styles — and their display helpers. These were fetched from the FIT API
// on every page load; they are fixed, so they live here now and the app no
// longer calls that API at all. (Conditions and allergies: restrictionNames.)
//
// The ids are the API's own, kept identical so saved questionnaires and the
// meal catalog's diet tags still line up: dietaryTypeId is matched against each
// dish's `diets`, and the generator reads secondaryTypeId === 'IntermittentFasting'.

const ids = (field, values) => values.map((v) => ({ [`${field}Id`]: v, [`${field}Name`]: v }))

export const DIETARY_TYPES = ids('dietaryType', ['Halal', 'Keto', 'Kosher', 'Omnivore', 'Pescatarian', 'Vegan', 'Vegetarian'])

// Descriptions carry the keywords the helpers below read (multiplier, display
// name, order). The editor reads the id as words ("Alt Moderately Active").
export const ACTIVITIES = [
  { enumId: 'AltSedentary', description: 'Sedentary' },
  { enumId: 'AltLightlyActive', description: 'Lightly Active' },
  { enumId: 'AltModeratelyActive', description: 'Moderately Active' },
  { enumId: 'AltVeryActive', description: 'Very Active' },
  { enumId: 'AltExtraActive', description: 'Extra Active' },
]

// ── Display-name mappings ported from the demo ───────────────────────

export const ACTIVITY_MULTIPLIERS = {
  'extra active': 1.75,
  'very active': 1.575,
  sedentary: 1.05,
  light: 1.2,
  lightly: 1.2,
  moderate: 1.3,
  active: 1.75,
}

const ACTIVITY_DISPLAY = [
  ['highly active', 'Peak Performance (Hard exercise, sports, or physically demanding activity 6–7 days per week)'],
  ['extra active', 'Peak Performance (Hard exercise, sports, or physically demanding activity 6–7 days per week)'],
  ['very active', 'Committed Intense (Exercise 5–6 days per week)'],
  ['moderately active', 'Consistent Moderate (Exercise 3–4 days per week)'],
  ['moderate', 'Consistent Moderate (Exercise 3–4 days per week)'],
  ['lightly active', 'Building Momentum (Light exercise or physical activity 1–2 days per week)'],
  ['light', 'Building Momentum (Light exercise or physical activity 1–2 days per week)'],
  ['sedentary', 'Getting Started (Very little or no exercise)'],
]

const ACTIVITY_ORDER = ['sedentary', 'light', 'lightly active', 'moderate', 'moderately active', 'very active', 'highly active', 'extra active']

// Arabic for each distinct activity display label.
const ACTIVITY_AR = {
  'Peak Performance (Hard exercise, sports, or physically demanding activity 6–7 days per week)':
    'الأداء الأقصى (تمارين شاقة أو رياضة أو نشاط بدني مكثّف ٦–٧ أيام في الأسبوع)',
  'Committed Intense (Exercise 5–6 days per week)':
    'التزام مكثّف (تمارين ٥–٦ أيام في الأسبوع)',
  'Consistent Moderate (Exercise 3–4 days per week)':
    'نشاط معتدل منتظم (تمارين ٣–٤ أيام في الأسبوع)',
  'Building Momentum (Light exercise or physical activity 1–2 days per week)':
    'بناء الزخم (تمارين خفيفة أو نشاط بدني ١–٢ يوم في الأسبوع)',
  'Getting Started (Very little or no exercise)':
    'بداية الطريق (تمارين قليلة جداً أو بدون)',
}

export function activityDisplayName(description, lang) {
  const desc = (description || '').toLowerCase()
  for (const [key, label] of ACTIVITY_DISPLAY) {
    if (desc.includes(key)) return lang === 'ar' ? (ACTIVITY_AR[label] || label) : label
  }
  return description
}

// Splits "Peak Performance (Hard exercise …)" into { label, desc } for the
// intake's chip picker; desc is '' when the label has no bracketed detail.
export function activityInfo(description, lang) {
  const full = activityDisplayName(description, lang) || ''
  const m = full.match(/^(.*?)\s*\((.*)\)$/)
  return m ? { label: m[1], desc: m[2] } : { label: full, desc: '' }
}

export function sortActivities(activities) {
  const idx = (d) => {
    const i = ACTIVITY_ORDER.findIndex((k) => (d || '').toLowerCase().includes(k))
    return i === -1 ? 999 : i
  }
  return [...activities].sort((a, b) => idx(a.description) - idx(b.description))
}

export function activityMultiplier(activity) {
  const desc = (activity?.description || '').toLowerCase()
  for (const key of Object.keys(ACTIVITY_MULTIPLIERS)) {
    if (desc.includes(key)) return ACTIVITY_MULTIPLIERS[key]
  }
  return null
}

// Matched by keyword against dietaryTypeName. Order here is the order
// the intake shows them in. `desc` is the one-liner shown to clients under the name.
const DIETARY_DISPLAY = [
  ['halal', {
    en: { label: 'Halal', desc: 'Meat and poultry prepared to Islamic guidelines. No pork or alcohol.' },
    ar: { label: 'حلال', desc: 'لحوم ودواجن مذبوحة وفق الشريعة الإسلامية، بدون لحم الخنزير أو الكحول.' },
  }],
  ['keto', {
    en: { label: 'Keto', desc: 'Very low in carbs, high in healthy fats, with moderate protein.' },
    ar: { label: 'كيتو', desc: 'منخفض جداً بالكربوهيدرات، غني بالدهون الصحية، مع كمية معتدلة من البروتين.' },
  }],
  ['kosher', {
    en: { label: 'Kosher', desc: 'Follows Jewish dietary laws. No pork or shellfish; meat and dairy kept apart.' },
    ar: { label: 'كوشير', desc: 'يتبع قواعد الطعام اليهودية، بدون لحم الخنزير أو القشريات، مع فصل اللحوم عن الألبان.' },
  }],
  ['omnivore', {
    en: { label: 'Omnivore', desc: 'Eats everything: meat, fish, dairy, eggs and plant foods.' },
    ar: { label: 'نظام شامل', desc: 'يشمل جميع الأطعمة: اللحوم والأسماك والألبان والبيض والأطعمة النباتية.' },
  }],
  ['pescatarian', {
    en: { label: 'Pescatarian', desc: 'Vegetarian plus fish and seafood. No meat or poultry.' },
    ar: { label: 'نباتي مع الأسماك', desc: 'نظام نباتي مع الأسماك والمأكولات البحرية، بدون لحوم أو دواجن.' },
  }],
  ['vegan', {
    en: { label: 'Vegan', desc: 'Fully plant-based. No meat, fish, dairy, eggs or honey.' },
    ar: { label: 'نباتي صِرف', desc: 'نباتي بالكامل، بدون لحوم أو أسماك أو ألبان أو بيض أو عسل.' },
  }],
  ['vegetarian', {
    en: { label: 'Vegetarian', desc: 'No meat, poultry or fish. Includes dairy and eggs.' },
    ar: { label: 'نباتي', desc: 'بدون لحوم أو دواجن أو أسماك، ويشمل الألبان والبيض.' },
  }],
]

function dietaryEntry(name) {
  const lower = (name || '').toLowerCase()
  const i = DIETARY_DISPLAY.findIndex(([key]) => lower.includes(key))
  return i === -1 ? null : { index: i, text: DIETARY_DISPLAY[i][1] }
}

// { label, desc } for a diet type; desc is '' for a type we have no copy for.
export function dietaryInfo(name, lang) {
  const e = dietaryEntry(name)
  if (!e) return { label: name, desc: '' }
  return e.text[lang === 'ar' ? 'ar' : 'en']
}

export function dietaryDisplayName(name, lang) {
  return dietaryInfo(name, lang).label
}

export function sortDietaryTypes(types) {
  const idx = (t) => dietaryEntry(t.dietaryTypeName)?.index ?? 999
  return [...types].sort((a, b) => idx(a) - idx(b))
}

// Order is the order goals are offered in. These are the clinical names shown
// on the PDF and staff screens; the intake uses the client-facing wizard.goal.*.
export const GOAL_LABELS = { maintain: 'Maintenance', lose: 'Weight Loss', recomp: 'Body Recomposition', gain: 'Weight Gain' }
export const GOALS = Object.keys(GOAL_LABELS)

// The API's plan-type ids, recorded on the questionnaire for continuity. There
// is no recomposition type, so Shape Up records Maintenance.
export const PLAN_TYPE_IDS = { maintain: 'Maintenance', lose: 'WeightLoss', recomp: 'Maintenance', gain: 'WeightGain' }
export const PLAN_STYLE_IDS = { normal: 'Default', if: 'IntermittentFasting' }

export function calcAge(dateOfBirth) {
  if (!dateOfBirth) return 0
  const birth = new Date(dateOfBirth)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}
