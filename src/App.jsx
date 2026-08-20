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
import { Campaigns }              from './pages/campaigns/index'
import { CampaignPlanner, CampaignPostEditor } from './pages/campaigns/CampaignPlanner'
import { ContentPlans } from './pages/campaigns/ContentPlans'
import { Schedule }                from './pages/schedule/index'
import { EmailFlows }             from './pages/email/index'
import { Analytics }               from './pages/analytics/index'
import { Insights }                from './pages/insights/index'
import { MediaLibrary }            from './pages/media/index'
import { SocialOverview, SocialPlatform } from './pages/social/index'
import { InstagramPage } from './pages/social/InstagramPage'
import { TikTokPage } from './pages/social/TikTokPage'
import { SnapchatPage } from './pages/social/SnapchatPage'
import { Approvals as PostApprovals } from './pages/social/Approvals'
import { Settings, Integrations } from './pages/settings/index'
import { Access } from './pages/settings/Access'
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
      dispatch(actions.hydrateWebhooks(saved))
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
          cached brand profile resets — no manual refresh.
          The remount alone was never enough for the persisted half of the
          store: it re-read the same localStorage blob, so an in-progress
          monthly plan survived the switch and reappeared under the next
          company. Passing the id down is what scopes that blob per company;
          see appStore.jsx. */}
      <AppProvider key={activeWorkspaceId || 'none'} workspaceId={activeWorkspaceId || 'none'}>
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
            <Route path="/schedule"              element={<Schedule />} />
            <Route path="/email"                 element={<EmailFlows />} />
            <Route path="/analytics"             element={<Analytics />} />
            <Route path="/insights"              element={<Insights />} />
            <Route path="/media"                 element={<MediaLibrary />} />
            <Route path="/social"                element={<SocialOverview />} />
            <Route path="/social/approvals"      element={<PostApprovals />} />
            <Route path="/social/instagram"      element={<InstagramPage />} />
            <Route path="/social/tiktok"         element={<TikTokPage />} />
            <Route path="/social/snapchat"       element={<SnapchatPage />} />
            {/* Fallback for any platform in PLATFORM_META without its own page
                yet. React Router ranks static segments above dynamic ones, so
                the three above still win regardless of order. */}
            <Route path="/social/:platform"      element={<SocialPlatform />} />
            <Route path="/settings"             element={<Settings />} />
            <Route path="/integrations"          element={<Integrations />} />
            <Route path="/team"                  element={<Access />} />
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
