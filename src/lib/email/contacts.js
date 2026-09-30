// ─── Email contacts: the shared vocabulary ─────────────────────────────────
// Used by the browser (Contacts tab, CSV import) and by the server
// (api/email/[action].js, which re-checks everything the browser checked).
// Pure — no React, no Supabase, no import.meta — so a Node function can load
// it. See src/lib/agent/nodeBoundary.test.js.

// The two lanes. A contact is in exactly one.
export const AUDIENCES = {
  marketing: {
    label: 'Newsletter',
    hint: 'Knows us: customers, partners, people who signed up or replied, people met at events. They get newsletters.',
  },
  cold: {
    label: 'Outreach',
    hint: 'Prospects who have not opted in yet. Written to only from the outreach mailboxes, a few a day. A reply or a sign-up moves them to Newsletter.',
  },
}

export const CONTACT_TYPES = [
  'Customer', 'Contractor', 'MEP contractor', 'Consultant', 'Lighting designer',
  'Architect', 'Interior designer', 'Developer', 'Facility manager', 'Government',
  'Supplier', 'Partner', 'Other',
]

export const CONSENT = {
  opted_in:         { label: 'Opted in',          hint: 'Asked to hear from us (sign-up form, event list, reply).' },
  customer:         { label: 'Existing customer', hint: 'Has bought from us.' },
  business_contact: { label: 'Business contact',  hint: 'Exchanged business email with us, or gave us a card.' },
  none:             { label: 'No consent',        hint: 'Found through research. Cold outreach only.' },
}

export const STATUSES = {
  active:       { label: 'Active',       tone: 'green' },
  unsubscribed: { label: 'Unsubscribed', tone: 'gray' },
  bounced:      { label: 'Bounced',      tone: 'red' },
  complained:   { label: 'Marked spam',  tone: 'red' },
}

export const SOURCES = {
  manual: 'Added by hand', import: 'CSV import', website: 'Website', event: 'Event',
  research: 'Research agent', reply: 'Replied to outreach', other: 'Other',
}

export const LANGUAGES = { en: 'English', ar: 'Arabic' }

// The marketing group a prospect joins by pressing the sign-up button in an
// outreach email (api/email/_engine.js, subscribe). Made on the first sign-up.
export const SUBSCRIBERS_GROUP = 'Newsletter subscribers'

// The marketing group a prospect joins by replying to an outreach email with
// anything but "stop" (api/email/_cold.js, readReplies). Made on the first one.
export const REPLIES_GROUP = 'Replied to outreach'

// The marketing group someone joins by sending an enquiry from the website
// with the marketing box ticked (api/email/_engine.js, websiteSignup).
export const WEBSITE_GROUP = 'Website enquiries'

/** Lower-cased, trimmed, with a mailto: or angle brackets stripped. */
export function normalizeEmail(raw) {
  return String(raw || '')
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^<(.*)>$/, '$1')
    .trim()
    .toLowerCase()
}

// Deliberately modest. A stricter regex rejects real addresses; this catches
// the typos that actually happen in a spreadsheet (missing @, spaces, no dot
// in the domain, a trailing comma).
const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[a-z]{2,}$/i
export function isValidEmail(raw) {
  const email = normalizeEmail(raw)
  return email.length <= 254 && EMAIL_RE.test(email)
}

export function fullName(c) {
  return [c?.first_name, c?.last_name].map(s => String(s || '').trim()).filter(Boolean).join(' ')
}

export function displayName(c) {
  return fullName(c) || c?.email || ''
}

/**
 * Whether a contact may receive an email in `audience`'s lane at all.
 * Returns '' when it may, otherwise the reason it may not — the reason is what
 * the campaign screen shows next to "skipped".
 */
export function blockReason(contact, audience) {
  if (!contact) return 'Contact no longer exists'
  if (contact.status === 'unsubscribed') return 'Unsubscribed'
  if (contact.status === 'bounced') return 'Address bounced'
  if (contact.status === 'complained') return 'Marked us as spam'
  if (!isValidEmail(contact.email)) return 'Invalid address'
  if (contact.audience !== audience) {
    return audience === 'marketing'
      ? 'Cold contact: marketing email only goes to people who know us'
      : 'Marketing contact: not a cold prospect'
  }
  if (audience === 'marketing' && contact.consent === 'none') return 'No consent recorded'
  if (audience === 'cold' && contact.replied_at) return 'Already replied'
  return ''
}

/**
 * The recipients of a campaign: every contact in any of the chosen groups,
 * once each, split into who will be sent to and who will be skipped (and why).
 *
 * @param {object} args
 * @param {Array}  args.contacts     contact rows
 * @param {Array}  args.memberships  { group_id, contact_id } rows
 * @param {Array}  args.groupIds     the campaign's groups
 * @param {'marketing'|'cold'} args.audience
 * @param {'en'|'ar'|null} [args.language]  only contacts who prefer this language
 */
export function pickRecipients({ contacts, memberships, groupIds, audience, language = null }) {
  const wanted = new Set(groupIds || [])
  const byId = new Map((contacts || []).map(c => [c.id, c]))
  const seenContact = new Set()
  const seenEmail = new Set()
  const eligible = []
  const skipped = []
  for (const m of memberships || []) {
    if (!wanted.has(m.group_id) || seenContact.has(m.contact_id)) continue
    seenContact.add(m.contact_id)
    const contact = byId.get(m.contact_id)
    const reason = blockReason(contact, audience)
      || (language && (contact.language || 'en') !== language ? `Prefers ${language === 'ar' ? 'English' : 'Arabic'}` : '')
    if (reason) { skipped.push({ contact, reason }); continue }
    // Two rows with the same address should be impossible (unique index), but
    // one email per address per campaign is the promise, so it is kept here.
    const email = normalizeEmail(contact.email)
    if (seenEmail.has(email)) continue
    seenEmail.add(email)
    eligible.push(contact)
  }
  return { eligible, skipped }
}

/** Shape a contact from a form or import for writing. Unknown keys are dropped. */
export function cleanContact(input, defaults = {}) {
  const pick = (k, fallback = '') => String(input?.[k] ?? defaults[k] ?? fallback).trim()
  const audience = ['marketing', 'cold'].includes(input?.audience) ? input.audience
    : (defaults.audience || 'marketing')
  const language = ['en', 'ar'].includes(input?.language) ? input.language : (defaults.language || 'en')
  const consent = Object.hasOwn(CONSENT, input?.consent) ? input.consent
    : (defaults.consent || (audience === 'cold' ? 'none' : 'business_contact'))
  const source = Object.hasOwn(SOURCES, input?.source) ? input.source : (defaults.source || 'manual')
  return {
    email: normalizeEmail(input?.email),
    first_name: pick('first_name'),
    last_name: pick('last_name'),
    company: pick('company'),
    job_title: pick('job_title'),
    phone: pick('phone'),
    city: pick('city'),
    country: pick('country'),
    contact_type: pick('contact_type'),
    notes: pick('notes'),
    audience,
    language,
    // A cold contact never carries a marketing consent. Filing one as cold is
    // the statement that they did not opt in.
    consent: audience === 'cold' ? 'none' : (consent === 'none' ? 'business_contact' : consent),
    source,
    // Tied to the research lead it came from, when it did. Only sent when
    // set, so saving an edit never unties a contact.
    ...(/^[0-9a-f-]{36}$/i.test(String(input?.opportunity_id || '')) ? { opportunity_id: input.opportunity_id } : {}),
  }
}
