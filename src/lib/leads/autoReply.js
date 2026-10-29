// ─── Auto-reply to a qualified lead (2026-10-29) ───────────────────────────
// Every qualified lead gets one short reply from the mailbox it wrote to (a
// website enquiry from info@). The sales team chose ONE reply, the plain
// acknowledgement, with "as soon as possible" instead of a promised day:
//
//   Dear {name},
//   Thank you for your enquiry regarding {topic}.
//   We have received your request, and our sales team is reviewing it now.
//   A sales engineer will contact you as soon as possible.
//
// The model fills only {topic}: what they asked about, in a few words. It
// never writes a sentence of its own, and the topic is checked in code
// (cleanBlank) before it is used: money, stock or delivery talk, a hidden
// name or link, markup, or anything too long drops it, and the reply then
// says just "Thank you for your enquiry." So a reply can never quote a price
// or promise a date.
//
// The greeting is built here from the name we stored, never by the model:
// names do not leave for a model (maskText), the same rule as qualifying.
//
// The reply text is data (REPLY_TEMPLATE), so it can move to per-company
// settings when the platform's Auto-replies tab is built.
//
// Model: DeepSeek V4.1 Flash, the cheap one, by the owner's choice (it also
// scored 68/68 in the qualifier's bake-off).
//
// Pure: no network, no clock. Tested in autoReply.test.js.

import { maskedEnquiry } from './qualify.js'

/** The owner's pick (2026-10-29): the cheap DeepSeek. Pinned, never a "latest" alias. */
export const REPLY_MODEL = 'deepseek/deepseek-v4.1-flash'

/**
 * The reply, as paragraphs. In a line, "a || b" means: use `a` when every
 * {blank} in it is filled, else `b`, else drop the line.
 */
export const REPLY_TEMPLATE = [
  'Thank you for your enquiry regarding {topic}. || Thank you for your enquiry.',
  'We have received your request, and our sales team is reviewing it now. A sales engineer will contact you as soon as possible.',
]

/**
 * The signature the info@ account already uses on its own replies (read from
 * its Sent Items, 2026-10-29: Outlook keeps signatures where the API cannot
 * read them). Plain text, so it shows the same in every mail app.
 */
export const REPLY_SIGNATURE = ['Best Regards,', 'ARAK Lighting']

// Outlook's own default, as in the account's replies.
const MAIL_STYLE = 'font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif;font-size:12pt;color:rgb(0,0,0)'

const escHtml = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/** The reply as the email's HTML body: its paragraphs, then the signature, in the account's own style. */
export function replyHtml(text, { signature = REPLY_SIGNATURE } = {}) {
  const line = (s) => `<div style="${MAIL_STYLE}">${s ? escHtml(s) : '<br>'}</div>`
  const paras = String(text ?? '').split('\n\n').flatMap((p, i) => [...(i ? [line('')] : []), ...p.split('\n').map(line)])
  return [...paras, line(''), line(''), ...signature.map(line)].join('')
}

// ─── The mailbox's own Outlook signature (2026-10-29) ──────────────────────
// The owner wants the signature the mailbox has in Outlook, pictures and all.
// Outlook keeps it where the API cannot read it, so it is copied from an
// email or draft in that mailbox (copy-signature.mjs): Outlook wraps it in
// <div id="Signature">, and its pictures are inline attachments ("cid:").
// It is stored on the mailbox (lead_mailboxes.reply_signature) and sent the
// way Outlook sends it: the HTML after the reply, the pictures attached inline.

/**
 * The signature inside an Outlook body, with only the pictures it shows.
 * `attachments` are Graph fileAttachments (contentId, name, contentType,
 * contentBytes). Returns { html, images } or null when there is none.
 * Scripts, event handlers and javascript: links are stripped, though the
 * HTML comes from our own mailbox.
 */
export function signatureFromBody(bodyHtml, attachments = []) {
  const html = String(bodyHtml ?? '')
  const start = html.search(/<div[^>]*\bid="Signature"[^>]*>/i)
  if (start < 0) return null
  // The signature div runs to its matching </div>.
  const tags = /<div\b[^>]*>|<\/div>/gi
  tags.lastIndex = start
  let depth = 0
  let end = -1
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    depth += m[0][1] === '/' ? -1 : 1
    if (!depth) { end = m.index + m[0].length; break }
  }
  if (end < 0) return null
  const inner = html.slice(html.indexOf('>', start) + 1, end - '</div>'.length)
    // Outlook's empty lines around it: the reply adds its own spacing.
    .replace(/^(\s*<div[^>]*>\s*<br\s*\/?>\s*<\/div>)+|(<div[^>]*>\s*<br\s*\/?>\s*<\/div>\s*)+$/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"')
    .trim()
  if (!inner) return null
  const cids = new Set([...inner.matchAll(/src="cid:([^"]+)"/gi)].map((m) => m[1]))
  const images = attachments
    .filter((a) => a?.contentId && cids.has(a.contentId) && a.contentBytes)
    .map((a) => ({ cid: a.contentId, name: a.name || 'image.png', type: a.contentType || 'image/png', bytes: a.contentBytes }))
  return { html: inner, images }
}

/**
 * The email to send: the reply's paragraphs in the account's own style, then
 * the mailbox's signature with its pictures as inline attachments. A mailbox
 * with no signature copied yet ends with the plain REPLY_SIGNATURE.
 * Returns { html, attachments } for Graph (message.body + message.attachments).
 */
export function replyMessage(text, signature = null) {
  if (!signature?.html) return { html: replyHtml(text), attachments: [] }
  const body = replyHtml(text, { signature: [] }).replace(/(<div[^>]*><br><\/div>)+$/, '')
  return {
    html: `${body}<div style="${MAIL_STYLE}"><br></div>${signature.html}`,
    attachments: (signature.images || []).map((i) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: i.name, contentType: i.type, contentBytes: i.bytes, contentId: i.cid, isInline: true,
    })),
  }
}

/** "arak-sa.com" from the Brand Brain's "Website: www.arak-sa.com"; '' when there is none. */
export function websiteFromContact(contact) {
  const m = String(contact || '').match(/website:\s*(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/i)
  return m ? m[1].toLowerCase() : ''
}

/** The same email for a browser to show: the pictures as data: URLs instead of attachments. */
export function replyPreviewHtml(text, signature = null) {
  const { html } = replyMessage(text, signature)
  const byCid = new Map((signature?.images || []).map((i) => [i.cid, `data:${i.type};base64,${i.bytes}`]))
  return html.replace(/src="cid:([^"]+)"/gi, (m, cid) => (byCid.has(cid) ? `src="${byCid.get(cid)}"` : m))
}

// ─── The greeting, in code ─────────────────────────────────────────────────

const NOT_A_PERSON = /\b(sales|team|department|dept|procurement|purchas\w*|info|admin|office|support|account\w*|estimation|tender\w*|hr|noreply|no-reply|company|co|ltd|llc|est|group|trading|contracting)\b/i
const TITLES = { eng: 'Eng.', engr: 'Eng.', dr: 'Dr.', mr: 'Mr.', mrs: 'Mrs.', ms: 'Ms.' }

const titleCase = (w) => (w === w.toUpperCase() || w === w.toLowerCase()
  ? w.toLowerCase().replace(/(^|[-'])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
  : w)

/**
 * "Dear Mohammed Alkhalifa," from what the mail client showed as the name.
 * Handles "Last, First", "Company | Person", "eng.abdalla kotb", ALL CAPS,
 * and shortens a long name to first and family name. Anything that is not
 * clearly a person (an address, "Yuhang Sales", "Procurement Dept") gets
 * "Dear Sir or Madam,".
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
  if (words.length > 2) words = [words[0], words[words.length - 1]]
  return `Dear ${[title, ...words.map(titleCase)].filter(Boolean).join(' ')},`
}

// ─── The one blank the model fills ─────────────────────────────────────────

// Words a reply must never carry: money, promises, stock, delivery.
const FORBIDDEN = /\b(price[sd]?|pricing|cost|costs|discount\w*|cheap\w*|budget|sar|usd|riyals?|guarantee\w*|warrant\w*|in stock|stock|available|availability|deliver(y|ed|ies)?|lead time|ship\w*|best offer|lowest)\b|[$€£%]|﷼/i
// A mask left in the text means the model echoed something we hid.
const MASK = /\[(NAME|EMAIL|PHONE|LINK)[^\]]*\]/i

/** The blank, cleaned, or '' when it is not safe to use. */
export function cleanBlank(v, { max = 140 } = {}) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().replace(/[.;:,]+$/, '')
  if (!s || s.length > max || MASK.test(s) || FORBIDDEN.test(s) || /[<>{}]/.test(s)) return ''
  return s
}

// ─── Building the text ─────────────────────────────────────────────────────

/** One line with its blanks filled: the first alternative that is complete, else null. */
export function fillLine(line, values) {
  for (const alt of line.split(' || ')) {
    const keys = [...alt.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    if (keys.every((k) => values[k])) return alt.replace(/\{(\w+)\}/g, (_, k) => values[k])
  }
  return null
}

/**
 * The reply's subject and text. An email lead is answered on its own thread
 * ("RE:" its subject); a website enquiry gets a new email.
 */
export function buildReply({ topic = '' } = {}, lead = {}, { company = {}, template = REPLY_TEMPLATE } = {}) {
  const paragraphs = template.map((line) => fillLine(line, { topic })).filter(Boolean)
  const subject = lead.source === 'website_form'
    ? `Your enquiry to ${company.name || 'us'}`
    : `RE: ${String(lead.subject || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '')}`.trim()
  return { subject, text: [greeting(lead.name), ...paragraphs].join('\n\n') }
}

// ─── The model call ────────────────────────────────────────────────────────

export function replyPrompt({ companyName = 'the company' } = {}) {
  return `${companyName} answers every real sales enquiry with a short, fixed acknowledgement that begins "Thank you for your enquiry regarding <topic>." Write only the topic.

topic: what they asked about, as it would follow "Thank you for your enquiry regarding". A short noun phrase in English (even when the enquiry is in Arabic), starting with "the", "a" or "your", at most 15 words. Include the project or product when there is one, for example "the lighting fixtures for the Al Muruj villas, Package 3" or "300 LED T8 tube lamps". Never a person's name, a price, money, stock, delivery or a date. Never invent anything that is not in the enquiry.`
}

export const REPLY_SCHEMA = {
  name: 'lead_reply',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['topic'],
    properties: { topic: { type: 'string' } },
  },
}

/** What the model sees: the masked enquiry plus what the qualifier already read. */
export function replyUserPrompt(env, lead = {}) {
  const m = maskedEnquiry(env)
  return [
    `Source: ${m.source}`,
    `Company: ${m.company || '(not given)'}`,
    `Summary: ${lead.summary || '(none)'}`,
    `Subject: ${m.subject || '(none)'}`,
    'Message:',
    m.message || '(empty)',
  ].join('\n')
}

/** The body for OpenRouter's /chat/completions, set up like the qualifier's (see openRouterRequest): no temperature, no data-keeping providers. */
export function replyRequest(env, lead = {}, { companyName = '', model = REPLY_MODEL } = {}) {
  return {
    model,
    messages: [
      { role: 'system', content: replyPrompt({ companyName }) },
      { role: 'user', content: replyUserPrompt(env, lead) },
    ],
    max_tokens: 2000,
    response_format: { type: 'json_schema', json_schema: REPLY_SCHEMA },
    reasoning: { effort: 'low', exclude: true },
    provider: { data_collection: 'deny', require_parameters: true },
    usage: { include: true },
  }
}

/**
 * The model's text → { topic, dropped, valid }. An unreadable answer or an
 * unsafe topic gives an empty topic, and the reply then says just "Thank you
 * for your enquiry."
 */
export function parseReply(text) {
  let data
  try {
    const raw = String(text ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    const start = raw.indexOf('{'); const end = raw.lastIndexOf('}')
    data = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw)
  } catch {
    return { topic: '', dropped: false, valid: false }
  }
  const topic = cleanBlank(data?.topic)
  return { topic, dropped: Boolean(data?.topic) && !topic, valid: true }
}
