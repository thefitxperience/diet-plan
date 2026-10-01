// The medical conditions and allergies the questionnaires offer, and their
// Arabic labels. These used to come from the FIT API, whose list had stray and
// inconsistent entries ("Mellitus", "Thyroid" next to "Hyperthyroidism"); now
// the list is ours. Only the NAME travels with a plan (the questionnaire's
// conditionNames / allergyNames), and every name here must map to the tokens the
// rules use — canonicalTokens() in dietaryRules, LOCAL_ALLERGENS, and
// RESTRICTION_EXCLUDES in foodGroups. Adding one? Check it maps.

const list = (field, names) => names.map((name) => ({
  [`${field}Id`]: name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, ''),
  [`${field}Name`]: name,
}))

export const CONDITIONS = list('condition', [
  'Cardiovascular Disease', 'Celiac Disease', 'Diabetes', 'Fatty Liver Disease', 'Favism',
  'GERD (Acid Reflux)', 'Gout', 'Hemochromatosis', 'Histamine Intolerance', 'Hypercholesterolemia',
  'Hyperkalemia', 'Hypertension', 'Hyperthyroidism', 'Hypoglycemia', 'IBS', 'Kidney Stones',
  'Lactose Intolerance', 'Pancreatitis', 'Phenylketonuria', 'Thyroid Dysfunction', "Wilson's Disease",
])

export const ALLERGIES = list('allergy', [
  'Egg Allergy', 'Fish Allergy', 'Gluten Sensitivity', 'Latex-Fruit Cross-Reactivity',
  'Legume Family Cross-Reactivity', 'Milk Allergy', 'Nut Allergy', 'Oral Allergy Syndrome',
  'Peanut Allergy', 'Seafood Allergy', 'Sesame Allergy', 'Soy Allergy', 'Wheat Allergy',
])

// Arabic labels, keyed by the exact English name. Older plans carry the FIT
// API's spellings, so those stay here too.

const AR = {
  // conditions
  'Cardiovascular Disease': 'أمراض القلب والأوعية الدموية',
  'Cardiovascular Diseases': 'أمراض القلب والأوعية الدموية',
  'Celiac disease': 'الداء البطني (حساسية القمح)',
  'Chronic Kidney Disease': 'مرض الكلى المزمن',
  'Diabetes': 'السكري',
  'Diabetes Mellitus': 'داء السكري',
  'Fatty Liver Disease': 'مرض الكبد الدهني',
  'Favism': 'التفويل (فقر دم الفول)',
  'GERD': 'ارتجاع المريء',
  'GERD (Acid Reflux)': 'ارتجاع المريء (الحموضة)',
  'Gout': 'النقرس',
  'Hemochromatosis': 'داء ترسّب الأصبغة الدموية',
  'Histamine Intolerance': 'عدم تحمّل الهيستامين',
  'Hypercholesterolemia': 'ارتفاع الكوليسترول',
  'Hyperkalemia': 'ارتفاع بوتاسيوم الدم',
  'hyperkaliemia': 'ارتفاع بوتاسيوم الدم',
  'Hypertension': 'ارتفاع ضغط الدم',
  'Hyperthyroidism': 'فرط نشاط الغدة الدرقية',
  'Hypoglycemia': 'انخفاض سكر الدم',
  'IBS': 'القولون العصبي',
  'Kidney Stones': 'حصى الكلى',
  'Lactose Intolerance': 'عدم تحمّل اللاكتوز',
  'Mellitus': 'السكري',
  'Pancreatitis': 'التهاب البنكرياس',
  'Phenylketonuria': 'بيلة الفينيل كيتون',
  'Thyroid': 'الغدة الدرقية',
  'Thyroid Dysfunction': 'اضطراب الغدة الدرقية',
  'Wilson’s Disease': 'داء ويلسون',
  "Wilson's Disease": 'داء ويلسون',

  // allergies
  'Celiac Disease': 'الداء البطني (حساسية القمح)',
  'Celiac Disease / Gluten Sensitivity': 'الداء البطني / حساسية الغلوتين',
  'Egg Allergy': 'حساسية البيض',
  'Fish Allergy': 'حساسية السمك',
  'Milk Allergy': 'حساسية الحليب',
  'Peanut Allergy': 'حساسية الفول السوداني',
  'Gluten Sensitivity': 'حساسية الغلوتين',
  'Latex-Fruit Cross-Reactivity': 'التفاعل التحسّسي بين اللاتكس والفواكه',
  'Latex-Fruit Syndrome': 'متلازمة اللاتكس والفواكه',
  'Legume Family Cross-Reactivity': 'التحسّس المتصالب للبقوليات',
  'Nut Allergy': 'حساسية المكسرات',
  'Nut allergy': 'حساسية المكسرات',
  'Oral Allergy Syndrome': 'متلازمة حساسية الفم',
  'SeaFood Allergy': 'حساسية المأكولات البحرية',
  'Seafood Allergy': 'حساسية المأكولات البحرية',
  'Sesame Allergy': 'حساسية السمسم',
  'Soy allergy': 'حساسية الصويا',
  'Soy Allergy': 'حساسية الصويا',
  'Wheat Allergy': 'حساسية القمح',
}

// Return the Arabic label in AR mode (falls back to the English name).
export function restrictionLabel(name, lang) {
  return lang === 'ar' ? (AR[name] || name) : name
}
