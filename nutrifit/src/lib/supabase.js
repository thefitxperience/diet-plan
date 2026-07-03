import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = supabaseConfigured
  ? createClient(url, anonKey)
  : null

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.'
    )
  }
  return supabase
}
