import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AppProvider } from './store/appStore'
import { useApp, actions } from './store/app'
import { AuthProvider } from './store/AuthContext'
import { useAuth } from './store/auth'
import { RequireAuth } from './components/auth/RequireAuth'
import { AppLayout } from './components/layout/AppLayout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { fetchWorkspaceWebhooks } from './lib/workspaceWebhooks'

import { Login } from './pages/auth/Login'
import { Signup } from './pages/auth/Signup'
import { Onboarding } from './pages/auth/Onboarding'

import Dashboard from './pages/Dashboard'
import { Campaigns, NewCampaign }  from './pages/campaigns/index'
import { CampaignPlanner, CampaignPostEditor } from './pages/campaigns/CampaignPlanner'
import { ContentPlans } from './pages/campaigns/ContentPlans'
import { Schedule }                from './pages/schedule/index'
import { EmailFlows, NewEmailFlow }from './pages/email/index'
import { Analytics }               from './pages/analytics/index'
import { MediaLibrary }            from './pages/media/index'
import { SocialOverview, SocialPlatform, NewPost } from './pages/social/index'
import { InstagramPage } from './pages/social/InstagramPage'
import { LinkedInPage }  from './pages/social/LinkedInPage'
import { Approvals as PostApprovals } from './pages/social/Approvals'
import { Settings, Integrations, Team } from './pages/settings/index'
import { BrandBrain } from './pages/settings/BrandBrain'
import { CreativeStudio } from './pages/studio/index'

// Loads the account's saved webhook URLs into state.webhooks on startup, so
// they're there regardless of which page loads first. This used to happen
// only inside the Settings → Integrations component's own effect — meaning
// any page that fires a webhook (Studio, Instagram, etc.) BEFORE Settings
// was ever visited in that browser session saw every webhook as "not
// configured", even though the account's copy in workspace_webhooks was
// correct all along. Hooks-only; renders nothing.
function WebhooksLoader() {
  const { dispatch } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    fetchWorkspaceWebhooks(activeWorkspaceId, accessToken).then(saved => {
      if (cancelled || !saved) return
      Object.entries(saved).forEach(([platform, url]) => {
        if (typeof url === 'string') dispatch(actions.setWebhook(platform, url))
      })
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken, dispatch])
  return null
}

// The page you land on when a URL doesn't match anything. Previously the
// inner <Routes> had no catch-all, so a mistyped or stale link rendered the
// layout around an empty hole — indistinguishable from a crash.
function NotFound() {
  return (
    <div className="p-8 max-w-xl">
      <div className="border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text">That page doesn't exist</h2>
        <p className="text-xs text-text-secondary mt-1.5">
          The link may be out of date. Everything is reachable from the sidebar.
        </p>
        <a href="/" className="inline-block mt-4 border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-subtle">
          Back to dashboard
        </a>
      </div>
    </div>
  )
}

// Everything under here requires a signed-in user with a workspace. Wrapping
// it as one element (rather than gating each <Route> individually) means
// adding a new page later never risks forgetting the auth check.
function ProtectedApp() {
  const { activeWorkspaceId } = useAuth()
  const { pathname } = useLocation()
  return (
    <RequireAuth>
      {/* Key the whole data subtree on the active company: switching companies
          remounts it, so every page re-runs its Supabase fetches and the
          cached brand profile / in-progress draft reset — no manual refresh. */}
      <AppProvider key={activeWorkspaceId || 'none'}>
        <WebhooksLoader />
        <AppLayout>
          {/* Inside AppLayout, so a crashed page keeps the sidebar and you can
              navigate out of it. Keyed on the path because a boundary has no
              way to know the route changed — without the key, one crash would
              pin the error screen in place for every page after it. */}
          <ErrorBoundary key={pathname}>
          <Routes>
            <Route path="/"                      element={<Dashboard />} />
            <Route path="/brand-brain"           element={<BrandBrain />} />
            <Route path="/studio"                element={<CreativeStudio />} />
            <Route path="/campaigns"             element={<Campaigns />} />
            <Route path="/campaigns/plans"       element={<ContentPlans />} />
            <Route path="/campaigns/plan"        element={<CampaignPlanner />} />
            <Route path="/campaigns/plan/post/:rowId" element={<CampaignPostEditor />} />
            <Route path="/campaigns/new"         element={<NewCampaign />} />
            <Route path="/schedule"              element={<Schedule />} />
            <Route path="/email"                 element={<EmailFlows />} />
            <Route path="/email/new"             element={<NewEmailFlow />} />
            <Route path="/analytics"             element={<Analytics />} />
            <Route path="/media"                 element={<MediaLibrary />} />
            <Route path="/social"                element={<SocialOverview />} />
            <Route path="/social/approvals"      element={<PostApprovals />} />
            <Route path="/social/instagram"      element={<InstagramPage />} />
            <Route path="/social/linkedin"       element={<LinkedInPage />} />
            <Route path="/social/tiktok"         element={<SocialPlatform />} />
            <Route path="/social/instagram/new"  element={<NewPost />} />
            <Route path="/social/linkedin/new"   element={<NewPost />} />
            <Route path="/social/tiktok/new"     element={<NewPost />} />
            <Route path="/settings"             element={<Settings />} />
            <Route path="/integrations"          element={<Integrations />} />
            <Route path="/team"                  element={<Team />} />
            <Route path="*"                      element={<NotFound />} />
          </Routes>
          </ErrorBoundary>
        </AppLayout>
      </AppProvider>
    </RequireAuth>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login"      element={<Login />} />
        <Route path="/signup"     element={<Signup />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/*"          element={<ProtectedApp />} />
      </Routes>
    </AuthProvider>
  )
}
