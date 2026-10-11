// ─── Lead Agent page: what the numbers and labels say ──────────────────────
// Pure, so the page's counts are tested without a browser.

export const VERDICT_LABEL = {
  qualified: 'Qualified',
  unqualified: 'Unqualified',
  needs_review: 'Needs review',
  duplicate: 'Duplicate',
  pending: 'Not checked yet',
}

export const VERDICT_TONE = {
  qualified: 'bg-sage-100 text-sage-700',
  unqualified: 'bg-stone-100 text-stone-600',
  needs_review: 'bg-amber-100 text-amber-800',
  duplicate: 'bg-sky-50 text-sky-700',
  pending: 'bg-red-50 text-red-600',
}

export const SOURCE_LABEL = { website_form: 'Website', email: 'Email' }

/** What a lead counts as: a person's correction wins over the agent. */
export function effectiveVerdict(lead) {
  if (lead?.human_verdict) return lead.human_verdict
  return lead?.verdict || 'pending'
}

const sameMonth = (iso, now) => {
  const d = new Date(iso)
  return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()
}

/**
 * This month's counts. A lead belongs to the month it ARRIVED in (or was
 * stored, when the Sheet's time could not be read), so backfilling old rows
 * does not inflate this month.
 */
export function monthStats(leads = [], now = new Date()) {
  const out = { qualified: 0, unqualified: 0, needs_review: 0, duplicate: 0, pending: 0, total: 0, spend: 0, reviewed: 0, corrected: 0 }
  for (const l of leads) {
    if (!sameMonth(l.received_at || l.created_at, now)) continue
    out.total++
    out[effectiveVerdict(l)]++
    if (l.human_verdict) {
      out.reviewed++
      if (l.verdict && l.verdict !== 'duplicate' && l.human_verdict !== l.verdict) out.corrected++
    }
  }
  // Spend is when it was spent, whatever month the enquiry is from.
  out.spend = leads.filter((l) => sameMonth(l.created_at, now)).reduce((s, l) => s + (Number(l.cost_usd) || 0), 0)
  return out
}

/**
 * How the website Sheet's timer is doing, from the last time it called in.
 * It calls every five minutes, so more than twenty minutes of silence means
 * it has stopped.
 */
export function sheetHealth(lastIntakeAt, now = new Date()) {
  if (!lastIntakeAt) return { state: 'never', label: 'Not connected yet' }
  const mins = Math.round((now.getTime() - new Date(lastIntakeAt).getTime()) / 60_000)
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 2880 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`
  return mins > 20 ? { state: 'stale', label: `Last checked ${ago}` } : { state: 'ok', label: `Checked ${ago}` }
}

/** "GPT-6 Luna" from "openai/gpt-6-luna". */
export function modelName(id = '') {
  const known = { 'openai/gpt-6-luna': 'GPT-6 Luna' }
  return known[id] || id.split('/').pop() || ''
}

// ─── Paging ────────────────────────────────────────────────────────────────
// The list is read one page at a time from Supabase, filtered there, so
// every lead is reachable however many there are.

export const PAGE_SIZE = 25

/**
 * A tab as a PostgREST `or` filter on the effective verdict (a person's
 * correction wins). null for "all".
 */
export function verdictFilter(tab = 'all') {
  if (tab === 'all') return null
  if (tab === 'pending') return 'and(human_verdict.is.null,verdict.is.null)'
  return `human_verdict.eq.${tab},and(human_verdict.is.null,verdict.eq.${tab})`
}

/** The first and last row (inclusive) of a 0-based page. */
export function pageRange(page = 0, size = PAGE_SIZE) {
  const from = Math.max(0, page) * size
  return { from, to: from + size - 1 }
}

/** "26–50 of 542". */
export function pageLabel(page, size, total) {
  if (!total) return '0 of 0'
  const { from, to } = pageRange(page, size)
  return `${from + 1}–${Math.min(to + 1, total)} of ${total}`
}

export const pageCount = (total, size = PAGE_SIZE) => Math.max(1, Math.ceil((Number(total) || 0) / size))

// ─── The sales team's criteria, in their words (2026-10-11) ────────────────

export const SENDER_LABEL = {
  contractor: 'Contractor', developer_owner: 'Developer / owner', consultant: 'Consultant', end_client: 'End client',
  facility_company: 'Facility company', trader: 'Trader', individual: 'Individual', unknown: 'Sender unclear',
}
export const PROJECT_LABEL = { jih: 'JIH', tender: 'Tender', maintenance: 'Maintenance' }
export const REQUEST_LABEL = { requirement: 'Requirement', inquiry: 'Inquiry' }
export const FOLDER_LABEL = { inbox: 'Inbox', junk: 'Junk', deleted: 'Deleted items', archive: 'Archive', other: 'Other folder', website: 'Website form' }
export const PHILIPS_LABEL = { only: 'Philips only', mixed: 'Philips + others', or_equivalent: 'Philips or equivalent' }

/**
 * The criteria a lead was read against, as short labels in a fixed order:
 * who, verified, phase, what, Philips, folder, email kind. Only what is known;
 * a lead read before the criteria (version 1) gives none.
 */
export function criteriaLabels(lead = {}) {
  if ((lead.criteria_version || 1) < 2) return []
  const out = []
  if (lead.sender_type) out.push(SENDER_LABEL[lead.sender_type] || lead.sender_type)
  if (lead.source_check) out.push(lead.source_check === 'verified' ? 'Verified' : 'Not verified')
  if (lead.project_type) out.push(PROJECT_LABEL[lead.project_type] || lead.project_type)
  if (lead.request_type) out.push(REQUEST_LABEL[lead.request_type] || lead.request_type)
  if (PHILIPS_LABEL[lead.philips]) out.push(PHILIPS_LABEL[lead.philips])
  if (lead.folder && lead.folder !== 'inbox') out.push(FOLDER_LABEL[lead.folder] || lead.folder)
  if (lead.email_kind === 'free') out.push('Free email')
  return out
}

// ─── The leads list's filters (the sales view, 2026-10-11) ─────────────────

/** What the "Show" filter offers. "Leads" = qualified + needs review: what sales works on. */
export const SHOW_OPTIONS = [
  { key: 'leads', label: 'Leads to work on' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'unqualified', label: 'Unqualified' },
  { key: 'duplicate', label: 'Duplicates' },
  { key: 'pending', label: 'Not checked yet' },
  { key: 'all', label: 'Everything' },
]

export const EMPTY_FILTERS = { show: 'leads', sender: '', project: '', request: '', folder: '', emailKind: '', search: '' }

/**
 * The filters as PostgREST conditions: `or` groups (each its own `or=`
 * parameter, so they AND together) and plain `eq` pairs. Pure, so the list's
 * rules are tested without Supabase. A person's verdict wins over the agent's.
 */
export function leadFilters(f = EMPTY_FILTERS) {
  const ors = []
  const eqs = []
  if (f.show === 'leads') {
    ors.push('human_verdict.in.(qualified,needs_review),and(human_verdict.is.null,verdict.in.(qualified,needs_review))')
  } else if (f.show && f.show !== 'all') {
    ors.push(verdictFilter(f.show))
  }
  if (f.sender) eqs.push(['sender_type', f.sender])
  // "Not stated" is the empty phase: sales fills it in after the call.
  if (f.project) eqs.push(['project_type', f.project === 'none' ? '' : f.project])
  if (f.request) eqs.push(['request_type', f.request])
  if (f.folder) eqs.push(['folder', f.folder])
  if (f.emailKind) eqs.push(['email_kind', f.emailKind])
  // PostgREST's or-syntax uses , ( ) and quotes: keep them out of the words.
  const words = String(f.search || '').replace(/[,()"'*\\%]/g, ' ').replace(/\s+/g, ' ').trim()
  if (words) {
    const like = `*${words}*`
    ors.push(['company', 'name', 'email', 'subject', 'summary', 'message'].map((c) => `${c}.ilike.${like}`).join(','))
  }
  return { ors, eqs }
}

/** How many filters besides "Show" are set, for the "Clear filters" button. */
export const activeFilterCount = (f = EMPTY_FILTERS) =>
  ['sender', 'project', 'request', 'folder', 'emailKind', 'search'].filter((k) => String(f[k] || '').trim()).length

/** "$0.0098" for small amounts, "$9.60" otherwise. */
export const money = (n) => `$${(Number(n) || 0).toFixed(n && n < 0.1 ? 4 : 2)}`

/** "6 Oct, 13:00" in Riyadh time. */
export function when(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' })
}
