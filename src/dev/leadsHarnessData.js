// ─── Dev-only data for the Lead Agent harness ──────────────────────────────
// Imported FIRST by leadsHarness.jsx so window.fetch is replaced before the
// page loads. Made-up enquiries only (this repo is public). ?mode=hang keeps
// every request pending (the loading state); ?mode=fail rejects them.

import { buildLeadCard, normaliseLeadCard, afterCallFields } from '../lib/sales/leadCard'
import { manualLead, trackFields } from '../lib/leads/pipeline'
import runsFixture from './runsFixture.json'

export const WS = '00000000-0000-0000-0000-0000000000dd'

// What the research watches, made up: the sales Research page lists it.
const AGENDA = [
  { id: 'a1', kind: 'source', source_type: 'tender_portal', tier: 1, status: 'active', subject: 'tenders.example.gov.sa', why: 'Government tenders and planned projects: schools, hospitals, ministry buildings.' },
  { id: 'a2', kind: 'source', source_type: 'exchange', tier: 1, status: 'active', subject: 'exchange.example.sa', why: 'Listed contractors must announce contract awards.' },
  { id: 'a3', kind: 'source', source_type: 'news', tier: 2, status: 'active', subject: 'construction-news.example.com', why: 'Saudi awards, contractors and fit-out news.' },
  { id: 'a4', kind: 'source', source_type: 'linkedin', tier: 2, status: 'active', subject: 'Example Fit-Out Co', why: 'Fit-out contractor that posts its Riyadh wins.' },
  { id: 'a5', kind: 'source', source_type: 'instagram', tier: 1, status: 'active', subject: '@example_projects', why: 'Tracks Riyadh projects under construction.' },
  { id: 'a6', kind: 'source', source_type: 'hashtag', tier: 1, status: 'active', subject: '#مشاريع_الرياض', why: '"Riyadh projects", used by developers and contractors.' },
  { id: 'a7', kind: 'source', source_type: 'keyword', tier: 2, status: 'active', subject: '"awarded" fit-out contract Riyadh', why: 'Finds contractors announcing new jobs.' },
  { id: 'a8', kind: 'source', source_type: 'news', tier: 3, status: 'retired', subject: 'paused.example.com', why: 'Paused, so not listed.' },
  { id: 'c1', kind: 'competitor', status: 'active', subject: 'Example Lighting', domain: 'example-lighting.com', why: 'Internal note, not shown.' },
  { id: 'c2', kind: 'competitor', status: 'active', subject: 'Sample Controls', domain: '', why: '' },
  { id: 'c3', kind: 'competitor', status: 'retired', subject: 'Retired Rival', domain: 'retired.example', why: '' },
  { id: 'q1', kind: 'question', status: 'active', subject: 'A standing question, not listed', why: '' },
]

const mode = new URLSearchParams(window.location.search).get('mode') || ''
const iso = (d, h) => `2026-10-0${d}T${String(h).padStart(2, '0')}:00:00Z`
const as = new URLSearchParams(window.location.search).get('as') || 'admin'

// The made-up sales team (2026-10-13). u1 is whoever is signed in to the
// harness: the sales admin (?as=sales_admin) or a salesperson (?as=sales).
const TEAM = [
  { user_id: 'u1', email: 'sales@example.com', full_name: as === 'sales' ? 'Omar Example' : 'Arif Example', approver: as !== 'sales', all_website_leads: false, odoo_login: '', odoo_user_id: null },
  { user_id: 'u2', email: 'huda@example.com', full_name: 'Huda Example', approver: false, all_website_leads: true, odoo_login: '', odoo_user_id: null },
  { user_id: 'u3', email: 'sami@example.com', full_name: 'Sami Example', approver: false, all_website_leads: false, odoo_login: 'sami.e', odoo_user_id: null },
]

const leads = [
  { id: 'e1', source: 'email', mailbox: 'info@example-co.sa', link: 'https://outlook.office.com/mail/', received_at: iso(6, 10), created_at: iso(6, 10), name: 'Khalid', company: '', email: 'khalid@example-dev.sa', phone: '', subject: 'Facade lighting for a tower', message: 'Dear ARAK, we are developing a 20-floor tower in Jeddah and need facade lighting design and supply. Can we meet next week?\n\nPlease find attached the BOQ. Drawings: Download<https://example-my.sharepoint.com/:f:/g/drawings>\n\nBest Regards,\n\n[cid:195874d0-d5e4-47e7-8fb9-adec9825c390]\n\nKhalid\nwww.example-dev.sa<http://www.example-dev.sa>\nkhalid@example-dev.sa<mailto:khalid@example-dev.sa>', language: 'en', verdict: 'qualified', category: 'project_enquiry', confidence: 'high', reason: 'A developer with a tower project asking for facade lighting design and supply.', summary: 'Facade lighting design and supply, 20-floor tower, Jeddah', details: { products: 'Facade lighting', location: 'Jeddah', stage: 'Development' }, ask_next: ['Project timeline?', 'Who is the consultant?', 'Budget range?'], model: 'openai/gpt-6-luna', cost_usd: 0.00018, error: '', human_verdict: null, criteria_version: 2, sender_type: 'trader', sender_evidence: 'Signature: Purchasing, Example Dev Trading Est.', source_check: 'verified', source_evidence: 'signature and website match', project_type: 'tender', project_evidence: 'we are bidding for the main contract', request_type: 'requirement', philips: 'or_equivalent', website: 'example-dev.sa', folder: 'junk', email_kind: 'company', phones: ['+966 12 600 0000', '055 000 1111'], assigned_to: 'u1', assigned_at: iso(6, 11), forward_status: 'failed', forward_to: 'sales@example.com', forward_error: 'info@example-clb.sa can only read. On Agent settings, choose "Allow forwarding" on it and sign in as it again.' },
  { id: 'l1', source: 'website_form', received_at: iso(6, 8), created_at: iso(6, 8), name: 'Omar Haddad', company: 'Nour Contracting', email: 'omar@nourcontracting.sa', phone: '+966 50 111 2233', subject: 'Commercial / office', message: 'We need a quotation for 40 recessed downlights, 4000K, for an office fit-out in Riyadh. Delivery in 3 weeks.', language: 'en', verdict: 'qualified', category: 'quotation_request', confidence: 'high', reason: 'Asks for a quote on 40 downlights for an office in Riyadh.', summary: 'Quote for 40 recessed downlights, 4000K, office fit-out, Riyadh', details: { products: 'Recessed downlights 4000K', quantity: '40', location: 'Riyadh', urgency: '3 weeks' }, ask_next: ['Beam angle and dimming?', 'Is there a lighting layout?', 'Who approves the order?'], model: 'openai/gpt-6-luna', cost_usd: 0.00016, error: '', human_verdict: null, criteria_version: 2, sender_type: 'contractor', sender_evidence: 'Nour Contracting, office fit-out', source_check: 'verified', source_evidence: 'company name + company email domain', project_type: 'jih', project_evidence: 'Delivery in 3 weeks', request_type: 'requirement', philips: 'none', folder: 'website', email_kind: 'company', approved_at: iso(6, 12), crm_status: 'queued', stage: 'rfq', stage_at: iso(6, 13), next_step: 'Send the downlight quote', follow_up: '2026-10-15', assigned_to: 'u2', assigned_at: iso(6, 11), forward_status: 'sent', forward_to: 'huda@example.com', forwarded_at: iso(6, 11) },
  { id: 'l2', source: 'website_form', received_at: iso(5, 14), created_at: iso(5, 14), name: 'Ayşe K.', company: 'Bosphorus Chandeliers', email: 'sales@example-chandeliers.com', phone: '', subject: 'Hotel / hospitality', message: 'We are an Istanbul chandelier manufacturer and would love to share our portfolio for your upcoming hotel projects.', language: 'en', verdict: 'unqualified', category: 'vendor_pitch', confidence: 'high', reason: 'A manufacturer offering its own products to us.', summary: 'Chandelier maker pitching its portfolio', details: {}, ask_next: [], model: 'openai/gpt-6-luna', cost_usd: 0.00015, error: '', human_verdict: 'unqualified' },
  { id: 'l3', source: 'website_form', received_at: iso(5, 9), created_at: iso(5, 9), name: 'فهد', company: '', email: 'fahad@example.com', phone: '0550000000', subject: 'خارجي / واجهات', message: 'انارات خارجيه', language: 'ar', verdict: 'qualified', category: 'product_enquiry', confidence: 'medium', reason: 'Asks for outdoor lighting; very little detail.', summary: 'Outdoor lighting, no details yet', details: { products: 'Outdoor lighting' }, ask_next: ['Which building or site?', 'How many fittings?'], model: 'openai/gpt-6-luna', cost_usd: 0.00014, error: '', human_verdict: null },
  { id: 'l4', source: 'website_form', received_at: iso(5, 9), created_at: iso(5, 9), name: 'فهد', company: '', email: 'fahad@example.com', phone: '0550000000', subject: 'خارجي / واجهات', message: 'انارات خارجيه', language: 'ar', verdict: 'duplicate', category: '', confidence: '', reason: 'Same sender and message as the enquiry of 2026-10-05 06:00 UTC.', summary: '', details: {}, ask_next: [], model: '', cost_usd: 0, error: '', human_verdict: null },
  { id: 'l5', source: 'website_form', received_at: iso(4, 11), created_at: iso(4, 11), name: 'Studio Raml', company: 'Studio Raml Interiors', email: 'hello@example-raml.sa', phone: '', subject: 'Villa / palace', message: 'We propose a referral partnership: we recommend your lighting to our clients for a commission.', language: 'en', verdict: 'needs_review', category: 'partnership_offer', confidence: 'medium', reason: 'A referral partnership offer, not a purchase.', summary: 'Referral partnership proposal', details: {}, ask_next: [], model: 'openai/gpt-6-luna', cost_usd: 0.00017, error: '', human_verdict: null },
  { id: 'l6', source: 'website_form', received_at: iso(6, 9), created_at: iso(6, 9), name: 'Test', company: 'Example Hotels', email: 'buyer@example-hotels.com', phone: '', subject: 'Hotel / hospitality', message: 'KNX lighting control for 120 guest rooms.', language: 'en', verdict: null, category: '', confidence: '', reason: '', summary: '', details: {}, ask_next: [], model: 'openai/gpt-6-luna', cost_usd: 0, error: 'Provider overloaded', human_verdict: null },
]

// Made-up leads added by hand (2026-10-18): in the Pipeline from the start.
leads.push(
  { id: 'm1', source: 'manual', channel: 'phone', received_at: iso(7, 9), created_at: iso(7, 9), name: 'Sara Example', company: 'Example Fit-Out Co', email: 'sara@example-fitout.sa', phone: '+966 55 123 4567', phones: ['+966 55 123 4567'], subject: '60 linear profiles and DALI dimming for an office floor, Riyadh', summary: '60 linear profiles and DALI dimming for an office floor, Riyadh', message: 'Called the office. They have the layout and want a price this week; consultant is Example Design.', language: 'en', verdict: 'qualified', human_verdict: 'qualified', category: 'project_enquiry', details: { location: 'Riyadh', urgency: 'Price this week', brands: 'Reggiani or equivalent' }, ask_next: [], criteria_version: 2, sender_type: 'contractor', human_project_type: 'jih', project_final: 'jih', request_type: 'requirement', stage: 'quotation', stage_at: iso(7, 15), next_step: 'Call Sara about the quote', follow_up: '2026-10-21', assigned_to: 'u1', assigned_at: iso(7, 9), added_by: 'u1' },
  { id: 'm2', source: 'manual', channel: 'whatsapp', received_at: iso(3, 9), created_at: iso(3, 9), name: 'Yousef', company: 'Example Villas', email: '', phone: '050 000 2222', phones: ['050 000 2222'], subject: 'Garden lighting for a villa compound', summary: 'Garden lighting for a villa compound', message: '', language: 'en', verdict: 'qualified', human_verdict: 'qualified', category: 'quotation_request', details: {}, ask_next: [], criteria_version: 2, sender_type: 'developer_owner', request_type: 'requirement', stage: 'lost', stage_at: iso(5, 9), lost_reason: 'price', lost_to: 'Example Rival Lighting', next_step: '', follow_up: null, assigned_to: 'u3', assigned_at: iso(3, 9) },
)

// Enough older made-up pitches to page through (September, so they stay out
// of this month's counts).
for (let i = 1; i <= 60; i++) {
  const day = String(1 + (i % 28)).padStart(2, '0')
  leads.push({ id: `old${String(i).padStart(2, '0')}`, source: 'email', mailbox: 'info@example-co.sa', link: '', received_at: `2026-09-${day}T${String(i % 24).padStart(2, '0')}:00:00Z`, created_at: '2026-10-07T10:00:00Z', name: `Sender ${i}`, company: `Example Vendor ${i}`, email: `sales${i}@example-vendor.com`, phone: '', subject: 'Our catalogue', message: `Made-up vendor pitch number ${i}.`, language: 'en', verdict: i % 10 === 0 ? 'qualified' : 'unqualified', category: 'vendor_pitch', confidence: 'high', reason: 'A vendor offering its own products.', summary: `Vendor pitch ${i}`, details: {}, ask_next: [], model: 'openai/gpt-6-luna', cost_usd: 0.00015, error: '', human_verdict: null })
}

// What PostgREST would answer: the tab's `or` filter (only the shapes
// verdictFilter makes), the received_at/created_at month filter, newest
// first, the offset/limit page, and the exact count in Content-Range.
function restLeads(url) {
  const p = new URL(url, window.location.origin).searchParams
  const eff = (l) => l.human_verdict || l.verdict || 'pending'
  let rows = leads
  // The leads policy (can_see_lead): a salesperson sees only their own.
  if (as === 'sales') rows = rows.filter((l) => l.assigned_to === 'u1')
  const owner = p.get('assigned_to')
  if (owner === 'is.null') rows = rows.filter((l) => !l.assigned_to)
  else if (owner) rows = rows.filter((l) => l.assigned_to === owner.replace(/^eq\./, ''))
  // The Pipeline: every lead with a stage.
  if (p.get('stage') === 'not.is.null') rows = rows.filter((l) => l.stage)
  const src = p.get('source')
  if (src) rows = rows.filter((l) => l.source === src.replace(/^eq\./, ''))
  // Each or= group narrows the list (PostgREST ANDs them), like the real thing.
  for (const or of p.getAll('or')) {
    if (or.includes('assigned_to.is.null')) { rows = rows.filter((l) => !l.assigned_to); continue }
    if (or.includes('human_verdict.in.(qualified,needs_review)')) { rows = rows.filter((l) => ['qualified', 'needs_review'].includes(eff(l))); continue }
    const words = or.match(/company\.ilike\.\*([^*]*)\*/)?.[1]
    if (words) { const w = words.toLowerCase(); rows = rows.filter((l) => [l.company, l.name, l.email, l.subject, l.summary, l.message].some((v) => String(v || '').toLowerCase().includes(w))); continue }
    const tab = or.match(/^\(human_verdict\.eq\.(\w+),/)?.[1] || (or.includes('verdict.is.null') ? 'pending' : null)
    if (tab) rows = rows.filter((l) => eff(l) === tab)
    const since = or.match(/received_at\.gte\.([^,)]+)/)?.[1]
    if (since) rows = rows.filter((l) => l.received_at >= since || l.created_at >= since)
  }
  for (const col of ['sender_type', 'project_type', 'request_type', 'folder', 'email_kind']) {
    const v = p.get(col)
    if (v != null) rows = rows.filter((l) => (l[col] || '') === v.replace(/^eq\./, ''))
  }
  rows = [...rows].sort((a, b) => (b.received_at || '').localeCompare(a.received_at || '') || b.id.localeCompare(a.id))
  const offset = Number(p.get('offset') || 0)
  const limit = p.has('limit') ? Number(p.get('limit')) : rows.length
  const page = rows.slice(offset, offset + limit)
  return new Response(JSON.stringify(page), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': `${offset}-${offset + page.length - 1}/${rows.length}` } })
}

const status = {
  ok: true,
  model: 'openai/gpt-6-luna',
  settings: { workspace_id: WS, enabled: true, intake_key: '1cfe0000-aaaa-bbbb-cccc-ddddeeeeffff', last_intake_at: new Date(Date.now() - 3 * 60_000).toISOString() },
  key: { saved: true, valid: true, limitRemaining: 9.6, fromDeployment: false },
  microsoft: true,
  crm: { connected: false, url: '', db: '', login: '', hasKey: false, version: '', lastCheckedAt: null, lastError: '', queued: 0, failed: 0 },
  mailboxes: [
    { id: 'mb1', email: 'info@example-co.sa', status: 'active', can_send: true, last_checked_at: new Date(Date.now() - 2 * 60_000).toISOString(), last_error: '', last_counts: { seen: 9, skipped: 7, qualified: 1, unqualified: 1 } },
    { id: 'mb2', email: 'info@example-clb.sa', tenant: 'other-tenant', status: 'active', can_send: false, last_checked_at: new Date(Date.now() - 2 * 60_000).toISOString(), last_error: '', last_counts: { seen: 3, skipped: 3 } },
  ],
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const original = window.fetch.bind(window)

const cards = {}
const READS = new Set()
const NOTES = [{ id: 'n1', kind: 'lead', title: 'Arif gave you a lead: Example Fit-Out Co', body: '60 linear profiles and DALI dimming for an office floor, Riyadh', link: '/leads?view=pipeline&lead=m1', workspace_id: WS, created_at: new Date(Date.now() - 20 * 60_000).toISOString(), read_at: null }]
const CARD_CONTEXT = {
  suppliers: ['C°LB', 'Reggiani', 'Zennio'],
  accounts: [{ name: 'Nour Contracting Co', orders: 4, value_sar: 610000, last_order: '2026-05-01', status: 'new' }],
  earlier: [{ received_at: '2026-09-14T09:00:00Z' }],
  companyFacts: 'Registered vendor / prequalified with (example): Example Giga City',
  playbook: null,
  keyProjects: 'Palm Grand Hotel, Riyadh — hotel; light fittings\nTower One, Riyadh — corporate headquarters office; KNX lighting control',
  icp: {
    segments: [
      { key: 'office', label: 'Offices, headquarters and corporate fit-outs', track: 'core', weight: 2, match: ['office', 'headquarters'] },
      { key: 'hospitality', label: 'Hotels and resorts', track: 'core', weight: 3, match: ['hotel'] },
    ],
    buyers: [{ key: 'contractor_awarded', weight: 3, note: 'Holds the job' }, { key: 'contractor_bidding', weight: -2, note: 'Still bidding: quote light' }],
    regions: ['riyadh'],
    size: { sweet_max: 500000, ok_max: 2000000, currency: 'SAR' },
  },
}
const WATCHLIST = [
  { name: 'Example Rival Lighting', note: 'Made-up rival: strong in office fit-outs, works through design partners.', domain: 'example-rival.sa', lines: ['lighting'], city: 'Riyadh', brands: [{ brand: 'Acme Lights', relationship: 'exclusive' }] },
  { name: 'Example Controls Co', note: 'Made-up rival: KNX integrator.', domain: '', lines: ['controls'], city: 'Jeddah', brands: [] },
]

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  if (url.includes('/src/') || url.includes('/node_modules/') || url.includes('/@')) return original(input, init)
  if (mode === 'hang') return new Promise(() => {})
  if (mode === 'fail') return Promise.reject(new TypeError('Failed to fetch'))
  if (url.includes('/rest/v1/leads')) return restLeads(url)
  // The sales app's Research page: the committed research fixture, and an
  // empty tracker (the page then shows this run's own openings and events).
  if (url.includes('/rest/v1/research_runs')) return json(runsFixture)
  if (url.includes('/rest/v1/research_agenda')) return json(AGENDA)
  if (url.includes('/rest/v1/research_')) return json([])
  // Read and unread (2026-10-19): everything before 6 Oct counts as read.
  if (url.includes('/rest/v1/rpc/lead_read_before')) return json('2026-10-06T00:00:00Z')
  if (url.includes('/rest/v1/lead_reads')) {
    const method = (init.method || 'GET').toUpperCase()
    if (method === 'POST') { const b = JSON.parse(init.body || '{}'); for (const r of [].concat(b)) READS.add(r.lead_id); return json([], 201) }
    if (method === 'DELETE') { const id = new URL(url, window.location.origin).searchParams.get('lead_id')?.replace(/^eq\./, ''); READS.delete(id); return json([]) }
    return json([...READS].map((lead_id) => ({ lead_id })))
  }
  // The bell: one made-up "you were given a lead".
  if (url.includes('/rest/v1/notifications')) {
    if ((init.method || 'GET').toUpperCase() === 'PATCH') { NOTES.forEach((n) => { n.read_at = n.read_at || new Date().toISOString() }); return json([]) }
    return json(NOTES)
  }
  // What a sales seat reads for the "Came in" filter (SalesApp).
  if (url.includes('/rest/v1/lead_mailboxes')) return json(status.mailboxes.map(({ id, email }) => ({ id, email, label: '' })))
  if (url.includes('/api/leads/status')) return json(status)
  // The sales team (sales_team for the list, team for the settings card).
  if (url.includes('/rest/v1/rpc/sales_team')) return json(TEAM.map(({ user_id, email, full_name, approver, all_website_leads }) => ({ user_id, email, full_name, approver, all_website_leads })))
  if (url.includes('/api/leads/team_save')) {
    const body = JSON.parse(init.body || '{}')
    const m = TEAM.find((x) => x.user_id === body.user_id)
    if (typeof body.all_website_leads === 'boolean') m.all_website_leads = body.all_website_leads
    if (body.odoo_login !== undefined) Object.assign(m, { odoo_login: String(body.odoo_login).trim().toLowerCase(), odoo_user_id: null })
    return json({ ok: true, team: TEAM })
  }
  if (url.includes('/api/leads/team_odoo')) return json({ ok: false, error: 'Connect Odoo first.' }, 409)
  if (url.includes('/api/leads/team')) return json({ ok: true, team: TEAM })
  // Assigning forwards the email: from a mailbox allowed to send it goes; from
  // the read-only one (and the website, when none may send) it fails.
  const assignTo = (l, userId) => {
    const m = TEAM.find((x) => x.user_id === userId)
    const from = l.source === 'email' ? status.mailboxes.find((b) => b.email === l.mailbox) : status.mailboxes.find((b) => b.can_send)
    const ok = Boolean(from?.can_send)
    Object.assign(l, {
      // Assigning puts it in the Pipeline with its card (2026-10-19).
      stage: l.stage || 'new', stage_at: l.stage_at || new Date().toISOString(),
      assigned_to: userId, assigned_at: l.assigned_to === userId ? l.assigned_at : new Date().toISOString(), forward_to: m.email,
      forward_status: ok ? 'sent' : 'failed', forwarded_at: ok ? new Date().toISOString() : l.forwarded_at,
      forward_error: ok ? '' : `${from?.email || 'info@'} can only read. On Agent settings, choose "Allow forwarding" on it and sign in as it again.`,
    })
  }
  if (url.includes('/api/leads/assign')) {
    const { lead_id, user_id } = JSON.parse(init.body || '{}')
    const l = leads.find((x) => x.id === lead_id)
    if (!user_id) {
      if (l.approved_at) return json({ ok: false, error: 'An approved lead always has someone on it. Assign it to someone else instead.' }, 409)
      Object.assign(l, { assigned_to: null, assigned_at: null, forward_status: null, forward_to: '', forward_error: '' }, l.stage === 'new' && l.source !== 'manual' ? { stage: null } : {})
      return json({ ok: true, lead: l, forward: null, odooError: '' })
    }
    assignTo(l, user_id)
    return json({ ok: true, lead: l, forward: { ok: l.forward_status === 'sent' }, odooError: '' })
  }
  if (url.includes('/api/leads/forward')) {
    const { lead_id } = JSON.parse(init.body || '{}')
    const l = leads.find((x) => x.id === lead_id)
    assignTo(l, l.assigned_to)
    return json({ ok: true, lead: l, forward: { ok: l.forward_status === 'sent' } })
  }
  if (url.includes('/api/leads/set_enabled')) {
    const { enabled } = JSON.parse(init.body || '{}')
    status.settings = { ...status.settings, enabled }
    return json({ ok: true, settings: status.settings })
  }
  if (url.includes('/api/leads/review')) {
    const { lead_id, verdict, reason } = JSON.parse(init.body || '{}')
    const l = leads.find((x) => x.id === lead_id)
    l.human_verdict = verdict
    l.human_reason = verdict ? String(reason || '') : ''
    return json({ ok: true, lead: l })
  }
  if (url.includes('/api/leads/outlook_link')) {
    // e1 is still in its mailbox; any other email lead was deleted there.
    const { lead_id } = JSON.parse(init.body || '{}')
    window.__lastOutlookAsk = lead_id
    return lead_id === 'e1'
      ? json({ ok: true, url: 'https://outlook.office.com/mail/info%40example-co.sa/deeplink?ItemID=AAMkHarness&exvsurl=1' })
      : json({ ok: false, error: 'This email is no longer in info@example-co.sa: it was deleted there.' }, 404)
  }
  if (url.includes('/api/leads/set_project')) {
    const { lead_id, project } = JSON.parse(init.body || '{}')
    const l = leads.find((x) => x.id === lead_id)
    l.human_project_type = project
    l.project_final = project === null ? (l.project_type || '') : project === 'none' ? '' : project
    return json({ ok: true, lead: l })
  }
  if (url.includes('/api/leads/approve')) {
    // Odoo not connected in the harness: an approval waits as queued.
    const { lead_id, assign_to } = JSON.parse(init.body || '{}')
    const l = leads.find((x) => x.id === lead_id)
    if (assign_to && assign_to !== l.assigned_to) assignTo(l, assign_to)
    if (!l.assigned_to) return json({ ok: false, error: 'Assign this lead to a salesperson before approving it.' }, 400)
    Object.assign(l, { approved_at: new Date().toISOString(), crm_status: 'queued', stage: l.stage || 'new', stage_at: l.stage_at || new Date().toISOString(), human_verdict: l.verdict === 'qualified' ? l.human_verdict : 'qualified' })
    status.crm.queued++
    return json({ ok: true, lead: l, crm: 'queued' })
  }
  // Battle cards: built by the real builder from made-up records.
  if (url.includes('/api/leads/card_save')) {
    const body = JSON.parse(init.body || '{}')
    const row = cards[body.lead_id]
    if (!row) return json({ ok: false, error: 'This lead has no battle card yet. Open it first.' }, 404)
    const after = afterCallFields(body)
    if (after.error) return json({ ok: false, error: after.error }, 400)
    const track = trackFields({ next_step: body.next_step, follow_up: body.follow_up })
    if (track.error) return json({ ok: false, error: track.error }, 400)
    Object.assign(row, { card: normaliseLeadCard(body.card), ...after.values, updated_at: new Date().toISOString() })
    const l = leads.find((x) => x.id === body.lead_id)
    Object.assign(l, track.values)
    return json({ ok: true, card: row, lead: l })
  }
  if (url.includes('/api/leads/lead_add')) {
    const body = JSON.parse(init.body || '{}')
    const shaped = manualLead(body)
    if (shaped.error) return json({ ok: false, error: shaped.error }, 400)
    const now = new Date().toISOString()
    const owner = body.assign_to !== undefined ? body.assign_to : 'u1'
    const l = { id: `m${leads.length}`, ...shaped.row, added_by: 'u1', project_final: shaped.row.human_project_type || '', received_at: now, created_at: now, stage_at: now, ask_next: [], assigned_to: owner, assigned_at: owner ? now : null }
    leads.unshift(l)
    return json({ ok: true, lead: l })
  }
  if (url.includes('/api/leads/lead_delete')) {
    const { lead_id } = JSON.parse(init.body || '{}')
    const i = leads.findIndex((x) => x.id === lead_id)
    if (i < 0) return json({ ok: false, error: 'That lead is not in this company.' }, 404)
    const l = leads[i]
    if (as === 'sales' && !(l.source === 'manual' && l.added_by === 'u1')) return json({ ok: false, error: 'Only a sales admin can delete this lead. You can delete the leads you added yourself.' }, 403)
    leads.splice(i, 1)
    return json({ ok: true, deleted: lead_id, inOdoo: l.crm_status === 'sent' })
  }
  if (url.includes('/api/leads/stage')) {
    const body = JSON.parse(init.body || '{}')
    const t = trackFields(body)
    if (t.error) return json({ ok: false, error: t.error }, 400)
    const l = leads.find((x) => x.id === body.lead_id)
    if (!l?.stage) return json({ ok: false, error: 'This lead joins the pipeline when it is approved.' }, 409)
    Object.assign(l, t.values, t.values.stage && t.values.stage !== l.stage ? { stage_at: new Date().toISOString() } : {})
    return json({ ok: true, lead: l })
  }
  if (url.includes('/api/leads/card')) {
    const { lead_id } = JSON.parse(init.body || '{}')
    const l = leads.find((x) => x.id === lead_id)
    if (!l?.approved_at && !l?.stage && !l?.assigned_to) return json({ ok: false, error: 'The battle card is made when the lead is assigned.' }, 409)
    if (!cards[lead_id]) {
      const now = new Date().toISOString()
      cards[lead_id] = { lead_id, card: buildLeadCard(l, CARD_CONTEXT), decision: '', quote_due: null, target_price: '', decides: '', built_at: now, updated_at: now }
    }
    return json({ ok: true, card: cards[lead_id], watchlist: WATCHLIST })
  }
  if (url.includes('/api/leads/attachment_file')) {
    const { attachment_id } = JSON.parse(init.body || '{}')
    window.__lastAttachment = attachment_id
    // A large one comes back as a private link, as Storage would sign it.
    if (attachment_id === 'a2') return json({ ok: true, url: 'data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==', filename: 'Facade drawings.zip' })
    return new Response('made-up file', { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })
  }
  if (url.includes('/api/leads/attachments')) {
    const { lead_id } = JSON.parse(init.body || '{}')
    return lead_id === 'e1'
      ? json({ ok: true, attachments: [{ id: 'a1', name: 'Tower BOQ rev2.xlsx', contentType: 'application/vnd.ms-excel', size: 84_000, kind: 'file', tooBig: false }, { id: 'a2', name: 'Facade drawings.zip', contentType: 'application/zip', size: 9_400_000, kind: 'file', big: true, tooBig: false }, { id: 'a3', name: 'Site survey video.mp4', contentType: 'video/mp4', size: 180_000_000, kind: 'file', big: true, tooBig: true }] })
      : json({ ok: false, error: 'This email is no longer in info@example-co.sa: it was deleted there.' }, 404)
  }
  if (url.includes('/api/leads/try')) {
    return json({ ok: true, model: 'openai/gpt-6-luna', cost: 0.00015, verdict: { verdict: 'unqualified', category: 'job_or_recruitment', confidence: 'high', reason: 'A job application with a CV.', summary: 'Electrical engineer looking for a job', details: {}, ask_next: [] } })
  }
  if (url.includes('/api/leads/email_file')) {
    // A made-up email, as Microsoft would hand it back.
    const eml = 'From: Khalid <khalid@example-dev.sa>\r\nTo: info@example-co.sa\r\nSubject: Facade lighting for a tower\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nDear ARAK, we are developing a 20-floor tower.\r\n'
    window.__lastEmailFile = eml
    return new Response(eml, { status: 200, headers: { 'Content-Type': 'message/rfc822', 'Content-Disposition': "attachment; filename*=UTF-8''Facade%20lighting%20for%20a%20tower.eml" } })
  }
  return json({ ok: false, error: `harness: unhandled ${url}` }, 404)
}
