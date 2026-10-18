import { ME } from './requestsFetch'
import ReactDOM from 'react-dom/client'
import { useState } from 'react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../store/auth'
import { AppProvider } from '../store/appStore'
import { AppLayout } from '../components/layout/AppLayout'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { Requests } from '../pages/requests/index'
import { Settings } from '../pages/settings/index'
import AskInput from '../components/AskInput'
import { useTaggable } from '../lib/useTaggable'
import '../index.css'

// ─── Dev-only Requests harness ─────────────────────────────────────────────
//   /dev/requests.html                    the board, the bell, a request panel
//   /dev/requests.html?page=/requests?id=r2   a request opened
//   /dev/requests.html?mode=empty|fail|hang   the empty, failed and loading states
//   /dev/requests.html?page=/ask          the chat box with the @ picker
//   /dev/requests.html?page=/settings     Your account and AI spending
// Vite only builds index.html, so this never reaches production.

const params = new URLSearchParams(window.location.search)
const page = params.get('page') || '/requests'
const WS = [{ id: 'ws-arak', name: 'Arak Lighting', role: 'owner' }]

export function AskDemo() {
  const [text, setText] = useState('')
  const people = useTaggable('ws-arak')
  return (
    <div className="max-w-xl mt-40 flex gap-2 items-end">
      <AskInput value={text} onChange={setText} onSubmit={() => {}} mentions={people} placeholder="Ask anything, or @ to tag someone…" />
    </div>
  )
}

export function Harness() {
  const session = { user: { id: ME.user_id, email: ME.email }, access_token: 'dev' }
  const auth = {
    session, user: session.user, accessToken: 'dev', loading: false,
    access: { status: 'approved', role: 'admin' }, accessStatus: 'approved', isApproved: true, isAccessAdmin: true,
    workspaces: WS, activeWorkspace: WS[0], activeWorkspaceId: 'ws-arak',
    switchWorkspace: () => {}, refreshWorkspaces: async () => {}, signOut: () => {},
  }
  return (
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[page]}>
        <AppProvider workspaceId="ws-arak">
          <AppLayout>
            <ErrorBoundary>
              <Routes>
                <Route path="/requests" element={<Requests />} />
                <Route path="/ask" element={<AskDemo />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </ErrorBoundary>
          </AppLayout>
        </AppProvider>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<Harness />)
