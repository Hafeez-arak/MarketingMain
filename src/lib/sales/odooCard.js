// ─── The battle card in Odoo (2026-10-20, simplified the same day) ─────────
// The owner's decisions: everything in Odoo, but simple. Each part of the
// card goes where it is used:
//
//   the prep      → the lead's Internal Notes (its description), written once
//                   when it goes to Odoo: the battle card itself, the weapons
//                   for the call (briefHtml): tactics, proof, objections, walk-away.
//   the outcome   → six fields on the lead (Odoo Properties of the team our
//                   leads go into), synced both ways, Odoo the master:
//                   decision, quote due, target price, who decides, who else
//                   is quoting, call notes.
//   the next step → an Odoo Activity (a to-do with a due date) for the
//                   salesperson; done or rescheduled in Odoo comes back here.
//
// The first version (26 fields) was dropped as too much: nobody fills a form
// that long, and the prep is read once, not edited.
//
// Properties are single-line in Odoo, and a line break typed there is lost,
// so the call notes are numbered answers joined by " | ": "1) Yes | 2) …",
// the numbers matching the questions in the brief.
//
// Odoo writes Properties WHOLE: writing { la_x: 'v' } empties the others. So
// a push reads the lead's current values and writes the full set back
// (mergeProps).
//
// Pure. No network.

import { DECISIONS, BAND_LABEL, CARD_KINDS, normaliseLeadCard } from './leadCard.js'
import { projectOf } from '../leads/view.js'

const str = (v) => String(v ?? '').trim()
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))

/** Every property we own starts with this, so others' properties are never touched. */
export const PREFIX = 'la_'

/** A free call note (not an answer to a numbered question) on our card. */
export const CALL_NOTE = 'Call note'

const SEP = ' | '

// The block on the lead form. Keys are stable: renaming a key loses the
// values stored under it.
export const PROPS = [
  { name: 'la_sep_card', string: 'Battle card: record after the call', type: 'separator' },
  { name: 'la_decision', string: 'Decision', type: 'selection', selection: Object.entries(DECISIONS) },
  { name: 'la_quote_due', string: 'Quote due', type: 'date' },
  { name: 'la_target_price', string: 'Target price', type: 'char' },
  { name: 'la_decides', string: 'Who decides', type: 'char' },
  { name: 'la_competitors', string: 'Who else is quoting', type: 'char' },
  { name: 'la_call_notes', string: 'Call notes', type: 'char' },
]

const VALUE_PROPS = PROPS.filter((p) => p.type !== 'separator')
const LABEL = Object.fromEntries(PROPS.map((p) => [p.name, p.string.replace(/ \(.*$/, '')]))

/** The team's definition with ours put in (replacing any older version of ours), others kept. */
export function mergeDefinition(current = []) {
  const others = (Array.isArray(current) ? current : []).filter((d) => !String(d?.name || '').startsWith(PREFIX))
  return [...others, ...PROPS.map((p) => ({ ...p }))]
}

/** Does the team hold exactly our current definition? */
export function definitionCurrent(current = []) {
  const ours = new Map((Array.isArray(current) ? current : []).filter((d) => String(d?.name || '').startsWith(PREFIX)).map((d) => [d.name, d]))
  return PROPS.length === ours.size && PROPS.every((p) => {
    const d = ours.get(p.name)
    return d && d.string === p.string && d.type === p.type
      && JSON.stringify(d.selection || null) === JSON.stringify(p.selection || null)
  })
}

// ─── Call notes ────────────────────────────────────────────────────────────

/** Our card's answers → "1) answer | 2) answer | free note". */
export function callNotes(cardRaw = {}) {
  const c = normaliseLeadCard(cardRaw)
  const questions = c.ask.filter((a) => a.q !== CALL_NOTE)
  const answered = questions.map((a, i) => (str(a.a) ? `${i + 1}) ${str(a.a)}` : '')).filter(Boolean)
  const notes = c.ask.filter((a) => a.q === CALL_NOTE).map((a) => str(a.a)).filter(Boolean)
  return [...answered, ...notes].join(SEP)
}

/**
 * "1) Yes | 2) Example | spoke to the PM" → our card's answers. A numbered
 * part answers that question; anything else is kept as a call note. Odoo is
 * the master: a question with no part here has no answer.
 */
export function applyCallNotes(cardRaw = {}, text = '') {
  const c = normaliseLeadCard(cardRaw)
  const questions = c.ask.filter((a) => a.q !== CALL_NOTE).map((a) => ({ q: a.q, a: '' }))
  const notes = []
  for (const part of str(text).split('|').map(str).filter(Boolean)) {
    const m = part.match(/^(\d+)\)\s*(.*)$/)
    const i = m ? Number(m[1]) - 1 : -1
    if (m && questions[i]) questions[i].a = str(m[2])
    else notes.push({ q: CALL_NOTE, a: part })
  }
  return normaliseLeadCard({ ...c, ask: [...questions, ...notes] })
}

// ─── The six fields ────────────────────────────────────────────────────────

/** Our card and its after-call fields → { la_*: value }; empty is false (Odoo's empty). */
export function cardToProps(cardRaw = {}, after = {}) {
  const v = {
    la_decision: after.decision, la_quote_due: after.quote_due, la_target_price: after.target_price,
    la_decides: after.decides, la_competitors: after.competitors, la_call_notes: callNotes(cardRaw),
  }
  return Object.fromEntries(VALUE_PROPS.map((p) => [p.name, str(v[p.name]) || false]))
}

/** Odoo's read format ([{ name, value, … }]) → { la_*: value }, ours only. */
export function propsFromRead(list = []) {
  const out = {}
  for (const p of Array.isArray(list) ? list : []) {
    if (!String(p?.name || '').startsWith(PREFIX) || p.type === 'separator') continue
    const val = Array.isArray(p.value) ? p.value[0] : p.value
    out[p.name] = val === false || val == null || val === '' ? false : String(val)
  }
  return out
}

/**
 * Odoo's values → our card and after-call fields. Only the names present
 * are applied; anything else stays ours.
 */
export function propsToCard(props = {}, cardRaw = {}, after = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(props, k)
  const val = (k, fallback) => (has(k) ? str(props[k] || '') : str(fallback))
  return {
    card: has('la_call_notes') ? applyCallNotes(cardRaw, props.la_call_notes || '') : normaliseLeadCard(cardRaw),
    after: {
      decision: val('la_decision', after.decision),
      quote_due: val('la_quote_due', after.quote_due) || null,
      target_price: val('la_target_price', after.target_price),
      decides: val('la_decides', after.decides),
      competitors: val('la_competitors', after.competitors),
    },
  }
}

/** The properties whose values differ: [name], in the block's order. */
export function changedProps(before = {}, after = {}) {
  return VALUE_PROPS.map((p) => p.name).filter((k) => (before[k] || false) !== (after[k] || false))
}

/** The full set to write: what Odoo holds now, with only the changed names replaced. */
export function mergeProps(odooNow = {}, ours = {}, names = []) {
  const out = { ...odooNow }
  for (const k of names) out[k] = ours[k] || false
  return out
}

// ─── The next step as an Odoo Activity ─────────────────────────────────────

/** The lead's next step and follow-up as an activity: { summary, date } or null. */
export function activityOf(lead = {}) {
  const summary = str(lead.next_step)
  const date = str(lead.follow_up)
  return summary || date ? { summary: summary || 'Follow up', date: date || null } : null
}

/** Same activity? */
export const sameActivity = (a, b) => (a?.summary || '') === (b?.summary || '') && (a?.date || '') === (b?.date || '')

// ─── The battle card itself: Internal Notes ────────────────────────────────
// The owner's shape (2026-10-20, after two tries): three parts and no more.
//   1. Who they are: the lead, before the call, from what we hold, with
//      their history with us read from Odoo itself (orders, quotations,
//      deals won and lost, and an open deal someone already has).
//   2. What to do: 2–4 lines of moves (what to ask, what to quote or offer).
//   3. After the call: the six fields and the to-do (below the notes).

/** "2026-03-14 09:00:00" → "Mar 2026". */
const monthYear = (d) => {
  const t = new Date(`${String(d || '').slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}
const sar = (n) => `SAR ${Math.round(Number(n) || 0).toLocaleString('en-US')}`
const ownerOf = (row) => (Array.isArray(row?.user_id) ? row.user_id[1] : '')

/**
 * Their history with us, from Odoo (customerHistory in api/leads/_odoo.js),
 * in words: lines for "who they are", a warning when someone already has an
 * open deal with them, and the one move it suggests.
 * Returns { lines, alert, move }.
 */
export function historyFacts(h, now = new Date()) {
  if (!h) return { lines: [], alert: '', move: '' }
  if (!h.matchedBy) return { lines: ['Not found in Odoo (no customer with their email domain or company name).'], alert: '', move: '' }
  const lines = []
  const names = (h.companies || []).map((c) => c.name).filter(Boolean)
  lines.push(names.length
    ? `In Odoo as ${names.join(' / ')} (matched by ${h.matchedBy}).`
    : `Found in Odoo by their ${h.matchedBy} (deals only, no customer record).`)

  const orders = (h.orders || []).filter((o) => o.state === 'sale')
  const quotes = (h.orders || []).filter((o) => o.state !== 'sale')
  if (orders.length) {
    const total = orders.reduce((s, o) => s + (Number(o.amount_total) || 0), 0)
    const first = orders[orders.length - 1]
    lines.push(`${orders.length} order${orders.length === 1 ? '' : 's'} since ${monthYear(first.date_order)}, ${sar(total)}; last ${monthYear(orders[0].date_order)}${ownerOf(orders[0]) ? ` (${ownerOf(orders[0])})` : ''}.`)
  }
  if (quotes.length) lines.push(`${quotes.length} quotation${quotes.length === 1 ? '' : 's'} that did not become an order.`)

  const deals = h.deals || []
  const won = deals.filter((d) => d.active && d.probability === 100)
  const lost = deals.filter((d) => !d.active && d.probability === 0)
  const open = deals.filter((d) => d.active && d.probability > 0 && d.probability < 100)
  const lastLost = lost[0]
  const reason = Array.isArray(lastLost?.lost_reason_id) ? lastLost.lost_reason_id[1] : ''
  if (deals.length) {
    lines.push(`Deals: ${won.length} won · ${lost.length} lost${lastLost ? ` (last ${monthYear(lastLost.date_closed || lastLost.create_date)}${reason ? `: ${reason}` : ''})` : ''} · ${open.length} open.`)
  }

  let alert = ''
  if (open.length) {
    const newest = open[0]
    const days = (now.getTime() - new Date(`${String(newest.create_date).replace(' ', 'T')}Z`).getTime()) / 86_400_000
    const owners = [...new Set(open.map(ownerOf).filter(Boolean))].join(', ') || 'someone'
    alert = days <= 14
      ? `Probably this same enquiry: ${owners} opened a deal for them on ${String(newest.create_date).slice(0, 10)}. Check before working it twice.`
      : `${owners} already ha${owners.includes(',') ? 've' : 's'} an open deal with them (since ${monthYear(newest.create_date)}). Talk to them before calling.`
  }

  let move = ''
  if (!open.length) {
    if (/price|expensive|cost|budget|cheaper/i.test(reason)) move = `They went elsewhere on price last time (${monthYear(lastLost.date_closed || lastLost.create_date)}): open with a budget option, then the full offer.`
    else if (orders.length) move = `They have bought from us (last ${monthYear(orders[0].date_order)}${ownerOf(orders[0]) ? `, ${ownerOf(orders[0])}` : ''}): name that order and ask how it went.`
    else if (quotes.length >= 3) move = `We have quoted them ${quotes.length} times without an order: ask what decides it this time.`
    else if (reason) move = `Lost last time: ${reason}. Find out early if that still stands.`
  }
  return { lines, alert, move }
}

/**
 * The suggestions in the lead's Internal Notes: who they are, what to do
 * (2–4 moves), as label | value rows; what to record is the Battle card block. `history` is Odoo's, or
 * null when it could not be read. HTML, every value escaped. '' with no card.
 */
export function briefHtml(cardRaw, lead = {}, history = null, now = new Date()) {
  if (!cardRaw) return ''
  const c = normaliseLeadCard(cardRaw)
  const questions = c.ask.filter((a) => a.q !== CALL_NOTE)
  const { alerts, tactics } = splitHistory(c.history)
  const odoo = historyFacts(history, now)
  const phase = PHASE_LABEL[projectOf(lead)] || ''
  const objection = c.pushback[0] ? { objection: c.pushback[0].objection, ...splitWalkAway(c.pushback[0].answer) } : null

  // 2–4 moves, the most specific first: what Odoo says about them, then the
  // playbook's move for this kind of deal; what to ask always; then what to
  // offer and the likeliest pushback while there is room.
  const plays = [odoo.move, ...tactics].map(str).filter(Boolean)
  const ask = questions.length ? questions.map((a, i) => `${i + 1}) ${a.q}`).join(' ') : ''
  const extras = [
    ['Offer', /offer|ours/i.test(c.facts.brand) ? c.facts.brand : ''],
    ['If they say', objection ? `“${objection.objection}” → ${objection.say}` : ''],
  ].filter(([, v]) => str(v))
  const room = Math.max(0, 4 - (ask ? 1 : 0) - Math.min(plays.length, 2))
  const moves = [
    ['Do first', plays[0]],
    ['Then', plays[1]],
    ['Ask', ask],
    ...extras.slice(0, room),
  ].filter(([, v]) => str(v))

  // Label | value rows: short to scan, and Odoo's editor keeps tables.
  const row = (label, value) => `<tr><td style="padding:2px 14px 2px 0;white-space:nowrap;vertical-align:top"><b>${esc(label)}</b></td><td style="padding:2px 0">${esc(value).replace(/\n/g, '; ')}</td></tr>`
  const table = (rows) => `<table><tbody>${rows.map(([l, v]) => row(l, v)).join('')}</tbody></table>`
  const who = [
    ...[odoo.alert, ...alerts].filter(Boolean).map((w) => ['⚠ Watch out', w]),
    ['Who', c.facts.who],
    ['Wants', c.facts.wants],
    ['Brand', c.facts.brand],
    ['Deadline', c.facts.due],
    ...odoo.lines.map((l, i) => [i ? '' : 'With us', l]),
  ].filter(([, v]) => str(v))
  return [
    `<p><b>⚔ BATTLE CARD</b> · ${esc([CARD_KINDS[c.kind], phase, BAND_LABEL[c.fit.band]].filter(Boolean).join(' · '))}</p>`,
    '<p><b>1. WHO THEY ARE</b></p>',
    table(who),
    '<p><b>2. WHAT TO DO</b></p>',
    table(moves),
    '<p><i>After the call, record what you learned in the Battle card fields above (answers to the questions in Call notes, as 1) … | 2) …) and set the next step as a to-do.</i></p>',
  ].join('')
}

// What the card builder puts in `history`: facts about this account first,
// then the playbook's tactics matched to the lead (src/lib/sales/leadCard.js).
const ALERT = /^(Parked account|Existing customer|Earlier enquiries|We are a registered vendor)/i
const PLAIN = /^New to us\b/i

/** The card's history split: what to watch out for, and how to win. "New to us" is neither. */
export function splitHistory(history = []) {
  const lines = (Array.isArray(history) ? history : []).map(str).filter(Boolean)
  return { alerts: lines.filter((l) => ALERT.test(l)), tactics: lines.filter((l) => !ALERT.test(l) && !PLAIN.test(l)) }
}

/** An objection's answer: what to say, and when to walk away (the Agent Brief adds it after "Walk away if:"). */
export function splitWalkAway(answer = '') {
  const [say, walk = ''] = str(answer).split(/\s*Walk away if:\s*/i)
  return { say: str(say), walk: str(walk) }
}

const PHASE_LABEL = { jih: 'JIH', tender: 'Tender', maintenance: 'Maintenance' }

// ─── History notes ─────────────────────────────────────────────────────────

/** One short line for a change made on our platform: who, and what changed to what. */
export function changeNote(names = [], values = {}, by = '', activity = undefined) {
  const label = (k, v) => (k === 'la_decision' ? DECISIONS[v] || v : v)
  const parts = names.map((k) => `${LABEL[k] || k}: ${values[k] ? label(k, values[k]) : 'cleared'}`)
  if (activity !== undefined) parts.push(activity ? `Next step: ${activity.summary}${activity.date ? ` (by ${activity.date})` : ''}` : 'Next step: done/cleared')
  return `<p>Battle card updated on the Arak leads platform${by ? ` by ${esc(by)}` : ''}: ${esc(parts.join('; '))}.</p>`
}

// ─── When Odoo is read: 07:50 and 13:00, Riyadh (UTC+3, no daylight saving) ──

export const PULL_SLOTS = [[7, 50], [13, 0]]
const RIYADH_MS = 3 * 3_600_000

/** The most recent slot at or before `now`, as a Date (UTC). */
export function lastSlot(now = new Date()) {
  const local = new Date(now.getTime() + RIYADH_MS)
  const y = local.getUTCFullYear(); const m = local.getUTCMonth(); const d = local.getUTCDate()
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes()
  const today = PULL_SLOTS.map(([h, mi]) => h * 60 + mi).filter((t) => t <= minutes)
  const at = (dayOffset, t) => new Date(Date.UTC(y, m, d + dayOffset, Math.floor(t / 60), t % 60) - RIYADH_MS)
  if (today.length) return at(0, Math.max(...today))
  const [h, mi] = PULL_SLOTS[PULL_SLOTS.length - 1]
  return at(-1, h * 60 + mi)
}

/** Is a read from Odoo due? Yes when the last one was before the latest slot. */
export function pullDue(now = new Date(), lastPullAt = null) {
  const slot = lastSlot(now)
  return !lastPullAt || new Date(lastPullAt).getTime() < slot.getTime()
}
