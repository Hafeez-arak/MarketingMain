import { WS } from './targetsHarnessData'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../store/auth'
import Targets from '../pages/sales/Targets'
import AgentBrief from '../pages/admin/AgentBrief'
import '../index.css'

// ─── Dev-only Targets harness ──────────────────────────────────────────────
// The real Sales → Targets page without signing in: a fake admin session and
// canned, made-up answers (targetsHarnessData.js). Served at
// /dev-targets.html (?tab=targets|events|icp, ?mode=hang | ?mode=fail), and
// the Agent Brief page at ?page=brief. Vite
// only builds index.html, so this never reaches production.

const session = { user: { id: 'u1', email: 'admin@example.com' }, access_token: 'dev' }
const auth = {
  session, user: session.user, accessToken: 'dev', loading: false, isApproved: true, isAccessAdmin: true,
  workspaces: [{ id: WS, name: 'Harness Co', role: 'owner' }], activeWorkspace: { id: WS, name: 'Harness Co' }, activeWorkspaceId: WS,
  switchWorkspace: () => {}, refreshWorkspaces: () => {},
}

const q = new URLSearchParams(window.location.search)
const brief = q.get('page') === 'brief'
const tab = q.get('tab') || (brief ? 'sales' : 'accounts')

ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthContext.Provider value={auth}>
    <MemoryRouter initialEntries={[`/${brief ? 'agent-brief' : 'targets'}?tab=${tab}`]}>
      <div className="p-6 bg-surface-subtle min-h-screen">{brief ? <AgentBrief /> : <Targets />}</div>
    </MemoryRouter>
  </AuthContext.Provider>,
)
