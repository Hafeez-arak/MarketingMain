// ─── Auto-reply to a qualified lead (2026-10-29) ───────────────────────────
// Every qualified lead gets one short reply from the mailbox it wrote to (a
// website enquiry from info@). The owner approved five kinds of reply; the
// wording of each is fixed text below. The model only says what kind of
// enquiry it is (chooseFormat picks the reply from that, in code) and fills a
// few short blanks (what they asked about, what they attached, what is
// missing, their deadline). So a reply can never quote a
// price or promise a date: the model never writes a sentence of its own, and
// every blank is checked in code (checkFields) before it is used. A blank that
// fails is dropped, and a line whose blank is gone falls back to its plainer
// wording or disappears.
//
// The greeting is built here from the name we stored, never by the model:
// names do not leave for a model (maskText), the same rule as qualifying.
//
// The format text is data (`formats`), so it can move to per-company settings
// when the platform's Auto-replies tab is built. ARAK_FORMATS is the text the
// owner approved on 2026-10-29, English only.
//
// Pure: no network, no clock. Tested in autoReply.test.js.

import { maskedEnquiry, QUALIFIER_MODEL } from './qualify.js'

export const FORMAT_IDS = ['acknowledge', 'missing_details', 'introduce', 'next_steps', 'call']

/**
 * The five replies. Each is a list of paragraphs; a paragraph is a list of
 * lines. In a line, "a || b" means: use `a` when every {blank} in it is
 * filled, else `b`, else drop the line. {missing} and {steps} are lists and
 * become one line per item. {company} and {phone} come from the company.
 */
export const ARAK_FORMATS = {
  acknowledge: {
    label: 'Quick acknowledgement',
    body: [
      ['Thank you for your enquiry regarding {topic}. || Thank you for your enquiry.'],
      ['We have received your request, and our sales team is reviewing it now. A sales engineer will contact you within one working day.'],
    ],
  },
  missing_details: {
    label: 'Ask for missing details',
    body: [
      ['Thank you for your interest in {topic}. || Thank you for your enquiry.'],
      ['So that we can prepare an accurate quotation, could you please send us:'],
      ['• {missing}'],
      ['Once we have these, our team will come back to you with our offer.'],
    ],
  },
  introduce: {
    label: 'Introduce the company',
    body: [
      ['Thank you for considering {company} for {topic}. || Thank you for considering {company}.'],
      ['For 50 years, Arak has supplied architectural lighting and lighting control systems across Saudi Arabia. We represent more than 40 international brands and are a registered vendor with NEOM, Qiddiya, Roshn, the Red Sea Development Company and Saudi Aramco.'],
      ['Our team is reviewing your {documents} and will be in touch within one working day. || Our team is reviewing your request and will be in touch within one working day.'],
    ],
  },
  next_steps: {
    label: 'Next steps and timeline',
    body: [
      ['Thank you for your request for quotation for {topic}. Here is what happens next: || Thank you for your request for quotation. Here is what happens next:'],
      [
        '1. Our engineers review your {documents} against the brands we carry. || 1. Our engineers review your requirements against the brands we carry.',
        '2. If anything is unclear, we will contact you with questions.',
        '3. We send you our technical and commercial offer.',
      ],
      ['We have noted your submission date of {submission_date} and will plan our offer around it.'],
    ],
  },
  call: {
    label: 'Invite a call or meeting',
    body: [
      ['Thank you for your enquiry regarding {topic}. || Thank you for your enquiry.'],
      ['Systems like this are best scoped together. We would be glad to arrange a short call or a meeting at our Riyadh office to understand your requirements.'],
      ['Please reply with a time that suits you, or call us on {phone}. || Please reply with a time that suits you.'],
    ],
  },
}

// ─── The greeting, in code ─────────────────────────────────────────────────

const NOT_A_PERSON = /\b(sales|team|department|dept|procurement|purchas\w*|info|admin|office|support|account\w*|estimation|tender\w*|hr|noreply|no-reply|company|co|ltd|llc|est|group|trading|contracting)\b/i
const TITLES = { eng: 'Eng.', engr: 'Eng.', dr: 'Dr.', mr: 'Mr.', mrs: 'Mrs.', ms: 'Ms.' }

const titleCase = (w) => (w === w.toUpperCase() || w === w.toLowerCase()
  ? w.toLowerCase().replace(/(^|[-'])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
  : w)

/**
 * "Dear Mohammed Alkhalifa," from what the mail client showed as the name.
 * Handles "Last, First", "Company | Person", "eng.abdalla kotb", ALL CAPS.
 * Anything that is not clearly a person (an address, "Yuhang Sales",
 * "Procurement Dept") gets "Dear Sir or Madam,".
 */
export function greeting(rawName) {
  let n = String(rawName ?? '').trim()
  if (!n || n.includes('@') || /\d/.test(n)) return 'Dear Sir or Madam,'
  if (n.includes('|')) n = n.split('|').pop().trim()
  const comma = n.match(/^([^,]+),\s*([^,]+)$/)
  if (comma) n = `${comma[2]} ${comma[1]}`
  let title = ''
  const t = n.match(/^(eng|engr|dr|mr|mrs|ms)\.?\s*(?=\p{L})/iu)
  if (t) { title = TITLES[t[1].toLowerCase()]; n = n.slice(t[0].length) }
  let words = n.split(/\s+/).filter(Boolean)
  if (!words.length || words.length > 5 || NOT_A_PERSON.test(n) || words.some((w) => !/^[\p{L}'.-]+$/u.test(w))) return 'Dear Sir or Madam,'
  // "Moataz Ahmed Mohammed Abdelaal" → "Moataz Abdelaal": first and family name.
  if (words.length > 2) words = [words[0], words[words.length - 1]]
  return `Dear ${[title, ...words.map(titleCase)].filter(Boolean).join(' ')},`
}

// ─── What the model may fill ───────────────────────────────────────────────

// Words a reply must never carry: money, promises, stock, dates beyond the
// customer's own deadline. Checked on every blank the model fills.
const FORBIDDEN = /\b(price[sd]?|pricing|cost|costs|discount\w*|cheap\w*|budget|sar|usd|riyals?|guarantee\w*|warrant\w*|in stock|stock|available|availability|deliver(y|ed|ies)?|lead time|ship\w*|best offer|lowest)\b|[$€£%]|﷼/i
// A mask left in the text means the model echoed something we hid.
const MASK = /\[(NAME|EMAIL|PHONE|LINK)[^\]]*\]/i

/** The blank, cleaned, or '' when it is not safe to use. */
export function cleanBlank(v, { max = 140 } = {}) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().replace(/[.;:,]+$/, '')
  if (!s || s.length > max || MASK.test(s) || FORBIDDEN.test(s) || /[<>{}]/.test(s)) return ''
  return s
}

export const ENQUIRY_KINDS = ['control_system', 'project_package', 'items', 'unclear']

/**
 * Which reply, decided here from what the model read (the first run let the
 * model choose and it bunched every RFQ into one or two formats):
 *   too little to price          → missing_details
 *   a control or automation system → call
 *   a landmark project's package → introduce
 *   any other project package    → next_steps
 *   items, spares, a supply      → acknowledge
 */
export function chooseFormat({ kind = 'items', landmark = false, missing = [] } = {}) {
  if (kind === 'unclear') return missing.length ? 'missing_details' : 'acknowledge'
  if (kind === 'control_system') return 'call'
  if (kind === 'project_package') return landmark ? 'introduce' : 'next_steps'
  return 'acknowledge'
}

/**
 * The model's answer → { format, fields, dropped }. Each blank is checked on
 * its own, so one bad blank costs only its own line.
 */
export function checkFields(data = {}) {
  const dropped = []
  const take = (key, v, opts) => {
    const out = cleanBlank(v, opts)
    if (v && !out) dropped.push(key)
    return out
  }
  // A deadline must be a date ("ASAP" is not one), and "27 OCT 2026" reads as "27 Oct 2026".
  const date = /\d/.test(String(data.submission_date ?? '')) ? String(data.submission_date).replace(/\b\p{Lu}{3,}\b/gu, (w) => titleCase(w)) : ''
  if (data.submission_date && !date) dropped.push('submission_date')
  const fields = {
    topic: take('topic', data.topic),
    documents: take('documents', data.documents, { max: 40 }),
    submission_date: take('submission_date', date, { max: 40 }),
    missing: (Array.isArray(data.missing) ? data.missing : []).slice(0, 3).map((m) => take('missing', m, { max: 80 })).filter(Boolean),
  }
  const kind = ENQUIRY_KINDS.includes(data.kind) ? data.kind : 'items'
  return { format: chooseFormat({ kind, landmark: data.landmark === true, missing: fields.missing }), kind, fields, dropped }
}

// ─── Building the text ─────────────────────────────────────────────────────

/** One line with its blanks filled: the first alternative that is complete, else null. */
export function fillLine(line, values) {
  for (const alt of line.split(' || ')) {
    const keys = [...alt.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    if (keys.every((k) => Array.isArray(values[k]) ? values[k].length : values[k])) {
      const list = keys.find((k) => Array.isArray(values[k]))
      const fill = (v) => alt.replace(/\{(\w+)\}/g, (_, k) => (k === list ? v : values[k]))
      return list ? values[list].map(fill).join('\n') : fill()
    }
  }
  return null
}

/**
 * The reply's subject and text. `lead` is the stored row; `company` gives
 * {company} and {phone}. An email lead is answered on its own thread (the
 * send adds "RE:" itself); a website enquiry gets a new email.
 */
export function buildReply({ format, fields }, lead = {}, { company = {}, formats = ARAK_FORMATS } = {}) {
  const f = formats[format] || formats.acknowledge
  const values = { ...fields, company: company.name || '', phone: company.phone || '' }
  const paragraphs = f.body
    .map((para) => para.map((line) => fillLine(line, values)).filter((l) => l !== null).join('\n'))
    .filter(Boolean)
  const subject = lead.source === 'website_form'
    ? `Your enquiry to ${company.name || 'us'}`
    : `RE: ${String(lead.subject || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '')}`.trim()
  return { format, label: f.label, subject, text: [greeting(lead.name), ...paragraphs].join('\n\n') }
}

// ─── The model call ────────────────────────────────────────────────────────

export function replyPrompt({ companyName = 'the company' } = {}) {
  return `${companyName} answers every real sales enquiry with a short acknowledgement. The wording is fixed; you describe the enquiry and fill a few blanks. Never invent anything that is not in the enquiry.

kind, exactly one:
- control_system: mainly a lighting control or automation SYSTEM to design or supply (KNX, DALI, DMX, lighting control system, home automation) or lighting design work. NOT spare parts or loose components for an existing system.
- project_package: lighting for a construction project: the fixtures or lighting package for a building, development, villa or infrastructure project, usually with a BOQ, specification or drawings.
- items: specific products, drivers, spare parts, a supply order or a single product, with or without a project name.
- unclear: too little to price: no item list, no quantities, no BOQ, specification or drawings.

landmark: true only when the project named is a giga-project or a landmark of a government body or major developer (NEOM, Qiddiya, Red Sea, Roshn, Diriyah, KAFD, King Salman Park, an airport, a ministry and similar). Otherwise false.

The blanks (English only, even when the enquiry is in Arabic):
- topic: what they asked about, as it would follow "Thank you for your enquiry regarding". A short noun phrase starting with "the", "a" or "your", at most 15 words, for example "the lighting fixtures for the Al Muruj villas, Package 3" or "300 LED T8 tube lamps". Include the project name when there is one. No person's name, price, quantity of money or date.
- documents: what they sent, in one or two words ("BOQ", "specification", "drawings", "RFQ documents"), or "" when nothing is attached or described.
- missing: when kind is unclear, up to three things we need, each starting with "the" or "your", for example "the quantities or a BOQ", "the project name and location", "your required submission date". Otherwise [].
- submission_date: the deadline as a date (for example "5 November" or "27 October 2026"), or "" when they gave none or only wrote "ASAP" or "urgent".
- why: one sentence on why you chose this kind, for the sales team (not sent).

Never mention prices, discounts, stock, delivery or lead times in any blank.`
}

export const REPLY_SCHEMA = {
  name: 'lead_reply',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'landmark', 'topic', 'documents', 'missing', 'submission_date', 'why'],
    properties: {
      kind: { type: 'string', enum: ENQUIRY_KINDS },
      landmark: { type: 'boolean' },
      topic: { type: 'string' },
      documents: { type: 'string' },
      missing: { type: 'array', items: { type: 'string' } },
      submission_date: { type: 'string' },
      why: { type: 'string' },
    },
  },
}

/** What the model sees: the masked enquiry plus what the qualifier already read. */
export function replyUserPrompt(env, lead = {}) {
  const m = maskedEnquiry(env)
  return [
    `Source: ${m.source}`,
    `Company: ${m.company || '(not given)'}`,
    `Sender type: ${lead.sender_type || 'unknown'}`,
    `Project type: ${lead.project_type || 'not stated'}`,
    `Summary: ${lead.summary || '(none)'}`,
    `Subject: ${m.subject || '(none)'}`,
    'Message:',
    m.message || '(empty)',
  ].join('\n')
}

/** The body for OpenRouter's /chat/completions, set up like the qualifier's (see openRouterRequest). */
export function replyRequest(env, lead = {}, { companyName = '', model = QUALIFIER_MODEL } = {}) {
  return {
    model,
    messages: [
      { role: 'system', content: replyPrompt({ companyName }) },
      { role: 'user', content: replyUserPrompt(env, lead) },
    ],
    max_tokens: 3000,
    response_format: { type: 'json_schema', json_schema: REPLY_SCHEMA },
    reasoning: { effort: 'low', exclude: true },
    provider: { data_collection: 'deny', require_parameters: true },
    usage: { include: true },
  }
}

/** The model's text → checkFields' result plus `why`. Unreadable → the plain acknowledgement. */
export function parseReply(text) {
  let data
  try {
    const raw = String(text ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    const start = raw.indexOf('{'); const end = raw.lastIndexOf('}')
    data = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw)
  } catch {
    return { format: 'acknowledge', kind: 'items', fields: { topic: '', documents: '', submission_date: '', missing: [] }, dropped: [], why: 'The model reply was not readable.', valid: false }
  }
  return { ...checkFields(data), why: typeof data.why === 'string' ? data.why.trim() : '', valid: true }
}
