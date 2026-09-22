import ReactDOM from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../store/auth'
import { AppProvider } from '../store/appStore'
import { AppLayout } from '../components/layout/AppLayout'
import { PerformanceReport } from '../pages/analytics/PerformanceReport'
import { ResearchReport } from '../pages/insights/ResearchReport'
import { BusinessView } from '../pages/insights/BusinessView'
import { Insights } from '../pages/insights/index'
import { planStoreWrites } from '../lib/agent/intel'
import { parseLines, stampLines } from '../lib/agent/lines'
import fixture from './reportFixture.json'
import runs from './runsFixture.json'
import '../index.css'

// ─── Dev-only report harness ───────────────────────────────────────────────
// Served by Vite at /dev-report.html. Vite only builds index.html, so this
// never reaches a production bundle.
//
// ── WHAT THIS EXISTS TO TEST, AND WHY IT NEEDS THE REAL SHELL ──
//
// The report's whole point is that it prints. Printing it correctly depends
// on one thing that is nowhere near the report itself: AppLayout is
// `h-screen overflow-hidden` wrapped around an inner scroller, so a printed
// page would be the first viewport and nothing else unless the @media print
// block in index.css unwinds that chain. That chain is the thing under test,
// which is why this mounts the REAL AppLayout rather than a stand-in — a
// harness with its own simplified shell would pass while the app failed.
//
// Auth is faked at the context rather than worked around, because everything
// on this screen is behind a sign-in the print layout has nothing to do with.
// fetch is stubbed with a real captured /api/agent/performance payload, so the
// numbers, the empty cases and the row counts are the ones production renders.

const auth = {
  user: { id: 'dev', email: 'dev@example.com' },
  session: null,
  accessToken: 'dev-token',
  workspaces: [{ id: 'dev-ws', name: 'ARAK Lighting' }],
  activeWorkspaceId: 'dev-ws',
  activeWorkspace: { id: 'dev-ws', name: 'ARAK Lighting' },
  switchWorkspace: () => {},
  signOut: () => {},
  isAccessAdmin: false,
  loading: false,
  ready: true,
}

// Only the report's own call is answered; anything else the shell fires on
// mount resolves empty rather than throwing an unhandled rejection into the
// console, where it would look like a fault in the thing being tested.
const realFetch = window.fetch.bind(window)
window.fetch = async (url, init) => {
  const href = String(url)
  // The report moved behind the n8n reports gateway; matching both spellings
  // keeps this harness working either way rather than silently falling through
  // to the real network and rendering an empty report.
  if (href.includes('/api/agent/performance') || href.includes('arak-agent-reports')) {
    return new Response(JSON.stringify(fixture), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  // fetchRuns reads PostgREST straight from the browser, so the research
  // report is fed the same way production feeds it: a real research_runs
  // payload, captured from this workspace, findings and all.
  if (href.includes('research_runs')) {
    return new Response(JSON.stringify(withLines(runs)), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  // The market-intelligence store. `#brief` leaves it empty — what a workspace
  // sees before its first run with the store. `#brief-store` fills it by
  // running the REAL planStoreWrites over the captured findings, with lead and
  // event names attached to the three openings findings and one calendar date
  // the way the lens now reports them, so the tracker's editable rows render.
  // Dev-only: these names are the 14 Sep run's own projects, not new claims.
  // ── The competitor tables, for the business view ──
  // `#business` serves the REAL watchlist with an empty bid log, which is the
  // honest state today and the one worth looking at: almost every block on the
  // page should be reporting a gap. `#business-full` adds contested bids and
  // signals so the filled state can be checked too.
  if (href.includes('research_agenda')) {
    if ((init?.method || 'GET') !== 'GET') return new Response(null, { status: 204 })
    return new Response(JSON.stringify(demoWatchlist()), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  for (const table of ['competitor_brands', 'deal_outcomes']) {
    if (href.includes(table)) {
      if ((init?.method || 'GET') !== 'GET') return new Response(null, { status: 204 })
      const full = window.location.hash.startsWith('#business-full')
      const rows = table === 'competitor_brands' ? demoBrands() : (full ? demoDeals() : [])
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  }
  for (const table of ['research_opportunities', 'research_events', 'research_signals']) {
    if (href.includes(table)) {
      const rows = window.location.hash === '#brief-store' ? demoStore()[table] : []
      if ((init?.method || 'GET') !== 'GET') return new Response(null, { status: 204 })
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  }
  if (href.startsWith('/api') || href.includes('supabase')) {
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return realFetch(url, init)
}

// ── `#brief-lines`: the report split by business line ──
//
// The captured 14 Sep run predates business lines and every finding on it
// carries `line: ''`, so the grouped competitor view correctly collapses to a
// single group — which is the right fallback and shows nothing about the
// split. This mode stamps the lines using the REAL `stampLines` against Arak's
// REAL `business_lines` configuration and the watchlist below, so what renders
// is what the code will actually produce rather than a hand-written mock.
//
// Dev-only, and applied to a copy: nothing here writes to the fixture.
const BUSINESS_LINES = [
  'lighting | Lighting | /services/indoor-lighting, /services/facade-lighting, lighting design, lighting consultant, facade, luminaire, architectural lighting',
  'controls | Controls & automation | /services/lighting-controls, knx, dali, grms, guest room, building automation, home automation',
  'poles | Smart poles | /services/smart-poles, smart pole, street light, lighting pole',
].join('\n')

function withLines(rows) {
  if (window.location.hash !== '#brief-lines') return rows
  const lines = parseLines(BUSINESS_LINES)
  const watchlist = demoWatchlist().map(c => ({ subject: c.subject, lines: c.lines }))
  return rows.map(r => ({
    ...r,
    report: {
      ...r.report,
      findings: stampLines(r.report?.findings || [], { lines, watchlist }),
    },
  }))
}

// The live watchlist as it stands, so the business view can be looked at
// against real identities rather than invented ones. Dev-only.
const C = (subject, domain, lines, kinds, city, resolution = 'company', status = 'active') =>
  ({ id: subject, subject, why: '', domain, lines, kinds, city, tier: null, source: 'sales', resolution, status, kind: 'competitor', ig_status: 'unresolved', ig_handle: '' })

function demoWatchlist() {
  return [
    C('Al Nasser Group', '', ['lighting', 'controls'], ['manufacturer', 'distributor', 'retailer', 'integrator'], 'Riyadh', 'unresolved'),
    C('Huda Lighting', 'hudalighting.com', ['lighting'], ['brand', 'supplier'], 'Riyadh'),
    C('Nassli Group', 'nassli.com.sa', ['lighting', 'controls'], ['manufacturer', 'integrator'], 'Saudi Arabia'),
    C('Sela-PASS', 'selapass.com', ['controls'], ['integrator'], 'Riyadh'),
    C('Armada', 'armadasolutions.com.sa', ['lighting', 'controls'], ['supplier'], 'Riyadh'),
    C('Futuron', 'futuron.sa', ['controls'], ['integrator'], 'Riyadh'),
    C('ViaLighting', 'vialighting.com', ['lighting'], ['supplier'], 'Riyadh'),
    C('Spectra Electricals', 'spectra.com.sa', ['lighting', 'controls'], ['supplier'], 'Riyadh'),
    C('SAS Systems Engineering', 'sas-se.com', ['controls'], ['integrator'], 'Jeddah'),
    C('Nouran Lighting', 'nouran.net', ['lighting'], ['supplier'], 'Riyadh'),
    C('MASQ Lighting', 'masqlighting.com', ['lighting'], ['designer', 'supplier'], 'Riyadh'),
    C('Prime Star Technologies', 'primestartech.com', ['controls'], ['contractor'], 'Riyadh'),
    C('Namaraa', 'namaraa.com', ['lighting'], ['supplier'], 'Riyadh'),
    C('Spectrum Lighting', '', ['lighting'], ['designer'], '', 'unresolved'),
    C('Greenlight', '', ['lighting'], [], '', 'unresolvable'),
    C('Al Dhow', '', ['lighting'], [], '', 'unresolvable'),
    // Retired, so the panel can be checked for what it does with them: hidden
    // from the list, counted underneath. They stay on record because a
    // deleted name is one the agent rediscovers and proposes again.
    C('Datacore', '', ['lighting'], [], '', 'unresolved', 'retired'),
    C('Tawridat Al Hadaf', '', ['lighting'], [], '', 'unresolved', 'retired'),
    C('Technolight', 'technolight-ksa.com', ['lighting'], ['manufacturer'], 'Riyadh', 'company', 'retired'),
  ]
}

function demoBrands() {
  return [
    { competitor: 'Al Nasser Group', brand: 'Berker', relationship: 'exclusive', line: 'controls', source_url: 'https://example.com/berker', observed_at: '2026-09-16' },
    { competitor: 'Al Nasser Group', brand: 'NOORTEK', relationship: 'exclusive', line: 'lighting', source_url: '', observed_at: '2026-09-16' },
    { competitor: 'Al Nasser Group', brand: 'SIDRA', relationship: 'exclusive', line: 'lighting', source_url: '', observed_at: '2026-09-16' },
  ]
}

// Deliberately "(demo)" — these are not real bids, they exist so the filled
// state of the page can be checked before any real one is recorded.
function demoDeals() {
  return [
    { project: 'Riyadh hotel tower (demo)', competitor: 'Al Nasser Group', line: 'controls', outcome: 'lost', decided_by: 'agency_rights', value_sar: 1400000, consultant: 'Dar Al-Omran', decided_on: '2026-08-20' },
    { project: 'Government HQ (demo)', competitor: 'Al Nasser Group', line: 'controls', outcome: 'lost', decided_by: 'agency_rights', value_sar: 900000, consultant: '', decided_on: '2026-07-11' },
    { project: 'Mall refit (demo)', competitor: 'Sela-PASS', line: 'controls', outcome: 'won', decided_by: 'unknown', value_sar: 600000, consultant: '', decided_on: '2026-06-30' },
    { project: 'Hospital lighting (demo)', competitor: 'Huda Lighting', line: 'lighting', outcome: 'lost', decided_by: 'price', value_sar: 480000, consultant: '', decided_on: '2026-08-02' },
  ]
}

function demoStore() {
  const report = runs[0].report
  const names = { F13: 'Tuwaiq Palace hotel conversion', F17: 'Riyadh hotel pipeline (13 under construction)', F18: 'Mondrian Riyadh' }
  const findings = report.findings.map(f => (names[f.ref]
    ? { ...f, for_whom: 'sales', relevance: f.ref === 'F13' ? 'high' : 'medium', lead: { name: names[f.ref], type: f.ref === 'F13' ? 'tender' : 'project', location: 'Riyadh', consultant: f.ref === 'F13' ? 'Dar Al-Omran' : '', timing: f.ref === 'F13' ? 'closed' : 'unconfirmed' } }
    : f))
  // Placeholder events, one per band, so the events section's three tables
  // render. Deliberately named "(demo)" — they are not claims about real expos.
  const demoEvents = [
    { lens: 'events', ref: 'E1', headline: 'Developer property expo (demo) opens in October', relevance: 'high', for_whom: 'sales',
      suggested_action: 'Visit and meet the exhibiting developers; list their upcoming towers for sales.',
      sources: [{ url: 'https://example.com/developer-expo' }],
      event: { name: 'Developer Property Expo (demo) 2026', start_date: '2026-10-20', end_date: '2026-10-23', venue: 'Riyadh Front', city: 'Riyadh', exhibitor_deadline: '2026-09-30', competitors_exhibiting: ['Technolight'] } },
    { lens: 'events', ref: 'E2', headline: 'Tech conference (demo) 2027 dates announced', relevance: 'medium', for_whom: 'marketing',
      suggested_action: 'Decide by November whether to exhibit in the smart-city hall.',
      sources: [{ url: 'https://example.com/tech-conference' }],
      event: { name: 'Tech Conference (demo) 2027', start_date: '2027-02-08', end_date: '2027-02-11', city: 'Riyadh', exhibitor_deadline: '2026-11-15' } },
    { lens: 'events', ref: 'E3', headline: 'Tech conference (demo) 2026 has ended', relevance: 'medium', for_whom: 'both',
      detail: 'Demo takeaway: a competitor showed a connected street-lighting range; two city programmes announced smart-pole pilots.',
      suggested_action: 'Brief the technical team on the pilots.',
      sources: [{ url: 'https://example.com/tech-conference-2026' }],
      event: { name: 'Tech Conference (demo) 2026', start_date: '2026-02-09', end_date: '2026-02-12', city: 'Riyadh', competitors_exhibiting: ['Huda Lighting'] } },
  ]
  const plan = planStoreWrites([...findings, ...demoEvents], {}, { runId: runs[0].id, now: new Date('2026-09-14T18:00:00Z') })
  let n = 0
  const withIds = rows => rows.map(r => ({ id: `demo-${n += 1}`, status: 'new', decision: 'undecided', ...r }))
  return {
    research_opportunities: withIds(plan.opportunities.insert),
    research_events: withIds(plan.events.insert),
    research_signals: withIds(plan.signals.insert),
  }
}

// Which report to mount. `#research` on the URL, so both can be looked at
// without editing this file — and so the research one can be reached at all,
// since it is the half with the real brief behind it.
const route = window.location.hash === '#research' ? '/insights/report'
  : window.location.hash.startsWith('#business') ? '/insights/business'
    : window.location.hash.startsWith('#brief') ? '/insights'
      : '/analytics/report'

export function ReportHarness() {
  return (
    <AuthContext.Provider value={auth}>
      <AppProvider workspaceId="dev-ws">
        <MemoryRouter initialEntries={[route]}>
          <AppLayout>
            <Routes>
              <Route path="/analytics/report" element={<PerformanceReport />} />
              <Route path="/insights/report" element={<ResearchReport />} />
              <Route path="/insights/business" element={<BusinessView />} />
              <Route path="/insights" element={<Insights />} />
            </Routes>
          </AppLayout>
        </MemoryRouter>
      </AppProvider>
    </AuthContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<ReportHarness />)
