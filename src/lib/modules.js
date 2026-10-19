// ─── The app's sections (v2) ───────────────────────────────────────────────
// 2026-10-19. The owner's direction: split the app by type of work instead
// of one long sidebar holding everything. The pattern (docs/COMPANY-HUB-PLAN.md)
// is an icon rail of SECTIONS on the far left, the open section's own pages
// beside it, a Home page of tiles, and a few things present everywhere
// (assistant, bell, Requests, Settings).
//
// This file is the ONE place a section or page is named. The rail, the
// section sidebar, Home's tiles, the top bar's title and the old-URL
// redirects all read it, so adding a page is one entry here and one <Route>.
//
// Every page's URL starts with its section (/sales/leads, /marketing/schedule)
// so a link always opens in the right place. The v1 URLs (/leads, /schedule…)
// still work: LEGACY maps them, and App.jsx redirects with the rest of the
// path, the query and the hash kept, so no bookmark, email or OAuth return
// address breaks.
//
// Access today is v1's roles: `adminOnly` sections and pages are for the
// access admin. Per-person section access (module_access) is step 2 of the
// plan and will replace `adminOnly` here without touching the screens.
//
// Pure: no React, no IO. Icons are named, not drawn; components/layout/icons.jsx
// draws them.

/**
 * @typedef {{ to: string, label: string, icon: string, adminOnly?: boolean,
 *             badge?: string, exact?: boolean, notUnder?: string[], hidden?: boolean }} Page
 * @typedef {{ key: string, label: string, icon: string, base: string,
 *             blurb: string, adminOnly?: boolean, pages: Page[] }} Section
 */

/** @type {Section[]} In rail order. Home is not here: it is the rail's first icon on its own. */
export const SECTIONS = [
  {
    key: 'ceo', label: 'CEO', icon: 'building', base: '/ceo', adminOnly: true,
    blurb: 'Six numbers, the decisions waiting for you, the team and the targets.',
    pages: [
      { to: '/ceo', label: 'Control panel', icon: 'building' },
    ],
  },
  {
    key: 'sales', label: 'Sales', icon: 'funnel', base: '/sales', adminOnly: true,
    blurb: 'Leads, the pipeline, target accounts and how the lead agent decides.',
    pages: [
      { to: '/sales/leads', label: 'Leads', icon: 'funnel' },
      { to: '/sales/targets', label: 'Target accounts', icon: 'target' },
      { to: '/sales/agent-brief', label: 'Agent Brief', icon: 'search' },
    ],
  },
  {
    key: 'marketing', label: 'Marketing', icon: 'megaphone', base: '/marketing',
    blurb: 'Plan, create, schedule and publish, and the brand behind it.',
    pages: [
      // The marketing team's own dashboard from v1, unchanged: they designed
      // it, and it is their landing page. Analytics in Insights is the deep
      // dive it links to (the owner's call, 2026-10-19).
      { to: '/marketing', label: 'Dashboard', icon: 'grid', exact: true },
      { to: '/marketing/campaigns', label: 'Content Planning', icon: 'check-circle' },
      { to: '/marketing/studio', label: 'Creative Studio', icon: 'pen' },
      { to: '/marketing/schedule', label: 'Schedule', icon: 'calendar' },
      { to: '/marketing/social', label: 'Social Media', icon: 'share', notUnder: ['/marketing/social/approvals', '/marketing/social/auto-replies'] },
      { to: '/marketing/social/approvals', label: 'Post Queue', icon: 'check-square', badge: 'pendingPosts' },
      { to: '/marketing/social/auto-replies', label: 'Auto-replies', icon: 'message-check' },
      { to: '/marketing/email', label: 'Email', icon: 'mail' },
      { to: '/marketing/media', label: 'Media Library', icon: 'image' },
      { to: '/marketing/brand-brain', label: 'Brand Brain', icon: 'brain' },
    ],
  },
  {
    key: 'insights', label: 'Insights', icon: 'bars', base: '/insights',
    blurb: 'Market research, competitors, and how every channel is performing.',
    pages: [
      { to: '/insights', label: 'Research', icon: 'bulb', exact: true },
      { to: '/insights/analytics', label: 'Analytics', icon: 'bars' },
      // Reached from inside Research / Analytics, not from the menu.
      { to: '/insights/report', label: 'Research Brief', icon: 'bulb', hidden: true },
      { to: '/insights/business', label: 'Business View', icon: 'bulb', hidden: true },
      { to: '/insights/analytics/report', label: 'Performance Report', icon: 'bars', hidden: true },
    ],
  },
  {
    key: 'admin', label: 'Admin', icon: 'users', base: '/admin', adminOnly: true,
    blurb: 'Who can use the app, and what each person can see.',
    pages: [
      { to: '/admin/team', label: 'Team & Access', icon: 'users', badge: 'pendingAccess' },
    ],
  },
]

/**
 * Present in every section: the rail's foot. Not a section, so they never
 * light a section in the rail and never appear on Home as a tile.
 */
export const GLOBAL_PAGES = [
  { to: '/agent', label: 'Assistant', icon: 'chat' },
  { to: '/requests', label: 'Requests', icon: 'check-square', badge: 'waitingRequests' },
  { to: '/settings', label: 'Settings', icon: 'gear' },
]

export const HOME = { to: '/', label: 'Home', icon: 'home' }

/**
 * v1 URL prefix → v2. Matched on whole path segments, longest first, so
 * '/social/approvals' never matches '/socialite' and a deeper old path keeps
 * its tail: /campaigns/plan?plan=7 → /marketing/campaigns/plan?plan=7.
 *
 * '/' is not here: v1's home is v2's Home page, and v1's dashboard is
 * Marketing's Dashboard (/marketing).
 */
export const LEGACY = {
  '/leads': '/sales/leads',
  '/targets': '/sales/targets',
  '/agent-brief': '/sales/agent-brief',
  '/campaigns': '/marketing/campaigns',
  '/studio': '/marketing/studio',
  '/schedule': '/marketing/schedule',
  '/social': '/marketing/social',
  '/email': '/marketing/email',
  '/media': '/marketing/media',
  '/brand-brain': '/marketing/brand-brain',
  '/analytics': '/insights/analytics',
  '/team': '/admin/team',
  '/dashboard': '/marketing',
}

const LEGACY_KEYS = Object.keys(LEGACY).sort((a, b) => b.length - a.length)

const underPrefix = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`)

/** The v2 path for a v1 one, or null when it is not a v1 path. Tail kept. */
export function fromLegacy(pathname) {
  const p = String(pathname || '')
  for (const old of LEGACY_KEYS) {
    if (underPrefix(p, old)) return LEGACY[old] + p.slice(old.length)
  }
  return null
}

const REVERSE = Object.entries(LEGACY).map(([old, now]) => [now, old]).sort((a, b) => b[0].length - a[0].length)

/**
 * The v1 path for a v2 one (the inverse of fromLegacy). For code whose
 * vocabulary is v1's routes, chiefly the assistant's page context
 * (lib/pageContext.js), so what the assistant knows about a page does not
 * change because the URL did.
 */
export function toLegacy(pathname) {
  const p = String(pathname || '')
  for (const [now, old] of REVERSE) {
    if (underPrefix(p, now)) return old + p.slice(now.length)
  }
  return p
}

/** Can this person open this section / page? v1's roles until module_access exists. */
export const canOpen = (item, { isAccessAdmin = false } = {}) => !item?.adminOnly || isAccessAdmin

/** The sections this person can open, each with only the pages they can open. */
export function sectionsFor(who = {}) {
  return SECTIONS
    .filter(s => canOpen(s, who))
    .map(s => ({ ...s, pages: s.pages.filter(pg => canOpen(pg, who)) }))
    .filter(s => s.pages.length)
}

/**
 * The pages the section menu lists for this path and person: none on Home
 * and the global pages, and none for a one-page section (the rail already
 * opened it, and a column holding one link is space taken for nothing).
 */
export function menuPages(pathname, who = {}) {
  return sectionMenu(sectionOf(pathname), who)
}

/** A section's menu for this person: its listed pages, or none for a one-page section. */
export function sectionMenu(section, who = {}) {
  if (!section) return []
  const pages = section.pages.filter(pg => !pg.hidden && canOpen(pg, who))
  return pages.length < 2 ? [] : pages
}

/** The section a path belongs to, or null for Home and the global pages. */
export function sectionOf(pathname) {
  const p = String(pathname || '')
  if (p === '/' || p === '') return null
  return SECTIONS.find(s => underPrefix(p, s.base)) || null
}

/** Every page, sections' and global, for titles and search. */
export const ALL_PAGES = [HOME, ...SECTIONS.flatMap(s => s.pages.map(pg => ({ ...pg, section: s.key }))), ...GLOBAL_PAGES]

/**
 * The top bar's title: the page whose URL is the longest match for this
 * path. /marketing/social/instagram is "Social Media" unless it has its own
 * entry; a planner under /marketing/campaigns/plan is "Content Planning".
 */
export function pageTitle(pathname) {
  const p = String(pathname || '')
  if (p === '/') return HOME.label
  let best = null
  for (const pg of ALL_PAGES) {
    if (pg.to === '/') continue
    if (underPrefix(p, pg.to) && (!best || pg.to.length > best.to.length)) best = pg
  }
  return best ? best.label : ''
}

/**
 * The sales team's own app (pages/leads/SalesApp.jsx) is a one-section app
 * already and keeps v1's /leads address: links in the lead agent's emails
 * point there, and for them it is the whole app. Only the marketing shell
 * redirects /leads.
 */
export const SALES_APP_PATH = '/leads'
