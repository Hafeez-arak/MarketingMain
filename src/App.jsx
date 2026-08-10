import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AppProvider, useApp, actions } from './store/appStore'
import { AuthProvider, useAuth } from './store/AuthContext'
import { RequireAuth } from './components/auth/RequireAuth'
import { AppLayout } from './components/layout/AppLayout'
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

// Everything under here requires a signed-in user with a workspace. Wrapping
// it as one element (rather than gating each <Route> individually) means
// adding a new page later never risks forgetting the auth check.
function ProtectedApp() {
  const { activeWorkspaceId } = useAuth()
  return (
    <RequireAuth>
      {/* Key the whole data subtree on the active company: switching companies
          remounts it, so every page re-runs its Supabase fetches and the
          cached brand profile / in-progress draft reset — no manual refresh. */}
      <AppProvider key={activeWorkspaceId || 'none'}>
        <WebhooksLoader />
        <AppLayout>
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
          </Routes>
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
