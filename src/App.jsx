import { Routes, Route } from 'react-router-dom'
import { AppProvider } from './store/appStore'
import { AuthProvider, useAuth } from './store/AuthContext'
import { RequireAuth } from './components/auth/RequireAuth'
import { AppLayout } from './components/layout/AppLayout'

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
