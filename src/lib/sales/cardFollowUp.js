// ─── The battle card after the call: clock, odds, follow-ups, close ────────
// The owner's Part 1 (2026-11-07), from the CRM and email analysis: most
// deals die after the quote, not before it: most quotes get no answer, many
// get no follow-up, and most lost deals carry no reason. So the card gains:
//
//   the quote clock   the deadline against our usual turnaround, on step 1
//   the deal odds     how often we win at the target price's size, on step 3
//   the follow-ups    "quote sent on" makes three reminders (day 3, 10, 30),
//                     each an Odoo to-do for the salesperson (step 4)
//   the close         Odoo's Won / Lost and its reason, read back (step 5)
//
// The numbers are one company's own (sales_icp.battle_cards.lead.quote_days
// and .size_odds), so none sit in this public repository; without them the
// clock and the odds are simply not shown. Steps 4 and 5 run for the leads
// of the people on the pilot list (sales_icp.battle_cards.pilot, emails),
// empty until the owner names them; admins see them to preview.
//
// Pure. No network.

const str = (v) => String(v ?? '').trim()
const list = (v) => (Array.isArray(v) ? v : [])
const DAY = 86_400_000

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(str(v)) && !Number.isNaN(new Date(`${str(v)}T00:00:00Z`).getTime())
const toDate = (v) => new Date(`${str(v).slice(0, 10)}T00:00:00Z`)
const iso = (d) => d.toISOString().slice(0, 10)
const daysBetween = (from, to) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY)

/** "2026-11-12" → "12 Nov". */
export function dayMonth(v) {
  if (!isDate(v)) return ''
  return toDate(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

// ─── The quote clock ───────────────────────────────────────────────────────

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

/**
 * A date written in the enquiry's urgency line ("by 18 Oct", "12/11/2026",
 * "Nov 3", "2026-11-12"), as YYYY-MM-DD, or ''. A date without a year is
 * the first such date on or after the enquiry (a deadline is never before it).
 * Day first for numbers, as Saudi senders write them.
 */
export function deadlineFrom(text = '', receivedAt = '') {
  const t = str(text).toLowerCase()
  if (!t) return ''
  const base = isDate(str(receivedAt).slice(0, 10)) ? toDate(receivedAt) : null
  const pick = (y, m, d) => {
    if (m < 0 || m > 11 || d < 1 || d > 31) return ''
    if (y == null) {
      if (!base) return ''
      y = base.getUTCFullYear()
      if (Date.UTC(y, m, d) < base.getTime()) y += 1
    }
    const out = new Date(Date.UTC(y < 100 ? 2000 + y : y, m, d))
    return out.getUTCDate() === d ? iso(out) : ''
  }
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (m) return pick(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  m = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/)
  if (m) return pick(m[3] ? Number(m[3]) : null, Number(m[2]) - 1, Number(m[1]))
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?/)
  if (m) return pick(m[3] ? Number(m[3]) : null, MONTHS[m[2]], Number(m[1]))
  m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/)
  if (m) return pick(m[3] ? Number(m[3]) : null, MONTHS[m[1]], Number(m[2]))
  return ''
}

/** The company's usual days from request to quote, or 0 (no clock). */
export function turnaroundDays(playbook = {}) {
  const n = Number(playbook?.quote_days)
  return Number.isFinite(n) && n > 0 && n < 365 ? Math.round(n) : 0
}

/**
 * The quote clock for one lead: the offer's due date (the card's "quote
 * due", else a date in the enquiry) against today and our usual turnaround.
 * Once the quote is sent, it says when and how long it took.
 * Returns { tone: 'late' | 'tight' | 'ok' | 'sent', text, due } or null.
 */
export function quoteClock({ quoteDue = '', urgency = '', receivedAt = '', sentOn = '', turnaround = 0, today = '' } = {}) {
  const asked = str(receivedAt).slice(0, 10)
  if (isDate(sentOn)) {
    const took = isDate(asked) ? daysBetween(asked, sentOn) : null
    const due = isDate(quoteDue) ? quoteDue : deadlineFrom(urgency, asked)
    const late = due && daysBetween(due, sentOn) > 0
    return {
      tone: late ? 'late' : 'sent',
      due: due || '',
      text: `Quote sent ${dayMonth(sentOn)}${took != null && took >= 0 ? `, ${took} day${took === 1 ? '' : 's'} after the enquiry` : ''}${late ? `, after their deadline (${dayMonth(due)})` : ''}.`,
    }
  }
  const due = isDate(quoteDue) ? quoteDue : deadlineFrom(urgency, asked)
  if (!due || !isDate(today)) return null
  const left = daysBetween(today, due)
  const usual = turnaround ? ` · our usual turnaround is ${turnaround} days` : ''
  if (left < 0) return { tone: 'late', due, text: `Their deadline (${dayMonth(due)}) passed ${-left} day${left === -1 ? '' : 's'} ago. Call today: ask for a new date, or send what we have.` }
  const when = left === 0 ? 'Due today' : `${left} day${left === 1 ? '' : 's'} left (due ${dayMonth(due)})`
  if (turnaround && left < turnaround) return { tone: 'tight', due, text: `${when}${usual} → agree a budget price or a firm date today.` }
  return { tone: 'ok', due, text: `${when}${usual}.` }
}

// ─── The deal's size and our odds at that size ─────────────────────────────

/**
 * An amount in SAR from what a salesperson types: "950k", "1.2M SAR",
 * "SAR 1,200,000", "1.2 million", "about 600k for lighting". The first
 * amount; 0 when there is none ("not shared").
 */
export function parseSar(text = '') {
  const t = str(text).toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1')
  const m = t.match(/(\d+(?:\.\d+)?)\s*(k|m|mn|mio|million|thousand|ألف|مليون)?(?![a-z])/i)
  if (!m) return 0
  const n = Number(m[1])
  const unit = (m[2] || '').toLowerCase()
  const mult = /^(m|mn|mio|million|مليون)$/.test(unit) ? 1e6 : /^(k|thousand|ألف)$/.test(unit) ? 1e3 : 1
  const v = n * mult
  return v >= 1000 ? Math.round(v) : 0 // a bare "5" is not a price
}

/** The company's win-rate bands, checked: [{ max (SAR, last may be null), rate (0–100) }]. */
export function sizeBands(playbook = {}) {
  return list(playbook?.size_odds)
    .map((b) => ({ max: b?.max == null || b.max === '' ? null : Number(b.max), rate: Number(b?.rate) }))
    .filter((b) => (b.max === null || (Number.isFinite(b.max) && b.max > 0)) && Number.isFinite(b.rate) && b.rate >= 0 && b.rate <= 100)
    .sort((a, b) => (a.max ?? Infinity) - (b.max ?? Infinity))
}

const short = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`)

/**
 * "At about 950k SAR we win about 13% of decided deals." from the target
 * price and the bands, with what to do when the odds are low.
 * Returns { value, rate, text, low } or null.
 */
export function dealOdds(targetPrice = '', playbook = {}) {
  const value = parseSar(targetPrice)
  const bands = sizeBands(playbook)
  if (!value || !bands.length) return null
  const band = bands.find((b) => b.max === null || value <= b.max)
  if (!band) return null
  const low = band.rate < 15
  return {
    value, rate: band.rate, low,
    text: `At about ${short(value)} SAR we win about ${band.rate}% of decided deals${low ? ': settle the award, the brand and their target before a full estimate.' : '.'}`,
  }
}

// ─── Follow-ups after the quote ────────────────────────────────────────────

export const FOLLOW_UP_DAYS = [3, 10, 30]

// What to ask at each follow-up (card 15 of the playbook draft): the summary
// of the Odoo to-do, so the salesperson knows why they are calling.
export const FOLLOW_UP_ASK = {
  3: 'Did the quote reach the right person? Any questions on the items or the brand?',
  10: 'Where does it stand: are they comparing offers, is there a target to look at?',
  30: 'Keep it open? If it went elsewhere, ask why (price, brand, delivery, timing) and close it.',
}

/** A day off in Saudi Arabia (Friday, Saturday) moves to the Sunday after. */
export function workingDay(dateIso) {
  const d = toDate(dateIso)
  const wd = d.getUTCDay() // 5 Fri, 6 Sat
  if (wd === 5) d.setUTCDate(d.getUTCDate() + 2)
  else if (wd === 6) d.setUTCDate(d.getUTCDate() + 1)
  return iso(d)
}

/** The three follow-ups for a quote sent on `sentOn`: [{ day, date }]. */
export function followUpPlan(sentOn) {
  if (!isDate(sentOn)) return []
  return FOLLOW_UP_DAYS.map((day) => {
    const d = toDate(sentOn)
    d.setUTCDate(d.getUTCDate() + day)
    return { day, date: workingDay(iso(d)) }
  })
}

/** The Odoo to-do's title for a follow-up. */
export const followUpSummary = (day) => `Quote follow-up, day ${day}: ${FOLLOW_UP_ASK[day] || 'call the client.'}`

/** One stored follow-up, cut back to shape. */
function oneFollowUp(f) {
  const day = Number(f?.day)
  if (!FOLLOW_UP_DAYS.includes(day) || !isDate(f?.date)) return null
  return {
    day,
    date: str(f.date),
    note: str(f.note).slice(0, 300),
    done_at: str(f.done_at) || null,
    activity_id: Number.isInteger(Number(f.activity_id)) && Number(f.activity_id) > 0 ? Number(f.activity_id) : null,
  }
}

/** The stored follow-ups, whatever was stored: one per day, in order. */
export function normaliseFollowUps(raw) {
  const out = new Map()
  for (const f of list(raw)) { const x = oneFollowUp(f); if (x && !out.has(x.day)) out.set(x.day, x) }
  return FOLLOW_UP_DAYS.filter((d) => out.has(d)).map((d) => out.get(d))
}

/**
 * The follow-ups after a save. A new or moved "quote sent on" re-plans the
 * dates (keeping each one's Odoo to-do, to be moved, and anything already
 * done); a cleared one leaves none. Ticks and notes sent by the card are
 * applied by day. Returns the new list.
 */
export function nextFollowUps(stored, { sentOn = '', sentBefore = '', sent = null, now = new Date() } = {}) {
  const was = normaliseFollowUps(stored)
  if (!isDate(sentOn)) return []
  const byDay = new Map(was.map((f) => [f.day, f]))
  const plan = sentOn !== sentBefore || !was.length
    ? followUpPlan(sentOn).map((p) => ({ ...(byDay.get(p.day) || { note: '', done_at: null, activity_id: null }), day: p.day, date: p.date }))
    : was
  if (!Array.isArray(sent)) return plan
  const incoming = new Map(list(sent).map((f) => [Number(f?.day), f]))
  return plan.map((f) => {
    const s = incoming.get(f.day)
    if (!s) return f
    const done = Boolean(s.done)
    return { ...f, note: s.note === undefined ? f.note : str(s.note).slice(0, 300), done_at: done ? f.done_at || now.toISOString() : null }
  })
}

/** "late" past its date and not done, "today", "done", or "" (later). */
export function followUpState(f, today) {
  if (f?.done_at) return 'done'
  if (!isDate(today) || !isDate(f?.date)) return ''
  if (f.date < today) return 'late'
  return f.date === today ? 'today' : ''
}

// ─── The close, read from Odoo ─────────────────────────────────────────────

/**
 * Odoo's lost reason, in our words (leads.lost_reason). A CRM's reasons often
 * hide our own part ("cannot match the delivery time" usually meant we were
 * late), so "late"/"slow"/"overloaded" wins over the rest.
 */
export function lostReasonFrom(name = '') {
  const t = str(name).toLowerCase()
  if (!t) return 'other'
  if (/late|slow|delay|overload|not ready|our side|arak|internal|sample|submittal/.test(t)) return 'arak_late'
  if (/brand|spec|approved|vendor list|vendor/.test(t)) return 'brand'
  if (/regret|declin|did not quote|didn't quote|out of (our )?(scope|range)/.test(t)) return 'declined'
  if (/price|expensive|cost|cheap|budget|discount/.test(t)) return 'price'
  if (/stock|delivery|lead ?time/.test(t)) return 'lead_time'
  if (/no (response|reply|answer)|not respond|quiet|silent/.test(t)) return 'no_reply'
  if (/cancel|hold|postpon|not awarded|lost the (main )?contract|stopped/.test(t)) return 'cancelled'
  return 'other'
}

/**
 * A deal's outcome from Odoo's crm.lead read: { stage: 'won' | 'lost', reason, reasonName }
 * or null while it is open. Won = active at 100%; lost = archived at 0%
 * (what Odoo's Lost button does).
 */
export function outcomeFrom(row) {
  if (!row) return null
  const reasonName = Array.isArray(row.lost_reason_id) ? str(row.lost_reason_id[1]) : ''
  if (row.active !== false && Number(row.probability) === 100) return { stage: 'won', reason: '', reasonName: '' }
  if (row.active === false && Number(row.probability) === 0) return { stage: 'lost', reason: lostReasonFrom(reasonName), reasonName }
  return null
}

// ─── The pilot ─────────────────────────────────────────────────────────────

/** The pilot's people, as lower-case emails. */
export function pilotEmails(battleCards = {}) {
  return list(battleCards?.pilot).map((e) => str(e).toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
}

/** Does this person's lead get steps 4 and 5? */
export const inPilot = (battleCards, email) => Boolean(email) && pilotEmails(battleCards).includes(str(email).toLowerCase())
