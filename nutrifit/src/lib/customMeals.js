// Per-gym custom meals the dietitian saves from the editor, reusable across all
// future plans. Backed by the `custom_meals` table (migration 012). Shaped to
// match mealCatalog.json entries so the meal picker can treat them uniformly.

import { supabase } from './supabase'

// DB row → mealCatalog-style entry (what MealPicker/optionFromCatalog expect).
function rowToCatalogEntry(row) {
  return {
    id: `custom_${row.id}`,
    customId: row.id,
    isCustom: true,
    name_en: row.name_en || '',
    name_ar: row.name_ar || '',
    desc_en: row.desc_en || '',
    desc_ar: row.desc_ar || '',
    diets: row.diets || [],
    categories: row.slot ? [row.slot] : [],
    ingredients: row.ingredients || [],
    ingredientCount: (row.ingredients || []).length,
    macros: row.macros || { protein: null, carbs: null, fats: null },
    kcal: row.kcal || 0,
  }
}

export async function listCustomMeals(gymId) {
  if (!gymId) return []
  const { data, error } = await supabase
    .from('custom_meals')
    .select('*')
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(rowToCatalogEntry)
}

// Persist an edited plan option as a reusable meal for the gym.
export async function saveCustomMeal({ gymId, createdBy, slot, option, diets = [] }) {
  const row = {
    gym_id: gymId,
    created_by: createdBy || null,
    slot: slot || null,
    name_en: option.name_en || '',
    name_ar: option.name_ar || '',
    desc_en: option.desc_en || '',
    desc_ar: option.desc_ar || '',
    diets,
    ingredients: option.ingredients || [],
    macros: option.macros || {},
    kcal: Math.round(option.kcal || 0),
  }
  const { data, error } = await supabase.from('custom_meals').insert(row).select().single()
  if (error) throw error
  return rowToCatalogEntry(data)
}

export async function deleteCustomMeal(id) {
  const { error } = await supabase.from('custom_meals').delete().eq('id', id)
  if (error) throw error
}
