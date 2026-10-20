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

import { DECISIONS, CUSTOMER_LABEL, BAND_LABEL, CARD_KINDS, normaliseLeadCard } from './leadCard.js'
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
  { name: 'la_sep_card', string: 'Battle card', type: 'separator' },
  { name: 'la_decision', string: 'Decision', type: 'selection', selection: Object.entries(DECISIONS) },
  { name: 'la_quote_due', string: 'Quote due', type: 'date' },
  { name: 'la_target_price', string: 'Target price', type: 'char' },
  { name: 'la_decides', string: 'Who decides', type: 'char' },
  { name: 'la_competitors', string: 'Who else is quoting', type: 'char' },
  { name: 'la_call_notes', string: 'Call notes (1) answer | 2) answer …)', type: 'char' },
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
// The owner (2026-10-20): a battle card is the salesperson's weapons for the
// fight, so this is the arsenal, ordered for the 30 seconds before the call
// and short in every section: what kind of deal; what could blow up
// (parked or existing account, earlier enquiries); the target; how we win
// this one (the playbook's tactics matched to the lead); why us (proof
// projects with what we did); what to ask first; the objections with what
// to say; and when to walk away. The six fields below it are the scorecard.

/**
 * The brief at the top of the lead's Internal Notes: what to know and ask
 * before the first call. HTML, every value escaped. '' with no card.
 */
export function briefHtml(cardRaw, lead = {}) {
  if (!cardRaw) return ''
  const c = normaliseLeadCard(cardRaw)
  const questions = c.ask.filter((a) => a.q !== CALL_NOTE)
  const { alerts, tactics } = splitHistory(c.history)
  const fights = c.pushback.slice(0, 2).map((p) => ({ objection: p.objection, ...splitWalkAway(p.answer) }))
  const donts = [...new Set(fights.map((f) => f.walk).filter(Boolean))]
  const phase = PHASE_LABEL[projectOf(lead)] || ''

  const section = (title, items) => (items.length ? `<p><b>${esc(title)}</b></p><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '')
  const labelled = (label, value) => (str(value) ? `<b>${esc(label)}:</b> ${esc(value).replace(/\n/g, '; ')}` : '')
  return [
    `<p><b>⚔ BATTLE CARD</b> · ${esc([CARD_KINDS[c.kind], phase, CUSTOMER_LABEL[c.customer], BAND_LABEL[c.fit.band]].filter(Boolean).join(' · '))}</p>`,
    section('⚠ Watch out', alerts.map(esc)),
    section('The target', [
      labelled('Who', c.facts.who), labelled('Wants', c.facts.wants), labelled('Brand', c.facts.brand), labelled('Deadline', c.facts.due),
    ].filter(Boolean)),
    section('How we win this one', tactics.slice(0, 3).map(esc)),
    section('Why us: name these', c.references.slice(0, 3).map(esc)),
    section('Ask first', questions.map((a, i) => `${i + 1}) ${esc(a.q)}`)),
    section('If they say…', fights.map((f) => `“${esc(f.objection)}” → ${esc(f.say)}`)),
    section("Don't", donts.map(esc)),
    '<p><i>After the call: fill the Battle card fields below (answers in Call notes as 1) … | 2) … | 3) …) and the next step as a to-do.</i></p>',
  ].filter(Boolean).join('')
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
