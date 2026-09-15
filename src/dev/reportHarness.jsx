import ReactDOM from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../store/auth'
import { AppProvider } from '../store/appStore'
import { AppLayout } from '../components/layout/AppLayout'
import { PerformanceReport } from '../pages/analytics/PerformanceReport'
import { ResearchReport } from '../pages/insights/ResearchReport'
import { Insights } from '../pages/insights/index'
import { planStoreWrites } from '../lib/agent/intel'
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
  if (href.includes('/api/agent/performance')) {
    return new Response(JSON.stringify(fixture), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  // fetchRuns reads PostgREST straight from the browser, so the research
  // report is fed the same way production feeds it: a real research_runs
  // payload, captured from this workspace, findings and all.
  if (href.includes('research_runs')) {
    return new Response(JSON.stringify(runs), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  // The market-intelligence store. `#brief` leaves it empty — what a workspace
  // sees before its first run with the store. `#brief-store` fills it by
  // running the REAL planStoreWrites over the captured findings, with lead and
  // event names attached to the three openings findings and one calendar date
  // the way the lens now reports them, so the tracker's editable rows render.
  // Dev-only: these names are the 14 Sep run's own projects, not new claims.
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

function demoStore() {
  const report = runs[0].report
  const names = { F13: 'Tuwaiq Palace hotel conversion', F17: 'Riyadh hotel pipeline (13 under construction)', F18: 'Mondrian Riyadh' }
  const findings = report.findings.map(f => (names[f.ref]
    ? { ...f, for_whom: 'sales', relevance: f.ref === 'F13' ? 'high' : 'medium', lead: { name: names[f.ref], type: f.ref === 'F13' ? 'tender' : 'project', location: 'Riyadh', consultant: f.ref === 'F13' ? 'Dar Al-Omran' : '', timing: f.ref === 'F13' ? 'closed' : 'unconfirmed' } }
    : f))
  const plan = planStoreWrites(findings, {}, { runId: runs[0].id, now: new Date('2026-09-14T18:00:00Z') })
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
              <Route path="/insights" element={<Insights />} />
            </Routes>
          </AppLayout>
        </MemoryRouter>
      </AppProvider>
    </AuthContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<ReportHarness />)
