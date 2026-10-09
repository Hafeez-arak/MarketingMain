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
