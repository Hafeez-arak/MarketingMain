import { createClient } from '@supabase/supabase-js'

// ─── Supabase client ────────────────────────────────────────────────────────
// Phase 0 replaces the old pattern (each workspace manually pasting a
// Supabase URL + anon key into Settings → Integrations) with a single,
// fixed client baked from env vars. There is only ever one Supabase project
// behind this app now — tenant isolation happens via RLS + auth, not via
// "which credentials did this browser tab happen to have typed in."
//
// Required in .env (see .env.example):
//   VITE_SUPABASE_URL=https://vxjhfvehccftvajgtqtv.supabase.co
//   VITE_SUPABASE_ANON_KEY=...
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Loud and early — a misconfigured env is the #1 cause of "RLS is
  // blocking everything" confusion, and it's much easier to debug here
  // than three network calls deep in a page component.
  console.error(
    '[supabaseClient] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env and fill them in.'
  )
}

export const SUPABASE_URL = supabaseUrl
export const SUPABASE_ANON_KEY = supabaseAnonKey

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
