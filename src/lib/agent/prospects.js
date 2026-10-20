import { domainOf } from './resolve.js'
import { normaliseIcp, icpPromptText } from '../sales/icp.js'

// ─── Prospects: companies we could contract with ───────────────────────────
// Asked for by Ghusn on 2026-10-03 and again 2026-10-20: "a tool for finding
// associations or corporates that will benefit from our services, people we
// can contract with". Not a lens. The weekly research finds what changed in
// the news; a prospect list is built per segment, on request, and most of the
// companies on it have done nothing newsworthy at all. A hotel group or a
// restaurant chain is a buyer because of what it RUNS, not because of what it
// announced this week.
//
// One model call with search (api/agent/_prospects.js), then the decisions
// that have to be the same every time are made here, in code:
//
//   is it a company we already have?          nameKey / sameCompany
//   did the model read the page it cites?     the allow-list of URLs the
//                                             search tools actually returned
//   is a contact detail one it actually saw?  contact_source on that list
//
// Nothing in this file names an industry. "Hotels in Riyadh" is a segment a
// person typed; what Ghusn sells arrives from the Brand Brain and the ICP.
//
// Pure. No network, no clock.

/** Never more than this from one search. A wall of names gets ignored wholesale. */
export const MAX_PROSPECTS = 15
export const DEFAULT_COUNT = 10

export const PROSPECT_STATUSES = {
  new: 'To review',
  added: 'In outreach',
  contacted: 'Contacted',
  rejected: 'Rejected',
}

// Words that make two spellings of one company look different. Kept short on
// purpose: "Al" is NOT here, because "Al Rajhi" and "Rajhi" are the same name
// either way and stripping it would merge different Al-something companies.
const SUFFIXES = new Set([
  'the', 'co', 'company', 'ltd', 'limited', 'llc', 'inc', 'est', 'establishment',
  'group', 'holding', 'holdings', 'trading', 'ksa', 'saudi', 'arabia',
  'شركة', 'مؤسسة', 'مجموعة', 'المحدودة', 'القابضة',
])

/**
 * What "the same company" means, as a string.
 *
 * Unicode-aware, unlike resolve.js `norm`, which keeps only a–z and 0–9 and so
 * turns every Arabic name into the empty string. Two Arabic-only prospects
 * would then be "the same company" and the second silently dropped.
 */
const wordsOf = name => String(name || '')
  .normalize('NFKC')
  .toLowerCase()
  .split(/[^\p{L}\p{N}]+/u)
  .filter(w => w && !SUFFIXES.has(w))

export function nameKey(name) {
  return wordsOf(name).join('')
}

/**
 * Same domain, same key, or every word of one name inside the other.
 *
 * Whole words, not substrings: "Company 1" is not "Company 10", and "Abc" is
 * not "Abcon Contracting". Otherwise biased toward calling a near-match the
 * same ("Example Hotels" and "Example Hotels Riyadh"): a prospect wrongly
 * merged is found again by typing its name; a list with three spellings of
 * one company sends it three cold emails.
 */
export function sameCompany(a, b) {
  const da = domainOf(a?.website || a?.domain)
  const db = domainOf(b?.website || b?.domain)
  if (da && db && da === db) return true
  const ka = a?.name_key || nameKey(a?.name)
  const kb = b?.name_key || nameKey(b?.name)
  if (!ka || !kb) return false
  if (ka === kb) return true
  const wa = wordsOf(a?.name)
  const wb = wordsOf(b?.name)
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  return short.length > 0 && short.join('').length >= 5 && short.every(w => long.includes(w))
}

/**
 * Segments to offer before anyone types one: the ICP's own segments when the
 * company has written them, since those are already the buyers it targets.
 * Without an ICP, the lines of the Brand Brain's audience, headings skipped.
 * (The audience also lists private buyers, such as villa owners, which an ICP
 * leaves out on purpose.)
 */
export function segmentSuggestions({ targetPersonas = '', icp = null } = {}) {
  const out = []
  const push = label => {
    const clean = String(label || '').replace(/^[\s\-•*]+/, '').replace(/[:：]\s*$/, '').trim()
    if (clean.length < 4 || clean.length > 140) return
    if (out.some(o => o.toLowerCase() === clean.toLowerCase())) return
    out.push(clean)
  }
  for (const s of normaliseIcp(icp || {}).segments) push(s.label)
  if (out.length) return out.slice(0, 12)
  for (const line of String(targetPersonas || '').split('\n')) {
    // "Companies and project clients come first:" is a heading, not a segment.
    if (/[:：]\s*$/.test(line.trim())) continue
    push(line.split(/[:：]/)[0])
  }
  return out.slice(0, 12)
}

const str = v => String(v ?? '').trim()

/**
 * What the model hands back. Every field required, an empty string when not
 * established: the same rule the targets schema follows, and for the same
 * reason (structured output refuses large optional-heavy schemas).
 */
export const PROSPECTS_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['prospects', 'note'],
    properties: {
      note: {
        type: 'string',
        description: 'One or two sentences: where you looked, and anything about this segment the reader should know (e.g. most are run by one operator).',
      },
      prospects: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'name', 'website', 'city', 'sites', 'fit', 'source_url', 'offer', 'pitch', 'proof',
            'ask_for', 'email', 'phone', 'linkedin', 'contact_source', 'confidence',
          ],
          properties: {
            name: { type: 'string', description: 'The company or organisation as it trades. Never a sentence.' },
            website: { type: 'string', description: 'Their own website, or empty.' },
            city: { type: 'string' },
            sites: { type: 'string', description: 'What they run that needs us, and where: "14 drive-through branches in Riyadh". Empty if unknown.' },
            fit: { type: 'string', description: 'One sentence: why this company would buy from us.' },
            source_url: { type: 'string', description: 'A page you actually read that shows this company and why it fits.' },
            offer: { type: 'string', description: 'The key of the offer to lead with, from WHAT WE SELL, or empty.' },
            pitch: { type: 'string', description: 'One sentence: what to offer them first and why now.' },
            proof: { type: 'string', description: 'Our own project or client closest to them, as named in the brand context, or empty.' },
            ask_for: { type: 'string', description: 'The role to ask for, e.g. facilities manager or procurement.' },
            email: { type: 'string', description: 'A general, procurement or facilities email PUBLISHED by the company, or empty. Never guessed.' },
            phone: { type: 'string', description: 'Their main published phone number, or empty.' },
            linkedin: { type: 'string', description: 'Their LinkedIn COMPANY page URL, or empty. Never a person.' },
            contact_source: { type: 'string', description: 'The page where you read the email or phone. Empty when both are empty.' },
            confidence: { type: 'number', description: '0 to 1: how sure you are that this company fits and exists as described.' },
          },
        },
      },
    },
  },
}

/** The ICP's offers as prompt lines. */
function offerLines(icp) {
  return icp.offers.map(o =>
    `- ${o.label} [offer key: ${o.key}]${o.kind === 'recurring' ? ' — recurring, a yearly contract' : ''}${o.note ? ` — ${o.note}` : ''}`)
}

/**
 * The prompt. Every specific — the industry, the city, the buyer — arrives
 * from the brand and from what the person typed.
 */
export function prospectsPrompt(brand = {}, {
  segment = '', area = '', count = DEFAULT_COUNT, icp = null, known = [], language = '',
} = {}) {
  const n = Math.max(1, Math.min(MAX_PROSPECTS, Math.round(Number(count) || DEFAULT_COUNT)))
  const norm = normaliseIcp(icp || {})
  const where = str(area) || str(brand.geography)
  const offers = offerLines(norm)
  return [
    `Brand: ${brand.brandName || 'this brand'}`,
    brand.descriptor ? `What they do: ${brand.descriptor}` : null,
    brand.audience ? `Who they sell to: ${brand.audience}` : null,
    where ? `Where: ${where}` : null,
    '',
    `One question: WHICH ${str(segment).toUpperCase() || 'COMPANIES'}${where ? ` IN ${where.toUpperCase()}` : ''} WOULD BUY FROM US, AND HOW DO WE REACH THEM?`,
    '',
    'This is a list for business-to-business outreach, not news. A company does not need to be in the',
    'news to be on it. An organisation that runs sites, branches, buildings or grounds that need what we',
    'sell is a prospect today. So are associations and bodies that manage shared property or speak for',
    'many members (an owners\' association, a chamber committee, a compound operator): one of them can',
    'open many sites at once.',
    '',
    // The ICP without its own offer list: the keyed one below replaces it.
    norm.summary || norm.segments.length ? icpPromptText({ ...norm, offers: [] }) : null,
    norm.summary || norm.segments.length ? '' : null,
    offers.length ? `WHAT WE SELL — lead with the one that fits each company best, by key:\n${offers.join('\n')}` : null,
    offers.length ? '' : null,
    'WHERE TO LOOK: member and supplier directories, chamber of commerce and association lists, lists of',
    'hotels, malls, hospitals, schools or branches in the area, the companies\' own websites (their',
    'locations and contact pages), and LinkedIn company pages. Read the company\'s own site before you',
    'name it: that is where its sites and its published contacts are.',
    language
      ? `Search in ${language} as well as English. Many companies here publish their branch lists and contacts in ${language} only.`
      : null,
    '',
    `Up to ${n} companies. ${n} real ones with a source each beat a longer list. Fewer is fine when the`,
    'segment is small; say so in note.',
    '',
    'FOR EVERY COMPANY:',
    '- source_url — a page you actually read. No page, no company.',
    '- sites — what they run that needs us, and how many, when a source says.',
    '- proof — name one of OUR projects or clients from the brand context that is closest to them. Only',
    '  ones the brand context names; empty when none is close.',
    '- ask_for — the role that buys this (facilities, procurement, projects, operations).',
    '- CONTACTS ARE PUBLIC ONLY: the company\'s own website, an email or phone the company itself',
    '  publishes (general, procurement, facilities), and its LinkedIn company page. Never a private',
    '  person\'s email or mobile. Never build an email from a pattern. contact_source is the page you',
    '  read them on; leave email and phone empty if you did not see them.',
    '- confidence — honest. A company you are 50% sure fits is a 0.5, not left out.',
    '',
    known.length
      ? `ALREADY ON OUR LIST — do not return these, in any spelling:\n${known.slice(0, 120).map(k => `- ${k}`).join('\n')}`
      : null,
    known.length ? '' : null,
    'Write in plain English: short sentences, everyday words. The readers use English as a second',
    'language. Keep company names as they are written.',
  ].filter(v => v != null).join('\n').replace(/\n{3,}/g, '\n\n')
}

/** Is this URL one the search tools actually returned, or on the same site as one? */
function seen(url, allowed) {
  const u = str(url)
  if (!u) return false
  if (allowed.has(u)) return true
  const d = domainOf(u)
  if (!d) return false
  for (const a of allowed) if (domainOf(a) === d) return true
  return false
}

const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i
const cleanPhone = p => {
  const v = str(p).replace(/[^\d+()\s-]/g, '').replace(/\s+/g, ' ').trim()
  return (v.match(/\d/g) || []).length >= 7 ? v : ''
}
const cleanLinkedIn = u => (/linkedin\.com\/(company|school|showcase)\//i.test(str(u)) ? str(u) : '')

/**
 * Keep what can be shown to a salesperson; say why the rest went.
 *
 * @param {Array} reported   the model's prospects
 * @param {object} o
 * @param {Array}  o.known   rows we already have, in every status
 * @param {Set}    o.allowed URLs the search tools returned this call
 * @param {object} o.icp     for the offer keys
 * @param {number} o.count
 * @returns {{ keep: Array, dropped: { known: number, unsourced: number, unnamed: number } }}
 */
export function cleanProspects(reported, { known = [], allowed = new Set(), icp = null, count = MAX_PROSPECTS } = {}) {
  const offerKeys = new Set(normaliseIcp(icp || {}).offers.map(o => o.key))
  const limit = Math.max(1, Math.min(MAX_PROSPECTS, Number(count) || MAX_PROSPECTS))
  const keep = []
  const dropped = { known: 0, unsourced: 0, unnamed: 0 }
  const list = [...(Array.isArray(known) ? known : [])]

  for (const p of Array.isArray(reported) ? reported : []) {
    const name = str(p?.name)
    const key = nameKey(name)
    if (!name || !key) { dropped.unnamed += 1; continue }
    const website = str(p?.website)
    // The page it cites, or failing that its own site, must be one the tools
    // returned. A company the model only remembers is not one it checked.
    const source = seen(p?.source_url, allowed) ? str(p.source_url) : seen(website, allowed) ? website : ''
    if (!source) { dropped.unsourced += 1; continue }
    const candidate = { name, name_key: key, website }
    if (list.some(k => sameCompany(candidate, k))) { dropped.known += 1; continue }

    // A contact detail survives only when the page it came from was read.
    const contactRead = seen(p?.contact_source, allowed)
    const email = contactRead && EMAIL.test(str(p?.email)) ? str(p.email).toLowerCase() : ''
    const phone = contactRead ? cleanPhone(p?.phone) : ''
    const conf = Number(p?.confidence)

    const row = {
      name,
      name_key: key,
      website,
      domain: domainOf(website),
      city: str(p?.city),
      sites: str(p?.sites),
      fit: str(p?.fit),
      offer: offerKeys.has(str(p?.offer)) ? str(p.offer) : '',
      pitch: str(p?.pitch),
      proof: str(p?.proof),
      ask_for: str(p?.ask_for),
      email,
      phone,
      linkedin: cleanLinkedIn(p?.linkedin),
      contact_source: email || phone ? str(p.contact_source) : '',
      source_url: source,
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
    }
    keep.push(row)
    list.push(row)
    if (keep.length >= limit) break
  }
  return { keep, dropped }
}

/** The rows to insert. Status is pinned: a person reviews every one. */
export function prospectRows(workspaceId, searchId, segment, keep) {
  return (keep || []).map(p => ({
    ...p,
    workspace_id: workspaceId,
    search_id: searchId || null,
    segment: str(segment),
    status: 'new',
  }))
}

/** What the person is told when the search ends. */
export function prospectsSummary({ keep = [], dropped = {}, seenCount = 0, cost = 0, note = '' }) {
  const parts = [
    keep.length ? `${keep.length} new ${keep.length === 1 ? 'company' : 'companies'} found.` : 'No new companies found.',
    dropped.known ? `${dropped.known} we already had ${dropped.known === 1 ? 'was' : 'were'} left out.` : '',
    dropped.unsourced ? `${dropped.unsourced} without a page we could check ${dropped.unsourced === 1 ? 'was' : 'were'} left out.` : '',
  ].filter(Boolean)
  return { ok: true, found: keep.length, seen: seenCount, dropped, cost, note: str(note), message: parts.join(' ') }
}

/** The cold-outreach group a segment's prospects join. */
export function groupNameFor(segment) {
  const s = str(segment).replace(/\s+/g, ' ')
  return `Prospects — ${s.length > 60 ? `${s.slice(0, 57)}…` : s || 'other'}`
}

/**
 * A prospect as an Outreach contact (src/lib/email/contacts.js cleanContact
 * input). Only a prospect with a published email can become one: outreach is
 * email, and a phone number is for the salesperson to call.
 */
export function contactFromProspect(p = {}) {
  if (!EMAIL.test(str(p.email))) return null
  return {
    email: str(p.email).toLowerCase(),
    company: str(p.name),
    phone: str(p.phone),
    city: str(p.city),
    job_title: str(p.ask_for),
    contact_type: 'Other',
    audience: 'cold',
    consent: 'none',
    source: 'research',
    notes: [str(p.segment) && `Prospect: ${str(p.segment)}`, str(p.fit), str(p.pitch) && `Pitch: ${str(p.pitch)}`]
      .filter(Boolean).join(' — ').slice(0, 1000),
  }
}
