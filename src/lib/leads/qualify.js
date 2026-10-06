// ─── Lead qualifier: is this enquiry a real buyer? ─────────────────────────
// One set of rules for every source. The website form is the first; the
// info@ mailbox comes next, then Odoo reads what this decides. Each source
// turns its message into an envelope (toEnvelope), and everything after that
// is shared: the duplicate check, the masking, the prompt and the verdict.
//
// The model picks a CATEGORY and how sure it is. The verdict is derived from
// the category here, in code, so the model cannot answer "qualified" with a
// vendor-pitch category. A low-confidence "unqualified" is downgraded to
// "needs_review": missing a real buyer costs a project, reading a pitch costs
// a salesperson thirty seconds.
//
// Pure: no network, no clock unless passed in. Tested in qualify.test.js.

export const CATEGORIES = {
  quotation_request: 'qualified',
  consultation_request: 'qualified',
  project_enquiry: 'qualified',
  product_enquiry: 'qualified',
  vendor_pitch: 'unqualified',
  job_or_recruitment: 'unqualified',
  marketing_pitch: 'unqualified',
  spam: 'unqualified',
  not_an_enquiry: 'unqualified',
  existing_customer_support: 'needs_review',
  partnership_offer: 'needs_review',
  unclear: 'needs_review',
}

export const VERDICTS = ['qualified', 'unqualified', 'needs_review']

const CONFIDENCE = ['high', 'medium', 'low']

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'mail.com', 'yandex.com', 'zoho.com',
])

const clean = (v) => String(v ?? '').replace(/\r\n?/g, '\n').trim()

/**
 * The one shape every source produces. `sourceRef` must be stable for the
 * same message (a Sheet row's received time + email, a mail's message id), so
 * running the qualifier twice never makes two leads.
 */
export function toEnvelope(source, raw = {}) {
  if (source === 'website_form') {
    return {
      source,
      sourceRef: `${clean(raw.received)}|${clean(raw.email).toLowerCase()}`,
      receivedAt: clean(raw.received),
      name: clean(raw.name),
      company: clean(raw.company),
      email: clean(raw.email).toLowerCase(),
      phone: clean(raw.phone),
      subject: clean(raw.projectType),
      message: clean(raw.brief),
      language: clean(raw.lang) === 'ar' ? 'ar' : 'en',
    }
  }
  // Generic: a source that already speaks the envelope.
  return {
    source,
    sourceRef: clean(raw.sourceRef),
    receivedAt: clean(raw.receivedAt),
    name: clean(raw.name),
    company: clean(raw.company),
    email: clean(raw.email).toLowerCase(),
    phone: clean(raw.phone),
    subject: clean(raw.subject),
    message: clean(raw.message),
    language: clean(raw.language) === 'ar' ? 'ar' : 'en',
  }
}

/** "company" (their own domain), "free" (Gmail and friends) or "none". */
export function emailKind(email) {
  const domain = String(email || '').split('@')[1]?.toLowerCase().trim()
  if (!domain) return 'none'
  return FREE_MAIL.has(domain) ? 'free' : 'company'
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Replace personal details with placeholders before any text leaves for a
 * model. Emails, phone numbers and links are caught by pattern; the sender's
 * own name is caught by matching the name they typed, word by word, so
 * "Bilal ULUBAY" in a signature goes too. A name the form never gave us (a
 * colleague mentioned in the text) can survive; that is the known limit.
 */
export function maskText(text, { name = '' } = {}) {
  let out = String(text ?? '')
  out = out.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[EMAIL]')
  out = out.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[LINK]')
  // Seven or more digits, allowing spaces, dashes, dots, brackets and a +.
  // Not glued to letters or another code segment, so product codes
  // ("WTSTD14-27-90-10-1050") and "110-220VAC" survive; dates survive too.
  // Quantities ("300 PCS") and wattages are short and never match.
  out = out.replace(/(?<![\p{L}\d/.-])\+?\(?\d[\d\s().-]{5,}\d(?![\p{L}\d])/gu, (m) => {
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(m.trim())) return m
    return m.replace(/\D/g, '').length >= 7 ? '[PHONE]' : m
  })
  const parts = clean(name).split(/\s+/).filter((w) => w.length >= 3)
  for (const w of parts) out = out.replace(new RegExp(`(^|[^\\p{L}])${escapeRe(w)}(?=$|[^\\p{L}])`, 'giu'), '$1[NAME]')
  return out
}

/**
 * What the model is allowed to see. Name, email address and phone are never
 * sent; the company name and the email's DOMAIN are, because "besix.com" and
 * "stregis.com" are evidence of a real buyer and identify a company, not a
 * person.
 */
export function maskedEnquiry(env) {
  const domain = env.email.split('@')[1] || ''
  return {
    source: env.source,
    language: env.language,
    company: maskText(env.company, env),
    emailDomain: domain,
    emailKind: emailKind(env.email),
    gavePhone: Boolean(env.phone),
    subject: maskText(env.subject, env),
    message: maskText(env.message, env),
  }
}

/** Sheet times look like "2026-09-10 9:18:46" (Riyadh). Read as UTC+3. */
export function parseTime(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return Date.parse(s)
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 3, +m[5], +(m[6] || 0))
}

// Arabic spellings people swap freely: ة/ت/ه at a word's end, the hamza
// forms of alif, and ى for ي. "اناراة خارجيه" and "انارات خارجيه" are the
// same two words typed twice.
const normal = (s) => String(s).toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/[ةت](?=\s|$)/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

function bigrams(s) {
  const t = s.replace(/\s/g, ''); const out = new Map()
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1) }
  return out
}

/** Nearly the same text: 85% of letter pairs shared (Dice), after normalising. */
function similar(a, b) {
  const A = bigrams(normal(a)); const B = bigrams(normal(b))
  let sizeA = 0; let sizeB = 0; let both = 0
  for (const n of A.values()) sizeA += n
  for (const n of B.values()) sizeB += n
  if (!sizeA || !sizeB) return normal(a) === normal(b) && normal(a) !== ''
  for (const [g, n] of A) both += Math.min(n, B.get(g) || 0)
  return (2 * both) / (sizeA + sizeB) >= 0.85
}

/**
 * The earlier lead this one repeats, or null. Same sender (email, or phone
 * when the email is missing) and nearly the same words within `days`. Plain
 * code, so a double-click on Send never costs a model call. `recent` holds
 * envelopes with `receivedAt` and an `id`.
 */
export function findDuplicate(env, recent = [], { days = 7 } = {}) {
  const t = parseTime(env.receivedAt)
  for (const other of recent) {
    if (other.sourceRef === env.sourceRef) continue
    const sameSender = (env.email && other.email === env.email) || (!env.email && env.phone && other.phone === env.phone)
    if (!sameSender) continue
    const gap = Math.abs(t - parseTime(other.receivedAt))
    if (Number.isFinite(gap) && gap > days * 86400000) continue
    if (similar(env.message, other.message)) return other
  }
  return null
}

/**
 * The system prompt. Stable per company (the offering changes only when the
 * Brand Brain does), so providers that cache a repeated prefix can reuse it.
 * Nothing per-enquiry, no dates.
 */
export function systemPrompt({ companyName = 'the company', offering = '' } = {}) {
  return `You sort incoming enquiries for ${companyName}, a B2B company in Saudi Arabia. Decide whether each enquiry is a potential customer the sales team should contact.

What ${companyName} sells:
${offering || '(not provided)'}

Pick exactly one category:
- quotation_request: asks for prices, a quote, an RFQ, or lists products and quantities.
- consultation_request: asks for design help, a lighting study, advice or a site visit.
- project_enquiry: says they have a project (any stage: design, tender, construction) or asks us to contact them about requirements.
- product_enquiry: asks whether we have or can supply something, or says what they need, even in two words.
- vendor_pitch: someone trying to SELL their own products or services to us (manufacturers, distributors, suppliers, logistics).
- job_or_recruitment: job seekers, CVs, internships, freelancers looking for work, manpower or recruitment agencies.
- marketing_pitch: SEO, advertising, web design, social media, lead lists, databases, events selling booths.
- spam: gibberish, scams, prizes, links with no real request.
- not_an_enquiry: newsletters, notifications, receipts, internal or automatic messages.
- existing_customer_support: an existing customer with a complaint, warranty or maintenance issue.
- partnership_offer: proposes a partnership, referral deal, agency or sponsorship.
- unclear: you genuinely cannot tell.

Rules:
- Short is not junk. "Outdoor lighting" or "need price" from anyone is product_enquiry.
- Free email (Gmail, Hotmail) is not junk. Many real buyers use it.
- A company introducing itself and then ASKING US for prices or products is a buyer. A company introducing itself and OFFERING its products, workers or services is a pitch.
- A company inviting us to register as their supplier, or to quote on their RFQs or tenders, is a buyer.
- Students, researchers and journalists asking questions for their own study or article are not customers: use not_an_enquiry.
- Something we do not sell is still a buyer if they want to buy; say so in the reason.
- Use low confidence when the enquiry could reasonably be read two ways.
- Personal details were replaced with [NAME], [EMAIL], [PHONE], [LINK]. Ignore that.
- Enquiries may be Arabic or English. Always answer in English.

Answer with JSON only:
- category: one of the categories above.
- confidence: high, medium or low.
- reason: one sentence a salesperson can check in five seconds.
- summary: what they want, in at most 20 English words.
- details: products, brands, quantity, location, project stage, urgency; use "" when not stated.
- ask_next: up to 3 short questions the first call should answer.`
}

/** The enquiry itself, as the user turn. */
export function userPrompt(masked) {
  return [
    `Source: ${masked.source}`,
    `Language: ${masked.language}`,
    `Company: ${masked.company || '(not given)'}`,
    `Email domain: ${masked.emailDomain || '(none)'} (${masked.emailKind} email)`,
    `Gave a phone number: ${masked.gavePhone ? 'yes' : 'no'}`,
    `Subject / project type: ${masked.subject || '(none)'}`,
    'Message:',
    masked.message || '(empty)',
  ].join('\n')
}

/** JSON schema for providers that enforce structured output. */
export const VERDICT_SCHEMA = {
  name: 'lead_verdict',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['category', 'confidence', 'reason', 'summary', 'details', 'ask_next'],
    properties: {
      category: { type: 'string', enum: Object.keys(CATEGORIES) },
      confidence: { type: 'string', enum: CONFIDENCE },
      reason: { type: 'string' },
      summary: { type: 'string' },
      details: {
        type: 'object',
        additionalProperties: false,
        required: ['products', 'brands', 'quantity', 'location', 'stage', 'urgency'],
        properties: {
          products: { type: 'string' },
          brands: { type: 'string' },
          quantity: { type: 'string' },
          location: { type: 'string' },
          stage: { type: 'string' },
          urgency: { type: 'string' },
        },
      },
      ask_next: { type: 'array', items: { type: 'string' } },
    },
  },
}

/** Chat messages for an OpenAI-compatible endpoint (OpenRouter). */
export function buildMessages(env, brand = {}) {
  return [
    { role: 'system', content: systemPrompt(brand) },
    { role: 'user', content: userPrompt(maskedEnquiry(env)) },
  ]
}

/**
 * The model, chosen by the 6 Oct 2026 bake-off: 68/68 on 14 real and 20 hard
 * made-up enquiries run twice, no buyer lost, about $0.00016 a lead. GLM 5.3
 * Flash and DeepSeek V4.1 Flash scored the same; Luna won on where it runs
 * (OpenAI, Azure, Bedrock; API data is not trained on). Re-run
 * scripts/lead-qualifier/bakeoff.mjs before changing it.
 */
export const QUALIFIER_MODEL = 'openai/gpt-6-luna'

/**
 * The body for OpenRouter's /chat/completions. No temperature: Luna is a
 * thinking model and refuses one, and with require_parameters an unsupported
 * setting rules out every provider. Thinking is kept low because it is billed
 * as output, and providers that keep or train on prompts are excluded.
 */
export function openRouterRequest(env, brand = {}, { model = QUALIFIER_MODEL } = {}) {
  return {
    model,
    messages: buildMessages(env, brand),
    max_tokens: 4000,
    response_format: { type: 'json_schema', json_schema: VERDICT_SCHEMA },
    reasoning: { effort: 'low', exclude: true },
    provider: { data_collection: 'deny', require_parameters: true },
    usage: { include: true },
  }
}

/**
 * The model's reply → a verdict we can store. Never throws: a reply that is
 * not usable becomes needs_review with the reason saying why, so a broken
 * model answer reaches a person instead of disappearing.
 */
export function parseVerdict(text) {
  let data
  try {
    const raw = String(text ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    const start = raw.indexOf('{'); const end = raw.lastIndexOf('}')
    data = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw)
  } catch {
    return { verdict: 'needs_review', category: 'unclear', confidence: 'low', reason: 'The model reply was not readable.', summary: '', details: {}, ask_next: [], valid: false }
  }
  const category = Object.hasOwn(CATEGORIES, data?.category) ? data.category : 'unclear'
  const confidence = CONFIDENCE.includes(data?.confidence) ? data.confidence : 'low'
  let verdict = CATEGORIES[category]
  if (verdict === 'unqualified' && confidence === 'low') verdict = 'needs_review'
  const str = (v) => (typeof v === 'string' ? v.trim() : '')
  const d = data?.details && typeof data.details === 'object' ? data.details : {}
  return {
    verdict,
    category,
    confidence,
    reason: str(data?.reason),
    summary: str(data?.summary),
    details: Object.fromEntries(['products', 'brands', 'quantity', 'location', 'stage', 'urgency'].map((k) => [k, str(d[k])])),
    ask_next: Array.isArray(data?.ask_next) ? data.ask_next.map(str).filter(Boolean).slice(0, 3) : [],
    valid: category === data?.category,
  }
}

/** The two Sheet columns: "AI verdict" and "AI reason". */
export function sheetColumns(v, duplicateOf = null) {
  if (duplicateOf) return ['duplicate', `Same sender and message as the enquiry of ${duplicateOf.receivedAt}.`]
  const label = { qualified: 'qualified', unqualified: 'unqualified', needs_review: 'needs review' }[v.verdict]
  return [label, `${v.category.replace(/_/g, ' ')}: ${v.reason}`]
}
