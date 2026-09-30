import './loadingFetch'
import ReactDOM from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../store/auth'
import { AppProvider } from '../store/appStore'
import { AppLayout } from '../components/layout/AppLayout'
import { ErrorBoundary } from '../components/ErrorBoundary'
import Dashboard from '../pages/Dashboard'
import { CampaignPlanner } from '../pages/campaigns/CampaignPlanner'
import { ContentPlans } from '../pages/campaigns/ContentPlans'
import { Schedule } from '../pages/schedule/index'
import { EmailFlows } from '../pages/email/index'
import { Analytics } from '../pages/analytics/index'
import { PerformanceReport } from '../pages/analytics/PerformanceReport'
import { Insights } from '../pages/insights/index'
import { ResearchReport } from '../pages/insights/ResearchReport'
import { BusinessView } from '../pages/insights/BusinessView'
import AgentPage from '../pages/agent/index'
import { MediaLibrary } from '../pages/media/index'
import { SocialOverview } from '../pages/social/index'
import { InstagramPage } from '../pages/social/InstagramPage'
import { TikTokPage } from '../pages/social/TikTokPage'
import { LinkedInPage } from '../pages/social/LinkedInPage'
import { SnapchatPage } from '../pages/social/SnapchatPage'
import { Approvals } from '../pages/social/Approvals'
import AutoReplies from '../pages/social/AutoReplies'
import { Settings, Integrations } from '../pages/settings/index'
import { Access } from '../pages/settings/Access'
import { BrandBrain } from '../pages/settings/BrandBrain'
import { CreativeStudio } from '../pages/studio/index'
import '../index.css'

// ─── Dev-only loading harness ──────────────────────────────────────────────
// Every page of the app, signed in as a fake admin, with the network frozen
// (?mode=hang) or broken (?mode=fail) by loadingFetch.js. It answers one
// question per page: before any data arrives, does it show skeletons, or does
// it claim something (0, "Not connected", "No posts yet", "null") that is not
// true yet? See the no-placeholder-flash rule in #44.
//
// /dev-loading.html?page=/social/instagram&mode=hang
// Vite only builds index.html, so this never reaches production.

export const ROUTES = {
  '/': <Dashboard />, '/brand-brain': <BrandBrain />, '/studio': <CreativeStudio />,
  '/campaigns': <ContentPlans />, '/campaigns/plan': <CampaignPlanner />, '/schedule': <Schedule />,
  '/email': <EmailFlows />, '/analytics': <Analytics />, '/analytics/report': <PerformanceReport />,
  '/insights': <Insights />, '/insights/report': <ResearchReport />, '/insights/business': <BusinessView />,
  '/agent': <AgentPage />, '/media': <MediaLibrary />, '/social': <SocialOverview />,
  '/social/approvals': <Approvals />, '/social/auto-replies': <AutoReplies />,
  '/social/instagram': <InstagramPage />, '/social/tiktok': <TikTokPage />, '/social/linkedin': <LinkedInPage />,
  '/social/snapchat': <SnapchatPage />, '/settings': <Settings />, '/integrations': <Integrations />, '/team': <Access />,
}
window.__loadingRoutes = Object.keys(ROUTES)

const WS = '00000000-0000-0000-0000-000000000001'
const session = { user: { id: 'u1', email: 'hafeez@arak-sa.com' }, access_token: 'dev' }
const auth = {
  session, user: session.user, accessToken: 'dev', loading: false,
  access: { status: 'approved', role: 'admin' }, accessStatus: 'approved', isApproved: true, isAccessAdmin: true,
  workspaces: [{ id: WS, name: 'Arak Lighting', role: 'owner' }], activeWorkspace: { id: WS, name: 'Arak Lighting' }, activeWorkspaceId: WS,
  switchWorkspace: () => {}, refreshWorkspaces: () => {}, signOut: () => {},
}

const params = new URLSearchParams(window.location.search)
const page = params.get('page') || '/'
const [path, query = ''] = page.split('?')

ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthContext.Provider value={auth}>
    <MemoryRouter initialEntries={[page]}>
      <AppProvider workspaceId={WS}>
        <AppLayout>
          <ErrorBoundary>
            <Routes>
              <Route path={path} element={ROUTES[path] || <p>No such page: {path}{query}</p>} />
            </Routes>
          </ErrorBoundary>
        </AppLayout>
      </AppProvider>
    </MemoryRouter>
  </AuthContext.Provider>,
)
