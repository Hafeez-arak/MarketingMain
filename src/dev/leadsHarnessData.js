// ─── Dev-only data for the Lead Agent harness ──────────────────────────────
// Imported FIRST by leadsHarness.jsx so window.fetch is replaced before the
// page loads. Made-up enquiries only (this repo is public). ?mode=hang keeps
// every request pending (the loading state); ?mode=fail rejects them.

export const WS = '00000000-0000-0000-0000-0000000000dd'
const mode = new URLSearchParams(window.location.search).get('mode') || ''
const iso = (d, h) => `2026-10-0${d}T${String(h).padStart(2, '0')}:00:00Z`

const leads = [
  { id: 'e1', source: 'email', mailbox: 'info@example-co.sa', link: 'https://outlook.office.com/mail/', received_at: iso(6, 10), created_at: iso(6, 10), name: 'Khalid', company: '', email: 'khalid@example-dev.sa', phone: '', subject: 'Facade lighting for a tower', message: 'Dear ARAK, we are developing a 20-floor tower in Jeddah and need facade lighting design and supply. Can we meet next week?', language: 'en', verdict: 'qualified', category: 'project_enquiry', confidence: 'high', reason: 'A developer with a tower project asking for facade lighting design and supply.', summary: 'Facade lighting design and supply, 20-floor tower, Jeddah', details: { products: 'Facade lighting', location: 'Jeddah', stage: 'Development' }, ask_next: ['Project timeline?', 'Who is the consultant?', 'Budget range?'], model: 'openai/gpt-6-luna', cost_usd: 0.00018, error: '', human_verdict: null },
  { id: 'l1', source: 'website_form', received_at: iso(6, 8), created_at: iso(6, 8), name: 'Omar Haddad', company: 'Nour Contracting', email: 'omar@nourcontracting.sa', phone: '+966 50 111 2233', subject: 'Commercial / office', message: 'We need a quotation for 40 recessed downlights, 4000K, for an office fit-out in Riyadh. Delivery in 3 weeks.', language: 'en', verdict: 'qualified', category: 'quotation_request', confidence: 'high', reason: 'Asks for a quote on 40 downlights for an office in Riyadh.', summary: 'Quote for 40 recessed downlights, 4000K, office fit-out, Riyadh', details: { products: 'Recessed downlights 4000K', quantity: '40', location: 'Riyadh', urgency: '3 weeks' }, ask_next: ['Beam angle and dimming?', 'Is there a lighting layout?', 'Who approves the order?'], model: 'openai/gpt-6-luna', cost_usd: 0.00016, error: '', human_verdict: null },
  { id: 'l2', source: 'website_form', received_at: iso(5, 14), created_at: iso(5, 14), name: 'Ayşe K.', company: 'Bosphorus Chandeliers', email: 'sales@example-chandeliers.com', phone: '', subject: 'Hotel / hospitality', message: 'We are an Istanbul chandelier manufacturer and would love to share our portfolio for your upcoming hotel projects.', language: 'en', verdict: 'unqualified', category: 'vendor_pitch', confidence: 'high', reason: 'A manufacturer offering its own products to us.', summary: 'Chandelier maker pitching its portfolio', details: {}, ask_next: [], model: 'openai/gpt-6-luna', cost_usd: 0.00015, error: '', human_verdict: 'unqualified' },
  { id: 'l3', source: 'website_form', received_at: iso(5, 9), created_at: iso(5, 9), name: 'فهد', company: '', email: 'fahad@example.com', phone: '0550000000', subject: 'خارجي / واجهات', message: 'انارات خارجيه', language: 'ar', verdict: 'qualified', category: 'product_enquiry', confidence: 'medium', reason: 'Asks for outdoor lighting; very little detail.', summary: 'Outdoor lighting, no details yet', details: { products: 'Outdoor lighting' }, ask_next: ['Which building or site?', 'How many fittings?'], model: 'openai/gpt-6-luna', cost_usd: 0.00014, error: '', human_verdict: null },
  { id: 'l4', source: 'website_form', received_at: iso(5, 9), created_at: iso(5, 9), name: 'فهد', company: '', email: 'fahad@example.com', phone: '0550000000', subject: 'خارجي / واجهات', message: 'انارات خارجيه', language: 'ar', verdict: 'duplicate', category: '', confidence: '', reason: 'Same sender and message as the enquiry of 2026-10-05 06:00 UTC.', summary: '', details: {}, ask_next: [], model: '', cost_usd: 0, error: '', human_verdict: null },
  { id: 'l5', source: 'website_form', received_at: iso(4, 11), created_at: iso(4, 11), name: 'Studio Raml', company: 'Studio Raml Interiors', email: 'hello@example-raml.sa', phone: '', subject: 'Villa / palace', message: 'We propose a referral partnership: we recommend your lighting to our clients for a commission.', language: 'en', verdict: 'needs_review', category: 'partnership_offer', confidence: 'medium', reason: 'A referral partnership offer, not a purchase.', summary: 'Referral partnership proposal', details: {}, ask_next: [], model: 'openai/gpt-6-luna', cost_usd: 0.00017, error: '', human_verdict: null },
  { id: 'l6', source: 'website_form', received_at: iso(6, 9), created_at: iso(6, 9), name: 'Test', company: 'Example Hotels', email: 'buyer@example-hotels.com', phone: '', subject: 'Hotel / hospitality', message: 'KNX lighting control for 120 guest rooms.', language: 'en', verdict: null, category: '', confidence: '', reason: '', summary: '', details: {}, ask_next: [], model: 'openai/gpt-6-luna', cost_usd: 0, error: 'Provider overloaded', human_verdict: null },
]

const status = {
  ok: true,
  model: 'openai/gpt-6-luna',
  settings: { workspace_id: WS, enabled: true, intake_key: '1cfe0000-aaaa-bbbb-cccc-ddddeeeeffff', last_intake_at: new Date(Date.now() - 3 * 60_000).toISOString() },
  key: { saved: true, valid: true, limitRemaining: 9.6, fromDeployment: false },
  microsoft: true,
  mailboxes: [{ id: 'mb1', email: 'info@example-co.sa', status: 'active', last_checked_at: new Date(Date.now() - 2 * 60_000).toISOString(), last_error: '', last_counts: { seen: 9, skipped: 7, qualified: 1, unqualified: 1 } }],
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const original = window.fetch.bind(window)

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  if (url.includes('/src/') || url.includes('/node_modules/') || url.includes('/@')) return original(input, init)
  if (mode === 'hang') return new Promise(() => {})
  if (mode === 'fail') return Promise.reject(new TypeError('Failed to fetch'))
  if (url.includes('/rest/v1/leads')) return json(leads)
  if (url.includes('/api/leads/status')) return json(status)
  if (url.includes('/api/leads/set_enabled')) {
    const { enabled } = JSON.parse(init.body || '{}')
    status.settings = { ...status.settings, enabled }
    return json({ ok: true, settings: status.settings })
  }
  if (url.includes('/api/leads/review')) {
    const { lead_id, verdict } = JSON.parse(init.body || '{}')
    const l = leads.find((x) => x.id === lead_id)
    l.human_verdict = verdict
    return json({ ok: true, lead: l })
  }
  if (url.includes('/api/leads/try')) {
    return json({ ok: true, model: 'openai/gpt-6-luna', cost: 0.00015, verdict: { verdict: 'unqualified', category: 'job_or_recruitment', confidence: 'high', reason: 'A job application with a CV.', summary: 'Electrical engineer looking for a job', details: {}, ask_next: [] } })
  }
  return json({ ok: false, error: `harness: unhandled ${url}` }, 404)
}
