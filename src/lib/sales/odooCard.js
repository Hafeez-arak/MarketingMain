// ─── The battle card as Odoo fields (2026-10-20) ───────────────────────────
// The owner's decisions: every lead pushed to Odoo carries the whole battle
// card as real fields on the lead, the before-call part filled and the rest
// left for the salesperson; it syncs both ways, Odoo being the master (its
// value wins), read from Odoo twice a day (07:50 and 13:00 Riyadh); and every
// change made here is also written as a note in the lead's history.
//
// The fields are Odoo Properties: defined once on the sales team the leads
// go into (crm.team.lead_properties_definition), shown as their own block on
// the lead form, no Studio needed. Properties have no long-text type, so
// lists are written one per line in a char field and read back the same way.
//
// Odoo writes Properties WHOLE: writing { la_who: 'x' } empties every other
// property. So a push reads the lead's current values, changes only what
// changed here, and writes the full set back (mergeProps).
//
// Pure. No network.

import { DECISIONS, CARD_KINDS, CUSTOMER_LABEL, BAND_LABEL, normaliseLeadCard } from './leadCard.js'

const str = (v) => String(v ?? '').trim()
const opts = (labels) => Object.entries(labels).map(([k, l]) => [k, l])

/** Every property we own starts with this, so others' properties are never touched. */
export const PREFIX = 'la_'

/** "Q → A" lines and "objection → answer" lines, one per line. */
const ARROW = ' → '

// The block, in the order the lead form shows it. The keys are stable: a
// rename here must keep the key, or Odoo loses the values stored under it.
export const PROPS = [
  { name: 'la_sep_before', string: 'Battle card: before the call', type: 'separator' },
  { name: 'la_kind', string: 'Card', type: 'selection', selection: opts(CARD_KINDS) },
  { name: 'la_customer', string: 'Customer', type: 'selection', selection: opts(CUSTOMER_LABEL) },
  { name: 'la_headline', string: 'Headline', type: 'char' },
  { name: 'la_who', string: 'Who they are', type: 'char' },
  { name: 'la_wants', string: 'What they want', type: 'char' },
  { name: 'la_brand', string: 'Brand rule', type: 'char' },
  { name: 'la_due', string: 'Deadline', type: 'char' },
  { name: 'la_fit', string: 'ICP fit', type: 'selection', selection: opts(BAND_LABEL) },
  { name: 'la_fit_text', string: 'Why that fit', type: 'char' },
  { name: 'la_references', string: 'Proof to name', type: 'char' },
  { name: 'la_history', string: 'History with us', type: 'char' },
  { name: 'la_sep_call', string: 'Battle card: the first call', type: 'separator' },
  { name: 'la_q1', string: 'Question 1', type: 'char' },
  { name: 'la_a1', string: 'Answer 1', type: 'char' },
  { name: 'la_q2', string: 'Question 2', type: 'char' },
  { name: 'la_a2', string: 'Answer 2', type: 'char' },
  { name: 'la_q3', string: 'Question 3', type: 'char' },
  { name: 'la_a3', string: 'Answer 3', type: 'char' },
  { name: 'la_more', string: 'More questions (question → answer, one per line)', type: 'char' },
  { name: 'la_pushback', string: 'Objections (objection → answer, one per line)', type: 'char' },
  { name: 'la_sep_after', string: 'Battle card: after the call', type: 'separator' },
  { name: 'la_decision', string: 'Decision', type: 'selection', selection: opts(DECISIONS) },
  { name: 'la_quote_due', string: 'Quote due', type: 'date' },
  { name: 'la_target_price', string: 'Target price', type: 'char' },
  { name: 'la_decides', string: 'Who decides', type: 'char' },
  { name: 'la_competitors', string: 'Who else is quoting', type: 'char' },
  { name: 'la_next_step', string: 'Next step', type: 'char' },
  { name: 'la_follow_up', string: 'Follow up on', type: 'date' },
]

const VALUE_PROPS = PROPS.filter((p) => p.type !== 'separator')
const LABEL = Object.fromEntries(PROPS.map((p) => [p.name, p.string]))

/**
 * The team's definition with ours put in: ours replaced by the current
 * version (in order, at the end), anyone else's kept as they are.
 */
export function mergeDefinition(current = []) {
  const others = (Array.isArray(current) ? current : []).filter((d) => !String(d?.name || '').startsWith(PREFIX))
  return [...others, ...PROPS.map((p) => ({ ...p }))]
}

/** Does the team already hold exactly our definition? */
export function definitionCurrent(current = []) {
  const ours = new Map((Array.isArray(current) ? current : []).filter((d) => String(d?.name || '').startsWith(PREFIX)).map((d) => [d.name, d]))
  return PROPS.length === ours.size && PROPS.every((p) => {
    const d = ours.get(p.name)
    return d && d.string === p.string && d.type === p.type
      && JSON.stringify(d.selection || null) === JSON.stringify(p.selection || null)
  })
}

const lines = (arr) => arr.map(str).filter(Boolean).join('\n')
const pairs = (arr) => lines(arr.map(([a, b]) => (str(b) ? `${str(a)}${ARROW}${str(b)}` : str(a))))
const unpairs = (text) => str(text).split('\n').map(str).filter(Boolean).map((l) => {
  const i = l.indexOf(ARROW.trim())
  return i < 0 ? [l, ''] : [str(l.slice(0, i)), str(l.slice(i + 1))]
})

/**
 * Our card, its after-call fields and the lead's next step → { la_*: value }.
 * Empty is false, which is how Odoo stores an empty property.
 */
export function cardToProps(cardRaw = {}, after = {}, lead = {}) {
  const c = normaliseLeadCard(cardRaw)
  const ask = c.ask
  const v = {
    la_kind: c.kind, la_customer: c.customer, la_headline: c.headline,
    la_who: c.facts.who, la_wants: c.facts.wants, la_brand: c.facts.brand, la_due: c.facts.due,
    la_fit: c.fit.band, la_fit_text: c.fit.text,
    la_references: lines(c.references), la_history: lines(c.history),
    la_q1: ask[0]?.q, la_a1: ask[0]?.a, la_q2: ask[1]?.q, la_a2: ask[1]?.a, la_q3: ask[2]?.q, la_a3: ask[2]?.a,
    la_more: pairs(ask.slice(3).map((a) => [a.q, a.a])),
    la_pushback: pairs(c.pushback.map((p) => [p.objection, p.answer])),
    la_decision: after.decision, la_quote_due: after.quote_due, la_target_price: after.target_price,
    la_decides: after.decides, la_competitors: after.competitors,
    la_next_step: lead.next_step, la_follow_up: lead.follow_up,
  }
  return Object.fromEntries(VALUE_PROPS.map((p) => [p.name, str(v[p.name]) || false]))
}

/**
 * Odoo's read format (a list of { name, value, … }) → { la_*: value }, ours
 * only; a selection value is its key, a date 'YYYY-MM-DD', empty is false.
 */
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
 * Odoo's values → our card, after-call fields and lead fields. Odoo is the
 * master: what it holds replaces ours. A property Odoo does not have (the
 * block not defined yet) leaves ours as it is.
 */
export function propsToCard(props = {}, cardRaw = {}, after = {}, lead = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(props, k)
  const val = (k, fallback) => (has(k) ? str(props[k] || '') : fallback)
  const c = normaliseLeadCard(cardRaw)
  const askFixed = [1, 2, 3].map((i) => ({ q: val(`la_q${i}`, c.ask[i - 1]?.q || ''), a: val(`la_a${i}`, c.ask[i - 1]?.a || '') }))
  const askMore = has('la_more') ? unpairs(props.la_more).map(([q, a]) => ({ q, a })) : c.ask.slice(3)
  const card = normaliseLeadCard({
    ...c,
    kind: val('la_kind', c.kind) || c.kind,
    customer: val('la_customer', c.customer) || c.customer,
    headline: val('la_headline', c.headline),
    facts: { who: val('la_who', c.facts.who), wants: val('la_wants', c.facts.wants), brand: val('la_brand', c.facts.brand), due: val('la_due', c.facts.due) },
    fit: { band: val('la_fit', c.fit.band), text: val('la_fit_text', c.fit.text) },
    references: has('la_references') ? str(props.la_references || '').split('\n') : c.references,
    history: has('la_history') ? str(props.la_history || '').split('\n') : c.history,
    ask: [...askFixed, ...askMore].filter((a) => a.q),
    pushback: has('la_pushback') ? unpairs(props.la_pushback).map(([objection, answer]) => ({ objection, answer })) : c.pushback,
  })
  return {
    card,
    after: {
      decision: val('la_decision', str(after.decision)),
      quote_due: val('la_quote_due', str(after.quote_due)) || null,
      target_price: val('la_target_price', str(after.target_price)),
      decides: val('la_decides', str(after.decides)),
      competitors: val('la_competitors', str(after.competitors)),
    },
    track: { next_step: val('la_next_step', str(lead.next_step)), follow_up: val('la_follow_up', str(lead.follow_up)) || null },
  }
}

/** The properties whose values differ: [name], in the block's order. */
export function changedProps(before = {}, after = {}) {
  return VALUE_PROPS.map((p) => p.name).filter((k) => (before[k] || false) !== (after[k] || false))
}

/**
 * The full set to write to Odoo: what Odoo holds now (others' properties
 * included), with only the names that changed here replaced.
 */
export function mergeProps(odooNow = {}, ours = {}, names = []) {
  const out = { ...odooNow }
  for (const k of names) out[k] = ours[k] || false
  return out
}

/**
 * The history note for a change made on our platform: who, and each changed
 * field with its new value. HTML, every value escaped.
 */
export function changeNote(names = [], values = {}, by = '', title = '') {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
  const selLabel = (k, v) => PROPS.find((p) => p.name === k)?.selection?.find(([key]) => key === v)?.[1] || v
  const rows = names.map((k) => {
    const v = values[k]
    const shown = v ? esc(selLabel(k, v)).replace(/\n/g, '<br>') : '<i>cleared</i>'
    return `<li><b>${esc(LABEL[k] || k)}:</b> ${shown}</li>`
  })
  const head = title || `Battle card updated on the Arak leads platform${by ? ` by ${by}` : ''}.`
  return `<p>${esc(head)}</p><ul>${rows.join('')}</ul>`
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
