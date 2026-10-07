import { WS } from './targetsHarnessData'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../store/auth'
import Targets from '../pages/sales/Targets'
import '../index.css'

// ─── Dev-only Targets harness ──────────────────────────────────────────────
// The real Sales → Targets page without signing in: a fake admin session and
// canned, made-up answers (targetsHarnessData.js). Served at
// /dev-targets.html (?tab=targets|events|icp, ?mode=hang | ?mode=fail). Vite
// only builds index.html, so this never reaches production.

const session = { user: { id: 'u1', email: 'admin@example.com' }, access_token: 'dev' }
const auth = {
  session, user: session.user, accessToken: 'dev', loading: false, isApproved: true, isAccessAdmin: true,
  workspaces: [{ id: WS, name: 'Harness Co', role: 'owner' }], activeWorkspace: { id: WS, name: 'Harness Co' }, activeWorkspaceId: WS,
  switchWorkspace: () => {}, refreshWorkspaces: () => {},
}

const tab = new URLSearchParams(window.location.search).get('tab') || 'accounts'

ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthContext.Provider value={auth}>
    <MemoryRouter initialEntries={[`/targets?tab=${tab}`]}>
      <div className="p-6 bg-surface-subtle min-h-screen"><Targets /></div>
    </MemoryRouter>
  </AuthContext.Provider>,
)
