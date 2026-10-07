// ─── Dev-only data for the Targets harness ─────────────────────────────────
// Imported FIRST by targetsHarness.jsx so window.fetch is replaced before the
// page loads. Made-up companies and projects only — this repo is public, and
// the real accounts live in the database. ?mode=hang keeps every request
// pending (the loading state); ?mode=fail rejects them.

export const WS = '00000000-0000-0000-0000-0000000000ee'
const mode = new URLSearchParams(window.location.search).get('mode') || ''

const icp = {
  summary: 'Contractors who already hold the job, and owners buying direct, on hotels, schools, villas and offices in the capital, with a package under about 2M.',
  evidence: 'Made-up harness ICP',
  mix: { core: 50 },
  segments: [
    { key: 'hospitality', label: 'Hotels and resorts', track: 'core', weight: 3, match: ['hotel', 'resort'], note: 'Half of these ended won' },
    { key: 'education', label: 'Schools and universities', track: 'core', weight: 3, match: ['school', 'university', 'campus'] },
    { key: 'office', label: 'Offices and HQs', track: 'core', weight: 2, match: ['office', 'tower', 'headquarters'] },
    { key: 'fitout', label: 'Fit-out and interiors companies', track: 'broader', weight: 3, match: ['fit-out', 'interiors'] },
    { key: 'healthcare', label: 'Hospitals and clinics', track: 'broader', weight: 2, match: ['hospital', 'clinic'] },
  ],
  buyers: [
    { key: 'contractor_awarded', weight: 3, note: 'Holds the job' },
    { key: 'owner_developer', weight: 2 },
    { key: 'fitout', weight: 2 },
    { key: 'contractor_bidding', weight: -2, note: 'Their tender loss is our loss' },
  ],
  size: { sweet_max: 500000, ok_max: 2000000, currency: 'SAR', note: 'Large tenders are rarely won.' },
  regions: ['capital city'],
  red_flags: [{ label: 'Specified brand', advice: 'ask for the vendor list first', match: ['approved vendor', 'specified brand'] }],
  ask_first: ['What is your target price?', 'Is there an approved vendor list?', 'Has the main contractor been awarded?'],
  win_levers: ['Samples and mock-ups early', 'Our own design and lux calculations'],
  pains: [{ pain: 'Submittals take weeks', angle: 'Complete submittal packs that get through the consultant' }],
}

const accounts = [
  { id: 'a1', name: 'Harbour Contracting Co', orders: 12, value_sar: 4200000, first_year: 2022, last_order: '2024-02-01', bought: 'lighting', plays: ['reactivate', 'cross_sell'], open_deals: 2, open_value_sar: 900000, why: 'Our largest customer, quiet for 30 months, never bought controls.', priority: 1, status: 'new', owner: '', owner_note: '', next_step_on: null },
  { id: 'a2', name: 'Palm Resorts Builders (شركة النخيل للمقاولات)', orders: 5, value_sar: 2100000, first_year: 2024, last_order: '2026-09-01', bought: 'both', plays: ['next_phase', 'maintenance'], open_deals: null, open_value_sar: null, why: 'Resort phases 1 and 2 won. Ask for phase 3 and offer a maintenance contract.', priority: 1, status: 'contacted', owner: 'Sales A', owner_note: 'Meeting set for next week.', next_step_on: '2026-10-14' },
  { id: 'a3', name: 'Grid Works Est', orders: 3, value_sar: 310000, first_year: 2023, last_order: '2023-11-01', bought: 'controls', plays: ['cross_sell'], open_deals: null, open_value_sar: null, why: 'Bought controls only.', priority: 3, status: 'new', owner: '', owner_note: '', next_step_on: null },
]

const opportunities = [
  { id: 'o1', type: 'project', name: 'Cedar Hotel Downtown', headline: 'Main contractor awarded the Cedar Hotel fit-out', client: 'Cedar Hospitality', contractor: 'Stone & Steel Contracting', consultant: 'Arc Design', location: 'Capital city', scope: 'Interior and facade lighting', stage: 'awarded', deadline: null, timing: 'unconfirmed', relevance: 'high', suggested_action: 'Call Stone & Steel procurement; open with a sample board and a lux study.', source_url: 'https://example.com/award', status: 'new', owner_note: '', first_seen_at: '2026-10-05T08:00:00Z', last_seen_at: '2026-10-05T08:00:00Z', times_seen: 1, last_change: '', segment: 'hospitality', buyer: 'contractor_awarded', value_sar: 450000, track: 'core', why_fit: 'Hotel job held by the contractor', red_flags: '', contact: 'stonesteel.example — procurement manager' },
  { id: 'o2', type: 'lead', name: 'Linea Interiors', headline: 'Linea Interiors won three office fit-outs this quarter', client: '', contractor: '', consultant: '', location: 'Capital city', scope: 'Office fit-out', stage: 'fit-out', deadline: null, timing: 'unconfirmed', relevance: 'medium', suggested_action: 'Introduce our range to their design lead.', source_url: 'https://example.com/linea', status: 'new', owner_note: '', first_seen_at: '2026-09-28T08:00:00Z', last_seen_at: '2026-10-05T08:00:00Z', times_seen: 2, last_change: '', segment: 'fitout', buyer: 'fitout', value_sar: null, track: 'broader', why_fit: 'Fit-out company winning office work', red_flags: '', contact: 'linea.example — general enquiries' },
  { id: 'o3', type: 'tender', name: 'North Campus University Library', headline: 'Library package out to tender; approved vendor list issued', client: 'North University', contractor: '', consultant: 'Campus Engineers', location: 'North region', scope: 'Lighting and controls', stage: 'tender', deadline: '2026-11-02', timing: 'open', relevance: 'medium', suggested_action: 'Ask for the vendor list before estimating.', source_url: 'https://example.com/tender', status: 'new', owner_note: '', first_seen_at: '2026-10-05T08:00:00Z', last_seen_at: '2026-10-05T08:00:00Z', times_seen: 1, last_change: '', segment: 'education', buyer: 'contractor_bidding', value_sar: 3500000, track: 'core', why_fit: 'A university', red_flags: 'Approved vendor list issued', contact: '' },
  { id: 'o4', type: 'project', name: 'Riverside Tower', headline: 'Mixed-use tower in design', client: 'River Developments', contractor: '', consultant: '', location: '', scope: '', stage: 'design', deadline: null, timing: 'unconfirmed', relevance: 'medium', suggested_action: 'Find the consultant.', source_url: 'https://example.com/tower', status: 'new', owner_note: '', first_seen_at: '2026-09-21T08:00:00Z', last_seen_at: '2026-09-21T08:00:00Z', times_seen: 1, last_change: '', segment: '', buyer: '', value_sar: null, track: '', why_fit: '', red_flags: '', contact: '' },
]

const events = [
  { id: 'e1', name: 'Build Expo 2026', start_date: '2026-11-10', end_date: '2026-11-12', venue: 'Expo Centre', city: 'Capital city', organizer: 'Expo Co', url: 'https://example.com/expo', exhibitor_deadline: '2026-10-20', competitors_exhibiting: ['Rival One'], relevance: 'high', recommendation: 'Visit; meet the contractors exhibiting.', status: 'upcoming', decision: 'undecided' },
  { id: 'e2', name: 'Hospitality Summit', start_date: null, end_date: null, venue: '', city: '', organizer: '', url: '', exhibitor_deadline: null, competitors_exhibiting: [], relevance: 'medium', recommendation: 'Confirm the dates.', status: 'tbc', decision: 'undecided' },
]

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const original = window.fetch.bind(window)

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  if (url.includes('/src/') || url.includes('/node_modules/') || url.includes('/@')) return original(input, init)
  if (mode === 'hang') return new Promise(() => {})
  if (mode === 'fail') return Promise.reject(new TypeError('Failed to fetch'))
  const method = (init.method || 'GET').toUpperCase()
  if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'admin@example.com' })
  if (method !== 'GET') return new Response(null, { status: 204 })
  if (url.includes('/rest/v1/sales_icp')) return json([{ config: icp, updated_at: '2026-10-07T10:00:00Z' }])
  if (url.includes('/rest/v1/sales_accounts')) return json(accounts)
  if (url.includes('/rest/v1/research_opportunities')) return json(opportunities)
  if (url.includes('/rest/v1/research_events')) return json(events)
  if (url.includes('/rest/v1/research_runs')) return json([{ started_at: '2026-10-05T07:00:00Z', status: 'complete' }])
  return json([])
}
