import { supabase } from '../supabaseClient'

// ─── The shell's reads and writes (v2) ─────────────────────────────────────
// 2026-10-28, docs/SHELL.md. Straight to the database with the person's own
// login. Every query names its company as well as RLS: RLS is membership,
// not isolation.

/**
 * This person's saved pins in one company: { sections } (null = never
 * chose), or { sections: null, error } when the read failed (the table not
 * there yet, say). The rail then draws the defaults.
 */
export async function fetchPins(workspaceId, userId) {
  if (!workspaceId || !userId) return { sections: null }
  const { data, error } = await supabase
    .from('shell_pins')
    .select('sections')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return { sections: null, error: error.message }
  return { sections: data ? data.sections || [] : null }
}

/** Save this person's pins in one company (the whole list). */
export async function savePins(workspaceId, userId, sections) {
  const { error } = await supabase.from('shell_pins').upsert(
    { workspace_id: workspaceId, user_id: userId, sections, updated_at: new Date().toISOString() },
    { onConflict: 'workspace_id,user_id' },
  )
  return { error: error?.message || null }
}

/**
 * The search's database call for one company (lib/shell/search.js): one
 * module's search function, run as the person. Throws on failure so the
 * palette can say which part did not answer.
 */
export function searchCall(workspaceId) {
  return async (rpc, query, limit) => {
    if (!workspaceId) return []
    const { data, error } = await supabase.rpc(rpc, { ws: workspaceId, q: query, lim: limit })
    if (error) throw new Error(error.message)
    return data || []
  }
}
