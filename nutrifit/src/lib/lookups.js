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

// Multipliers on the InBody BMR. Calibrated on Maya Mouawad's review of 50
// plans (10.2026): the lower three levels were too low (10 clients she found
// underestimated) and "very active" a little high. Close to the standard
// factors (1.2 / 1.375 / 1.55 / 1.725 / 1.9), lower at the top, where
// self-reported activity tends to run high.
export const ACTIVITY_MULTIPLIERS = {
  'extra active': 1.7,
  'very active': 1.55,
  sedentary: 1.25,
  light: 1.375,
  lightly: 1.375,
  moderate: 1.45,
  active: 1.7,
}

const ACTIVITY_DISPLAY = [
  ['highly active', 'Peak Performance (Hard training every day like an athlete, or hard exercise plus a physical job)'],
  ['extra active', 'Peak Performance (Hard training every day like an athlete, or hard exercise plus a physical job)'],
  ['very active', 'Committed Intense (Hard exercise 5 to 6 days a week, or a physically demanding job)'],
  ['moderately active', 'Consistent Moderate (Exercise 3 to 4 days a week, or on your feet and moving most of the day)'],
  ['moderate', 'Consistent Moderate (Exercise 3 to 4 days a week, or on your feet and moving most of the day)'],
  ['lightly active', 'Building Momentum (Light exercise 1 to 2 days a week, or on your feet for part of the day)'],
  ['light', 'Building Momentum (Light exercise 1 to 2 days a week, or on your feet for part of the day)'],
  ['sedentary', 'Getting Started (Little or no exercise, and sitting most of the day, like a desk job)'],
]

const ACTIVITY_ORDER = ['sedentary', 'light', 'lightly active', 'moderate', 'moderately active', 'very active', 'highly active', 'extra active']

// Arabic for each distinct activity display label. The brackets count daily
// movement as well as exercise (review, Maya Mouawad: a job on your feet
// burns more than a desk job), so clients pick the level that fits their day.
const ACTIVITY_AR = {
  'Peak Performance (Hard training every day like an athlete, or hard exercise plus a physical job)':
    'الأداء الأقصى (تدريب قوي يوميًا مثل الرياضيين، أو تمارين قوية مع عمل يتطلب جهدًا بدنيًا)',
  'Committed Intense (Hard exercise 5 to 6 days a week, or a physically demanding job)':
    'التزام مكثّف (تمارين قوية ٥ إلى ٦ أيام في الأسبوع، أو عمل يتطلب جهدًا بدنيًا)',
  'Consistent Moderate (Exercise 3 to 4 days a week, or on your feet and moving most of the day)':
    'نشاط معتدل منتظم (تمارين ٣ إلى ٤ أيام في الأسبوع، أو الوقوف والحركة معظم اليوم)',
  'Building Momentum (Light exercise 1 to 2 days a week, or on your feet for part of the day)':
    'بناء الزخم (تمارين خفيفة يومًا أو يومين في الأسبوع، أو الوقوف جزءًا من اليوم)',
  'Getting Started (Little or no exercise, and sitting most of the day, like a desk job)':
    'بداية الطريق (تمارين قليلة أو بدون، مع الجلوس معظم اليوم مثل العمل المكتبي)',
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
