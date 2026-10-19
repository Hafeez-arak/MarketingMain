// ─── The sales pipeline (2026-10-18) ───────────────────────────────────────
// The owner: approved leads and leads the team adds by hand gather in one
// place, the Pipeline tab, and each moves through stages that follow Odoo's
// own, so they map over when Odoo connects. A lead is in the pipeline when it
// has a stage (20261024_lead_pipeline): approving gives it 'new', and so does
// adding it by hand.
//
// What the stages are called, what a hand-added lead must say, and what is
// due when. Pure, so the server and the page share the rules and the tests
// need neither.

import { SENDER_LABEL, PROJECT_LABEL, CHANNEL_LABEL } from './view.js'

export { CHANNEL_LABEL }

const str = (v) => String(v ?? '').trim()
const clip = (v, n) => str(v).slice(0, n)

/** In order. Won and Lost are the two ends. */
export const STAGES = [
  ['new', 'New'],
  ['contacted', 'Contacted'],
  ['rfq', 'RFQ received'],
  ['quotation', 'Quotation sent'],
  ['negotiating', 'Negotiating'],
  ['won', 'Won'],
  ['lost', 'Lost'],
]
export const STAGE_LABEL = Object.fromEntries(STAGES)
export const OPEN_STAGES = ['new', 'contacted', 'rfq', 'quotation', 'negotiating']

export const LOST_REASON_LABEL = {
  price: 'Price',
  brand: 'Brand not ours / not approved',
  lead_time: 'Lead time or stock',
  no_reply: 'They stopped replying',
  cancelled: 'Project cancelled or on hold',
  other: 'Other',
}

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
const FREE_MAIL = /@(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|proton|protonmail|msn|ymail)\./i

/**
 * A stage change, the next step or the follow-up date, checked. Only the
 * keys that were sent are returned, so one control can change one thing.
 * Lost asks why; leaving Lost clears the why.
 * Returns { values } or { error }.
 */
export function trackFields(body = {}) {
  const values = {}
  if (body.stage !== undefined) {
    const stage = str(body.stage)
    if (!STAGE_LABEL[stage]) return { error: 'Unknown stage.' }
    values.stage = stage
    if (stage === 'lost') {
      const why = str(body.lost_reason)
      if (!LOST_REASON_LABEL[why]) return { error: 'Say why it was lost.' }
      values.lost_reason = why
      values.lost_to = clip(body.lost_to, 200)
    } else {
      values.lost_reason = ''
      values.lost_to = ''
    }
  }
  if (body.next_step !== undefined) values.next_step = clip(body.next_step, 500)
  if (body.follow_up !== undefined) {
    const d = str(body.follow_up)
    if (d && !isDate(d)) return { error: 'The follow-up date is not a date.' }
    values.follow_up = d || null
  }
  return { values }
}

/**
 * A lead the team adds by hand, checked and shaped as a leads row (without
 * the ids and times the server adds). It is qualified by a person: they
 * talked to the customer. Returns { row } or { error }.
 */
export function manualLead(body = {}) {
  const company = clip(body.company, 200)
  const name = clip(body.name, 200)
  if (!company && !name) return { error: 'Give the company or the person\'s name.' }
  const summary = clip(body.summary, 500)
  if (!summary) return { error: 'Say what they want.' }
  const email = clip(body.email, 200).toLowerCase()
  if (email && !isEmail(email)) return { error: 'That email address does not look right.' }
  const channel = str(body.channel) || 'other'
  if (!CHANNEL_LABEL[channel]) return { error: 'Unknown way it came in.' }
  const sender = str(body.sender_type)
  if (sender && !SENDER_LABEL[sender]) return { error: 'Unknown kind of customer.' }
  const project = str(body.project)
  if (project && !PROJECT_LABEL[project]) return { error: 'Unknown project phase.' }
  const phone = clip(body.phone, 60)
  const follow = trackFields({ follow_up: body.follow_up ?? '', next_step: body.next_step ?? '' })
  if (follow.error) return follow
  const details = {
    products: clip(body.products, 300),
    quantity: clip(body.quantity, 100),
    location: clip(body.location, 200),
    urgency: clip(body.deadline, 200),
    brands: clip(body.brands, 200),
  }
  return {
    row: {
      source: 'manual',
      channel,
      company, name, email, phone,
      phones: phone ? [phone] : [],
      subject: summary,
      summary,
      message: clip(body.notes, 4000),
      language: /[؀-ۿ]/.test(`${company} ${summary}`) ? 'ar' : 'en',
      details: Object.fromEntries(Object.entries(details).filter(([, v]) => v)),
      verdict: 'qualified',
      human_verdict: 'qualified',
      category: project ? 'project_enquiry' : 'quotation_request',
      reason: `Added by hand: ${CHANNEL_LABEL[channel].toLowerCase()}.`,
      criteria_version: 2,
      sender_type: sender,
      human_project_type: project || null,
      request_type: 'requirement',
      email_kind: email ? (FREE_MAIL.test(email) ? 'free' : 'company') : '',
      stage: 'new',
      ...follow.values,
    },
  }
}

/** Riyadh's date today, as YYYY-MM-DD. */
export function riyadhToday(now = new Date()) {
  return new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 'overdue', 'today', 'soon' (within 3 days), 'later', or '' for none. */
export function followUpState(date, today) {
  if (!date) return ''
  if (date < today) return 'overdue'
  if (date === today) return 'today'
  const days = (new Date(`${date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000
  return days <= 3 ? 'soon' : 'later'
}

/** "20 Oct". */
export function shortDate(date) {
  if (!date || !isDate(date)) return ''
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/**
 * The pipeline's leads by stage, in stage order, every stage present. Inside
 * a stage, the most pressing follow-up first, then the newest.
 */
export function groupByStage(leads = []) {
  const groups = STAGES.map(([key, label]) => ({ key, label, leads: [] }))
  for (const l of leads) groups.find((g) => g.key === l.stage)?.leads.push(l)
  for (const g of groups) {
    g.leads.sort((a, b) => (a.follow_up || '9999').localeCompare(b.follow_up || '9999')
      || String(b.stage_at || b.received_at || '').localeCompare(String(a.stage_at || a.received_at || '')))
  }
  return groups
}

/** The Pipeline's counts: open leads, follow-ups due today or before, won and lost. */
export function pipelineStats(leads = [], today) {
  const out = { open: 0, due: 0, won: 0, lost: 0 }
  for (const l of leads) {
    if (OPEN_STAGES.includes(l.stage)) {
      out.open++
      const f = followUpState(l.follow_up, today)
      if (f === 'overdue' || f === 'today') out.due++
    } else if (l.stage === 'won') out.won++
    else if (l.stage === 'lost') out.lost++
  }
  return out
}
