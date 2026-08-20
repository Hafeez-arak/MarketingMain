import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// ─── Research agent — the agenda ───────────────────────────────────────────
// The standing memory the weekly run works from: the questions this brand
// keeps asking, and the competitors it keeps watching. Seeded from the Brand
// Brain and never written back to it — a resolved Instagram handle is
// research metadata (discovered, scored, timestamped), not a statement the
// company makes about itself. See RESEARCH-AGENT.md §5a.
//
// EVERY query below carries its own workspace_id filter. RLS on these tables
// is per-USER, and the operators belong to all three workspaces — so RLS
// alone would happily return every brand's watchlist at once.

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}

export const IG_STATUS_LABELS = {
  unresolved: 'Needs checking',
  resolved:   'Verified',
  not_found:  'Not found',
  private:    'Not a public business account',
  human_set:  'Set by you',
}

// The one rule the rest of the system reads this table by. A handle alone is
// never enough: the resolve step stores a weak candidate as a SUGGESTION so a
// human has something to accept, and reading `ig_handle` without checking the
// status is precisely how a guess would end up in the numbers.
export function isSnapshotable(row) {
  return !!row?.ig_handle && (row.ig_status === 'resolved' || row.ig_status === 'human_set')
}

export async function fetchAgenda(workspaceId, accessToken, { kind = null } = {}) {
  if (!workspaceId) return []
  const kindFilter = kind ? `&kind=eq.${kind}` : ''
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/research_agenda?workspace_id=eq.${workspaceId}${kindFilter}` +
      `&select=*&order=kind.asc,subject.asc`,
      { headers: authHeaders(accessToken) },
    )
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

export async function updateAgendaItem(accessToken, id, patch) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/research_agenda?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ ...patch, reviewed_at: new Date().toISOString() }),
    })
    if (!res.ok) return { error: await res.text() }
    const [row] = await res.json()
    return { ok: true, row }
  } catch (err) { return { error: err.message } }
}

// A handle a person typed. Marked `human_set` rather than `resolved`, and the
// two are not the same thing: `human_set` is never re-resolved on a later
// run, so a correction stays corrected instead of being quietly overwritten
// by next week's search.
// People paste whatever is in front of them: `@lumina`, a full profile URL
// with tracking junk on the end, or the handle alone. All three mean the same
// account, and a stored `@lumina` would 400 at the Graph API in a way that
// looks like the rival went private.
export function cleanHandle(input) {
  return String(input || '').trim()
    .replace(/^.*instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .trim()
}

export function setHandleByHand(accessToken, id, handle) {
  const clean = cleanHandle(handle)
  if (!clean) {
    return updateAgendaItem(accessToken, id, {
      ig_handle: '', ig_user_id: '', ig_confidence: null,
      ig_status: 'unresolved', ig_verified_at: null,
    })
  }
  return updateAgendaItem(accessToken, id, {
    ig_handle: clean, ig_user_id: '', ig_confidence: 1,
    ig_status: 'human_set', ig_verified_at: new Date().toISOString(),
  })
}

export async function createAgendaItem(workspaceId, accessToken, row) {
  if (!workspaceId) return { error: 'No active workspace.' }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/research_agenda`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ workspace_id: workspaceId, ...row }),
    })
    if (!res.ok) return { error: await res.text() }
    const [created] = await res.json()
    return { ok: true, row: created }
  } catch (err) { return { error: err.message } }
}

// ─── Competitors, as the resolve step wants them ───────────────────────────
// Sibling of competitorNamesFrom() in insights.js, and read the same way:
// from the directory rather than asked for, because every workspace names and
// shapes that section itself. Returns the whole row rather than just the name
// because verification needs the website and positioning — a bio linking to
// the rival's own domain is the one conclusive signal there is, and it is
// worthless if the domain never leaves the browser.
export function competitorRowsFrom(schema, directory) {
  const sections = (schema?.sections || []).filter(
    s => s.kind === 'directory' && s.enabled !== false && /competitor|rival/i.test(`${s.key} ${s.title}`),
  )
  const out = []
  for (const section of sections) {
    const cols = (schema.columns || []).filter(
      c => c.section_key === section.key && c.enabled !== false && c.in_prompt !== false,
    )
    if (!cols.length) continue
    // Same convention buildDirectoryIndex uses: the first in-prompt column is
    // the row's name.
    const nameKey = cols[0].key
    const find = re => (cols.find(c => re.test(`${c.key} ${c.label}`)) || {}).key
    const siteKey = find(/url|site|website|link/i)
    const posKey  = find(/position|descri|about|note/i)

    for (const row of directory?.rowsBySection?.[section.key] || []) {
      const name = String(row.data?.[nameKey] || '').trim()
      if (!name) continue          // the live Arak directory has one blank row
      out.push({
        name,
        website: siteKey ? String(row.data?.[siteKey] || '').trim() : '',
        positioning: posKey ? String(row.data?.[posKey] || '').trim() : '',
        source_row_id: row.id || null,
      })
    }
  }
  // Two rows naming the same rival would each collect half its history.
  const seen = new Set()
  return out.filter(c => {
    const k = c.name.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ─── Triggering resolution ─────────────────────────────────────────────────
// Seeds the agenda from the Brand Brain, then finds and verifies a handle for
// every competitor that does not have one. No model call anywhere in it —
// matching a rival to an account is arithmetic over a domain, a name and a
// bio, and it has to answer the same way twice.
export async function requestHandleResolve(webhookUrl, payload) {
  if (!webhookUrl) return { error: 'Research resolve webhook not configured. Go to Settings → Integrations.' }
  if (!payload?.workspace_id) return { error: 'No active workspace.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return { error: `Resolve webhook returned ${res.status}` }
    const data = await res.json()
    const row = Array.isArray(data) ? data[0] : data
    if (!row || row.ok !== true) return { error: (row && row.error) || 'The resolve step returned nothing usable.' }
    return {
      ok: true, skipped: !!row.skipped, reason: row.reason || '',
      seeded: row.seeded || 0, resolved: row.resolved || 0,
      suggested: row.suggested || 0, notFound: row.not_found || 0,
      deferred: row.deferred || 0, outcomes: row.outcomes || [],
    }
  } catch (err) { return { error: err.message } }
}

// What the user is told after a resolve pass. Written here rather than in the
// page because the interesting case is the one that reads like success and is
// not: handles were found, none could be verified, and the competitor board
// will still be empty next run.
export function summariseResolve(res) {
  if (!res?.ok) return res?.error || ''
  if (res.skipped) return res.reason
  const bits = []
  if (res.seeded) bits.push(`added ${res.seeded} competitor${res.seeded === 1 ? '' : 's'} to the watchlist`)
  if (res.resolved) bits.push(`verified ${res.resolved} handle${res.resolved === 1 ? '' : 's'}`)
  if (res.suggested) bits.push(`${res.suggested} need${res.suggested === 1 ? 's' : ''} your confirmation`)
  if (res.notFound) bits.push(`${res.notFound} not found`)
  if (res.deferred) bits.push(`${res.deferred} left for the next run`)
  if (!bits.length) return 'Nothing to resolve.'
  const sentence = `${bits.join(', ')}.`
  return res.resolved === 0 && (res.suggested || res.notFound)
    ? `${sentence} No competitor has a verified handle yet, so the Instagram side of the report will stay empty until one does.`
    : sentence
}
