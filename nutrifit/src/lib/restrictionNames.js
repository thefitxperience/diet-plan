// Arabic labels for the medical-condition / allergy names that come from the
// FIT API lookups (the API only returns English). Keyed by the exact English
// name (conditionName / allergyName). Used to render the questionnaire in AR.

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
  'Gluten Sensitivity': 'حساسية الغلوتين',
  'Latex-Fruit Cross-Reactivity': 'التفاعل التحسّسي بين اللاتكس والفواكه',
  'Latex-Fruit Syndrome': 'متلازمة اللاتكس والفواكه',
  'Legume Family Cross-Reactivity': 'التحسّس المتصالب للبقوليات',
  'Nut Allergy': 'حساسية المكسرات',
  'Nut allergy': 'حساسية المكسرات',
  'Oral Allergy Syndrome': 'متلازمة حساسية الفم',
  'SeaFood Allergy': 'حساسية المأكولات البحرية',
  'Sesame Allergy': 'حساسية السمسم',
  'Soy allergy': 'حساسية الصويا',
  'Wheat Allergy': 'حساسية القمح',
}

// Return the Arabic label in AR mode (falls back to the English name).
export function restrictionLabel(name, lang) {
  return lang === 'ar' ? (AR[name] || name) : name
}
