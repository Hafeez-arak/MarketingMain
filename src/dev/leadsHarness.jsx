import { WS } from './leadsHarnessData'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../store/auth'
import LeadAgent from '../pages/leads/index'
import SalesApp from '../pages/leads/SalesApp'
import '../index.css'

// ─── Dev-only Lead Agent harness ───────────────────────────────────────────
// The real Lead Agent page without signing in: a fake admin session and
// canned answers (leadsHarnessData.js). Served at /dev-leads.html
// (?mode=hang | ?mode=fail for the loading and error states; ?as=sales for
// what the sales team sees). Vite only builds index.html, so this never
// reaches production.

const asSales = new URLSearchParams(window.location.search).get('as') === 'sales'

const session = { user: { id: 'u1', email: asSales ? 'sales@example.com' : 'admin@example.com' }, access_token: 'dev' }
const auth = {
  session, user: session.user, accessToken: 'dev', loading: false, isApproved: true, isAccessAdmin: !asSales, isSales: asSales,
  workspaces: [{ id: WS, name: 'Harness Co', role: 'owner' }, ...(asSales ? [{ id: 'other', name: 'Other Co', role: 'sales' }] : [])],
  activeWorkspace: { id: WS, name: 'Harness Co' }, activeWorkspaceId: WS,
  switchWorkspace: () => {}, refreshWorkspaces: () => {}, signOut: () => {},
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthContext.Provider value={auth}>
    <MemoryRouter initialEntries={['/leads']}>
      {asSales
        ? <SalesApp />
        : <div className="p-6 bg-surface-subtle min-h-screen"><LeadAgent /></div>}
    </MemoryRouter>
  </AuthContext.Provider>,
)
