// ─── CRM: the screens' logic (v2) ──────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/CRM.md. What Musa's CRM screens compute, written
// again in our words: the pipeline's columns, its four figures and activity
// bars, his list filters and groupings, the form's checks, "My activities",
// and the analysis report's pivot. The database (20261125_crm_2_rules.sql)
// has the last word on every rule; these only say it first.
//
// Pure: no React, no IO, so it is tested (logic.test.js). Dates are
// 'YYYY-MM-DD' strings in Riyadh's day.

export const STATUSES = ['open', 'won', 'lost']
export const ACTIVITY_TYPES = ['call', 'meeting', 'email', 'site_visit', 'task']
export const AUTO_EVENTS = ['pricing', 'technical', 'financial', 'revision']
/** The eight colours a tag can take (crm_tags.color is the index). */
export const TAG_COLORS = ['#78716c', '#2563eb', '#16a34a', '#ca8a04', '#dc2626', '#9333ea', '#0d9488', '#ea580c']
/** Days before the bid is due when its chip turns to a warning (his display choice). */
export const BID_WARN_DAYS = 7
/** His page sizes: the list, "My activities", and the most the board or a grouped list holds. */
export const LIST_PAGE = 30
export const ACTIVITY_PAGE = 50
export const BOARD_MAX = 800
export const GROUP_MAX = 1000

/** Today in Riyadh, as 'YYYY-MM-DD'. */
export function riyadhToday(now = new Date()) {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)
}

/** The Riyadh day a timestamp falls on. */
export const riyadhDay = ts => (ts ? riyadhToday(new Date(ts)) : '')

/** A list item's name (stage, source, reason, tag) in this language: English shows name_en when there is one. */
export function listName(item, lang = 'en') {
  if (!item) return ''
  return (lang !== 'ar' && item.name_en) || item.name || ''
}

/** An organisation's name in this language (Contacts keeps an English and an Arabic one). */
export function orgName(org, lang = 'en') {
  if (!org) return ''
  return (lang === 'ar' ? org.name_ar || org.name : org.name || org.name_ar) || ''
}

/** Who the opportunity is with: its client, else the organisation, else the person. */
export function partyOf(lead, clientsById = {}, lang = 'en') {
  return orgName(clientsById[lead?.client_org_id], lang) || lead?.organization || lead?.contact_name || ''
}

/** Value × probability, only when both are known: unknown is never zero (his rule). */
export function weighted(lead) {
  if (lead?.expected_revenue == null || lead?.probability == null) return null
  return Math.round(Number(lead.expected_revenue) * Number(lead.probability)) / 100
}

/** Whole days from `today` to `date`, negative once passed. */
export function daysUntil(date, today) {
  if (!date || !today) return null
  const ms = Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000)
}

/** The bid's due date as a chip, open opportunities only: null, or { days, tone: 'past' | 'soon' | 'ok' }. */
export function bidChip(lead, today) {
  if (lead?.status !== 'open') return null
  const days = daysUntil(lead.bid_due_date, today)
  if (days == null) return null
  return { days, tone: days < 0 ? 'past' : days <= BID_WARN_DAYS ? 'soon' : 'ok' }
}

/** A date against today: 'late' | 'today' | 'planned' | 'none'. */
export function dueState(date, today) {
  const d = date ? String(date).slice(0, 10) : ''
  if (!d) return 'none'
  return d < today ? 'late' : d === today ? 'today' : 'planned'
}

/** Each opportunity's next planned activity: { leadId: 'YYYY-MM-DD' } from the activities not done. */
export function nextActivities(activities = []) {
  const next = {}
  for (const a of activities) {
    if (a.done_at) continue
    if (!next[a.lead_id] || a.due_date < next[a.lead_id]) next[a.lead_id] = a.due_date
  }
  return next
}

/** His order: the highest priority first, then the newest. */
export function sortLeads(leads = []) {
  return [...leads].sort((a, b) => (b.priority - a.priority)
    || String(b.created_at).localeCompare(String(a.created_at))
    || String(b.lead_no).localeCompare(String(a.lead_no)))
}

// ── The list's filters: OR inside a group, AND across groups (his ListView) ──

export const LEAD_FILTERS = [
  { key: 'open', group: 'status' },
  { key: 'won', group: 'status' },
  { key: 'lost', group: 'status' },
  { key: 'mine', group: 'owner' },
  { key: 'unassigned', group: 'owner' },
  { key: 'overdue', group: 'activity' },
  { key: 'no_activity', group: 'activity' },
  { key: 'starred', group: 'priority' },
  { key: 'this_month', group: 'date' },
]

/** Does this opportunity pass one filter? ctx: { me, today, next, openActs }. */
function passes(key, l, { me, today, next, openActs }) {
  switch (key) {
    case 'open': case 'won': case 'lost': return l.status === key
    case 'mine': return Boolean(me) && l.assigned_to === me
    case 'unassigned': return !l.assigned_to
    // An open opportunity with a planned activity past its date.
    case 'overdue': return l.status === 'open' && (openActs[l.id] || []).some(a => a.due_date < today)
    case 'no_activity': return l.status === 'open' && !next[l.id]
    case 'starred': return l.priority > 0
    case 'this_month': return riyadhDay(l.created_at) >= `${today.slice(0, 7)}-01`
    default: return true
  }
}

/** Apply the active filters (his rule: OR within a group, AND across). */
export function applyFilters(leads = [], active = [], ctx = {}) {
  const c = { me: null, today: riyadhToday(), next: {}, openActs: {}, ...ctx }
  const byGroup = {}
  for (const key of active) {
    const f = LEAD_FILTERS.find(x => x.key === key)
    if (f) (byGroup[f.group] ||= []).push(key)
  }
  return leads.filter(l => Object.values(byGroup).every(keys => keys.some(k => passes(k, l, c))))
}

/** His search: title, number, contact, organisation, phone, the client's name, a tag's name. */
export function searchLeads(leads = [], q = '', { clientsById = {}, tagsOf = () => [] } = {}) {
  const needle = q.trim().toLowerCase()
  if (!needle) return leads
  const has = v => String(v || '').toLowerCase().includes(needle)
  return leads.filter(l => [l.title, l.lead_no, l.contact_name, l.organization, l.phone].some(has)
    || [clientsById[l.client_org_id]?.name, clientsById[l.client_org_id]?.name_ar].some(has)
    || tagsOf(l.id).some(t => has(t.name) || has(t.name_en)))
}

/** His board shows the open opportunities unless a status filter asks otherwise. */
export function boardLeads(leads = [], active = []) {
  const shown = active.some(k => STATUSES.includes(k)) ? leads : leads.filter(l => l.status === 'open')
  return shown.slice(0, BOARD_MAX)
}

/**
 * The board: one column per stage, in the company's order. An archived
 * stage keeps its column while an opportunity on the board sits in it.
 * Each column: its opportunities, the known values' sum (null when none is
 * known) and how many have no value.
 */
export function boardColumns(stages = [], leads = []) {
  return [...stages]
    .sort((a, b) => (a.sequence - b.sequence) || String(a.created_at).localeCompare(String(b.created_at)))
    .filter(s => s.is_active || leads.some(l => l.stage_id === s.id))
    .map(s => {
      const inStage = leads.filter(l => l.stage_id === s.id)
      const known = inStage.filter(l => l.expected_revenue != null)
      return {
        stage: s,
        leads: inStage,
        total: known.length ? known.reduce((sum, l) => sum + Number(l.expected_revenue), 0) : null,
        unknown: inStage.length - known.length,
      }
    })
}

/** A column's activity bar, over its open opportunities: how many late, today, planned later, none. */
export function activityBar(leads = [], next = {}, today) {
  const bar = { late: 0, today: 0, planned: 0, none: 0 }
  for (const l of leads) if (l.status === 'open') bar[dueState(next[l.id], today)] += 1
  return bar
}

/**
 * The four figures above his pipeline, from the open opportunities on the
 * board: how many (and how many have no value), the known expected value,
 * the value weighted by probability where both are known (and how many
 * lack one), and the late activities on them. Null when none is open.
 */
export function pipelineFigures(leads = [], activities = [], today) {
  const open = leads.filter(l => l.status === 'open')
  if (!open.length) return null
  const ids = new Set(open.map(l => l.id))
  const known = open.filter(l => l.expected_revenue != null)
  const weights = open.map(weighted).filter(w => w != null)
  return {
    open: open.length,
    noValue: open.length - known.length,
    expected: known.length ? known.reduce((s, l) => s + Number(l.expected_revenue), 0) : null,
    weighted: weights.length ? Math.round(weights.reduce((s, w) => s + w, 0) * 100) / 100 : null,
    noWeight: open.length - weights.length,
    late: activities.filter(a => !a.done_at && ids.has(a.lead_id) && a.due_date < today).length,
  }
}

// ── Grouping (his "group by") ──

export const LEAD_GROUPS = ['stage', 'status', 'source', 'assignee', 'priority']

/** A row's group key; '' for "none" (no source, nobody). */
export function leadGroupKey(l, group) {
  switch (group) {
    case 'stage': return l.stage_id
    case 'status': return l.status
    case 'source': return l.source_id || ''
    case 'assignee': return l.assigned_to || ''
    case 'priority': return String(l.priority || 0)
    default: return ''
  }
}

/** Rows in groups, in the order each group first appears (the list's own order). */
export function groupRows(rows = [], keyOf) {
  const groups = []
  const at = new Map()
  for (const r of rows) {
    const key = keyOf(r)
    if (!at.has(key)) { at.set(key, groups.length); groups.push({ key, rows: [] }) }
    groups[at.get(key)].rows.push(r)
  }
  return groups
}

/** One page of rows, counting from 0. */
export function pageOf(rows = [], page = 0, size = LIST_PAGE) {
  return rows.slice(page * size, (page + 1) * size)
}

// ── "My activities" ──

export const ACTIVITY_FILTERS = [
  { key: 'overdue', group: 'when' },
  { key: 'today', group: 'when' },
  { key: 'upcoming', group: 'when' },
  { key: 'all_users', group: 'who' },
]
export const ACTIVITY_GROUPS = ['type', 'assignee']

/**
 * The activities not done yet: mine unless "everyone" is on, then the
 * "when" filters, then the search (the summary, the opportunity's title or
 * number). Earliest first.
 */
export function filterActivities(activities = [], { active = [], me = null, today, q = '', leadsById = {} } = {}) {
  const when = active.filter(k => ['overdue', 'today', 'upcoming'].includes(k))
  const needle = q.trim().toLowerCase()
  const has = v => String(v || '').toLowerCase().includes(needle)
  return activities
    .filter(a => !a.done_at)
    .filter(a => active.includes('all_users') || a.assigned_to === me)
    .filter(a => !when.length || when.some(k => (k === 'overdue' ? a.due_date < today : k === 'today' ? a.due_date === today : a.due_date > today)))
    .filter(a => !needle || has(a.summary) || has(leadsById[a.lead_id]?.title) || has(leadsById[a.lead_id]?.lead_no))
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || String(a.created_at).localeCompare(String(b.created_at)))
}

/** An opportunity's activities as his record shows them: planned first, by date; then done, latest first. */
export function recordActivities(activities = []) {
  return [...activities].sort((a, b) => (Boolean(a.done_at) - Boolean(b.done_at))
    || a.due_date.localeCompare(b.due_date)
    || String(b.done_at || '').localeCompare(String(a.done_at || '')))
}

/** Counters for Home (his home board): my late, my today, my open opportunities with nothing planned. */
export function homeCounts({ activities = [], leads = [], me, today }) {
  const mine = activities.filter(a => !a.done_at && a.assigned_to === me)
  const next = nextActivities(activities)
  return {
    late: mine.filter(a => a.due_date < today).length,
    today: mine.filter(a => a.due_date === today).length,
    idle: leads.filter(l => l.status === 'open' && l.assigned_to === me && !next[l.id]).length,
  }
}

// ── The form ──

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MONEY = /^\d+(\.\d{1,2})?$/
const LIMITS = { title: 255, contact_name: 255, organization: 255, phone: 30, city: 100, consultant: 255, project_owner: 255, tender_ref: 255, notes: 10000 }

export function emptyLead() {
  return {
    title: '', priority: 0, client_org_id: '', organization: '', contact_name: '', phone: '', email: '', city: '',
    consultant: '', project_owner: '', bid_due_date: '', tender_ref: '', stage_id: '', source_id: '', assigned_to: '',
    expected_close_date: '', expected_revenue: '', probability: '', notes: '', tag_ids: [],
  }
}

/**
 * The opportunity form's checks (his PHP validation and the database's
 * checks): { field: code }, empty when it can be saved.
 */
export function validateLead(f = {}) {
  const t = k => String(f[k] ?? '').trim()
  const errors = {}
  if (!t('title')) errors.title = 'required'
  for (const [k, max] of Object.entries(LIMITS)) if (t(k).length > max) errors[k] = 'too_long'
  if (!t('contact_name') && !t('organization') && !t('client_org_id')) errors.contact_name = 'someone'
  if (t('email') && !EMAIL.test(t('email'))) errors.email = 'email'
  if (t('expected_revenue') && (!MONEY.test(t('expected_revenue')) || Number(t('expected_revenue')) > 999999999999)) errors.expected_revenue = 'money'
  if (t('probability') && (!/^\d+$/.test(t('probability')) || Number(t('probability')) > 100)) errors.probability = 'percent'
  if (!t('stage_id')) errors.stage_id = 'required'
  const p = Number(f.priority ?? 0)
  if (!Number.isInteger(p) || p < 0 || p > 3) errors.priority = 'priority'
  return errors
}

/** The form's fields as a crm_leads row (blanks as null; the database trims). */
export function leadRow(f = {}) {
  const t = k => String(f[k] ?? '').trim()
  const orNull = k => t(k) || null
  return {
    title: t('title'),
    priority: Number(f.priority || 0),
    client_org_id: orNull('client_org_id'),
    organization: orNull('organization'),
    contact_name: orNull('contact_name'),
    phone: orNull('phone'),
    email: orNull('email'),
    city: orNull('city'),
    consultant: orNull('consultant'),
    project_owner: orNull('project_owner'),
    bid_due_date: orNull('bid_due_date'),
    tender_ref: orNull('tender_ref'),
    stage_id: orNull('stage_id'),
    source_id: orNull('source_id'),
    assigned_to: orNull('assigned_to'),
    expected_close_date: orNull('expected_close_date'),
    expected_revenue: t('expected_revenue') === '' ? null : Number(t('expected_revenue')),
    probability: t('probability') === '' ? null : Number(t('probability')),
    notes: orNull('notes'),
  }
}

/** A planned activity's checks: { field: code }. */
export function validateActivity(a = {}) {
  const errors = {}
  if (!ACTIVITY_TYPES.includes(a.activity_type)) errors.activity_type = 'required'
  const s = String(a.summary || '').trim()
  if (!s) errors.summary = 'required'
  else if (s.length > 500) errors.summary = 'too_long'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.due_date || ''))) errors.due_date = 'required'
  if (!a.assigned_to) errors.assigned_to = 'required'
  return errors
}

// ── Settings ──

export const LIST_KINDS = ['stages', 'sources', 'reasons', 'tags']
export const LIST_TABLES = { stages: 'crm_stages', sources: 'crm_sources', reasons: 'crm_lost_reasons', tags: 'crm_tags' }

/** His settings order: active first, then stages by their number, the rest by name. */
export function settingsOrder(kind, items = []) {
  return [...items].sort((a, b) => (Number(b.is_active) - Number(a.is_active))
    || (kind === 'stages' ? a.sequence - b.sequence || String(a.created_at).localeCompare(String(b.created_at)) : 0)
    || String(a.name).localeCompare(String(b.name)))
}

/** A new stage goes last unless a number is given: the highest so far plus ten. */
export const nextSequence = (stages = []) => stages.reduce((m, s) => Math.max(m, s.sequence), 0) + 10

/** A list item's checks: { field: code }. */
export function validateListItem(kind, f = {}, others = []) {
  const errors = {}
  const name = String(f.name || '').trim()
  if (!name) errors.name = 'required'
  else if (name.length > 120) errors.name = 'too_long'
  else if (others.some(o => o.id !== f.id && o.name === name)) errors.name = 'taken'
  if (String(f.name_en || '').trim().length > 120) errors.name_en = 'too_long'
  if (kind === 'stages' && String(f.sequence ?? '') !== '') {
    const n = Number(f.sequence)
    if (!Number.isInteger(n) || n < 0 || n > 9999) errors.sequence = 'sequence'
  }
  if (kind === 'stages' && f.auto_event && others.some(o => o.id !== f.id && o.auto_event === f.auto_event)) errors.auto_event = 'taken'
  return errors
}

// ── The analysis report (his CRM pivot) ──

export const REPORT_DIMS = ['stage', 'status', 'source', 'assignee', 'lost_reason', 'month']
export const REPORT_MEASURES = ['count', 'expected', 'weighted', 'unknown', 'won', 'win_rate']
/** Measures that add up across rows (a share of the total means something). */
export const ADDITIVE = new Set(['count', 'expected', 'weighted', 'unknown', 'won'])
export const REPORT_FILTERS = [{ key: 'open', group: 's' }, { key: 'closed', group: 's' }]

/**
 * One fact per opportunity, with every dimension already named in the
 * reader's language ('—' when there is none, as his report).
 */
export function reportFacts(leads = [], { stagesById = {}, sourcesById = {}, reasonsById = {}, peopleById = {}, lang = 'en' } = {}) {
  return leads.map(l => ({
    created_on: riyadhDay(l.created_at),
    status: l.status,
    stage: listName(stagesById[l.stage_id], lang) || '—',
    source: listName(sourcesById[l.source_id], lang) || '—',
    assignee: peopleById[l.assigned_to]?.name || '—',
    lost_reason: listName(reasonsById[l.lost_reason_id], lang) || '—',
    expected: l.expected_revenue == null ? null : Number(l.expected_revenue),
    weighted: weighted(l),
  }))
}

const sumKnown = (facts, k) => {
  const known = facts.filter(f => f[k] != null)
  return known.length ? known.reduce((s, f) => s + f[k], 0) : null
}

/** A measure over a set of facts (null when it cannot be computed, never a made-up 0). */
export function measure(facts = [], m) {
  switch (m) {
    case 'count': return facts.length
    case 'expected': return sumKnown(facts, 'expected')
    case 'weighted': return sumKnown(facts, 'weighted')
    case 'unknown': return facts.filter(f => f.expected == null).length
    case 'won': return facts.filter(f => f.status === 'won').length
    case 'win_rate': {
      const closed = facts.filter(f => f.status !== 'open').length
      return closed ? (100 * facts.filter(f => f.status === 'won').length) / closed : null
    }
    default: return null
  }
}

const dimKey = (f, dim) => (dim === 'month' ? f.created_on.slice(0, 7) : f[dim])

/** The report's facts after its filters (open / closed, OR-ed) and date range (inclusive). */
export function reportScope(facts = [], { active = [], from = '', to = '' } = {}) {
  const wanted = active.filter(k => k === 'open' || k === 'closed')
  return facts.filter(f => (!wanted.length || wanted.some(k => (k === 'open' ? f.status === 'open' : f.status !== 'open')))
    && (!from || f.created_on >= from) && (!to || f.created_on <= to))
}

/** His ordering: months and statuses in their natural order, everything else largest first. */
function orderKeys(keys, dim, totals) {
  if (dim === 'month') return [...keys].sort()
  if (dim === 'status') return [...keys].sort((a, b) => STATUSES.indexOf(a) - STATUSES.indexOf(b))
  return [...keys].sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0))
}

/**
 * The pivot: rows by one dimension, optionally columns by another, one
 * measure. Totals are computed on each set (a win rate is never summed).
 */
export function pivot(facts = [], { row = 'stage', col = '', m = 'count' } = {}) {
  const byRow = groupRows(facts, f => dimKey(f, row))
  const rowTotals = Object.fromEntries(byRow.map(g => [g.key, measure(g.rows, m)]))
  const rows = orderKeys(byRow.map(g => g.key), row, rowTotals)
  if (!col || col === row) {
    return { rows, cols: [], cells: {}, rowTotals, colTotals: {}, grand: measure(facts, m) }
  }
  const byCol = groupRows(facts, f => dimKey(f, col))
  const colTotals = Object.fromEntries(byCol.map(g => [g.key, measure(g.rows, m)]))
  const cols = orderKeys(byCol.map(g => g.key), col, colTotals)
  const cells = {}
  for (const g of byRow) {
    cells[g.key] = {}
    for (const c of groupRows(g.rows, f => dimKey(f, col))) cells[g.key][c.key] = measure(c.rows, m)
  }
  return { rows, cols, cells, rowTotals, colTotals, grand: measure(facts, m) }
}

/** The quick date ranges of his report: this month, last month, this quarter, this year, last year. */
export function quickRanges(today) {
  const [y, mo] = today.split('-').map(Number)
  const pad = n => String(n).padStart(2, '0')
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  const prevY = mo === 1 ? y - 1 : y
  const prevM = mo === 1 ? 12 : mo - 1
  const q0 = Math.floor((mo - 1) / 3) * 3 + 1
  return {
    this_month: [`${y}-${pad(mo)}-01`, `${y}-${pad(mo)}-${pad(lastDay(y, mo))}`],
    last_month: [`${prevY}-${pad(prevM)}-01`, `${prevY}-${pad(prevM)}-${pad(lastDay(prevY, prevM))}`],
    this_quarter: [`${y}-${pad(q0)}-01`, `${y}-${pad(q0 + 2)}-${pad(lastDay(y, q0 + 2))}`],
    this_year: [`${y}-01-01`, `${y}-12-31`],
    last_year: [`${y - 1}-01-01`, `${y - 1}-12-31`],
  }
}

/** A measure's value as text: whole numbers, money with two decimals, a percentage with one; '—' when unknown. */
export function fmtMeasure(v, m) {
  if (v == null) return '—'
  if (m === 'count' || m === 'unknown' || m === 'won') return Math.round(v).toLocaleString('en-US')
  if (m === 'win_rate') return `${v.toFixed(1)}%`
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** A plain number with two decimals ('—' when unknown), for values on cards and pages. */
export const fmtMoney = v => (v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

const csvCell = v => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The pivot as CSV lines (his export): a title, the range, the header, the rows, the total. */
export function pivotCsv(p, { title, range, rowLabel, label = k => k, colLabel = k => k, totalLabel, m }) {
  const num = v => (v == null ? '' : m === 'win_rate' ? v.toFixed(1) : ['count', 'unknown', 'won'].includes(m) ? String(Math.round(v)) : v.toFixed(2))
  const lines = [[title], [range], [rowLabel, ...p.cols.map(colLabel), totalLabel]]
  for (const r of p.rows) lines.push([label(r), ...p.cols.map(c => num(p.cells[r]?.[c])), num(p.rowTotals[r])])
  lines.push([totalLabel, ...p.cols.map(c => num(p.colTotals[c])), num(p.grand)])
  return lines.map(l => l.map(csvCell).join(',')).join('\n')
}

// ── The history ──

/**
 * A history row as the page shows it: who (the opportunity or an activity),
 * what (created / changed / deleted), and the fields that changed as
 * [field, old, new] in the reader's words (`show(field, value)`).
 */
export function describeHistory(row, show = (f, v) => v) {
  const changes = Object.entries(row.changes || {})
    .map(([f, [from, to]]) => [f, from == null || from === '' ? '—' : String(show(f, from)), to == null || to === '' ? '—' : String(show(f, to))])
  return { who: row.activity_id ? 'activity' : 'lead', action: row.action, label: row.label, changes }
}
