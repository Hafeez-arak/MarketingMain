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

// Vite inlines these at BUILD time, so a host that is missing them produces a
// bundle with `undefined` baked in — redeploying is required after setting
// them, and restarting the deployment is not enough.
const missing = [
  !supabaseUrl && 'VITE_SUPABASE_URL',
  !supabaseAnonKey && 'VITE_SUPABASE_ANON_KEY',
].filter(Boolean)

// Non-null when the build has no Supabase credentials. main.jsx renders a
// diagnostic screen instead of the app when this is set.
//
// Why not just let createClient throw: it validates its arguments in the
// constructor, and this module is imported at the top of the entry chain, so
// a missing variable threw before React ever mounted. The only symptom was a
// blank white page — no error text on screen, nothing in the DOM, the cause
// visible only to someone who thought to open the console. A deploy that is
// merely misconfigured should say so.
export const CONFIG_ERROR = missing.length
  ? `Missing ${missing.join(' and ')} in this build's environment.`
  : null

if (CONFIG_ERROR) {
  console.error(
    `[supabaseClient] ${CONFIG_ERROR} Set them in the hosting provider's ` +
    'environment variables (or .env for local dev) and redeploy — Vite ' +
    'inlines them at build time.'
  )
}

export const SUPABASE_URL = supabaseUrl
export const SUPABASE_ANON_KEY = supabaseAnonKey

// Placeholders keep the constructor from throwing when the config is absent.
// Nothing can successfully call this client in that state, but the app gets
// far enough to render the message above, which is the whole point.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
