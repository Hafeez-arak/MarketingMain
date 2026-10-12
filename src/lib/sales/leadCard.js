// ─── A battle card for one approved lead ───────────────────────────────────
// The owner's design (2026-10-12): once a lead is approved, it gets a
// one-screen card the salesperson works from until the deal moves to the
// CRM. The top half is built here from what we already hold — the agent's
// reading of the email, our accounts, earlier enquiries from the same
// sender, the brands in the Brand Brain — so a card costs no model call.
// The bottom half is the first call: three questions with room for the
// answers, and four things to record after it.
//
// Every part of a built card is the team's to edit afterwards, so the card
// is stored whole (lead_cards.card) rather than re-built on every open.
//
// The words that are one company's own — the lessons from its deal history,
// its objection answers, its questions — are data (sales_icp.battle_cards.lead),
// matched to the lead by the signals below. Without them a generic set is
// used. No client name or deal figure sits in this public repository.
//
// Pure. No network.

import { projectOf, SENDER_LABEL } from '../leads/view.js'

const str = (v) => String(v ?? '').trim()
const list = (v) => (Array.isArray(v) ? v : [])
const clip = (s, n) => str(s).slice(0, n)

export const CARD_KINDS = { project: 'Project quote', quick: 'Quick quote' }

/** What the salesperson records after the first call. */
export const DECISIONS = {
  quote_today: 'Quote today',
  project_quote: 'Project quote, with a date',
  park: 'Park until the award',
  decline: 'Decline, and say why',
}

export const CUSTOMER_LABEL = {
  existing: 'Existing customer',
  parked: 'Parked account',
  repeat: 'Repeat sender',
  new: 'New to us',
}

// The order the facts appear in, and their labels.
export const FACTS = [
  ['project', 'Project'],
  ['scope', 'Scope'],
  ['brand', 'Brand rule'],
  ['documents', 'Documents in hand'],
  ['also_want', 'They also want'],
  ['due', 'Deadline'],
]

// ─── Reading the email (no model) ──────────────────────────────────────────

const DOCUMENTS = [
  [/\bBOQs?\b|bill of quantit/i, 'BOQ'],
  [/drawings?\b|\blayouts?\b|\bdwg\b/i, 'drawings'],
  [/\bspec(s|ifications?)?\b/i, 'specification'],
  [/\btemplate\b/i, 'their RFQ template'],
  [/compliance sheet/i, 'compliance sheet'],
]

const WANTS = [
  [/data ?sheets?/i, 'datasheets'],
  [/submittal|\bMTS\b|technical submission/i, 'material submittal'],
  [/pre-?qualification|\bPQD?\b|vendor registration|supplier registration/i, 'prequalification'],
  [/samples?\b|mock-?up/i, 'samples or a mock-up'],
  [/certificat|\bISO\b|\bSASO\b|\bUL\b/i, 'certificates'],
  [/compliance/i, 'compliance sheet'],
  [/warrant|guarantee/i, 'warranty'],
  [/lead ?time|delivery (time|schedule|period)|availability|\bstock\b/i, 'lead time and stock'],
  [/country of origin|\borigin\b/i, 'country of origin'],
  [/\blux\b|photometric|dialux/i, 'lux calculation'],
  [/site visit|inspection/i, 'a site visit'],
  [/install/i, 'installation'],
  [/commission|programming/i, 'commissioning'],
  [/payment terms/i, 'payment terms'],
]

const textOf = (lead) => [lead.subject, lead.message].map(str).join('\n')

export function documentsIn(lead = {}) {
  const text = textOf(lead)
  const found = DOCUMENTS.filter(([re]) => re.test(text)).map(([, label]) => label)
  const attached = /attach|enclosed|sharepoint|wetransfer|onedrive|google drive|dropbox|download link/i.test(text)
  if (found.length) return `${cap(found.join(', '))}${attached ? ' (attached or linked)' : ''}`
  return attached ? 'Attachments mentioned; open the email' : ''
}

export function wantsIn(lead = {}) {
  const text = textOf(lead)
  const out = []
  for (const [re, label] of WANTS) if (re.test(text) && !out.includes(label)) out.push(label)
  return cap(out.slice(0, 7).join(', '))
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')

// ─── Brands ────────────────────────────────────────────────────────────────

const brandPattern = (name) => {
  const core = str(name).toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (core.length < 2) return null
  return new RegExp(`(^|[^a-z0-9])${core.split('').join('[^a-z0-9]?')}($|[^a-z0-9])`, 'i')
}

// Words that describe a brand rule rather than name a brand.
const NOT_A_BRAND = /equivalent|equal|similar|brand|specified|stated|approved|acceptable|reference|model|original|parts|subject|attach|unbranded|other items|n\/a|none|any\b|not\b|no\b/i

/**
 * The brand rule, checked against the brands we carry (the Brand Brain's
 * Suppliers list): which named brands are ours, which are not, and whether
 * equivalents are allowed. Philips is the sales team's own rule (2026-10-11).
 */
export function brandRule(lead = {}, suppliers = []) {
  const said = str(lead.details?.brands)
  const philips = lead.philips
  const ours = []
  const theirs = []
  for (const part of said.split(/[,;/]|\band\b|\bor\b|\(|\)/i).map(str).filter(Boolean)) {
    if (part.length > 40 || NOT_A_BRAND.test(part)) continue
    if (/philips|signify/i.test(part)) continue
    const mine = suppliers.find((s) => brandPattern(s)?.test(part))
    if (mine) { if (!ours.includes(mine)) ours.push(mine) } else if (!theirs.includes(part)) theirs.push(part)
  }
  const equivalents = /equivalent|equal|similar|alternative/i.test(said)
  const lines = []
  if (philips === 'only') lines.push('Philips only.')
  else if (philips === 'or_equivalent') lines.push('Philips or equivalent: offer one of ours.')
  else if (philips === 'mixed') lines.push('Philips on some items.')
  if (ours.length) lines.push(`We carry ${ours.join(', ')}.`)
  if (theirs.length) lines.push(`Not ours: ${theirs.join(', ')}. Offer our own or an approved equal, or say early that we can't.`)
  if (equivalents && philips !== 'or_equivalent') lines.push('Equivalents accepted.')
  const signals = {
    brand_ours: ours.length > 0,
    brand_not_ours: theirs.length > 0 && !ours.length,
    brand_equivalent: equivalents || philips === 'or_equivalent',
  }
  return { text: lines.join(' ') || '', signals, known: Boolean(lines.length) }
}

// ─── Our history with the sender ───────────────────────────────────────────

const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|proton|protonmail|msn|ymail)\./i

/** The sender's company domain, or '' for a free-mail address. */
export function senderDomain(lead = {}) {
  const d = str(lead.email).toLowerCase().split('@')[1] || ''
  return d && !FREE_MAIL.test(d) && /^[a-z0-9.-]+$/.test(d) ? d : ''
}

// Letters and digits only: an Arabic name in brackets drops out by itself,
// while a partner named in brackets ("BSS JV (… SAJCO)") stays matchable.
const compact = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * One of our accounts, matched by name: the sender's domain root (sajco in
 * sajco.com.sa) or company name found inside the account's name. Five
 * letters at least, so short words never match. A name match only, which
 * the card says.
 */
export function matchAccount(lead = {}, accounts = []) {
  const domain = senderDomain(lead)
  const keys = [
    domain.split('.')[0].replace(/[^a-z0-9]/g, ''),
    compact(str(lead.company).replace(/\b(company|co|ltd|llc|est|establishment|group|contracting|trading|for|and|the)\b/gi, ' ')),
  ].filter((k) => k.length >= 5)
  if (!keys.length) return null
  return accounts.find((a) => keys.some((k) => compact(a.name).includes(k))) || null
}

const sar = (n) => {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return ''
  return v >= 1e6 ? `SAR ${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M` : `SAR ${Math.round(v / 1000)}k`
}
// Riyadh dates, spelt the same on every runtime ("Sep", never "Sept").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const riyadh = (iso) => {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : new Date(t + 3 * 3600 * 1000)
}
const monthYear = (iso) => { const d = riyadh(iso); return d ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '' }
const dayMonth = (iso) => { const d = riyadh(iso); return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : '' }

/**
 * The bodies a company is registered with, from the Brand Brain's company
 * facts line "Registered vendor / prequalified with (…): A, B, C".
 */
export function vendorBodies(companyFacts = '') {
  const line = str(companyFacts).split('\n').find((l) => /^registered vendor/i.test(l.trim()))
  if (!line) return []
  return line.slice(line.lastIndexOf(':') + 1).split(',').map(str).filter((s) => s.length >= 3)
}

// ─── The company's own words (sales_icp.battle_cards.lead) ─────────────────

/** Used when a company has written none. Generic, no figures. */
export const DEFAULT_PLAYBOOK = {
  lessons: [
    { when: 'existing_customer', text: 'Existing customer: call, don\'t only email.' },
    { when: 'quick', text: 'Stock or like-for-like items: quote the same day.' },
    { when: 'bidding', text: 'They are still bidding: send a budget price before a full estimate.' },
    { when: 'submittals', text: 'They want documents: send the submittal pack with the first reply.' },
    { when: 'always', text: 'Reply within one working day, even if only with a date.' },
  ],
  questions: [
    { key: 'award', text: 'Is the main contract awarded, and who holds the lighting package?', skip: ['awarded', 'quick', 'maintenance'] },
    { key: 'brand', text: 'Which brands does the spec name, and can we offer an equal?', skip: ['brand_known'] },
    { key: 'price', text: 'Is there a target price or budget for this?' },
    { key: 'deadline', text: 'When is the offer due, and when is delivery needed on site?', skip: ['deadline_known'] },
    { key: 'decides', text: 'Who decides, and can we meet them?', skip: ['quick'] },
  ],
  objections: [
    { when: 'price_pressure', objection: 'Your price is higher than the others.', answer: 'Ask for their target first, then value-engineer.' },
    { when: 'bidding', objection: 'We have not won the job yet; just send a price.', answer: 'Send a budget price, not a full estimate, and call on the award date.' },
    { when: 'urgent', objection: 'We need it this week.', answer: 'Quote stock items the same day; give a fixed date for the rest.' },
    { when: 'submittals', objection: 'Send the certificates / you are not prequalified.', answer: 'Send the full pack the same day.' },
  ],
}

/** A company's playbook, whatever was stored, falling back part by part. */
export function normalisePlaybook(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  const lessons = (l) => list(l).map((x) => ({ when: str(x?.when), text: str(x?.text) })).filter((x) => x.when && x.text)
  const questions = (q) => list(q).map((x) => ({ key: str(x?.key), text: str(x?.text), skip: list(x?.skip).map(str).filter(Boolean) })).filter((x) => x.text)
  const objections = (o) => list(o).map((x) => ({ when: str(x?.when), objection: str(x?.objection), answer: str(x?.answer) })).filter((x) => x.when && x.objection && x.answer)
  const pick = (read, key) => (read(p[key]).length ? read(p[key]) : read(DEFAULT_PLAYBOOK[key]))
  return { lessons: pick(lessons, 'lessons'), questions: pick(questions, 'questions'), objections: pick(objections, 'objections') }
}

// ─── Building the card ─────────────────────────────────────────────────────

const HAS_DATE = /\b\d{1,2}(st|nd|rd|th)?[\s/.-]+(\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\btoday\b|\btomorrow\b/i

/** Project quote or quick quote: the phase, the request, or the words decide. */
export function cardKind(lead = {}) {
  if (['jih', 'tender', 'maintenance'].includes(projectOf(lead))) return 'project'
  if (['project_enquiry', 'consultation_request'].includes(lead.category)) return 'project'
  const words = [lead.subject, lead.summary, lead.details?.stage, lead.details?.location].map(str).join(' ')
  return /project|tender|package|\bBOQ\b|development|phase|parcel|works\b/i.test(words) ? 'project' : 'quick'
}

/**
 * Everything the card is built from, as yes/no signals: the playbook's
 * lessons, questions and objections are picked by them.
 */
export function leadSignals(lead = {}, { account = null, earlier = [], brand = null, vendors = [] } = {}) {
  const phase = projectOf(lead)
  const kind = cardKind(lead)
  const text = [lead.subject, lead.message, lead.summary].map(str).join('\n')
  const urgency = str(lead.details?.urgency)
  const wants = wantsIn(lead).toLowerCase()
  return {
    always: true,
    existing_customer: Boolean(account && account.status !== 'parked'),
    parked: account?.status === 'parked',
    repeat_sender: earlier.length > 0,
    new_sender: !account && !earlier.length,
    quick: kind === 'quick',
    project: kind === 'project',
    tender: phase === 'tender',
    awarded: phase === 'jih',
    maintenance: phase === 'maintenance',
    trader: lead.sender_type === 'trader',
    bidding: phase === 'tender' && !['developer_owner', 'end_client'].includes(lead.sender_type),
    submittals: /submittal|prequalification|samples|certificates|compliance/.test(wants),
    controls: /\bKNX\b|\bDALI\b|\bGRMS\b|lighting control|\bLCS\b|dimming|smart home|automation/i.test(text),
    price_pressure: /best (discounted |project )?price|discount|competitive|cheapest|best offer|best rate/i.test(text),
    urgent: /urgent|asap|as soon as possible|today|immediately|top urgent/i.test(`${urgency} ${lead.subject}`),
    registered_vendor: vendors.some((v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)),
    deadline_known: HAS_DATE.test(urgency),
    brand_known: Boolean(brand?.known),
    ...(brand?.signals || {}),
  }
}

/**
 * The card for one lead.
 *   context.accounts   our accounts ({ name, orders, value_sar, last_order, status })
 *   context.earlier    earlier enquiries from the same domain ({ received_at, subject })
 *   context.suppliers  the brands we carry (names)
 *   context.companyFacts  the Brand Brain's company facts (registered vendors)
 *   context.playbook   sales_icp.battle_cards.lead
 */
export function buildLeadCard(lead = {}, context = {}) {
  const suppliers = list(context.suppliers).map(str).filter(Boolean)
  const earlier = list(context.earlier).filter((e) => e && e.received_at)
  const account = matchAccount(lead, list(context.accounts))
  const brand = brandRule(lead, suppliers)
  const vendors = vendorBodies(context.companyFacts)
  const signals = leadSignals(lead, { account, earlier, brand, vendors })
  const playbook = normalisePlaybook(context.playbook)
  const d = lead.details || {}

  const history = []
  if (account?.status === 'parked') {
    history.push(`Parked account: ${account.name}. Check with the owner before contacting.`)
  } else if (account) {
    const bits = [account.orders ? `${account.orders} orders` : '', sar(account.value_sar), account.last_order ? `last order ${monthYear(account.last_order)}` : ''].filter(Boolean)
    history.push(`Existing customer (name match, confirm): ${account.name}${bits.length ? `, ${bits.join(', ')}` : ''}.`)
  }
  if (earlier.length) {
    const dates = [...earlier].sort((x, y) => String(x.received_at).localeCompare(String(y.received_at))).map((e) => dayMonth(e.received_at)).filter(Boolean)
    history.push(`Earlier enquiries from ${senderDomain(lead)}: ${dates.join(', ')}. Check they were answered.`)
  }
  if (!account && !earlier.length) history.push('New to us: no order and no earlier enquiry on record.')
  const text = textOf(lead)
  for (const v of vendors) if (new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) history.push(`We are a registered vendor with ${v}.`)
  const lessons = playbook.lessons.filter((l) => signals[l.when]).map((l) => l.text)
  history.push(...lessons.slice(0, Math.max(1, 4 - history.length)))

  // Two of the company's own win-factor questions the email has not
  // answered, then the agent's own, then the rest.
  const open = playbook.questions.filter((q) => !q.skip.some((s) => signals[s]))
  const asks = []
  const add = (q) => { if (q && asks.length < 3 && !asks.some((a) => a.toLowerCase() === q.toLowerCase())) asks.push(q) }
  open.slice(0, 2).forEach((q) => add(q.text))
  list(lead.ask_next).map(str).forEach(add)
  open.slice(2).forEach((q) => add(q.text))

  const pushback = playbook.objections.filter((o) => signals[o.when]).slice(0, 2).map((o) => ({ objection: o.objection, answer: o.answer }))

  const who = str(lead.company) || senderDomain(lead) || str(lead.name)
  return normaliseLeadCard({
    kind: cardKind(lead),
    customer: signals.parked ? 'parked' : signals.existing_customer ? 'existing' : signals.repeat_sender ? 'repeat' : 'new',
    headline: [who, str(lead.summary) || str(lead.subject)].filter(Boolean).join(': '),
    facts: {
      project: [d.location, d.stage].map(str).filter(Boolean).join(' · '),
      scope: [d.products, d.quantity].map(str).filter(Boolean).join(' · '),
      brand: brand.text,
      documents: documentsIn(lead),
      also_want: wantsIn(lead),
      due: str(d.urgency),
    },
    history,
    ask: asks.map((q) => ({ q, a: '' })),
    pushback,
  })
}

/** A complete card, whatever was stored or sent. Also the save's guard. */
export function normaliseLeadCard(raw = {}) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const facts = c.facts && typeof c.facts === 'object' ? c.facts : {}
  return {
    kind: CARD_KINDS[c.kind] ? c.kind : 'project',
    customer: CUSTOMER_LABEL[c.customer] ? c.customer : 'new',
    headline: clip(c.headline, 500),
    facts: Object.fromEntries(FACTS.map(([k]) => [k, clip(facts[k], 1000)])),
    history: list(c.history).map((h) => clip(h, 500)).filter(Boolean).slice(0, 8),
    ask: list(c.ask).map((a) => ({ q: clip(a?.q, 300), a: clip(a?.a, 1000) })).filter((a) => a.q).slice(0, 6),
    pushback: list(c.pushback).map((p) => ({ objection: clip(p?.objection, 300), answer: clip(p?.answer, 1000) })).filter((p) => p.objection).slice(0, 4),
  }
}

/** The four after-call fields, checked. Returns { values } or { error }. */
export function afterCallFields(body = {}) {
  const decision = str(body.decision)
  if (decision && !DECISIONS[decision]) return { error: 'Unknown decision.' }
  const due = str(body.quote_due)
  if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(new Date(`${due}T00:00:00Z`).getTime()))) return { error: 'The quote date is not a date.' }
  return { values: { decision, quote_due: due || null, target_price: clip(body.target_price, 200), decides: clip(body.decides, 300) } }
}

/** Header chips for a lead and its card, in display order. */
export function cardChips(lead = {}, card = {}) {
  const c = normaliseLeadCard(card)
  const out = [{ tone: 'kind', text: CARD_KINDS[c.kind] }]
  const who = SENDER_LABEL[lead.sender_type]
  if (who) out.push({ tone: '', text: `${who}${lead.source_check === 'verified' ? ' · verified' : lead.source_check ? ' · not verified' : ''}` })
  const phase = projectOf(lead)
  out.push({ tone: '', text: phase ? ({ jih: 'JIH', tender: 'Tender', maintenance: 'Maintenance' }[phase] || phase) : 'Phase not set' })
  out.push({ tone: c.customer === 'existing' ? 'good' : c.customer === 'parked' ? 'warn' : '', text: CUSTOMER_LABEL[c.customer] })
  return out
}
