import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Null when env vars are missing; the UI shows a setup message instead of crashing. */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null

export const configError = supabase
  ? null
  : 'Supabase is not configured. Copy .env.example to .env.local and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
