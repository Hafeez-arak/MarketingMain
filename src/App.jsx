import { Routes, Route } from 'react-router-dom'
import { AppProvider } from './store/appStore'
import { AppLayout } from './components/layout/AppLayout'

import Dashboard from './pages/Dashboard'
import { Campaigns, NewCampaign }  from './pages/campaigns/index'
import { Schedule }                from './pages/schedule/index'
import { EmailFlows, NewEmailFlow }from './pages/email/index'
import { Analytics }               from './pages/analytics/index'
import { MediaLibrary }            from './pages/media/index'
import { SocialOverview, SocialPlatform, NewPost } from './pages/social/index'
import { InstagramPage } from './pages/social/InstagramPage'
import { LinkedInPage }  from './pages/social/LinkedInPage'
import { Approvals }               from './pages/approvals/index'
import { Settings, Integrations, Team } from './pages/settings/index'

export default function App() {
  return (
    <AppProvider>
      <AppLayout>
        <Routes>
          <Route path="/"                      element={<Dashboard />} />
          <Route path="/campaigns"             element={<Campaigns />} />
          <Route path="/campaigns/new"         element={<NewCampaign />} />
          <Route path="/schedule"              element={<Schedule />} />
          <Route path="/email"                 element={<EmailFlows />} />
          <Route path="/email/new"             element={<NewEmailFlow />} />
          <Route path="/analytics"             element={<Analytics />} />
          <Route path="/media"                 element={<MediaLibrary />} />
          <Route path="/social"                element={<SocialOverview />} />
          <Route path="/social/instagram"      element={<InstagramPage />} />
          <Route path="/social/facebook"       element={<SocialPlatform />} />
          <Route path="/social/linkedin"       element={<LinkedInPage />} />
          <Route path="/social/tiktok"         element={<SocialPlatform />} />
          <Route path="/social/x"              element={<SocialPlatform />} />
          <Route path="/social/instagram/new"  element={<NewPost />} />
          <Route path="/social/facebook/new"   element={<NewPost />} />
          <Route path="/social/linkedin/new"   element={<NewPost />} />
          <Route path="/social/tiktok/new"     element={<NewPost />} />
          <Route path="/social/x/new"          element={<NewPost />} />
          <Route path="/approvals"             element={<Approvals />} />
          <Route path="/settings"             element={<Settings />} />
          <Route path="/integrations"          element={<Integrations />} />
          <Route path="/team"                  element={<Team />} />
        </Routes>
      </AppLayout>
    </AppProvider>
  )
}
