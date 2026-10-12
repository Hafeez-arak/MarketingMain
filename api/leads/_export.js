// ─── The master Sheet's feed ───────────────────────────────────────────────
// Every lead, from every source, as the rows the master workbook shows (see
// scripts/lead-qualifier/LeadsMaster.gs). The workbook asks every five
// minutes for what changed since its last answer, so a new lead, a verdict
// that arrived late, or a correction on the Lead Agent page all reach it.
// One-way: nothing the team types in the Sheet comes back (the owner's
// decision, 2026-10-07).
//
// The sales team's criteria (2026-10-11) have a column each, labelled the way
// the leads page labels them: Came in, Folder, Email type, Who, Verified,
// Request, Project, Philips. They also still ride in `type` ("quotation
// request · Contractor · Verified · Tender · Junk"), which is what a workbook
// script pasted before the columns existed shows in its Type column.

import {
  criteriaLabels, channelLabel, phonesOf,
  SENDER_LABEL, PROJECT_LABEL, REQUEST_LABEL, FOLDER_LABEL, PHILIPS_LABEL,
} from '../../src/lib/leads/view.js'

/** Rows per answer; the script asks again until it has everything. */
export const EXPORT_PAGE = 200

/**
 * The workbook's two tabs, by when a lead arrived (the owner's decision,
 * 2026-10-07): "New leads" from 1 October 2026, "Jul–Sep 2026" for 1 July to
 * 30 September. Anything older is not shown.
 */
export const NEW_FROM = Date.parse('2026-10-01T00:00:00+03:00')
export const HISTORY_FROM = Date.parse('2026-07-01T00:00:00+03:00')

export function periodOf(iso) {
  const t = Date.parse(iso || '')
  if (Number.isNaN(t)) return 'new'
  if (t >= NEW_FROM) return 'new'
  if (t >= HISTORY_FROM) return 'history'
  return ''
}

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
  // Read against the criteria at all? An older lead (version 1) has none, and
  // its blanks mean "not asked", not "no".
  const v2 = (lead.criteria_version || 1) >= 2
  const email = lead.source === 'email'
  return {
    id: lead.id,
    period: periodOf(lead.received_at || lead.created_at),
    received: riyadhTime(lead.received_at || lead.created_at),
    source: (SOURCE[lead.source] || lead.source) + (lead.mailbox ? ` (${lead.mailbox})` : ''),
    name: lead.name || '',
    company: lead.company || '',
    email: lead.email || '',
    // Every number they gave, one per line (signature, text or picture).
    phone: phonesOf(lead).join('\n'),
    brief: brief.slice(0, 45_000), // a Sheets cell holds 50,000 characters
    verdict: verdict ? VERDICT[verdict] || verdict : (lead.error ? 'Not checked yet' : ''),
    // In the Sheet: qualified leads AND the doubtful ones ("Needs review"), so
    // the team decides (the owner's decision, 2026-10-07). `qualified` is the
    // flag workbook scripts already pasted read for "goes in the Sheet", so it
    // carries the same meaning as `show`.
    show: verdict === 'qualified' || verdict === 'needs_review',
    // A person decided (in the Sheet's Decision column or on the Lead Agent
    // page): when that takes it out of the Sheet, its row goes even if the
    // team wrote in it.
    byPerson: Boolean(lead.human_verdict),
    qualified: verdict === 'qualified' || verdict === 'needs_review',
    type: lead.verdict === 'duplicate' ? 'duplicate' : [String(lead.category || '').replace(/_/g, ' '), ...criteriaLabels(lead)].filter(Boolean).join(' · '),
    reason: lead.reason || '',
    link: lead.link || '',
    // One column each, for the workbook's filters.
    cameIn: channelLabel(lead),
    folder: email && lead.folder ? FOLDER_LABEL[lead.folder] || lead.folder : '',
    emailType: lead.email_kind === 'free' ? 'Free email' : lead.email_kind === 'company' ? 'Company domain' : '',
    who: v2 && lead.sender_type ? SENDER_LABEL[lead.sender_type] || lead.sender_type : '',
    verified: v2 && lead.source_check ? (lead.source_check === 'verified' ? 'Verified' : 'Not verified') : '',
    request: v2 && lead.request_type ? REQUEST_LABEL[lead.request_type] || lead.request_type : '',
    // Empty when the email does not say: the team fills it in after the call
    // (the sales manager's rule), and the workbook never overwrites theirs.
    project: v2 && lead.project_type ? PROJECT_LABEL[lead.project_type] || lead.project_type : '',
    philips: PHILIPS_LABEL[lead.philips] || '',
    category: lead.verdict === 'duplicate' ? 'duplicate' : String(lead.category || '').replace(/_/g, ' '),
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
  const rows = await deps.db(`leads?workspace_id=eq.${ws}${after}&select=id,source,received_at,created_at,updated_at,name,company,email,phone,subject,message,verdict,human_verdict,category,reason,link,mailbox,error,sender_type,source_check,project_type,request_type,philips,folder,email_kind,criteria_version,phones&order=updated_at.asc,id.asc&limit=${EXPORT_PAGE}`) || []
  const last = rows[rows.length - 1]
  // The workbook's timer is the other watchman: it checks on the website
  // Sheet (and everything else) at most every 10 minutes. See _health.js.
  if (deps.health) await deps.health({ workspaceId: ws }).catch(() => {})
  return {
    status: 200,
    leads: rows.map(toRow),
    next: last ? `${last.updated_at}|${last.id}` : cursor,
    more: rows.length === EXPORT_PAGE,
  }
}

const DECISIONS = { qualified: 'qualified', unqualified: 'unqualified', 'needs review': 'needs_review', needs_review: 'needs_review' }

/**
 * The team's choices from the workbook's Decision column (the owner's
 * decision, 2026-10-07: the Sheet can settle "Needs review" leads). Each is
 * stored as a person's correction, exactly like "Is the agent right?" on the
 * Lead Agent page, and moves updated_at so the workbook's next read brings
 * the result back: an Unqualified row disappears, a Qualified one turns green.
 */
export async function applySheetDecisions(deps, { key, decisions = [] }) {
  if (!isUuid(key)) return { status: 401, error: 'This workbook is not connected to the lead agent (bad key).' }
  const [settings] = await deps.db(`lead_agent_settings?export_key=eq.${key}&select=workspace_id`) || []
  if (!settings) return { status: 401, error: 'This workbook is not connected to the lead agent (unknown key).' }
  const ws = settings.workspace_id
  const now = deps.now().toISOString()
  let applied = 0
  for (const d of (Array.isArray(decisions) ? decisions : []).slice(0, 200)) {
    const verdict = DECISIONS[String(d?.verdict || '').trim().toLowerCase()]
    if (!isUuid(d?.id) || !verdict) continue
    // workspace_id in the filter: a key can only touch its own company's leads.
    const rows = await deps.db(`leads?id=eq.${d.id}&workspace_id=eq.${ws}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { human_verdict: verdict, reviewed_by: null, reviewed_at: now, updated_at: now },
    }) || []
    applied += rows.length
  }
  return { status: 200, applied }
}
