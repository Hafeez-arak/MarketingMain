// ─── Who follows the LinkedIn page ─────────────────────────────────────────
// The CEO's question (request, 2026-10-19): are the page's ~4,900 followers
// potential customers, or mostly job seekers and suppliers? The follower count
// and its growth cannot answer that; LinkedIn's follower demographics can.
//
// Zernio's /analytics/linkedin/demographics gives the LIFETIME breakdown by job
// function, seniority, industry and company size. It does NOT give location:
// LinkedIn's API has a country breakdown, Zernio does not pass it on, so "how
// many followers are in Saudi Arabia" cannot be answered from here. The screen
// says so rather than leaving the gap unexplained.
//
// Because the breakdown is lifetime, not "this week", the weekly view is made
// by keeping a snapshot per week (linkedin_audience_snapshots) and comparing
// the latest with the week before. Shared by the server (which stores
// snapshots) and the browser (which draws them), so the rules that decide
// "customer sector" are written once.

export const DIMENSIONS = ['industry', 'function', 'seniority', 'company_size']

// LinkedIn returns at most the top 100 values per breakdown.
const MAX_ROWS = 100

/**
 * Zernio's response → `{ industry: [{ label, id, value }], … }`.
 *
 * Unknown dimensions are dropped, rows without a positive count are dropped,
 * and each list is sorted largest first so a stored snapshot never depends on
 * the order Zernio happened to send.
 */
export function cleanDemographics(raw = {}) {
  const src = raw?.demographics && typeof raw.demographics === 'object' ? raw.demographics : raw || {}
  const out = {}
  for (const dim of DIMENSIONS) {
    const rows = Array.isArray(src[dim]) ? src[dim] : []
    out[dim] = rows
      .map(r => ({
        label: String(r?.dimension || r?.label || r?.id || '').trim(),
        id: String(r?.id || '').trim(),
        value: Math.max(0, Math.round(Number(r?.value) || 0)),
      }))
      .filter(r => r.label && r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_ROWS)
  }
  return out
}

/** Whether a cleaned breakdown holds anything at all. */
export const hasDemographics = d => DIMENSIONS.some(dim => (d?.[dim] || []).length > 0)

// ── The buckets that answer the question ──
//
// Matched on LinkedIn's standardised English industry names. Customer sectors
// first: a row is counted once, in the first bucket it matches.
//
// Customer sectors are the ones the request named — construction,
// engineering, hospitality, real estate — plus architecture and interior
// design, because for a lighting company the designer who specifies the
// fitting is as much the customer as the contractor who buys it.
const CUSTOMER_SECTORS = /construction|contractor|architect|real estate|civil engineering|engineering services|interior design|design services|hospitality|hotel|restaurant|food and beverage services|facilities services/i

// Lighting and electrical makers and traders: the suppliers and peers the CEO
// suspected. They follow a lighting brand because they sell to it or compete
// with it, not because they buy from it.
const LIGHTING_TRADE = /lighting|electrical|electronic|wholesale|import and export|international trade/i

export function industryBucket(label = '') {
  if (CUSTOMER_SECTORS.test(label)) return 'customer'
  if (LIGHTING_TRADE.test(label)) return 'trade'
  return 'other'
}

// LinkedIn's seniority ids are ordered: 1 Unpaid, 2 Training, 3 Entry,
// 4 Senior, 5 Manager, 6 Director, 7 VP, 8 CXO, 9 Partner, 10 Owner. Read
// from the id rather than the label so a renamed label cannot move a row.
const seniorityRank = id => Number(String(id || '').match(/(\d+)$/)?.[1]) || 0

const sum = rows => rows.reduce((n, r) => n + r.value, 0)
const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

/**
 * The four numbers the request is really about, as shares of the followers
 * who list that field (a breakdown never adds up to the follower count —
 * people without the field on their profile are left out by LinkedIn).
 */
export function audienceMix(demo = {}) {
  const industry = demo.industry || []
  const seniority = demo.seniority || []
  const industryTotal = sum(industry)
  const seniorityTotal = sum(seniority)
  const customer = sum(industry.filter(r => industryBucket(r.label) === 'customer'))
  const trade = sum(industry.filter(r => industryBucket(r.label) === 'trade'))
  const deciders = sum(seniority.filter(r => seniorityRank(r.id) >= 5))
  const early = sum(seniority.filter(r => { const k = seniorityRank(r.id); return k >= 1 && k <= 3 }))
  return {
    customer_sectors: { count: customer, pct: share(customer, industryTotal) },
    lighting_trade: { count: trade, pct: share(trade, industryTotal) },
    decision_makers: { count: deciders, pct: share(deciders, seniorityTotal) },
    early_career: { count: early, pct: share(early, seniorityTotal) },
    industry_total: industryTotal,
    seniority_total: seniorityTotal,
  }
}

/** Percentage-point change, one decimal; null when either side is missing. */
export function pointChange(now, before) {
  if (typeof now !== 'number' || typeof before !== 'number') return null
  return Math.round((now - before) * 10) / 10
}

/**
 * One breakdown's rows with their share and the change since the previous
 * snapshot, matched by id (labels are not guaranteed stable).
 */
export function compareRows(rows = [], previousRows = null) {
  const total = sum(rows)
  const prevTotal = previousRows ? sum(previousRows) : 0
  const prevById = new Map((previousRows || []).map(r => [r.id || r.label, r]))
  return rows.map(r => {
    const pct = share(r.value, total)
    const prev = previousRows ? prevById.get(r.id || r.label) : null
    return {
      ...r,
      pct,
      change: previousRows ? r.value - (prev?.value || 0) : null,
      pct_change: previousRows ? pointChange(pct, prev ? share(prev.value, prevTotal) : 0) : null,
    }
  })
}

// ── Weeks ──
// A week starts on Sunday in Riyadh, the same morning the CEO's brief is
// written, so "this week's snapshot" and "this week's brief" agree.
const RIYADH_OFFSET_MS = 3 * 3_600_000

/** YYYY-MM-DD of the Sunday (Riyadh time) that starts the week holding `now`. */
export function weekStartOf(now = new Date()) {
  const local = new Date(new Date(now).getTime() + RIYADH_OFFSET_MS)
  local.setUTCDate(local.getUTCDate() - local.getUTCDay())
  return local.toISOString().slice(0, 10)
}

/** The Sunday seven days before a week start. */
export function previousWeekStart(weekStart) {
  const d = new Date(`${weekStart}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 7)
  return d.toISOString().slice(0, 10)
}

/**
 * Stored snapshots (any order) → the latest, and the one for the week before
 * it. "The week before" means exactly seven days earlier: a gap (no snapshot
 * last week) is reported as no comparison, never as a comparison against
 * something older that would overstate the change.
 */
export function latestPair(snapshots = []) {
  const sorted = [...(snapshots || [])]
    .filter(s => s?.week_start && hasDemographics(s.demographics))
    .sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)))
  const current = sorted[0] || null
  if (!current) return { current: null, previous: null }
  const want = previousWeekStart(current.week_start)
  return { current, previous: sorted.find(s => s.week_start === want) || null }
}

/**
 * The compact summary the CEO's brief reads. Numbers only, computed here, so
 * the model has nothing to estimate.
 */
export function audienceSummary(snapshots = []) {
  const { current, previous } = latestPair(snapshots)
  if (!current) return { available: false }
  const now = audienceMix(current.demographics)
  const before = previous ? audienceMix(previous.demographics) : null
  const pick = key => ({
    pct: now[key].pct,
    change_points_vs_last_week: before ? pointChange(now[key].pct, before[key].pct) : null,
  })
  return {
    available: true,
    week_of: current.week_start,
    compared_with_week_of: previous?.week_start || null,
    followers: current.followers ?? null,
    customer_sectors: pick('customer_sectors'),
    lighting_trade: pick('lighting_trade'),
    decision_makers: pick('decision_makers'),
    early_career: pick('early_career'),
    top_industries: (current.demographics.industry || []).slice(0, 5).map(r => ({ name: r.label, followers: r.value })),
    notes:
      'Shares are of followers who list that field on LinkedIn. customer_sectors = construction, ' +
      'contracting, engineering, architecture and design, real estate and hospitality; lighting_trade = ' +
      'lighting and electrical manufacturers, wholesalers and import/export (suppliers and peers, not ' +
      'buyers); decision_makers = manager and above; early_career = entry level, training and unpaid. ' +
      'LinkedIn location is not available, so the share in Saudi Arabia is unknown — do not estimate it.',
  }
}
