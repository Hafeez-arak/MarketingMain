import { WS } from './emailHarnessData'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../store/auth'
import { EmailFlows } from '../pages/email/index'
import '../index.css'

// ─── Dev-only Email harness ────────────────────────────────────────────────
// Mounts the real Email section without signing in. window.fetch is replaced
// by a small in-memory PostgREST stand-in for the email_* tables, plus canned
// answers for /api/email/*, so every tab can be clicked through — add, edit,
// import, group, compose, send — with nothing leaving the browser.
//
// Served at /dev-email.html?tab=contacts. Vite only builds index.html, so this
// never reaches production.

const session = { user: { id: 'u1', email: 'hafeez@arak-sa.com' }, access_token: 'dev' }
const auth = {
  session, user: session.user, accessToken: 'dev', loading: false, isApproved: true, isAccessAdmin: true,
  workspaces: [{ id: WS, name: 'Harness Co', role: 'owner' }], activeWorkspace: { id: WS, name: 'Harness Co' }, activeWorkspaceId: WS,
  switchWorkspace: () => {}, refreshWorkspaces: () => {},
}

const start = `/email${window.location.search}`
ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthContext.Provider value={auth}>
    <MemoryRouter initialEntries={[start]}>
      <div className="p-6 bg-surface-subtle min-h-screen"><EmailFlows /></div>
    </MemoryRouter>
  </AuthContext.Provider>,
)
