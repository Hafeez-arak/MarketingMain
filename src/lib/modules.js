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
// Access: per person and per company, from public.section_access (see
// sectionLevel below). `adminOnly` marks the sections v1 kept for the access
// admin; it decides only while that table does not exist yet.
//
// Pure: no React, no IO. Icons are named, not drawn; components/layout/icons.jsx
// draws them.

/**
 * @typedef {{ to: string, label: string, icon: string, min?: 'view'|'work'|'manage',
 *             badge?: string, exact?: boolean, notUnder?: string[], hidden?: boolean,
 *             ar?: string, translated?: boolean }} Page
 * @typedef {{ key: string, label: string, icon: string, base: string,
 *             blurb: string, ar?: string, blurbAr?: string, adminOnly?: boolean, pages: Page[] }} Section
 */

/** @type {Section[]} In rail order. Home is not here: it is the rail's first icon on its own. */
export const SECTIONS = [
  {
    key: 'ceo', label: 'CEO', ar: 'المدير التنفيذي', icon: 'building', base: '/ceo', adminOnly: true,
    blurb: 'Six numbers, the decisions waiting for you, the team and the targets.',
    blurbAr: 'ستة أرقام، والقرارات التي تنتظرك، والفريق، والأهداف.',
    pages: [
      { to: '/ceo', label: 'Control panel', ar: 'لوحة التحكم', icon: 'building', translated: true },
    ],
  },
  {
    key: 'sales', label: 'Sales', ar: 'المبيعات', icon: 'funnel', base: '/sales', adminOnly: true,
    blurb: 'Leads, the pipeline, target accounts and how the lead agent decides.',
    blurbAr: 'العملاء المحتملون، ومسار الصفقات، والحسابات المستهدفة، وكيف يقرر وكيل العملاء.',
    pages: [
      { to: '/sales/leads', label: 'Leads', ar: 'العملاء المحتملون', icon: 'funnel', translated: true },
      { to: '/sales/targets', label: 'Target accounts', ar: 'الحسابات المستهدفة', icon: 'target', translated: true },
      // How the lead agent decides: changing it is managing Sales.
      { to: '/sales/agent-brief', label: 'Agent Brief', ar: 'موجز الوكيل', icon: 'search', min: 'manage' },
    ],
  },
  {
    // Musa's CRM rewritten in our stack (2026-10-28, dev/erp-pilot/CRM.md):
    // his opportunities, pipeline, activities, analysis and settings, as
    // their own section (his menu has CRM as its own app beside Clients),
    // apart from Sales' lead-agent pipeline. view reads, work does the
    // day-to-day (his crm.manage), manage sets it up (his crm.settings).
    key: 'crm', label: 'CRM', ar: 'الفرص البيعية', icon: 'kanban', base: '/crm', adminOnly: true,
    blurb: 'Sales opportunities through your stages to won or lost, with their activities and analysis.',
    blurbAr: 'الفرص البيعية عبر مراحلكم حتى الكسب أو الخسارة، مع أنشطتها وتحليلها.',
    pages: [
      { to: '/crm', label: 'Pipeline', ar: 'مسار البيع', icon: 'kanban', exact: true, translated: true },
      { to: '/crm/mine', label: 'My opportunities', ar: 'فرصي', icon: 'target', translated: true },
      { to: '/crm/activities', label: 'Planned activities', ar: 'الأنشطة المخططة', icon: 'calendar', translated: true },
      { to: '/crm/list', label: 'All opportunities', ar: 'كل الفرص', icon: 'grid', translated: true },
      { to: '/crm/analysis', label: 'Analysis', ar: 'التحليل', icon: 'bars', translated: true },
      { to: '/crm/settings', label: 'CRM settings', ar: 'إعدادات الفرص', icon: 'gear', translated: true },
      // Reached from the lists, not the menu.
      { to: '/crm/lead', label: 'Opportunity', ar: 'الفرصة', icon: 'kanban', hidden: true, translated: true },
      { to: '/crm/new', label: 'New opportunity', ar: 'فرصة جديدة', icon: 'kanban', hidden: true, min: 'work', translated: true },
      { to: '/crm/edit', label: 'Edit opportunity', ar: 'تعديل الفرصة', icon: 'kanban', hidden: true, min: 'work', translated: true },
    ],
  },
  {
    // Musa's catalog (الكتالوج), rewritten in our stack (2026-10-30,
    // dev/erp-pilot/CATALOG.md): the company's items and their
    // specifications. No prices, no stock. view reads, manage edits (work
    // is the same as view: his catalog has two permissions).
    key: 'catalog', label: 'Catalog', ar: 'الكتالوج', icon: 'box', base: '/catalog', adminOnly: true,
    blurb: 'Items and their specifications, named by the company. No prices or stock.',
    blurbAr: 'الأصناف ومواصفاتها كما تسمّيها الشركة، بلا أسعار ولا مخزون.',
    pages: [
      { to: '/catalog', label: 'Items', ar: 'الأصناف', icon: 'box', exact: true, translated: true },
      { to: '/catalog/fields', label: 'Specification fields', ar: 'حقول المواصفات', icon: 'grid', min: 'manage', translated: true },
      // Reached from the list, not the menu.
      { to: '/catalog/item', label: 'Item', ar: 'الصنف', icon: 'box', hidden: true, translated: true },
      { to: '/catalog/new', label: 'New item', ar: 'صنف جديد', icon: 'box', hidden: true, min: 'manage', translated: true },
      { to: '/catalog/edit', label: 'Edit item', ar: 'تعديل الصنف', icon: 'box', hidden: true, min: 'manage', translated: true },
    ],
  },
  {
    // Musa's pricing module (التسعير), rewritten in our stack (2026-12-01,
    // dev/erp-pilot/PRICING.md): pricing sheets per opportunity, supplier
    // quotes, landed cost, margin and approval. view reads (cost and margin
    // included), work edits drafts and submits, manage approves and sets the
    // minimum margin.
    key: 'pricing', label: 'Pricing', ar: 'التسعير', icon: 'calculator', base: '/pricing', adminOnly: true,
    blurb: 'Pricing sheets per opportunity: supplier quotes, landed cost, margin and approval.',
    blurbAr: 'كشوف التسعير لكل فرصة: عروض الموردين والتكلفة الواصلة والهامش والاعتماد.',
    pages: [
      { to: '/pricing', label: 'Pricing sheets', ar: 'كشوف التسعير', icon: 'calculator', exact: true, translated: true },
      { to: '/pricing/settings', label: 'Settings', ar: 'الإعدادات', icon: 'gear', translated: true },
      // Reached from the list, not the menu.
      { to: '/pricing/sheet', label: 'Pricing sheet', ar: 'كشف التسعير', icon: 'calculator', hidden: true, translated: true },
      { to: '/pricing/new', label: 'New pricing sheet', ar: 'كشف تسعير جديد', icon: 'calculator', hidden: true, min: 'work', translated: true },
      { to: '/pricing/edit', label: 'Edit pricing sheet', ar: 'تعديل كشف التسعير', icon: 'calculator', hidden: true, min: 'work', translated: true },
      { to: '/pricing/lines', label: 'BOQ lines', ar: 'بنود جدول الكميات', icon: 'calculator', hidden: true, min: 'work', translated: true },
      { to: '/pricing/compare', label: 'Compare suppliers', ar: 'مقارنة الموردين', icon: 'calculator', hidden: true, translated: true },
      { to: '/pricing/quote-new', label: 'Ask a supplier to quote', ar: 'طلب عرض من مورد', icon: 'calculator', hidden: true, min: 'work', translated: true },
      { to: '/pricing/quote', label: 'Supplier quote', ar: 'عرض المورد', icon: 'calculator', hidden: true, translated: true },
    ],
  },
  {
    key: 'marketing', label: 'Marketing', ar: 'التسويق', icon: 'megaphone', base: '/marketing',
    blurb: 'Plan, create, schedule and publish, and the brand behind it.',
    blurbAr: 'التخطيط والإنشاء والجدولة والنشر، والعلامة التجارية خلف ذلك.',
    pages: [
      // The marketing team's own dashboard from v1, unchanged: they designed
      // it, and it is their landing page. Analytics in Insights is the deep
      // dive it links to (the owner's call, 2026-10-19).
      { to: '/marketing', label: 'Dashboard', ar: 'لوحة المعلومات', icon: 'grid', exact: true },
      { to: '/marketing/campaigns', label: 'Content Planning', ar: 'تخطيط المحتوى', icon: 'check-circle' },
      { to: '/marketing/studio', label: 'Creative Studio', ar: 'الاستوديو الإبداعي', icon: 'pen' },
      { to: '/marketing/schedule', label: 'Schedule', ar: 'الجدولة', icon: 'calendar' },
      { to: '/marketing/social', label: 'Social Media', ar: 'وسائل التواصل', icon: 'share', notUnder: ['/marketing/social/approvals', '/marketing/social/auto-replies'] },
      { to: '/marketing/social/approvals', label: 'Post Queue', ar: 'قائمة المنشورات', icon: 'check-square', badge: 'pendingPosts' },
      { to: '/marketing/social/auto-replies', label: 'Auto-replies', ar: 'الردود التلقائية', icon: 'message-check' },
      { to: '/marketing/email', label: 'Email', ar: 'البريد الإلكتروني', icon: 'mail' },
      { to: '/marketing/media', label: 'Media Library', ar: 'مكتبة الوسائط', icon: 'image' },
      { to: '/marketing/brand-brain', label: 'Brand Brain', ar: 'هوية العلامة', icon: 'brain' },
    ],
  },
  {
    key: 'insights', label: 'Insights', ar: 'الرؤى', icon: 'bars', base: '/insights',
    blurb: 'Market research, competitors, and how every channel is performing.',
    blurbAr: 'أبحاث السوق، والمنافسون، وأداء كل قناة.',
    pages: [
      { to: '/insights', label: 'Research', ar: 'الأبحاث', icon: 'bulb', exact: true },
      { to: '/insights/analytics', label: 'Analytics', ar: 'التحليلات', icon: 'bars' },
      // Reached from inside Research / Analytics, not from the menu.
      { to: '/insights/report', label: 'Research Brief', ar: 'موجز الأبحاث', icon: 'bulb', hidden: true },
      { to: '/insights/business', label: 'Business View', ar: 'نظرة الأعمال', icon: 'bulb', hidden: true },
      { to: '/insights/analytics/report', label: 'Performance Report', ar: 'تقرير الأداء', icon: 'bars', hidden: true },
    ],
  },
  {
    // Musa's HR rewritten in our stack (2026-10-28, dev/erp-pilot/HR.md):
    // view reads, work is his hr.attendance (attendance entry and corrections),
    // manage is his hr.manage + hr.contracts + hr.leave_approve (files, papers,
    // contracts, leave decisions and grants). No pay or payroll: out of scope by the owner's decision.
    key: 'hr', label: 'HR', ar: 'الموارد البشرية', icon: 'id-card', base: '/hr', adminOnly: true,
    blurb: 'Employees and their papers, leave and who is off, and daily attendance.',
    blurbAr: 'الموظفون ووثائقهم، والإجازات ومن هو في إجازة، والحضور اليومي.',
    pages: [
      { to: '/hr', label: 'Employees', ar: 'الموظفون', icon: 'users', exact: true, translated: true },
      { to: '/hr/employee', label: 'Employee', ar: 'الموظف', icon: 'users', hidden: true, translated: true },
      { to: '/hr/departments', label: 'Departments', ar: 'الأقسام', icon: 'building', translated: true },
      { to: '/hr/leave', label: 'Leave', ar: 'الإجازات', icon: 'calendar', translated: true },
      { to: '/hr/attendance', label: 'Attendance', ar: 'الحضور', icon: 'check-square', translated: true },
      // Musa's attendance in full (2026-10-28, dev/erp-pilot/ATTENDANCE.md):
      // its tabs and reports live under /hr/attendance; the devices, their
      // keys and the linking are for Manage.
      { to: '/hr/attendance/devices', label: 'Attendance devices', ar: 'أجهزة البصمة', icon: 'check-square', hidden: true, min: 'manage', translated: true },
      // His hr.contracts and the papers of hr.manage are Manage here (dev/erp-pilot/HR.md, the mapping).
      { to: '/hr/contracts', label: 'Contracts', ar: 'العقود', icon: 'file-check', min: 'manage', translated: true },
      { to: '/hr/contract', label: 'Contract', ar: 'العقد', icon: 'file-check', hidden: true, min: 'manage', translated: true },
      { to: '/hr/documents', label: 'Expiring papers', ar: 'الوثائق المنتهية', icon: 'file-check', min: 'manage', translated: true },
      { to: '/hr/settings', label: 'HR settings', ar: 'إعدادات الموارد البشرية', icon: 'gear', min: 'manage', translated: true },
    ],
  },
  {
    // Musa's ERP, item 3 (جهات الاتصال), rewritten in our stack (2026-10-28,
    // dev/erp-pilot/CONTACTS.md): one record per organisation or person with
    // several roles. Granted per person like the others; adminOnly keeps it
    // off for members until someone is given it.
    key: 'contacts', label: 'Contacts', ar: 'جهات الاتصال', icon: 'contacts', base: '/contacts', adminOnly: true,
    blurb: 'Clients, suppliers, contractors and consultants, once each, with their VAT, CR and national address.',
    blurbAr: 'العملاء والموردون والمقاولون والاستشاريون، كلٌّ مرة واحدة، مع الرقم الضريبي والسجل التجاري والعنوان الوطني.',
    pages: [
      { to: '/contacts', label: 'Organisations', ar: 'الجهات', icon: 'contacts', exact: true, translated: true },
      { to: '/contacts/people', label: 'People', ar: 'الأشخاص', icon: 'users', translated: true },
      // Musa's supplier categories: everyone reads them, managing names them.
      { to: '/contacts/categories', label: 'Supplier categories', ar: 'تصنيفات الموردين', icon: 'grid', translated: true },
      // One organisation's page, reached from the lists.
      { to: '/contacts/org', label: 'Organisation', ar: 'الجهة', icon: 'contacts', hidden: true, translated: true },
    ],
  },
  {
    // Musa's Documents app rewritten in our stack (2026-10-29,
    // dev/erp-pilot/DOCUMENTS.md): the company's documents and those of its
    // employees and suppliers (fixed assets wait for their module). His three
    // permissions on our levels: view reads the ordinary ones (documents.view),
    // work uploads, confirms, renews, archives and sets the types
    // (documents.manage), manage also holds confidential documents and
    // employees' papers (documents.confidential).
    key: 'documents', label: 'Documents', ar: 'المستندات', icon: 'folder', base: '/documents', adminOnly: true,
    blurb: 'Registers, certificates, licences, insurance and agreements of the company, its employees and suppliers, with expiry alerts.',
    blurbAr: 'السجلات والشهادات والتراخيص والتأمين والاتفاقيات للشركة وموظفيها وموردينها، مع تنبيهات الانتهاء.',
    pages: [
      { to: '/documents', label: 'Documents', ar: 'المستندات', icon: 'folder', exact: true, translated: true },
      { to: '/documents/types', label: 'Document types', ar: 'أنواع المستندات', icon: 'gear', min: 'work', translated: true },
      // Reached from the lists, not the menu.
      { to: '/documents/new', label: 'Upload document', ar: 'رفع مستند', icon: 'folder', hidden: true, min: 'work', translated: true },
      { to: '/documents/document', label: 'Document', ar: 'المستند', icon: 'folder', hidden: true, translated: true },
      { to: '/documents/review', label: 'Check the data', ar: 'مراجعة البيانات', icon: 'folder', hidden: true, min: 'work', translated: true },
    ],
  },
  {
    key: 'admin', label: 'Admin', ar: 'الإدارة', icon: 'users', base: '/admin', adminOnly: true,
    blurb: 'Who can sign in, and which sections each person gets.',
    blurbAr: 'من يمكنه الدخول، وأي الأقسام يحصل عليها كل شخص.',
    pages: [
      { to: '/admin/team', label: 'Team & Access', ar: 'الفريق والصلاحيات', icon: 'users', badge: 'pendingAccess', translated: true },
      { to: '/admin/sections', label: 'Section access', ar: 'صلاحيات الأقسام', icon: 'grid', translated: true },
    ],
  },
]

/**
 * Sections PARKED until Musa's ERP is connected (2026-10-25, lib/erp.js):
 * Technical and Finance read Odoo's projects and accounts, which the ERP will
 * own. Kept whole so they can be reused or removed later; nothing reads them
 * (not the rail, not Home, not Section access) and App.jsx sends their URLs
 * to Home. To bring one back, move it into SECTIONS.
 * @type {Section[]}
 */
export const PARKED_SECTIONS = [
  {
    // Odoo Project manages the projects; this watches them (2026-10-19):
    // the nine stages, late stages, submittal rounds and codes, the PM's
    // weekly update. A PM sees the projects they manage in Odoo; manage
    // sees every project and sets the stage limits.
    key: 'technical', label: 'Technical', ar: 'الفني', icon: 'hardhat', base: '/technical', adminOnly: true,
    blurb: 'Projects through their nine stages: what is late, submittals with the client, weekly updates.',
    blurbAr: 'المشاريع عبر مراحلها التسع: المتأخر منها، والتقديمات لدى العميل، والتحديثات الأسبوعية.',
    pages: [
      { to: '/technical', label: 'Projects', ar: 'المشاريع', icon: 'hardhat', exact: true, translated: true, badge: 'redProjects' },
      { to: '/technical/submittals', label: 'Submittals', ar: 'التقديمات', icon: 'file-check', translated: true },
      { to: '/technical/project', label: 'Project', ar: 'المشروع', icon: 'hardhat', hidden: true, translated: true },
      { to: '/technical/settings', label: 'Stage limits', ar: 'حدود المراحل', icon: 'gear', min: 'manage', translated: true },
    ],
  },
  {
    // Read only, from Odoo Accounting through the mirror (2026-10-19).
    key: 'finance', label: 'Finance', ar: 'المالية', icon: 'coins', base: '/finance', adminOnly: true,
    blurb: 'Invoices and collections, what is overdue, and each project\'s margin against plan.',
    blurbAr: 'الفواتير والتحصيل، والمتأخر منها، وهامش كل مشروع مقابل المخطط.',
    pages: [
      { to: '/finance', label: 'Invoices & collections', ar: 'الفواتير والتحصيل', icon: 'coins', exact: true, translated: true },
      { to: '/finance/projects', label: 'Project margins', ar: 'هوامش المشاريع', icon: 'bars', translated: true },
    ],
  },
]

/** The parked sections' keys. */
export const PARKED = new Set(PARKED_SECTIONS.map(s => s.key))

/**
 * Present in every section: the rail's foot. Not a section, so they never
 * light a section in the rail and never appear on Home as a tile.
 */
export const GLOBAL_PAGES = [
  { to: '/tasks', label: 'Tasks', ar: 'المهام', icon: 'check-circle', badge: 'openTasks', translated: true },
  { to: '/agent', label: 'Assistant', ar: 'المساعد', icon: 'chat', translated: true },
  { to: '/requests', label: 'Requests', ar: 'الطلبات', icon: 'check-square', badge: 'waitingRequests', translated: true },
  { to: '/settings', label: 'Settings', ar: 'الإعدادات', icon: 'gear', translated: true },
]

export const HOME = { to: '/', label: 'Home', ar: 'الرئيسية', icon: 'home', translated: true }

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

// ── Who may open what (v2 step 2, 2026-10-19) ──
// `who` = { isAccessAdmin, sections }. `sections` is this person's grants in
// the open company from public.section_access ({ sales: 'work', … }), or
// null when that table does not exist (production before v2 ships): then
// v1's rule applies, admin sections for the admin and the rest for members.
// The database enforces the same grants (has_section(), migration
// 20261101_section_access); this only decides what to draw.

export const LEVELS = ['view', 'work', 'manage']
const RANK = { view: 1, work: 2, manage: 3 }

/** Is `level` at least `min`? A missing level is below everything. */
export const atLeast = (level, min = 'view') => (RANK[level] || 0) >= (RANK[min] || 1)

/** This person's level in a section: 'view' | 'work' | 'manage' | null. */
export function sectionLevel(key, { isAccessAdmin = false, sections = null } = {}) {
  if (isAccessAdmin) return 'manage'
  const s = SECTIONS.find(x => x.key === key)
  // The Admin section (sign-ins, companies, these grants) is never granted.
  if (!s || key === 'admin') return null
  if (sections) return sections[key] || null
  return s.adminOnly ? null : 'work'
}

/**
 * Can this person open this section or page? A page asks for its section
 * at the page's own `min` level (view unless it says otherwise). Home and
 * the global pages belong to no section and are open to everyone.
 */
export function canOpen(item, who = {}) {
  const key = item?.pages ? item.key : sectionOf(item?.to)?.key
  if (!key) return true
  return atLeast(sectionLevel(key, who), item?.min || 'view')
}

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

/** The page a path is on: the longest page URL that contains it, or null. */
export function pageAt(pathname) {
  const p = String(pathname || '')
  if (p === '/') return HOME
  let best = null
  for (const pg of ALL_PAGES) {
    if (pg.to === '/') continue
    if (underPrefix(p, pg.to) && (!best || pg.to.length > best.to.length)) best = pg
  }
  return best
}

/**
 * The top bar's title: the page whose URL is the longest match for this
 * path. /marketing/social/instagram is "Social Media" unless it has its own
 * entry; a planner under /marketing/campaigns/plan is "Content Planning".
 */
export function pageTitle(pathname, lang = 'en') {
  const pg = pageAt(pathname)
  return (lang === 'ar' && pg?.ar) || pg?.label || ''
}

/**
 * Is this page translated into Arabic (lib/i18n.js)? An untranslated page
 * keeps English, left to right, inside the Arabic shell.
 */
export function isTranslated(pathname) {
  return Boolean(pageAt(pathname)?.translated)
}

/**
 * May this person be on this path? The page's section at the page's level;
 * a path inside a section that names no page asks for the section. Home,
 * the global pages and unknown paths are not refused here.
 */
export function canVisit(pathname, who = {}) {
  const section = sectionOf(pathname)
  if (!section) return true
  return canOpen(pageAt(pathname) || section, who)
}

/**
 * The sales team's own app (pages/leads/SalesApp.jsx) is a one-section app
 * already and keeps v1's /leads address: links in the lead agent's emails
 * point there, and for them it is the whole app. Only the marketing shell
 * redirects /leads.
 */
export const SALES_APP_PATH = '/leads'
