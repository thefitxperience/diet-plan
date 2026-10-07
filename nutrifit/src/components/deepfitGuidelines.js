// Static content for the client-facing plan PDF (pages 5–6 and the page-1
// blurbs), shaped for the UDRA six-page design.
//
// ── Why entries carry both `key` and `en` ────────────────────────────────────
// The Arabic dictionary (plan-ar.json) is keyed on the ENGLISH STRING, so every
// key below must stay byte-identical or the translation silently falls back to
// English. The UDRA design sets headings in sentence case where the old
// template used all-caps, so `key` is what we look up and `en` is what we print
// in English. Never "tidy" a `key`; change `en` instead.
//
// Body copy has no `en` twin — it is printed as-is in English and is itself the
// dictionary key.

/** Title whose Arabic lookup differs from its English presentation. */
const titled = (key, en) => ({ key, en })

// ── Page 1 ───────────────────────────────────────────────────────────────────

export const DIET_INTRO =
  'Welcome to your personalized diet plan! This guide provides a structured approach to healthy eating, offering several options for every meal and snack so you receive a balanced intake of proteins, carbohydrates, and healthy fats. Choose the options that best fit your preferences and dietary needs.'

// Shorter explainer that sits under the diet type on page 1. The full
// DIET_INTRO above is too long for the panel the design gives it.
export const DIET_TYPE_NOTE =
  'Every meal below carries several calorie-matched options: choose whichever suits your appetite and schedule.'

// ── Page 5 — how to use your plan ────────────────────────────────────────────

export const ABOUT_SECTION = titled('ABOUT THE PLAN', 'About the plan')

export const ABOUT_BLOCKS = [
  {
    ...titled('Meal Flexibility & Personalization', 'Meal flexibility & personalisation'),
    body: 'This meal plan is designed to give you flexibility while still helping you achieve your daily nutrition goals. The options within each meal are matched on calories, so whichever one you choose keeps your day on track. Their protein, carbohydrate and fat split can still differ a little, which lets you pick what suits your appetite, activity and schedule — a higher-protein breakfast after a workout, or something lighter on a less active day. What matters most is your overall daily intake rather than identical macronutrients at every meal. Feel free to mix and match your choices throughout the day.',
  },
  {
    ...titled('Non-Starchy Vegetables', 'Non-starchy vegetables'),
    body: 'Non-starchy vegetables are encouraged with every meal — aim for roughly 2 to 4 cups (about 200–400 g) spread across the day. They are naturally low in calories and rich in fiber, vitamins, minerals, and antioxidants, helping improve fullness, digestion, and overall health. Choose them fresh, steamed, boiled, grilled, roasted, or air-fried. Season freely with herbs, spices, lemon juice, or vinegar. Any oil you add is not included in your meal calorie totals, so keep it to no more than 1 tsp (about 5 g) of olive oil and count it toward your daily intake.',
  },
  {
    ...titled('Swapping Meals & Ingredients', 'Swapping meals & ingredients'),
    body: 'The options within each meal are matched on calories, so you can choose whichever you prefer without changing your daily total. If an ingredient is unavailable, replace it with a similar item from the same group — for example, one lean protein for another, or one complex carbohydrate for another — in a similar portion. Unless stated otherwise, listed weights refer to cooked portions, and any oils, sauces, or dressings named in a meal are already included in its calorie total; extras you add on your own are not. To swap a whole meal, pick another option from the same category to keep your intended daily intake.',
  },
]

export const GUIDELINES_SECTION = titled(
  'DAILY NUTRITION & LIFESTYLE GUIDELINES',
  'Daily nutrition & lifestyle guidelines',
)

export const GUIDELINES_INTRO =
  'These guidelines are general nutrition guidance rather than instructions written for you individually, so some of it may need to be adapted to your own circumstances. They are here to support your meal plan through daily habits that improve energy, digestion, recovery, and long-term health. If anything should be different in your case, your dietitian will tell you.'

export const HYDRATION = {
  ...titled('Hydration', 'Hydration'),
  note: 'Proper hydration supports digestion, appetite regulation, energy levels, skin health, and mental focus.',
  // Rendered with a zero-padded mono index (01, 02…) — the numbering is design,
  // so it is not part of the string.
  steps: [
    'Upon waking: 1 glass of water.',
    'Morning: 1–2 glasses between breakfast and lunch.',
    'Afternoon: 1–2 glasses between lunch and dinner.',
    'Evening: 1 glass, stopping at least 1 hour before bed.',
    'Daily target: Women 1.8–2.2 L / Men 2.2–2.8 L.',
  ],
}

export const PROTEIN = {
  ...titled('Protein Intake', 'Protein intake'),
  note: 'Protein supports muscle preservation, metabolism, blood sugar balance, and satiety. Aim for approximately 1.2 to 1.6 grams of protein per kilogram of body weight per day. Include a clear protein source at every main meal.',
  // Shape Up (recomposition) plans: higher range, and training is part of it.
  // The per-client grams on the navy panel come from proteinRangeFor() in
  // planModel — keep the numbers in both notes in step with it.
  noteRecomp: 'Protein is what lets muscle grow while your calories sit slightly below maintenance. Aim for approximately 1.6 to 2.2 grams of protein per kilogram of body weight per day, include a clear protein source at every meal, and pair your plan with regular strength training.',
}

// ── Page 6 — food groups, recovery, sign-off ─────────────────────────────────

export const GROUPS_SECTION = titled('Food groups to build from', 'Food groups to build from')

// Four cards in a 2×2 grid. `items` is padded with empty strings so the card's
// two item columns stay even — the design calls for that explicitly.
export const GROUPS = [
  {
    ...titled('Animal-Based Proteins', 'Animal-based proteins'),
    note: 'Include a clear protein source at every main meal.',
    items: ['Eggs / Egg Whites', 'Chicken / Turkey', 'Beef / Steak', 'Salmon / Tuna', 'White Fish', 'Shrimp / Seafood', 'Greek Yogurt / Labneh', 'Cottage Cheese'],
  },
  {
    ...titled('Plant-Based Proteins', 'Plant-based proteins'),
    note: 'Useful for meat-free days and for adding fiber.',
    items: ['Lentils', 'Chickpeas', 'Beans', 'Tofu / Tempeh', 'Quinoa', 'Edamame', 'Nuts & Seeds', ''],
  },
  {
    ...titled('Complex Carbohydrates', 'Complex carbohydrates'),
    note: 'Complex carbohydrates fuel the brain, support hormonal health, and aid recovery. Many people find them easiest to use around the most active part of their day.',
    items: ['Rice (white, brown, black)', 'Potatoes & sweet potatoes', 'Quinoa', 'Bulgur', 'Oats', 'Pasta (moderate portions)', 'Whole-grain bread', 'Beans & lentils'],
  },
  {
    ...titled('Healthy Fats', 'Healthy fats'),
    note: 'Healthy fats support hormone production, nutrient absorption, brain function, and satiety. Include 1–2 sources daily.',
    items: ['Olive oil', 'Avocado', 'Nuts & seeds', 'Nut butters', 'Fatty fish', 'Cheese (non-processed)', '', ''],
  },
]

export const VEG_FRUIT = {
  ...titled('Vegetables & Fruits', 'Vegetables & fruits'),
  note: 'Vegetables provide fiber, vitamins, minerals, and antioxidants essential for digestion and overall health. Aim for 6–8 servings daily. Fruits provide natural sugars and antioxidants; aim for 2–3 servings daily.',
  columns: [
    { ...titled('Vegetables', 'VEGETABLES'), items: ['Spinach, arugula, kale', 'Lettuce varieties', 'Broccoli, cauliflower', 'Zucchini, eggplant', 'Carrots, beets', 'Mushrooms', 'Green beans', 'Bell peppers', 'Tomatoes, cucumbers', 'Onions, garlic'] },
    { ...titled('Fruits', 'FRUITS'), items: ['Berries', 'Apples, pears', 'Oranges, mandarins', 'Banana', 'Mango, pineapple', 'Grapes, cherries', 'Melon'] },
  ],
}

// Condition-specific advice for page 6, shown only for the client's own
// conditions (canonical restriction tokens). From the dietitian review
// (Myriam Chehab, 28.09.2026); the egg allowance (3–4 a week) is ours to confirm.
export const CONDITION_ADVICE_SECTION = titled("Advice for your health conditions", "Advice for your health conditions")
export const CONDITION_ADVICE = [
  { token: "hypercholesterolemia", ...titled("High cholesterol", "High cholesterol"), body: "Keep whole eggs to about 3\u20134 a week (egg whites are fine), eat oily fish such as salmon twice a week, choose low-fat dairy, and keep red meat and fried food occasional." },
  { token: "hypertriglyceridemia", ...titled("High triglycerides", "High triglycerides"), body: "Limit sugar, sweets, honey, juices and sugary drinks, choose whole grains over white bread and rice, eat oily fish such as salmon twice a week, and avoid alcohol." },
  { token: "hypertension", ...titled("High blood pressure", "High blood pressure"), body: "Keep salt low: choose low-salt cheese, labneh and bread, avoid pickles, olives and salty snacks, and season with herbs, lemon and spices instead of salt." },
  { token: "diabetes", ...titled("Diabetes", "Diabetes"), body: "Keep the amount of carbohydrate steady from meal to meal, pair carbohydrates with protein or vegetables, choose whole grains, and avoid sugary drinks and sweets." },
  { token: "hypoglycemia", ...titled("Low blood sugar", "Low blood sugar"), body: "Eat at regular times and don't skip meals or snacks; each one includes carbohydrates. Keep a quick source of sugar with you in case your blood sugar drops." },
  { token: "gout", ...titled("Gout", "Gout"), body: "Limit red meat, organ meats and shellfish, choose chicken, turkey, eggs, dairy or tofu instead, keep portions moderate, and drink plenty of water through the day." },
  { token: "ibs", ...titled("Irritable bowel (IBS)", "Irritable bowel (IBS)"), body: "Your plan avoids common trigger foods such as onion, garlic, beans and wheat. Eat slowly, keep portions moderate, and note any food that causes bloating so your dietitian can adjust your plan." },
  { token: "kidney stones", ...titled("Kidney stones", "Kidney stones"), body: "Drink plenty of water through the day unless your doctor has limited your fluids, keep salt low, and limit high-oxalate foods such as spinach, nuts and cocoa." },
  { token: "fatty liver disease", ...titled("Fatty liver", "Fatty liver"), body: "Choose low-fat dairy and lean protein, limit fried and fatty food, sweets and sugary drinks, and keep red meat occasional." },
  { token: "gerd", ...titled("Acid reflux (GERD)", "Acid reflux (GERD)"), body: "Eat smaller meals, don't lie down for 2 to 3 hours after eating, and limit fatty, fried and spicy food, coffee and chocolate." },
  { token: "pancreatitis", ...titled("Pancreatitis", "Pancreatitis"), body: "Keep fat low at every meal: choose fat-free dairy and lean protein, avoid fried food and alcohol, and eat small, frequent meals." },
  { token: "favism", ...titled("Favism (G6PD deficiency)", "Favism (G6PD deficiency)"), body: "Never eat fava beans, foul or falafel made with fava beans, and avoid any medicine your doctor has listed as unsafe for G6PD deficiency." },
  { token: "wilson's disease", ...titled("Wilson's disease", "Wilson's disease"), body: "Limit foods rich in copper: shellfish, nuts, chocolate, mushrooms and liver." },
  { token: "hyperkalemia", ...titled("High potassium", "High potassium"), body: "Limit high-potassium foods such as bananas, potatoes, tomatoes, oranges and spinach, and follow your doctor's advice on potassium." },
  { token: "lactose intolerance", ...titled("Lactose intolerance", "Lactose intolerance"), body: "Your plan uses lactose-free dairy. Hard, aged cheeses are naturally very low in lactose and are usually well tolerated." },
]

export const SLEEP = {
  ...titled('Sleep & Recovery', 'Sleep & recovery'),
  note: 'Aim for 7–9 hours of sleep per night. Consistent sleep and wake times support appetite regulation, recovery, and overall well-being.',
  // Value and unit are separate because the unit is words in Arabic, which has
  // no single-letter abbreviation for "hours" the way English has "H".
  figure: '7–9',
  figureUnit: titled('sleep_hours_unit', 'H'),
}

// ── Masthead kickers ─────────────────────────────────────────────────────────
// Pages 2–4 build theirs from the client name + diet type instead.
export const KICKER = {
  cover: 'PERSONALIZED NUTRITION PROGRAM',
  guidelines1: 'HOW TO USE YOUR PLAN',
  guidelines2: 'FOOD GROUPS & RECOVERY',
}
