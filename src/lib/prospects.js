import { supabase } from './supabaseClient'
import { saveGroup, addToGroup } from './email/client'
import { cleanContact } from './email/contacts'
import { contactFromProspect, groupNameFor } from './agent/prospects'

// ─── Prospects, from the browser ───────────────────────────────────────────
// Reads and status changes go through the user's own session, so RLS
// applies. Finding new ones is the one paid call, and it goes to the server
// (api/agent/discover.js, mode 'prospects').

// Must match STALE_MS in api/agent/_prospects.js: a search still "running"
// after this is one whose function died.
export const STALE_MS = 6 * 60_000

function check({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

/** Every prospect for this company, newest first, and the last few searches. */
export async function fetchProspects(ws) {
  const [prospects, searches] = await Promise.all([
    supabase.from('research_prospects').select('*').eq('workspace_id', ws)
      .order('created_at', { ascending: false }).limit(1000),
    supabase.from('research_prospect_searches').select('*').eq('workspace_id', ws)
      .order('started_at', { ascending: false }).limit(10),
  ])
  return { prospects: check(prospects) || [], searches: check(searches) || [] }
}

/** The search row as the page should read it: a dead "running" is a failure. */
export function searchState(s, now = Date.now()) {
  if (!s) return null
  if (s.status === 'running' && now - new Date(s.started_at).getTime() > STALE_MS) {
    return { ...s, status: 'failed', error: s.error || 'This search stopped before it finished.' }
  }
  return s
}

/** The paid call: one search for one kind of company. */
export async function findProspects({ workspaceId, accessToken, segment, area = '', count = 10 }) {
  try {
    const res = await fetch('/api/agent/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ workspace_id: workspaceId, mode: 'prospects', segment, area, count }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body?.error || `The search returned ${res.status}.` }
    return body
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

export async function setProspectStatus(ws, id, status, extra = {}) {
  const { data: { user } = {} } = await supabase.auth.getUser()
  return check(await supabase.from('research_prospects')
    .update({ status, reviewed_by: user?.id || null, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra })
    .eq('id', id).eq('workspace_id', ws).select().single())
}

/**
 * Put a prospect into Email → Outreach, in a group named after its segment,
 * and mark it added. An address already in Contacts is reused, never
 * overwritten: whoever typed it there knew something about it.
 */
export async function addProspectToOutreach(ws, prospect) {
  const input = contactFromProspect(prospect)
  if (!input) throw new Error('This company has no published email, so it cannot go into outreach. Call them instead.')
  const contact = cleanContact(input, { audience: 'cold' })

  const existing = check(await supabase.from('email_contacts').select('id')
    .eq('workspace_id', ws).eq('email', contact.email).limit(1))
  let contactId = existing?.[0]?.id
  if (!contactId) {
    const { data: { user } = {} } = await supabase.auth.getUser()
    const row = check(await supabase.from('email_contacts')
      .insert({ ...contact, workspace_id: ws, created_by: user?.id || null }).select('id').single())
    contactId = row.id
  }

  const name = groupNameFor(prospect.segment)
  const groups = check(await supabase.from('email_groups').select('id,name')
    .eq('workspace_id', ws).eq('audience', 'cold').ilike('name', name.replace(/[%_\\]/g, '\\$&')).limit(1))
  const groupId = groups?.[0]?.id || (await saveGroup(ws, {
    name, audience: 'cold', description: 'Companies found by Research → Prospects.',
  })).id
  await addToGroup(ws, groupId, [contactId])

  return setProspectStatus(ws, prospect.id, 'added', { contact_id: contactId })
}

/** What the search box offers before anyone types: the audience lines and the ICP. */
export async function fetchProspectSetup(ws) {
  const [profile, icp] = await Promise.all([
    supabase.from('brand_profile').select('target_personas').eq('workspace_id', ws).maybeSingle(),
    supabase.from('sales_icp').select('config').eq('workspace_id', ws).maybeSingle(),
  ])
  return { targetPersonas: profile.data?.target_personas || '', icp: icp.data?.config || null }
}
