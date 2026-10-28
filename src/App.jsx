import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { isLeadsHost } from './lib/leadsHost'
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
import { ResetPassword } from './pages/auth/ResetPassword'

import Dashboard from './pages/Dashboard'
import { CampaignPlanner } from './pages/campaigns/CampaignPlanner'
import { ContentPlans } from './pages/campaigns/ContentPlans'
import { Schedule }                from './pages/schedule/index'
import { EmailFlows }             from './pages/email/index'
import { Analytics }               from './pages/analytics/index'
import { PerformanceReport }       from './pages/analytics/PerformanceReport'
import { Insights }                from './pages/insights/index'
import { ResearchReport }          from './pages/insights/ResearchReport'
import { BusinessView }            from './pages/insights/BusinessView'
import AgentPage                  from './pages/agent/index'
import LeadAgent                  from './pages/leads/index'
import SalesApp                   from './pages/leads/SalesApp'
import SalesResearch              from './pages/leads/SalesResearch'
import Targets                    from './pages/sales/Targets'
import AgentBrief                 from './pages/admin/AgentBrief'
import SectionAccess              from './pages/admin/SectionAccess'
import { MediaLibrary }            from './pages/media/index'
import { SocialOverview, SocialPlatform } from './pages/social/index'
import { InstagramPage } from './pages/social/InstagramPage'
import { LinkedInPage } from './pages/social/LinkedInPage'
import { Approvals as PostApprovals } from './pages/social/Approvals'
import AutoReplies from './pages/social/AutoReplies'
import { Settings } from './pages/settings/index'
import { Requests } from './pages/requests/index'
import { CeoPage } from './pages/ceo/index'
import { Access } from './pages/settings/Access'
import { BrandBrain } from './pages/settings/BrandBrain'
import { CreativeStudio } from './pages/studio/index'
import { HomePage } from './pages/home/index'
import { TasksPage } from './pages/tasks/index'
import { CrmPipeline, CrmMine, CrmAll } from './pages/crm/Leads'
import { CrmLead } from './pages/crm/Lead'
import { CrmLeadForm } from './pages/crm/LeadForm'
import { CrmActivities } from './pages/crm/Activities'
import { CrmAnalysis } from './pages/crm/Analysis'
import { CrmSettings } from './pages/crm/Settings'
import { ContactsPage } from './pages/contacts/index'
import { ContactsOrgPage } from './pages/contacts/Org'
import { ContactsPeoplePage } from './pages/contacts/People'
import { ContactsCategoriesPage } from './pages/contacts/Categories'
import { SalesTasksRedirect } from './pages/leads/SalesTasks'
import { TechnicalProjects } from './pages/technical/index'
import { TechnicalProject } from './pages/technical/Project'
import { TechnicalSubmittals } from './pages/technical/Submittals'
import { TechnicalSettings } from './pages/technical/Settings'
import { FinanceInvoices } from './pages/finance/index'
import { FinanceProjects } from './pages/finance/Projects'
import { HrEmployees } from './pages/hr/Employees'
import { HrEmployee } from './pages/hr/Employee'
import { HrDepartments } from './pages/hr/Departments'
import { HrLeave } from './pages/hr/Leave'
import { HrAttendance } from './pages/hr/Attendance'
import { HrDocuments } from './pages/hr/Documents'
import { HrSettings } from './pages/hr/Settings'
import { fromLegacy, canVisit, PARKED } from './lib/modules'
import { useLang, COMMON } from './lib/i18n'

// A parked section's page (lib/modules.js PARKED_SECTIONS) is not served: its URL goes to Home.
const parked = (key, page) => (PARKED.has(key) ? <Navigate to="/" replace /> : page)

// Loads the account's saved webhook URLs into state.webhooks on startup, so
// they're there regardless of which page loads first. This used to happen
// only inside the old Integrations page's own effect — meaning any page that
// fires a webhook (Studio, Instagram, etc.) BEFORE that page was ever visited
// in that browser session saw every webhook as "not configured", even though
// the account's copy in workspace_webhooks was correct all along. That page
// is gone; this is now the only place the saved copy is loaded. Hooks-only;
// renders nothing.
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

// A v1 address (/leads, /schedule, /campaigns/plan?plan=7…) goes to its v2
// home with everything after the old prefix kept: the tail of the path, the
// query, the hash, and the navigation state a page may have passed along
// (navigate(path, { state })). Anything else is a real not-found.
function LegacyOrNotFound() {
  const location = useLocation()
  const to = fromLegacy(location.pathname)
  if (to) return <Navigate to={{ pathname: to, search: location.search, hash: location.hash }} state={location.state} replace />
  return <NotFound />
}

// The page you land on when a URL doesn't match anything. Previously the
// inner <Routes> had no catch-all, so a mistyped or stale link rendered the
// layout around an empty hole — indistinguishable from a crash.
function NotFound() {
  const lang = useLang()
  const c = COMMON[lang]
  return (
    <div className="p-8 max-w-xl" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text">{c.notFoundTitle}</h2>
        <p className="text-xs text-text-secondary mt-1.5">
          {c.notFoundBody}
        </p>
        <a href="/" className="inline-block mt-4 border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-subtle">
          {c.backHome}
        </a>
      </div>
    </div>
  )
}

// Everything under here requires a signed-in user with a workspace. Wrapping
// it as one element (rather than gating each <Route> individually) means
// adding a new page later never risks forgetting the auth check.
function ProtectedApp() {
  const { activeWorkspaceId, isSales } = useAuth()
  const { pathname } = useLocation()
  // The sales team: Leads and Research (read only), and any other address
  // lands on Leads. The marketing shell (and its webhook loader, assistant
  // and publish watch) never mounts for them. See pages/leads/SalesShell.jsx.
  if (isSales) {
    return (
      <RequireAuth>
        <ErrorBoundary key={pathname}>
          <Routes>
            <Route path="/leads" element={<SalesApp key={activeWorkspaceId || 'none'} />} />
            <Route path="/research" element={<SalesResearch key={activeWorkspaceId || 'none'} />} />
            {/* A task link from the morning email or the bell (/tasks?id=…)
                opens it in the sales app's own Tasks view. */}
            <Route path="/tasks"    element={<SalesTasksRedirect />} />
            <Route path="*"      element={<Navigate to="/leads" replace />} />
          </Routes>
        </ErrorBoundary>
      </RequireAuth>
    )
  }
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
          <SectionGuard>
          <Routes>
            {/* v2 (2026-10-19): every page's URL starts with its section;
                lib/modules.js names them. v1's addresses (/leads, /schedule…)
                are not listed here: they fall through to the catch-all, which
                redirects them with the rest of the path, the query, the hash
                and any navigation state kept (LegacyOrNotFound). */}
            {/* sales.araklighting.com opens straight onto the leads page. */}
            <Route path="/"                      element={isLeadsHost() ? <Navigate to="/sales/leads" replace /> : <Home />} />

            {/* ── CEO ── */}
            <Route path="/ceo"                  element={<CeoPage />} />

            {/* ── Sales ── (who may open each section and page: SectionGuard) */}
            <Route path="/sales"                 element={<Navigate to="/sales/leads" replace />} />
            <Route path="/sales/leads"           element={<LeadAgent />} />
            <Route path="/sales/targets"         element={<Targets />} />
            <Route path="/sales/agent-brief"     element={<AgentBrief />} />

            {/* ── Marketing ── v1's dashboard is its Dashboard, unchanged. */}
            <Route path="/marketing"             element={<Dashboard />} />
            {/* Two routes, not four: the plans list carries "New monthly plan",
                so v1's menu between them was a click in the way.
                `/campaigns/plans` still resolves, for links already sent. */}
            <Route path="/marketing/campaigns"       element={<ContentPlans />} />
            <Route path="/marketing/campaigns/plans" element={<Navigate to="/marketing/campaigns" replace />} />
            <Route path="/marketing/campaigns/plan"  element={<CampaignPlanner />} />
            <Route path="/marketing/studio"          element={<CreativeStudio />} />
            <Route path="/marketing/schedule"        element={<Schedule />} />
            <Route path="/marketing/email"           element={<EmailFlows />} />
            <Route path="/marketing/media"           element={<MediaLibrary />} />
            <Route path="/marketing/brand-brain"     element={<BrandBrain />} />
            <Route path="/marketing/social"              element={<SocialOverview />} />
            <Route path="/marketing/social/approvals"    element={<PostApprovals />} />
            <Route path="/marketing/social/auto-replies" element={<AutoReplies />} />
            <Route path="/marketing/social/instagram"    element={<InstagramPage />} />
            <Route path="/marketing/social/linkedin"     element={<LinkedInPage />} />
            <Route path="/marketing/social/tiktok"       element={<Navigate to="/marketing/social" replace />} />
            <Route path="/marketing/social/snapchat"     element={<Navigate to="/marketing/social" replace />} />
            {/* Any platform in PLATFORM_META without its own page yet. Static
                segments outrank dynamic ones, so the routes above still win. */}
            <Route path="/marketing/social/:platform"    element={<SocialPlatform />} />

            {/* ── Insights ── the two printable documents are routes of their
                own: a report has its own period, its own URL to send someone,
                and has to survive being printed. */}
            <Route path="/insights"                  element={<Insights />} />
            <Route path="/insights/report"           element={<ResearchReport />} />
            <Route path="/insights/business"         element={<BusinessView />} />
            <Route path="/insights/research"         element={<Navigate to="/insights" replace />} />
            <Route path="/insights/analytics"        element={<Analytics />} />
            <Route path="/insights/analytics/report" element={<PerformanceReport />} />

            {/* ── Technical ── Odoo Project's projects, watched (2026-10-19).
                Parked until Musa's ERP (lib/erp.js): the URLs go to Home. */}
            <Route path="/technical"             element={parked('technical', <TechnicalProjects />)} />
            <Route path="/technical/project"     element={parked('technical', <TechnicalProject />)} />
            <Route path="/technical/submittals"  element={parked('technical', <TechnicalSubmittals />)} />
            <Route path="/technical/settings"    element={parked('technical', <TechnicalSettings />)} />

            {/* ── Finance ── read only, from Odoo Accounting. Parked too. */}
            <Route path="/finance"               element={parked('finance', <FinanceInvoices />)} />
            <Route path="/finance/projects"      element={parked('finance', <FinanceProjects />)} />

            {/* ── HR ── Musa's HR rewritten in our stack (dev/erp-pilot/HR.md). */}
            <Route path="/hr"                    element={<HrEmployees />} />
            <Route path="/hr/employee"           element={<HrEmployee />} />
            <Route path="/hr/departments"        element={<HrDepartments />} />
            <Route path="/hr/leave"              element={<HrLeave />} />
            <Route path="/hr/attendance"         element={<HrAttendance />} />
            <Route path="/hr/documents"          element={<HrDocuments />} />
            <Route path="/hr/settings"           element={<HrSettings />} />
            {/* ── CRM ── Musa's CRM, in our stack (dev/erp-pilot/CRM.md). */}
            <Route path="/crm"                   element={<CrmPipeline />} />
            <Route path="/crm/mine"              element={<CrmMine />} />
            <Route path="/crm/list"              element={<CrmAll />} />
            <Route path="/crm/lead"              element={<CrmLead />} />
            <Route path="/crm/new"               element={<CrmLeadForm />} />
            <Route path="/crm/edit"              element={<CrmLeadForm key="edit" />} />
            <Route path="/crm/activities"        element={<CrmActivities />} />
            <Route path="/crm/analysis"          element={<CrmAnalysis />} />
            <Route path="/crm/settings"          element={<CrmSettings />} />
            {/* ── Contacts ── Musa's ERP item 3, in our stack. */}
            <Route path="/contacts"              element={<ContactsPage />} />
            <Route path="/contacts/people"       element={<ContactsPeoplePage />} />
            <Route path="/contacts/org"          element={<ContactsOrgPage />} />
            <Route path="/contacts/categories"   element={<ContactsCategoriesPage />} />

            {/* ── Admin ── */}
            <Route path="/admin"               element={<Navigate to="/admin/team" replace />} />
            <Route path="/admin/team"            element={<Access />} />
            <Route path="/admin/sections"        element={<SectionAccess />} />

            {/* ── Everywhere (no section) ── */}
            <Route path="/agent"                 element={<AgentPage />} />
            <Route path="/requests"              element={<Requests />} />
            <Route path="/tasks"                 element={<TasksPage />} />
            <Route path="/settings"              element={<Settings />} />

            {/* The Integrations page was removed; old links land on Home. */}
            <Route path="/integrations"          element={<Navigate to="/" replace />} />
            <Route path="*"                      element={<LegacyOrNotFound />} />
          </Routes>
          </SectionGuard>
          </ErrorBoundary>
        </AppLayout>
      </AppProvider>
    </RequireAuth>
  )
}

// The CEO lands on his own page (user_access.landing = 'ceo'), once per
// visit: after that the rail's Home icon still opens Home.
const LANDED_KEY = 'arak.landed'
function Home() {
  const { access, isAccessAdmin } = useAuth()
  let landed = true
  try { landed = sessionStorage.getItem(LANDED_KEY) === '1'; sessionStorage.setItem(LANDED_KEY, '1') } catch { /* private window */ }
  if (!landed && isAccessAdmin && access?.landing === 'ceo') return <Navigate to="/ceo" replace />
  return <HomePage />
}

// One gate for every section page (v2): the person's grant for the page's
// section, at the page's level (lib/modules.js canVisit; the grants are
// public.section_access, which the database enforces again through
// has_section()). Anyone else lands on Home rather than on a page whose data
// RLS would refuse.
function SectionGuard({ children }) {
  const { pathname } = useLocation()
  const { who, sectionsReady } = useAuth()
  if (!sectionsReady) return null
  if (!canVisit(pathname, who)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login"      element={<Login />} />
        <Route path="/signup"     element={<Signup />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/*"          element={<ProtectedApp />} />
      </Routes>
    </AuthProvider>
  )
}
