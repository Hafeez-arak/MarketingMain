// ─── v2: which section and level each /api/leads action needs ──────────────
// 2026-10-19 (migration 20261101_section_access). Besides the access admin
// and a sales seat, a company member granted a section may use its actions:
//
//   CEO   view: read the panel · work: remind, contacted, send to sales ·
//         manage: targets, routing, the test alert
//   Sales work: what a salesperson does on a lead (SALES_ACTIONS) ·
//         manage: everything else (agent settings, mailboxes, CRM, team)
//
// Asked of the database with the caller's own token (has_section), so the
// answer is the same one RLS gives. Before the migration exists the call
// fails, and the answer is no: v1's rules alone.

const CEO = {
  control: 'view',
  remind: 'work', account_contacted: 'work', send_to_sales: 'work',
  targets_save: 'manage', routing_save: 'manage', alerts_now: 'manage',
}

/** { section, min } for an action. */
export function sectionFor(action, salesActions = new Set()) {
  if (CEO[action]) return { section: 'ceo', min: CEO[action] }
  if (salesActions.has(action)) return { section: 'sales', min: 'work' }
  return { section: 'sales', min: 'manage' }
}

/** has_section() with the caller's token; false on any failure. */
export async function hasSection({ url, apikey, token, workspaceId, section, min, fetch: f = fetch }) {
  try {
    const r = await f(`${url}/rest/v1/rpc/has_section`, {
      method: 'POST',
      headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ws: workspaceId, sec: section, min_level: min }),
    })
    return r.ok && (await r.json()) === true
  } catch { return false }
}
