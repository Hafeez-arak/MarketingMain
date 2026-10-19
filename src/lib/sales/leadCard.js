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
// Since 2026-10-12 the card also says how well the lead fits the company's
// ICP (the same scoring as Sales → Targets), names our own projects in the
// same segment as proof, says which competitor holds a brand they named, and
// takes its objection answers from the Agent Brief's battle cards, so an
// answer is written in one place.
//
// Pure. No network.

import { projectOf, SENDER_LABEL, leadLabels } from '../leads/view.js'
import { scoreTarget } from './icp.js'

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

// "Before the call": the facts the card fills in from the email, in order.
// Four boxes since 2026-10-18 (the owner: "the data looks too much"): the
// project, scope, documents and extra asks are one "What they want".
export const FACTS = [
  ['who', 'Who they are'],
  ['wants', 'What they want'],
  ['brand', 'Brand rule'],
  ['due', 'Deadline'],
]

/** "What they want", from the email: project · scope, then what they sent and what else they ask for. */
export function wantsLine(lead = {}) {
  const d = lead.details || {}
  const head = [d.location, d.stage].map(str).filter(Boolean).join(', ')
  const scope = [d.products, d.quantity].map(str).filter(Boolean).join(', ') || str(lead.summary)
  const lines = [[scope, head].filter(Boolean).join(' · ')]
  const docs = documentsIn(lead)
  if (docs) lines.push(`Sent: ${docs}`)
  const more = wantsIn(lead)
  if (more) lines.push(`Also wants: ${more}`)
  return lines.filter(Boolean).join('\n')
}

/** "Who they are": the company, what kind of buyer, verified or not, and the person. */
export function whoLine(lead = {}) {
  const company = str(lead.company) || senderDomain(lead)
  const kind = SENDER_LABEL[lead.sender_type] && lead.sender_type !== 'unknown'
    ? `${SENDER_LABEL[lead.sender_type]}${lead.source_check === 'verified' ? ' (verified)' : lead.source_check ? ' (not verified)' : ''}`
    : ''
  const person = company && str(lead.name) && str(lead.name) !== company ? str(lead.name) : ''
  return [company || str(lead.name), kind, person].filter(Boolean).join(' · ')
}

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
  return { text: lines.join(' ') || '', signals, known: Boolean(lines.length), ours, theirs }
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

// ─── Fit, proof and competition ───────────────────────────────────────────

/** The ICP's buyer type for a lead, from who wrote and the phase. */
export function buyerOf(lead = {}) {
  const phase = projectOf(lead)
  const words = [lead.subject, lead.summary, lead.details?.products].map(str).join(' ')
  switch (lead.sender_type) {
    case 'contractor':
      if (/fit-?\s?out|interiors?/i.test(words)) return 'fitout'
      return phase === 'jih' ? 'contractor_awarded' : phase === 'tender' ? 'contractor_bidding' : ''
    case 'developer_owner': return 'owner_developer'
    case 'end_client': case 'facility_company': return 'operator'
    case 'consultant': return 'consultant'
    case 'trader': return 'other'
    default: return ''
  }
}

// What the lead is about, without the signature (whose "Head office,
// Riyadh" would otherwise read as an office job in our region).
const aboutText = (lead = {}) => [lead.subject, lead.summary, lead.details?.products, lead.details?.location, lead.details?.stage].map(str).join(' ')

const BAND_LABEL = { strong: 'Strong fit', possible: 'Possible fit', weak: 'Weak fit' }

/**
 * How well the lead fits the company's ICP, scored the way Sales → Targets
 * scores a target. { band, text }, or an empty band when there is no ICP.
 */
export function icpFit(lead = {}, icp = null, { existing = false } = {}) {
  if (!icp || !list(icp.segments).length) return { band: '', text: '' }
  const r = scoreTarget({
    name: lead.company, headline: lead.summary, detail: aboutText(lead), scope: lead.details?.products,
    location: lead.details?.location, stage: lead.details?.stage, buyer: buyerOf(lead),
  }, icp)
  // The ICP's own finding: existing customers win about three times as
  // often. Targets scores companies we may never have sold to, so it does
  // not know this; a lead from one of our accounts does.
  if (existing) {
    r.score = Math.min(100, r.score + 20)
    r.band = r.score >= 60 ? 'strong' : r.score >= 35 ? 'possible' : 'weak'
    r.reasons.unshift('Existing customer')
  }
  const flags = [...r.flags]
  if (lead.sender_type === 'trader') flags.unshift('A trader: a stock deal, not a project')
  const track = r.track === 'core' ? ' (core)' : r.track === 'broader' ? ' (growth)' : ''
  const why = r.reasons.length ? r.reasons.join(', ') : 'no segment, buyer or region we recognise'
  return { band: r.band, text: `${BAND_LABEL[r.band]}${track}: ${why}.${flags.length ? ` Watch: ${flags.join('; ')}.` : ''}` }
}

/**
 * Our own projects to name on the call: those in the lead's ICP segments
 * (the segment's words found in both), two at most. key_projects is the
 * Brand Brain's list, one project per line.
 */
export function pickReferences(lead = {}, keyProjects = '', icp = null) {
  const projects = str(keyProjects).split('\n').map(str).filter(Boolean)
  if (!projects.length) return []
  const about = aboutText(lead).toLowerCase()
  const segments = list(icp?.segments).filter((sg) => list(sg.match).some((w) => about.includes(str(w).toLowerCase())))
  const out = []
  for (const sg of segments) {
    for (const p of projects) {
      if (out.length < 2 && !out.includes(p) && list(sg.match).some((w) => p.toLowerCase().includes(str(w).toLowerCase()))) out.push(p)
    }
  }
  return out
}

/** Which competitor holds a brand they named that we do not carry. */
export function heldBy(theirs = [], competitorBrands = []) {
  const out = []
  for (const b of theirs) {
    const re = brandPattern(b)
    const holders = competitorBrands.filter((cb) => re?.test(str(cb.brand)) && cb.relationship !== 'ended')
    if (holders.length) out.push(`${b}: ${holders.map((h) => `${h.competitor}${h.relationship === 'exclusive' ? ' (exclusive)' : ''}`).join(', ')}.`)
  }
  return out
}

/**
 * The Agent Brief's objections (inbound first, then outbound) that carry a
 * `when`: the one place their answers are written. The walk-away goes with
 * the answer.
 */
export function objectionsFromCards(battleCards = {}) {
  const seen = new Set()
  const out = []
  for (const kind of ['inbound', 'outbound']) {
    for (const o of list(battleCards?.[kind]?.objections)) {
      const key = str(o?.objection).toLowerCase()
      if (!str(o?.when) || !key || seen.has(key)) continue
      seen.add(key)
      const walk = str(o?.walk_away)
      out.push({ when: str(o.when), objection: str(o.objection), answer: `${str(o.answer)}${walk && walk !== '—' ? ` Walk away if: ${walk.replace(/\.$/, '')}.` : ''}` })
    }
  }
  return out
}

/** The signals an objection can be shown on, in words, for the Agent Brief. */
export const SIGNAL_LABEL = {
  always: 'every lead', existing_customer: 'an existing customer', repeat_sender: 'a repeat sender', quick: 'a quick quote',
  project: 'a project quote', tender: 'a tender', bidding: 'a contractor still bidding', trader: 'a trader',
  submittals: 'they ask for documents', controls: 'lighting control is in scope', price_pressure: 'they push on price',
  urgent: 'it is urgent', brand_not_ours: 'a brand we do not carry', brand_ours: 'a brand we carry',
  brand_equivalent: 'equivalents are allowed', maintenance: 'maintenance',
}

const plainName = (s) => compact(str(s).replace(/\([^)]*\)/g, ' '))

/**
 * The watchlist competitors named in a piece of text (the salesperson's
 * "who else is quoting"), by name, domain or a brand they hold.
 */
export function matchCompetitors(text = '', watchlist = []) {
  const hay = compact(text)
  if (hay.length < 3) return []
  return list(watchlist).filter((c) => {
    const name = plainName(c.name)
    const root = str(c.domain).toLowerCase().split('.')[0].replace(/[^a-z0-9]/g, '')
    return (name.length >= 4 && hay.includes(name)) || (root.length >= 4 && hay.includes(root))
      || list(c.brands).some((b) => compact(b.brand).length >= 4 && hay.includes(compact(b.brand)))
  })
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
 *   context.playbook   sales_icp.battle_cards.lead (lessons, questions)
 *   context.objections the Agent Brief's objections (objectionsFromCards)
 *   context.icp        sales_icp.config, for the fit line and the segments
 *   context.keyProjects   the Brand Brain's key projects, one per line
 *   context.competitorBrands   competitor_brands ({ competitor, brand, relationship })
 */
export function buildLeadCard(lead = {}, context = {}) {
  const suppliers = list(context.suppliers).map(str).filter(Boolean)
  const earlier = list(context.earlier).filter((e) => e && e.received_at)
  const account = matchAccount(lead, list(context.accounts))
  const brand = brandRule(lead, suppliers)
  const vendors = vendorBodies(context.companyFacts)
  const signals = leadSignals(lead, { account, earlier, brand, vendors })
  const fromCards = list(context.objections)
  const playbook = normalisePlaybook(fromCards.length ? { ...(context.playbook || {}), objections: fromCards } : context.playbook)
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
      who: whoLine(lead),
      wants: wantsLine(lead),
      brand: [brand.text, ...heldBy(brand.theirs, list(context.competitorBrands))].filter(Boolean).join(' '),
      due: str(d.urgency),
    },
    fit: icpFit(lead, context.icp, { existing: signals.existing_customer }),
    references: pickReferences(lead, context.keyProjects, context.icp),
    history,
    ask: asks.map((q) => ({ q, a: '' })),
    pushback,
  })
}

/** A complete card, whatever was stored or sent. Also the save's guard. */
export function normaliseLeadCard(raw = {}) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const stored = c.facts && typeof c.facts === 'object' ? c.facts : {}
  // A card stored before 2026-10-18 had six facts: fold them into four.
  const facts = stored.wants !== undefined || stored.who !== undefined ? stored : {
    ...stored,
    wants: [
      [stored.scope, stored.project].map(str).filter(Boolean).join(' · '),
      str(stored.documents) ? `Sent: ${str(stored.documents)}` : '',
      str(stored.also_want) ? `Also wants: ${str(stored.also_want)}` : '',
    ].filter(Boolean).join('\n'),
  }
  return {
    kind: CARD_KINDS[c.kind] ? c.kind : 'project',
    customer: CUSTOMER_LABEL[c.customer] ? c.customer : 'new',
    headline: clip(c.headline, 500),
    facts: Object.fromEntries(FACTS.map(([k]) => [k, clip(facts[k], 1000)])),
    fit: { band: BAND_LABEL[c.fit?.band] ? c.fit.band : '', text: clip(c.fit?.text, 600) },
    references: list(c.references).map((r) => clip(r, 300)).filter(Boolean).slice(0, 4),
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
  return { values: { decision, quote_due: due || null, target_price: clip(body.target_price, 200), decides: clip(body.decides, 300), competitors: clip(body.competitors, 300) } }
}

/** Header chips for a lead and its card, in display order. */
export function cardChips(lead = {}, card = {}, lang = 'en') {
  const c = normaliseLeadCard(card)
  const C = cardLabels(lang)
  const L = leadLabels(lang)
  const out = [{ tone: 'kind', text: C.kinds[c.kind] }]
  const who = L.sender[lead.sender_type]
  if (who) out.push({ tone: '', text: `${who}${lead.source_check === 'verified' ? ` · ${C.verified}` : lead.source_check ? ` · ${C.notVerified}` : ''}` })
  const phase = projectOf(lead)
  out.push({ tone: '', text: phase ? (L.project[phase] || phase) : C.phaseNotSet })
  out.push({ tone: c.customer === 'existing' ? 'good' : c.customer === 'parked' ? 'warn' : '', text: C.customer[c.customer] })
  if (c.fit.band) out.push({ tone: c.fit.band === 'strong' ? 'good' : c.fit.band === 'weak' ? 'warn' : '', text: C.bands[c.fit.band] })
  return out
}

// ─── Arabic (v2, lib/i18n.js) ──────────────────────────────────────────────
// The card's own words in each language. English stays the default; the
// card's content (the headline, the facts, the questions) is the agent's
// and stays in the language it was written in.
const CARD_AR = {
  kinds: { project: 'عرض سعر لمشروع', quick: 'عرض سعر سريع' },
  decisions: { quote_today: 'عرض سعر اليوم', project_quote: 'عرض سعر لمشروع، مع موعد', park: 'تعليق حتى الترسية', decline: 'اعتذار، مع السبب' },
  customer: { existing: 'عميل حالي', parked: 'حساب معلّق', repeat: 'مرسل متكرر', new: 'جديد علينا' },
  facts: { who: 'من هم', wants: 'ما الذي يريدونه', brand: 'شرط العلامة', due: 'الموعد النهائي' },
  bands: { strong: 'ملاءمة قوية', possible: 'ملاءمة محتملة', weak: 'ملاءمة ضعيفة' },
  verified: 'موثّق', notVerified: 'غير موثّق', phaseNotSet: 'المرحلة غير محددة',
}
const CARD_EN = {
  kinds: CARD_KINDS, decisions: DECISIONS, customer: CUSTOMER_LABEL,
  facts: Object.fromEntries(FACTS), bands: BAND_LABEL,
  verified: 'verified', notVerified: 'not verified', phaseNotSet: 'Phase not set',
}

/** The battle card's labels in one language. */
export const cardLabels = (lang = 'en') => (lang === 'ar' ? CARD_AR : CARD_EN)
