import { ME, myWorkspaces } from './accessFetch'
import { useState, useCallback } from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../store/auth'
import { AppProvider } from '../store/appStore'
import { AppLayout } from '../components/layout/AppLayout'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { Settings } from '../pages/settings/index'
import { Access } from '../pages/settings/Access'
import { Onboarding } from '../pages/auth/Onboarding'
import '../index.css'

// ─── Dev-only access harness ───────────────────────────────────────────────
// The three screens that decide who sees a company, on a small in-memory
// roster (accessFetch.js), so they can be clicked through without signing in:
//
//   /dev-access.html?page=/settings          the create-company form
//   /dev-access.html?page=/team              Team & Access
//   /dev-access.html?page=/onboarding&as=noor   approved, no companies yet
//
// ?as= picks who is signed in: admin (default), sara (a member), or noor
// (approved a moment ago, nothing ticked). Vite only builds index.html, so
// this never reaches production.

const params = new URLSearchParams(window.location.search)
const page = params.get('page') || '/settings'

export function AccessHarness() {
  const [workspaces, setWorkspaces] = useState(myWorkspaces)
  const [activeId, setActiveId] = useState(() => myWorkspaces()[0]?.id || null)
  const refreshWorkspaces = useCallback(async () => { setWorkspaces(myWorkspaces()) }, [])

  const session = { user: { id: ME.user_id, email: ME.email }, access_token: 'dev' }
  const isAccessAdmin = ME.role === 'admin'
  const auth = {
    session, user: session.user, accessToken: 'dev', loading: false,
    access: { status: ME.status, role: ME.role }, accessStatus: ME.status,
    isApproved: ME.status === 'approved', isAccessAdmin,
    workspaces, activeWorkspace: workspaces.find(w => w.id === activeId) || null, activeWorkspaceId: activeId,
    switchWorkspace: setActiveId, refreshWorkspaces, signOut: () => {},
  }

  const bare = page === '/onboarding'
  const body = (
    <ErrorBoundary>
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/team" element={<Access />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/" element={<p className="p-8 text-sm">Signed in, with a company: the app would open here.</p>} />
        <Route path="/login" element={<p className="p-8 text-sm">Sign-in screen.</p>} />
      </Routes>
    </ErrorBoundary>
  )

  return (
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[page]}>
        <AppProvider workspaceId={activeId}>
          {bare ? body : <AppLayout>{body}</AppLayout>}
        </AppProvider>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<AccessHarness />)
