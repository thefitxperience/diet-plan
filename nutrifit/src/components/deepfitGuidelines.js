// Static guideline pages content (deepFIT template pages 5–6). English text
// matches the demo exactly so the AR dictionary (plan-ar.json paragraphs /
// listItems / ui) keys resolve.

// "About the Plan" block — sits at the top of guidelines page 1 (before the
// DAILY NUTRITION guidelines), matching the demo.
export const ABOUT_TITLE = 'ABOUT THE PLAN'
export const ABOUT_SECTIONS = [
  {
    heading: 'Meal Flexibility & Personalization',
    paragraphs: ['This meal plan is designed to give you flexibility while still helping you achieve your daily nutrition goals. The protein, carbohydrate, and fat content may vary between meal options, allowing you to choose meals that best suit your appetite, activity level, schedule, and personal preferences. For example, you may prefer a higher-protein breakfast after a workout or a lighter, lower-carbohydrate lunch on a less active day. What matters most is your overall daily intake rather than having identical macronutrients at every meal. Feel free to mix and match your meal choices throughout the day to create a balanced eating pattern that works for you.'],
  },
  {
    heading: 'Vegetables – Enjoy Freely',
    paragraphs: ['Non-starchy vegetables are encouraged with every meal and can be eaten generously according to your appetite. They are naturally low in calories and rich in fiber, vitamins, minerals, and antioxidants, helping to improve fullness, digestion, and overall health. Choose fresh, steamed, boiled, grilled, roasted, or air-fried vegetables without dressings. Season with herbs, spices, lemon juice, vinegar, or very small amounts not more than 1 tsp of olive oil if desired.'],
  },
]

export const GUIDELINES_TITLE = 'DAILY NUTRITION & LIFESTYLE GUIDELINES'
export const GUIDELINES_INTRO =
  'These guidelines are designed to support your meal plan by focusing on daily habits that improve energy, digestion, recovery, and long-term health.'

export const DIET_INTRO =
  'Welcome to your personalized diet plan! This guide is designed to provide you with a structured approach to healthy eating, offering three meal options and one snack daily, ensuring you receive a balanced intake of proteins, carbohydrates, and healthy fats. Choose the options that best fit your preferences and dietary needs.'

export const GUIDELINES_PAGE_1 = [
  {
    heading: 'Daily Foundations Summary',
    paragraphs: ['Proper hydration supports digestion, appetite regulation, energy levels, skin health, and mental focus.'],
    orderedList: [
      'Upon waking: 1 glass of water.',
      'Morning: 1–2 glasses between breakfast and lunch.',
      'Afternoon: 1–2 glasses between lunch and dinner.',
      'Evening: 1 glass, stopping at least 1 hour before bed.',
      'Daily target: Women 1.8–2.2 L / Men 2.2–2.8 L.',
    ],
  },
  {
    heading: 'Hydration',
    paragraphs: [
      'Proper hydration supports digestion, appetite regulation, energy levels, skin health, and mental focus. Upon waking, drink one glass of water. In the morning, drink one to two glasses between breakfast and lunch. In the afternoon, drink one to two glasses between lunch and dinner. In the evening, drink one glass, stopping at least one hour before bed. The daily target is approximately 1.8 to 2.2 liters for women and 2.2 to 2.8 liters for men.',
    ],
  },
  {
    heading: 'Protein Intake',
    paragraphs: [
      'Protein supports muscle preservation, metabolism, blood sugar balance, and satiety. Aim for approximately 1.2 to 1.6 grams of protein per kilogram of body weight per day. Include a clear protein source at every main meal.',
    ],
  },
]

// Moved to the final page (after the title) to keep page 1 from overflowing:
// the protein source lists and the Vegetables & Fruits section.
export const GUIDELINES_PAGE_2 = [
  {
    columns: [
      {
        heading: 'Animal-Based Proteins',
        items: ['Eggs / Egg Whites', 'Chicken / Turkey', 'Beef / Steak', 'Salmon / Tuna', 'White Fish', 'Shrimp / Seafood', 'Greek Yogurt / Labneh', 'Cottage Cheese'],
      },
      {
        heading: 'Plant-Based Proteins',
        items: ['Lentils', 'Chickpeas', 'Beans', 'Tofu / Tempeh', 'Quinoa', 'Edamame', 'Nuts & Seeds'],
      },
    ],
  },
  {
    heading: 'Vegetables & Fruits',
    paragraphs: [
      'Vegetables provide fiber, vitamins, minerals, and antioxidants essential for digestion and overall health. Aim for 6–8 servings daily. Fruits provide natural sugars and antioxidants; aim for 2–3 servings daily.',
    ],
    columns: [
      {
        heading: 'Vegetables',
        items: ['Spinach, arugula, kale', 'Lettuce varieties', 'Broccoli, cauliflower', 'Zucchini, eggplant', 'Carrots, beets', 'Mushrooms', 'Green beans', 'Bell peppers', 'Tomatoes, cucumbers', 'Onions, garlic'],
      },
      {
        heading: 'Fruits',
        items: ['Berries', 'Apples, pears', 'Oranges, mandarins', 'Banana', 'Mango, pineapple', 'Grapes, cherries', 'Melon'],
      },
    ],
  },
  {
    // Complex Carbohydrates and Healthy Fats side by side.
    columns: [
      {
        heading: 'Complex Carbohydrates',
        paragraphs: ['Complex carbohydrates fuel the brain, support hormonal health, and aid recovery. Best consumed in the morning and post-activity.'],
        items: ['Rice (white, brown, black)', 'Potatoes & sweet potatoes', 'Quinoa', 'Bulgur', 'Oats', 'Pasta (moderate portions)', 'Whole-grain bread', 'Beans & lentils'],
      },
      {
        heading: 'Healthy Fats',
        paragraphs: ['Healthy fats support hormone production, nutrient absorption, brain function, and satiety. Include 1–2 sources daily.'],
        items: ['Olive oil', 'Avocado', 'Nuts & seeds', 'Nut butters', 'Fatty fish', 'Cheese (non-processed)'],
      },
    ],
  },
  {
    heading: 'Sleep & Recovery',
    paragraphs: ['Aim for 7–9 hours of sleep per night. Consistent sleep and wake times support appetite regulation, recovery, and overall well-being.'],
  },
]
