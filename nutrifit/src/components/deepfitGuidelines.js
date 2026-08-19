// Static guideline pages content (deepFIT template pages 5–6). English text
// matches the demo exactly so the AR dictionary (plan-ar.json paragraphs /
// listItems / ui) keys resolve.

// "About the Plan" block — sits at the top of guidelines page 1 (before the
// DAILY NUTRITION guidelines), matching the demo.
export const ABOUT_TITLE = 'ABOUT THE PLAN'
export const ABOUT_SECTIONS = [
  {
    heading: 'Meal Flexibility & Personalization',
    paragraphs: ['This meal plan is designed to give you flexibility while still helping you achieve your daily nutrition goals. The options within each meal are matched on calories, so whichever one you choose keeps your day on track. Their protein, carbohydrate and fat split can still differ a little, which lets you pick what suits your appetite, activity and schedule — a higher-protein breakfast after a workout, or something lighter on a less active day. What matters most is your overall daily intake rather than identical macronutrients at every meal. Feel free to mix and match your choices throughout the day.'],
  },
  {
    heading: 'Non-Starchy Vegetables',
    paragraphs: ['Non-starchy vegetables are encouraged with every meal — aim for roughly 2 to 4 cups (about 200–400 g) spread across the day. They are naturally low in calories and rich in fiber, vitamins, minerals, and antioxidants, helping improve fullness, digestion, and overall health. Choose them fresh, steamed, boiled, grilled, roasted, or air-fried. Season freely with herbs, spices, lemon juice, or vinegar. Any oil you add is not included in your meal calorie totals, so keep it to no more than 1 tsp (about 5 g) of olive oil and count it toward your daily intake.'],
  },
  {
    heading: 'Swapping Meals & Ingredients',
    paragraphs: ['The options within each meal are matched on calories, so you can choose whichever you prefer without changing your daily total. If an ingredient is unavailable, replace it with a similar item from the same group — for example, one lean protein for another, or one complex carbohydrate for another — in a similar portion. Unless stated otherwise, listed weights refer to cooked portions, and any oils, sauces, or dressings named in a meal are already included in its calorie total; extras you add on your own are not. To swap a whole meal, pick another option from the same category to keep your intended daily intake.'],
  },
]

export const GUIDELINES_TITLE = 'DAILY NUTRITION & LIFESTYLE GUIDELINES'
export const GUIDELINES_INTRO =
  'These guidelines are general nutrition guidance rather than instructions written for you individually, so some of it may need to be adapted to your own circumstances. They are here to support your meal plan through daily habits that improve energy, digestion, recovery, and long-term health. If anything should be different in your case, your dietitian will tell you.'

export const DIET_INTRO =
  'Welcome to your personalized diet plan! This guide provides a structured approach to healthy eating, offering several options for every meal and snack so you receive a balanced intake of proteins, carbohydrates, and healthy fats. Choose the options that best fit your preferences and dietary needs.'

export const GUIDELINES_PAGE_1 = [
  {
    heading: 'Hydration',
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
        paragraphs: ['Complex carbohydrates fuel the brain, support hormonal health, and aid recovery. Many people find them easiest to use around the most active part of their day.'],
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
