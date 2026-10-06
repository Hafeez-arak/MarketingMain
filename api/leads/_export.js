// ─── The master Sheet's feed ───────────────────────────────────────────────
// Every lead, from every source, as the rows the master workbook shows (see
// scripts/lead-qualifier/LeadsMaster.gs). The workbook asks every five
// minutes for what changed since its last answer, so a new lead, a verdict
// that arrived late, or a correction on the Lead Agent page all reach it.
// One-way: nothing the team types in the Sheet comes back (the owner's
// decision, 2026-10-07).

/** Rows per answer; the script asks again until it has everything. */
export const EXPORT_PAGE = 200

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))

const SOURCE = { website_form: 'Website', email: 'Email' }
const VERDICT = { qualified: 'Qualified', unqualified: 'Unqualified', needs_review: 'Needs review', duplicate: 'Duplicate' }

/** "2026-10-06 14:00" in Riyadh time, the way the office reads it. */
export function riyadhTime(iso) {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const r = new Date(t.getTime() + 3 * 3_600_000)
  const p = (n) => String(n).padStart(2, '0')
  return `${r.getUTCFullYear()}-${p(r.getUTCMonth() + 1)}-${p(r.getUTCDate())} ${p(r.getUTCHours())}:${p(r.getUTCMinutes())}`
}

/** One lead → the master Sheet's row. The verdict is a person's correction when there is one. */
export function toRow(lead) {
  const verdict = lead.human_verdict || lead.verdict || ''
  // Brief: everything they wrote. An email's subject is part of what it says;
  // a website enquiry's "subject" is the project type it ticked.
  const brief = lead.source === 'email'
    ? [lead.subject, lead.message].filter(Boolean).join('\n\n')
    : [lead.subject ? `Project type: ${lead.subject}` : '', lead.message].filter(Boolean).join('\n\n')
  return {
    id: lead.id,
    received: riyadhTime(lead.received_at || lead.created_at),
    source: (SOURCE[lead.source] || lead.source) + (lead.mailbox ? ` (${lead.mailbox})` : ''),
    name: lead.name || '',
    company: lead.company || '',
    email: lead.email || '',
    phone: lead.phone || '',
    brief: brief.slice(0, 45_000), // a Sheets cell holds 50,000 characters
    verdict: verdict ? VERDICT[verdict] || verdict : (lead.error ? 'Not checked yet' : ''),
    qualified: verdict === 'qualified',
    type: lead.verdict === 'duplicate' ? 'duplicate' : String(lead.category || '').replace(/_/g, ' '),
    reason: lead.reason || '',
    link: lead.link || '',
  }
}

/**
 * What changed since the cursor ("<updated_at>|<id>", '' for everything),
 * oldest first. Returns { leads, next, more }.
 */
export async function exportLeads(deps, { key, cursor = '' }) {
  if (!isUuid(key)) return { status: 401, error: 'This workbook is not connected to the lead agent (bad key).' }
  const [settings] = await deps.db(`lead_agent_settings?export_key=eq.${key}&select=workspace_id`) || []
  if (!settings) return { status: 401, error: 'This workbook is not connected to the lead agent (unknown key).' }
  const ws = settings.workspace_id
  await deps.db(`lead_agent_settings?workspace_id=eq.${ws}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { last_export_at: deps.now().toISOString() },
  })

  const [ts, id] = String(cursor || '').split('|')
  // Ties on updated_at are broken by id, so a page boundary never skips a row.
  const after = ts && !Number.isNaN(Date.parse(ts))
    ? `&or=(updated_at.gt.${encodeURIComponent(ts)},and(updated_at.eq.${encodeURIComponent(ts)},id.gt.${isUuid(id) ? id : '00000000-0000-0000-0000-000000000000'}))`
    : ''
  const rows = await deps.db(`leads?workspace_id=eq.${ws}${after}&select=id,source,received_at,created_at,updated_at,name,company,email,phone,subject,message,verdict,human_verdict,category,reason,link,mailbox,error&order=updated_at.asc,id.asc&limit=${EXPORT_PAGE}`) || []
  const last = rows[rows.length - 1]
  return {
    status: 200,
    leads: rows.map(toRow),
    next: last ? `${last.updated_at}|${last.id}` : cursor,
    more: rows.length === EXPORT_PAGE,
  }
}
