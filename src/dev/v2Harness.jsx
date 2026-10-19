import { ME } from './requestsFetch'
import ReactDOM from 'react-dom/client'
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthContext } from '../store/auth'
import { AppProvider } from '../store/appStore'
import { AppLayout } from '../components/layout/AppLayout'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { HomePage } from '../pages/home/index'
import { Requests } from '../pages/requests/index'
import { CeoPage } from '../pages/ceo/index'
import { ALL_PAGES, fromLegacy, pageTitle } from '../lib/modules'
import '../index.css'

// ─── Dev-only: the v2 shell (rail, section sidebar, Home) ──────────────────
//   /dev/v2.html                       Home, as an admin
//   /dev/v2.html?page=/marketing/schedule   inside a section (the page is a stand-in)
//   /dev/v2.html?page=/schedule        a v1 address: redirected, tail and query kept
//   /dev/v2.html?as=member             what a member (not admin) sees
// Pages other than Home, Requests and CEO are stand-ins: this checks the
// navigation, not the pages. Vite only builds index.html, so this never
// reaches production.

const params = new URLSearchParams(window.location.search)
const page = params.get('page') || '/'
const admin = params.get('as') !== 'member'
const WS = [{ id: 'ws-arak', name: 'Arak Lighting', role: 'owner' }]

function StandIn() {
  const { pathname, search } = useLocation()
  return (
    <div className="border border-dashed border-border bg-white px-6 py-10 text-center">
      <p className="text-sm font-semibold text-text">{pageTitle(pathname) || 'Unknown page'}</p>
      <p className="text-xs text-text-tertiary mt-1 font-mono" data-testid="where">{pathname}{search}</p>
    </div>
  )
}

function Legacy() {
  const location = useLocation()
  const to = fromLegacy(location.pathname)
  return to ? <Navigate to={{ pathname: to, search: location.search }} replace /> : <p>Not found: {location.pathname}</p>
}

export function Harness() {
  const session = { user: { id: ME.user_id, email: ME.email }, access_token: 'dev' }
  const auth = {
    session, user: session.user, accessToken: 'dev', loading: false,
    access: { status: 'approved', role: admin ? 'admin' : 'member' }, accessStatus: 'approved', isApproved: true, isAccessAdmin: admin,
    workspaces: WS, activeWorkspace: WS[0], activeWorkspaceId: 'ws-arak',
    switchWorkspace: () => {}, refreshWorkspaces: async () => {}, signOut: () => {},
  }
  const standIns = ALL_PAGES.filter(p => !['/', '/requests', '/ceo'].includes(p.to))
  return (
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[page]}>
        <AppProvider workspaceId="ws-arak">
          <AppLayout>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/requests" element={<Requests />} />
                <Route path="/ceo" element={<CeoPage />} />
                {standIns.map(p => <Route key={p.to} path={p.to} element={<StandIn />} />)}
                <Route path="/marketing/campaigns/plan" element={<StandIn />} />
                <Route path="/marketing/social/:platform" element={<StandIn />} />
                <Route path="*" element={<Legacy />} />
              </Routes>
            </ErrorBoundary>
          </AppLayout>
        </AppProvider>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<Harness />)
