// FIT generation API client (plan §4). All calls go through the Cloudflare
// Worker proxy (GitHub Pages is HTTPS, the API is HTTP).

const PROXY = import.meta.env.VITE_FIT_PROXY_URL || 'https://fit-proxy.andyayas27.workers.dev'
const BASE = `${PROXY}/rest/s1/fit/dietPlan`

// Known debt (§11): credentials in client JS — move into the Worker later.
const AUTH = 'Basic ' + btoa(
  `${import.meta.env.VITE_FIT_API_USER || 'fit'}:${import.meta.env.VITE_FIT_API_PASS || 'Fit@2024'}`
)

const HEADERS = { 'Content-Type': 'application/json', Authorization: AUTH }

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`)
  return res.json()
}

let lookupsCache = null

export async function fetchLookups() {
  if (lookupsCache) return lookupsCache
  const [dietaryTypes, activities, conditions, allergies, planTypes, planSecondaryTypes] =
    await Promise.all([
      get('/dietaryType'), get('/activity'), get('/condition'),
      get('/allergy'), get('/planType'), get('/planSecondaryType'),
    ])
  lookupsCache = {
    dietaryTypes: dietaryTypes.dietaryTypeList || [],
    activities: activities.activityList || [],
    conditions: conditions.conditionList || [],
    allergies: allergies.allergyList || [],
    planTypes: planTypes.planTypeList || [],
    planSecondaryTypes: planSecondaryTypes.planSecondaryTypeList || [],
  }
  return lookupsCache
}

export async function generatePlan(payload) {
  const res = await fetch(`${BASE}/v3/generate`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Generate failed: ${res.status} — ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

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

const DIETARY_DISPLAY = {
  halal: 'Halal-friendly',
  keto: 'Low-carb high-fat',
  kosher: 'Kosher-friendly',
  omnivore: 'Balanced diet',
  pescatarian: 'Fish-based vegetarian',
  vegan: 'Strict plant-based',
  vegetarian: 'Plant-based with dairy & eggs',
}

const DIETARY_AR = {
  'Halal-friendly': 'حلال',
  'Low-carb high-fat': 'قليل الكربوهيدرات عالي الدهون (كيتو)',
  'Kosher-friendly': 'كوشير',
  'Balanced diet': 'نظام متوازن',
  'Fish-based vegetarian': 'نباتي مع الأسماك',
  'Strict plant-based': 'نباتي صِرف',
  'Plant-based with dairy & eggs': 'نباتي مع الألبان والبيض',
}

export function dietaryDisplayName(name, lang) {
  const lower = (name || '').toLowerCase()
  for (const [key, label] of Object.entries(DIETARY_DISPLAY)) {
    if (lower.includes(key)) return lang === 'ar' ? (DIETARY_AR[label] || label) : label
  }
  return name
}

// Conditions/allergies hidden in the demo questionnaire
export const EXCLUDED_CONDITIONS = [
  'Cardiovascular Diseases', 'Diabetes', 'Nut allergy', 'Thyroid Dysfunction',
  'GERD (Acid Reflux)', 'hyperkaliemia', 'Oral Allergy Syndrome', 'Chronic Kidney Disease',
]
export const EXCLUDED_ALLERGIES = [
  'Phenylketonuria', 'Celiac Disease', 'Celiac Disease / Gluten Sensitivity', 'Latex-Fruit Syndrome',
]

// Goal & plan-style radios map onto API plan types by keyword (demo logic)
export const GOAL_KEYWORDS = {
  maintain: ['maintenance', 'maintain'],
  lose: ['weight loss', 'lose', 'fat loss'],
  gain: ['weight gain', 'gain', 'muscle gain'],
}
export const GOAL_LABELS = { maintain: 'Maintenance', lose: 'Weight Loss', gain: 'Weight Gain' }

export const PLAN_STYLE_KEYWORDS = {
  normal: ['default', 'normal', 'regular', 'standard'],
  if: ['intermittent fasting', 'if', 'fasting'],
}

export function matchTypeId(list, keywords, idField, nameField = 'typeName') {
  const m = list.find((t) => keywords.some((k) => (t[nameField] || '').toLowerCase().includes(k)))
  return m ? m[idField] : null
}

export function calcAge(dateOfBirth) {
  if (!dateOfBirth) return 0
  const birth = new Date(dateOfBirth)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}
