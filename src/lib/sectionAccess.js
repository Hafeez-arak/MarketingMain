import { PARKED } from './modules'
import { supabase } from './supabaseClient'

// ─── v2: section grants (public.section_access) ────────────────────────────
// 2026-10-19. Who may open which section of a company, at what level. The
// database enforces it (has_section(), migration 20261101_section_access);
// these reads and writes are for drawing the app and for the admin's screen.

const LEVELS = new Set(['view', 'work', 'manage'])

/** This person's grants in one company: { sales: 'work', … }, or null if the table is not there. */
export async function fetchMySections(workspaceId, userId) {
  if (!workspaceId || !userId) return null
  const { data, error } = await supabase
    .from('section_access')
    .select('section,level')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
  if (error) return null
  return Object.fromEntries((data || []).filter(r => LEVELS.has(r.level)).map(r => [r.section, r.level]))
}

/** Every grant in a company, for the admin's screen. RLS returns only your own unless you are the admin. */
export async function fetchCompanySections(workspaceId) {
  const { data, error } = await supabase
    .from('section_access')
    .select('user_id,section,level,granted_at')
    .eq('workspace_id', workspaceId)
  if (error) return { rows: [], error: error.message }
  return { rows: data || [], error: null }
}

/**
 * Set one person's level in one section: a level grants (or changes) it,
 * null takes it away. The access admin only; RLS refuses anyone else.
 */
export async function setSection(workspaceId, userId, section, level, grantedBy) {
  if (!level) {
    const { error } = await supabase.from('section_access').delete()
      .eq('workspace_id', workspaceId).eq('user_id', userId).eq('section', section)
    return { error: error?.message || null }
  }
  if (!LEVELS.has(level)) return { error: 'Unknown level.' }
  const { error } = await supabase.from('section_access').upsert(
    { workspace_id: workspaceId, user_id: userId, section, level, granted_by: grantedBy || null, granted_at: new Date().toISOString() },
    { onConflict: 'workspace_id,user_id,section' },
  )
  return { error: error?.message || null }
}

/** The sections that can be granted, in the rail's order. Admin is never granted. */
// Technical and Finance are parked until Musa's ERP (lib/erp.js): not offered.
export const GRANTABLE = ['ceo', 'sales', 'marketing', 'insights', 'technical', 'finance'].filter(k => !PARKED.has(k))

/**
 * The rows of the admin's Section access screen for one company: everyone
 * approved who belongs to it, with their grants. Pure, so it is tested.
 *
 *   kind 'admin'  the access admin: every section at manage, not editable
 *   kind 'member' a company member: one level (or none) per section
 *   kind 'sales'  a sales seat: the sales team's own app, not sections
 */
export function sectionRows({ access = [], assignments = {}, grants = [], workspaceId }) {
  const mine = grants.filter(g => g.workspace_id === undefined || g.workspace_id === workspaceId)
  return access
    .filter(a => a.status === 'approved' && (a.role === 'admin' || (assignments[a.user_id] || []).includes(workspaceId)))
    .map(a => {
      const kind = a.role === 'admin' ? 'admin' : a.role === 'sales' ? 'sales' : 'member'
      const levels = {}
      for (const s of GRANTABLE) {
        levels[s] = kind === 'admin' ? 'manage' : (mine.find(g => g.user_id === a.user_id && g.section === s)?.level || null)
      }
      return { userId: a.user_id, name: (a.full_name || '').trim() || String(a.email || '').split('@')[0], email: a.email, kind, levels }
    })
    .sort((x, y) => ['admin', 'member', 'sales'].indexOf(x.kind) - ['admin', 'member', 'sales'].indexOf(y.kind) || x.name.localeCompare(y.name))
}
