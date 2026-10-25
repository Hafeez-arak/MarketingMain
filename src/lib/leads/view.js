// ─── Lead Agent page: what the numbers and labels say ──────────────────────
// Pure, so the page's counts are tested without a browser.

export const VERDICT_LABEL = {
  qualified: 'Qualified',
  unqualified: 'Unqualified',
  needs_review: 'Needs review',
  duplicate: 'Duplicate',
  pending: 'Not checked yet',
}

export const VERDICT_TONE = {
  qualified: 'bg-sage-100 text-sage-700',
  unqualified: 'bg-stone-100 text-stone-600',
  needs_review: 'bg-amber-100 text-amber-800',
  duplicate: 'bg-sky-50 text-sky-700',
  pending: 'bg-red-50 text-red-600',
}

export const SOURCE_LABEL = { website_form: 'Website', email: 'Email', manual: 'Added by hand' }

/** How a lead added by hand came to us (2026-10-18). */
export const CHANNEL_LABEL = {
  phone: 'Phone call',
  whatsapp: 'WhatsApp',
  walk_in: 'Walk-in',
  referral: 'Referral',
  exhibition: 'Exhibition or event',
  site_visit: 'Site visit',
  outbound: 'We contacted them',
  other: 'Other',
}

/** What a lead counts as: a person's correction wins over the agent. */
export function effectiveVerdict(lead) {
  if (lead?.human_verdict) return lead.human_verdict
  return lead?.verdict || 'pending'
}

const sameMonth = (iso, now) => {
  const d = new Date(iso)
  return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()
}

/**
 * This month's counts. A lead belongs to the month it ARRIVED in (or was
 * stored, when the Sheet's time could not be read), so backfilling old rows
 * does not inflate this month.
 */
export function monthStats(leads = [], now = new Date()) {
  const out = { qualified: 0, unqualified: 0, needs_review: 0, duplicate: 0, pending: 0, total: 0, spend: 0, reviewed: 0, corrected: 0 }
  for (const l of leads) {
    if (!sameMonth(l.received_at || l.created_at, now)) continue
    out.total++
    out[effectiveVerdict(l)]++
    if (l.human_verdict) {
      out.reviewed++
      if (l.verdict && l.verdict !== 'duplicate' && l.human_verdict !== l.verdict) out.corrected++
    }
  }
  // Spend is when it was spent, whatever month the enquiry is from.
  out.spend = leads.filter((l) => sameMonth(l.created_at, now)).reduce((s, l) => s + (Number(l.cost_usd) || 0), 0)
  return out
}

/**
 * How the website Sheet's timer is doing, from the last time it called in.
 * It calls every five minutes, so more than twenty minutes of silence means
 * it has stopped.
 */
export function sheetHealth(lastIntakeAt, now = new Date()) {
  if (!lastIntakeAt) return { state: 'never', label: 'Not connected yet' }
  const mins = Math.round((now.getTime() - new Date(lastIntakeAt).getTime()) / 60_000)
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 2880 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`
  return mins > 20 ? { state: 'stale', label: `Last checked ${ago}` } : { state: 'ok', label: `Checked ${ago}` }
}

/** "GPT-6 Luna" from "openai/gpt-6-luna". */
export function modelName(id = '') {
  const known = { 'openai/gpt-6-luna': 'GPT-6 Luna' }
  return known[id] || id.split('/').pop() || ''
}

// ─── Paging ────────────────────────────────────────────────────────────────
// The list is read one page at a time from Supabase, filtered there, so
// every lead is reachable however many there are.

export const PAGE_SIZE = 25

/**
 * A tab as a PostgREST `or` filter on the effective verdict (a person's
 * correction wins). null for "all".
 */
export function verdictFilter(tab = 'all') {
  if (tab === 'all') return null
  if (tab === 'pending') return 'and(human_verdict.is.null,verdict.is.null)'
  return `human_verdict.eq.${tab},and(human_verdict.is.null,verdict.eq.${tab})`
}

/** The first and last row (inclusive) of a 0-based page. */
export function pageRange(page = 0, size = PAGE_SIZE) {
  const from = Math.max(0, page) * size
  return { from, to: from + size - 1 }
}

/** "26–50 of 542". */
export function pageLabel(page, size, total, lang = 'en') {
  const of = lang === 'ar' ? 'من' : 'of'
  if (!total) return `0 ${of} 0`
  const { from, to } = pageRange(page, size)
  return `${from + 1}–${Math.min(to + 1, total)} ${of} ${total}`
}

export const pageCount = (total, size = PAGE_SIZE) => Math.max(1, Math.ceil((Number(total) || 0) / size))

// ─── The sales team's criteria, in their words (2026-10-11) ────────────────

export const SENDER_LABEL = {
  contractor: 'Contractor', developer_owner: 'Developer / owner', consultant: 'Consultant', end_client: 'End client',
  facility_company: 'Facility company', trader: 'Trader', individual: 'Individual', unknown: 'Sender unclear',
}
export const PROJECT_LABEL = { jih: 'JIH', tender: 'Tender', maintenance: 'Maintenance' }
export const REQUEST_LABEL = { requirement: 'Requirement', inquiry: 'Info request' }
export const FOLDER_LABEL = { inbox: 'Inbox', junk: 'Junk', deleted: 'Deleted items', archive: 'Archive', other: 'Other folder', website: 'Website form' }
export const PHILIPS_LABEL = { only: 'Philips only', mixed: 'Philips + others', or_equivalent: 'Philips or equivalent' }

/**
 * The project phase that counts: the team's choice when they set one
 * (2026-10-12), else the agent's reading. '' is not stated.
 * project_final is the database's own copy of this rule.
 */
export function projectOf(lead = {}) {
  if (lead.project_final != null) return lead.project_final
  if (lead.human_project_type) return lead.human_project_type === 'none' ? '' : lead.human_project_type
  return lead.project_type || ''
}

/**
 * The criteria a lead was read against, as short labels in a fixed order:
 * who, verified, phase, what, Philips, folder, email kind. Only what is known;
 * a lead read before the criteria (version 1) gives none.
 */
export function criteriaLabels(lead = {}, lang = 'en') {
  if ((lead.criteria_version || 1) < 2) return []
  const L = leadLabels(lang)
  const out = []
  if (lead.sender_type) out.push(L.sender[lead.sender_type] || lead.sender_type)
  if (lead.source_check) out.push(lead.source_check === 'verified' ? L.words.verified : L.words.notVerified)
  if (projectOf(lead)) out.push(L.project[projectOf(lead)] || projectOf(lead))
  if (lead.request_type) out.push(L.request[lead.request_type] || lead.request_type)
  if (L.philips[lead.philips]) out.push(L.philips[lead.philips])
  if (lead.folder && lead.folder !== 'inbox') out.push(L.folder[lead.folder] || lead.folder)
  if (lead.email_kind === 'free') out.push(L.words.freeEmail)
  return out
}

// ─── The leads list's filters (the sales view, 2026-10-11) ─────────────────

/** What the "Show" filter offers. "Leads" = qualified + needs review: what sales works on. */
export const SHOW_OPTIONS = [
  { key: 'leads', label: 'Leads to work on' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'unqualified', label: 'Unqualified' },
  { key: 'duplicate', label: 'Duplicates' },
  { key: 'pending', label: 'Not checked yet' },
  { key: 'corrected', label: 'Corrected by a person' },
  { key: 'approved', label: 'Approved / in CRM' },
  { key: 'all', label: 'Everything' },
]

export const EMPTY_FILTERS = { show: 'leads', owner: '', channel: '', sender: '', project: '', request: '', folder: '', emailKind: '', search: '' }

/**
 * The filters as PostgREST conditions: `or` groups (each its own `or=`
 * parameter, so they AND together) and plain `eq` pairs. Pure, so the list's
 * rules are tested without Supabase. A person's verdict wins over the agent's.
 * `me` is the signed-in user's id, for the Owner filter's "Mine".
 */
export function leadFilters(f = EMPTY_FILTERS, { me = '' } = {}) {
  const ors = []
  const eqs = []
  // Whose it is (2026-10-13): mine, no one's yet, or one person's.
  if (f.owner === 'none') ors.push('assigned_to.is.null')
  else if (f.owner === 'me' && me) eqs.push(['assigned_to', me])
  else if (f.owner && f.owner !== 'me') eqs.push(['assigned_to', f.owner])
  if (f.show === 'leads') {
    ors.push('human_verdict.in.(qualified,needs_review),and(human_verdict.is.null,verdict.in.(qualified,needs_review))')
  } else if (f.show === 'corrected') {
    // The weekly review: where a person said the agent was wrong.
    eqs.push(['corrected', true])
  } else if (f.show === 'approved') {
    ors.push('approved_at.not.is.null')

  } else if (f.show && f.show !== 'all') {
    ors.push(verdictFilter(f.show))
  }
  // Where it came in: the website form, or one connected mailbox (by the label it is stored under).
  if (f.channel === 'website') eqs.push(['source', 'website_form'])
  else if (f.channel === 'manual') eqs.push(['source', 'manual'])
  else if (f.channel) eqs.push(['mailbox', f.channel])
  if (f.sender) eqs.push(['sender_type', f.sender])
  // "Not stated" is the empty phase: sales fills it in after the call. The
  // team's choice counts (project_final).
  if (f.project) eqs.push(['project_final', f.project === 'none' ? '' : f.project])
  if (f.request) eqs.push(['request_type', f.request])
  if (f.folder) eqs.push(['folder', f.folder])
  if (f.emailKind) eqs.push(['email_kind', f.emailKind])
  // PostgREST's or-syntax uses , ( ) and quotes: keep them out of the words.
  const words = String(f.search || '').replace(/[,()"'*\\%]/g, ' ').replace(/\s+/g, ' ').trim()
  if (words) {
    const like = `*${words}*`
    ors.push(['company', 'name', 'email', 'subject', 'summary', 'message'].map((c) => `${c}.ilike.${like}`).join(','))
  }
  return { ors, eqs }
}

/** How many filters besides "Show" are set, for the "Clear filters" button. */
export const activeFilterCount = (f = EMPTY_FILTERS) =>
  ['owner', 'channel', 'sender', 'project', 'request', 'folder', 'emailKind', 'search'].filter((k) => String(f[k] || '').trim()).length

/** "$0.0098" for small amounts, "$9.60" otherwise. */
export const money = (n) => `$${(Number(n) || 0).toFixed(n && n < 0.1 ? 4 : 2)}`

/** "6 Oct, 13:00" in Riyadh time. */
export function when(iso, lang = 'en') {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' })
}

/** "Arak" from info@arak-sa.com, "CLB" from info@clb-sa.com: the company a mailbox belongs to. */
export function brandOf(address = '') {
  const word = String(address).toLowerCase().split('@')[1]?.split(/[-.]/)[0] || ''
  if (!word) return ''
  return word.length <= 3 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)
}

/** Where a lead came in, the way the team says it: "Arak website", "Arak email", "CLB email". */
export function channelLabel(lead = {}, { websiteBrand = 'Arak', lang = 'en' } = {}) {
  const L = leadLabels(lang)
  const ar = lang === 'ar'
  if (lead.source === 'website_form') return ar ? `موقع ${websiteBrand}` : `${websiteBrand} website`
  if (lead.source === 'manual') return L.channel[lead.channel] ? `${L.words.added} · ${L.channel[lead.channel]}` : L.source.manual
  const brand = brandOf(lead.mailbox)
  return brand ? (ar ? `بريد ${brand}` : `${brand} email`) : L.source.email
}

/**
 * A WhatsApp link for a Saudi number as people write it (05…, 9665…,
 * +966 5…, 00966…), or '' when it is not a mobile we can tell.
 */
export function whatsappLink(phone = '') {
  let d = String(phone).replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '')
  if (/^05\d{8}$/.test(d)) d = `966${d.slice(1)}`
  else if (/^5\d{8}$/.test(d)) d = `966${d}`
  return /^9665\d{8}$/.test(d) ? `https://wa.me/${d}` : ''
}

/** Every number a lead gave, the stored list first, else the form's own field. */
export const phonesOf = (lead = {}) => (Array.isArray(lead.phones) && lead.phones.length ? lead.phones : [lead.phone].filter(Boolean))

// ─── Outlook and the CRM ───────────────────────────────────────────────────

/**
 * The email in Outlook on the web, in the mailbox it arrived in. Graph's
 * own webLink (outlook.office365.com/owa/?ItemID=…) opens only inside the
 * signed-in person's OWN mailbox, so it fails for anyone but the mailbox
 * itself. Naming the mailbox (/mail/<address>/deeplink) opens it for anyone
 * Microsoft 365 lets into that mailbox (Full Access). The address is the
 * mailbox's real one: info@arak-sa.com is an alias of a.rak@arak-sa.com.
 */
export function outlookLink(lead = {}, mailboxes = []) {
  const link = String(lead.link || '')
  if (!link) return ''
  let itemId
  try { itemId = new URL(link).searchParams.get('ItemID') || '' } catch { return link }
  const want = String(lead.mailbox || '').toLowerCase()
  const mb = mailboxes.find((m) => [m.label, m.email].some((a) => String(a || '').toLowerCase() === want))
  const address = mb?.email || ''
  if (!itemId || !address) return link
  return `https://outlook.office.com/mail/${encodeURIComponent(address)}/deeplink?ItemID=${encodeURIComponent(itemId)}&exvsurl=1`
}

/** A lead's trip to the CRM, as the list says it. */
export const CRM_LABEL = {
  queued: 'Approved · waiting for Odoo',
  sending: 'Sending to Odoo…',
  sent: 'In Odoo',
  failed: 'Odoo refused it',
}

// ─── Who works a lead (2026-10-13) ─────────────────────────────────────────

/** A team member's short name: their first name, or the part of the address before @. */
export function shortName(member) {
  if (!member) return ''
  const full = String(member.full_name || '').trim()
  return full ? full.split(/\s+/)[0] : String(member.email || '').split('@')[0]
}

/**
 * The Owner column's words for a lead: "You", a first name, "Unassigned",
 * or "Someone else" when the person has left the team.
 */
export function ownerLabel(lead, team = [], me = '', lang = 'en') {
  const w = leadLabels(lang).words
  if (!lead?.assigned_to) return w.unassigned
  if (me && lead.assigned_to === me) return w.you
  return shortName(team.find((m) => m.user_id === lead.assigned_to)) || w.someoneElse
}

/**
 * Who a lead can be given to: the salespeople, never a sales admin (the
 * owner, 2026-10-19: "Arif will be the one to assign it"). The sales admin
 * hands leads out; they do not work them.
 */
export const assignable = (team = []) => team.filter((m) => !m.approver)


/** What the person gets when a lead is assigned: the email forwarded, from where. */
export function forwardWords(lead = {}, person = null, lang = 'en') {
  if (lang === 'ar') {
    const n = person ? shortName(person) : 'سيحصل'
    return lead.source === 'email'
      ? `${n}: يُحوَّل إليه بريد العميل الآن من ${lead.mailbox || 'صندوق البريد الذي وصل إليه'} مع المرفقات، ويرد من هناك.`
      : lead.source === 'manual'
        ? `${n}: يصله إشعار؛ لا يوجد بريد لتحويله في عميل أُضيف يدويًا.`
        : `${n}: يصله استفسار الموقع هذا بالبريد الآن، وعنوان العميل للرد.`
  }
  const name = person ? shortName(person) : 'They'
  return lead.source === 'email'
    ? `${name} gets the customer's email forwarded from ${lead.mailbox || 'the mailbox it came to'} now, attachments and all, and replies from there.`
    : lead.source === 'manual'
      ? `${name} gets a notification; there is no email to forward for a lead added by hand.`
      : `${name} gets this website enquiry by email now, with the customer as the reply address.`
}

/** Where the forward of the customer's email to the owner stands. */
export const FORWARD_LABEL = { sending: 'Forwarding…', sent: 'Email forwarded', failed: 'Email not forwarded' }

/**
 * Which tabs an opened lead has: Lead (contact, where it stands, files),
 * Battle card, and the email as it arrived. A lead added by hand has no
 * email; its notes are on the Lead tab.
 */
export const leadTabs = (lead = {}, lang = 'en') => {
  const t = leadLabels(lang).tabs
  return [
    ['lead', t.lead],
    ['card', t.card],
    ...(lead.source === 'manual' ? [] : [['email', t.email]]),
  ]
}

/**
 * Unread for this person (2026-10-19): it arrived on or after the company's
 * read_before and they have not opened it. `readIds` is a Set of their reads.
 */
export function isUnread(lead = {}, readIds = new Set(), readBefore = null) {
  if (!lead.id || readIds.has(lead.id)) return false
  const at = lead.received_at || lead.created_at
  if (readBefore && at && new Date(at).getTime() < new Date(readBefore).getTime()) return false
  return true
}

// ─── Arabic (v2, lib/i18n.js) ──────────────────────────────────────────────
// The same labels in Arabic; leadLabels(lang) gives a screen the set for its
// language. English stays the default everywhere, so nothing that reads the
// English maps directly (the server, emails, exports) changes.

const AR = {
  verdict: { qualified: 'مؤهَّل', unqualified: 'غير مؤهَّل', needs_review: 'يحتاج مراجعة', duplicate: 'مكرر', pending: 'لم يُفحص بعد' },
  source: { website_form: 'الموقع', email: 'البريد', manual: 'أُضيف يدويًا' },
  channel: { phone: 'مكالمة هاتفية', whatsapp: 'واتساب', walk_in: 'زيارة مباشرة', referral: 'توصية', exhibition: 'معرض أو فعالية', site_visit: 'زيارة موقع', outbound: 'تواصلنا معهم', other: 'أخرى' },
  sender: { contractor: 'مقاول', developer_owner: 'مطوّر / مالك', consultant: 'استشاري', end_client: 'العميل النهائي', facility_company: 'شركة إدارة مرافق', trader: 'تاجر', individual: 'فرد', unknown: 'المرسل غير واضح' },
  project: { jih: 'JIH', tender: 'مناقصة', maintenance: 'صيانة' },
  request: { requirement: 'طلب احتياج', inquiry: 'استفسار' },
  folder: { inbox: 'البريد الوارد', junk: 'البريد غير المرغوب', deleted: 'المحذوفات', archive: 'الأرشيف', other: 'مجلد آخر', website: 'نموذج الموقع' },
  philips: { only: 'فيليبس فقط', mixed: 'فيليبس وغيرها', or_equivalent: 'فيليبس أو ما يعادلها' },
  show: { leads: 'العملاء للعمل عليهم', qualified: 'مؤهَّل', needs_review: 'يحتاج مراجعة', unqualified: 'غير مؤهَّل', duplicate: 'المكررات', pending: 'لم يُفحص بعد', corrected: 'صحّحه شخص', approved: 'معتمد / في النظام', all: 'الكل' },
  crm: { queued: 'معتمد · بانتظار أودو', sending: 'جارٍ الإرسال إلى أودو…', sent: 'في أودو', failed: 'رفضه أودو' },
  forward: { sending: 'جارٍ التحويل…', sent: 'حُوّل البريد', failed: 'لم يُحوَّل البريد' },
  tabs: { lead: 'العميل', card: 'بطاقة المنافسة', email: 'البريد والأدلة' },
  stage: { new: 'جديد', contacted: 'تم التواصل', rfq: 'وصل طلب التسعير', quotation: 'أُرسل عرض السعر', negotiating: 'تفاوض', won: 'مكسوب', lost: 'خاسر' },
  lost: { price: 'السعر', brand: 'العلامة ليست لدينا / غير معتمدة', lead_time: 'مدة التوريد أو المخزون', no_reply: 'توقفوا عن الرد', cancelled: 'أُلغي المشروع أو توقف', other: 'أخرى' },
  words: { verified: 'موثّق', notVerified: 'غير موثّق', freeEmail: 'بريد مجاني', you: 'أنت', unassigned: 'بلا مسؤول', someoneElse: 'شخص آخر', added: 'أُضيف', website: 'الموقع', emailWord: 'البريد' },
}
const EN = {
  verdict: VERDICT_LABEL, source: SOURCE_LABEL, channel: CHANNEL_LABEL, sender: SENDER_LABEL, project: PROJECT_LABEL,
  request: REQUEST_LABEL, folder: FOLDER_LABEL, philips: PHILIPS_LABEL,
  show: Object.fromEntries(SHOW_OPTIONS.map((o) => [o.key, o.label])), crm: CRM_LABEL, forward: FORWARD_LABEL,
  tabs: { lead: 'Lead', card: 'Battle card', email: 'Email and evidence' },
  stage: { new: 'New', contacted: 'Contacted', rfq: 'RFQ received', quotation: 'Quotation sent', negotiating: 'Negotiating', won: 'Won', lost: 'Lost' },
  lost: { price: 'Price', brand: 'Brand not ours / not approved', lead_time: 'Lead time or stock', no_reply: 'They stopped replying', cancelled: 'Project cancelled or on hold', other: 'Other' },
  words: { verified: 'Verified', notVerified: 'Not verified', freeEmail: 'Free email', you: 'You', unassigned: 'Unassigned', someoneElse: 'Someone else', added: 'Added', website: 'website', emailWord: 'email' },
}

/** Every lead label map in one language: leadLabels('ar').verdict.qualified === 'مؤهَّل'. */
export const leadLabels = (lang = 'en') => (lang === 'ar' ? AR : EN)
