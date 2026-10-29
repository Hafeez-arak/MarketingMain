import { describe, it, expect } from 'vitest'
import {
  SECTIONS, GLOBAL_PAGES, LEGACY, fromLegacy, toLegacy, sectionsFor, sectionOf, pageTitle, ALL_PAGES, menuPages, sectionLevel, canOpen, atLeast, canVisit,
} from './modules.js'

describe('the section registry', () => {
  it('every page URL starts with its section, and no URL is listed twice', () => {
    for (const s of SECTIONS) for (const pg of s.pages) expect(pg.to === s.base || pg.to.startsWith(`${s.base}/`)).toBe(true)
    const all = ALL_PAGES.map(p => p.to)
    expect(new Set(all).size).toBe(all.length)
  })

  it('every v1 address lands on a page that exists', () => {
    const known = ALL_PAGES.map(p => p.to)
    for (const now of Object.values(LEGACY)) expect(known.some(k => now === k || now.startsWith(`${k}/`) || k.startsWith(`${now}`))).toBe(true)
  })

  it('global pages belong to no section', () => {
    for (const g of GLOBAL_PAGES) expect(sectionOf(g.to)).toBeNull()
  })
})

describe('old addresses', () => {
  it('keeps the tail of the path', () => {
    expect(fromLegacy('/leads')).toBe('/sales/leads')
    expect(fromLegacy('/campaigns/plan')).toBe('/marketing/campaigns/plan')
    expect(fromLegacy('/social/approvals')).toBe('/marketing/social/approvals')
    expect(fromLegacy('/analytics/report')).toBe('/insights/analytics/report')
  })
  it('matches whole segments only, and leaves new paths alone', () => {
    expect(fromLegacy('/socialite')).toBeNull()
    expect(fromLegacy('/sales/leads')).toBeNull()
    expect(fromLegacy('/insights')).toBeNull()
    expect(fromLegacy('/ceo')).toBeNull()
    expect(fromLegacy('/')).toBeNull()
  })
  it('turns back into v1 routes for the assistant', () => {
    expect(toLegacy('/marketing/campaigns/plan')).toBe('/campaigns/plan')
    expect(toLegacy('/marketing/social/instagram')).toBe('/social/instagram')
    expect(toLegacy('/insights/analytics')).toBe('/analytics')
    expect(toLegacy('/insights')).toBe('/insights')
    expect(toLegacy('/marketing')).toBe('/dashboard')
    for (const old of Object.keys(LEGACY)) expect(toLegacy(fromLegacy(old))).toBe(old)
  })
})

describe('who sees what', () => {
  it('an admin gets every section; a member gets Marketing and Insights', () => {
    expect(sectionsFor({ isAccessAdmin: true }).map(s => s.key)).toEqual(['ceo', 'sales', 'crm', 'marketing', 'insights', 'hr', 'contacts', 'documents', 'admin'])
    expect(sectionsFor({ isAccessAdmin: false }).map(s => s.key)).toEqual(['marketing', 'insights'])
  })
})

describe('where am I', () => {
  it('finds the section from the path', () => {
    expect(sectionOf('/marketing/social/instagram').key).toBe('marketing')
    expect(sectionOf('/sales/leads').key).toBe('sales')
    expect(sectionOf('/insights/report').key).toBe('insights')
    expect(sectionOf('/')).toBeNull()
    expect(sectionOf('/requests')).toBeNull()
    expect(sectionOf('/salesforce')).toBeNull()
  })
  it('titles the page by its longest match', () => {
    expect(pageTitle('/')).toBe('Home')
    expect(pageTitle('/marketing')).toBe('Dashboard')
    expect(pageTitle('/marketing/social/approvals')).toBe('Post Queue')
    expect(pageTitle('/marketing/social/linkedin')).toBe('Social Media')
    expect(pageTitle('/marketing/campaigns/plan')).toBe('Content Planning')
    expect(pageTitle('/insights/analytics/report')).toBe('Performance Report')
    expect(pageTitle('/nowhere')).toBe('')
  })
})

describe('the section menu', () => {
  it('lists a section\'s visible pages, and nothing for Home, global pages or one-page sections', () => {
    expect(menuPages('/marketing/schedule').map(p => p.label)).toContain('Schedule')
    expect(menuPages('/insights/report').map(p => p.to)).toEqual(['/insights', '/insights/analytics'])
    expect(menuPages('/')).toEqual([])
    expect(menuPages('/requests')).toEqual([])
    expect(menuPages('/ceo', { isAccessAdmin: true })).toEqual([])
  })
})

describe('section access (v2 step 2)', () => {
  const grants = { sales: 'work', insights: 'view' }
  it('uses the person\'s grants when the table exists', () => {
    expect(sectionsFor({ sections: grants }).map(s => s.key)).toEqual(['sales', 'insights'])
    expect(sectionLevel('sales', { sections: grants })).toBe('work')
    expect(sectionLevel('marketing', { sections: grants })).toBeNull()
    expect(sectionsFor({ sections: {} })).toEqual([])
  })
  it('falls back to v1 roles when there are no grants to read', () => {
    expect(sectionLevel('marketing', {})).toBe('work')
    expect(sectionLevel('sales', {})).toBeNull()
  })
  it('the admin has every section at manage; Admin is never granted', () => {
    expect(sectionLevel('ceo', { isAccessAdmin: true })).toBe('manage')
    expect(sectionLevel('admin', { isAccessAdmin: true })).toBe('manage')
    expect(sectionLevel('admin', { sections: { admin: 'manage' } })).toBeNull()
  })
  it('a page can ask for more than view', () => {
    const brief = { to: '/sales/agent-brief', min: 'manage' }
    expect(canOpen(brief, { sections: { sales: 'work' } })).toBe(false)
    expect(canOpen(brief, { sections: { sales: 'manage' } })).toBe(true)
    expect(canOpen({ to: '/sales/leads' }, { sections: { sales: 'view' } })).toBe(true)
    expect(canOpen({ to: '/requests' }, { sections: {} })).toBe(true)
    expect(sectionsFor({ sections: { sales: 'work' } })[0].pages.map(p => p.label)).toEqual(['Leads', 'Target accounts'])
  })
  it('orders levels', () => {
    expect(atLeast('manage', 'work')).toBe(true)
    expect(atLeast('view', 'work')).toBe(false)
    expect(atLeast(null)).toBe(false)
  })
})

describe('canVisit', () => {
  it('checks the page\'s section and level by path', () => {
    const who = { sections: { sales: 'work', marketing: 'view' } }
    expect(canVisit('/sales/leads', who)).toBe(true)
    expect(canVisit('/sales/agent-brief', who)).toBe(false)
    expect(canVisit('/marketing/social/instagram', who)).toBe(true)
    expect(canVisit('/insights/analytics', who)).toBe(false)
    expect(canVisit('/ceo', who)).toBe(false)
    expect(canVisit('/', who)).toBe(true)
    expect(canVisit('/requests', who)).toBe(true)
    expect(canVisit('/admin/team', who)).toBe(false)
    expect(canVisit('/admin/team', { isAccessAdmin: true })).toBe(true)
  })
})

describe('parked until Musa\'s ERP (2026-10-25)', () => {
  it('Technical and Finance are parked, not offered anywhere', async () => {
    const { PARKED, PARKED_SECTIONS } = await import('./modules.js')
    const { GRANTABLE } = await import('./sectionAccess.js')
    expect([...PARKED].sort()).toEqual(['finance', 'technical'])
    expect(PARKED_SECTIONS.every(s => s.pages.length)).toBe(true)
    expect(SECTIONS.some(s => PARKED.has(s.key))).toBe(false)
    expect(GRANTABLE.some(k => PARKED.has(k))).toBe(false)
  })
})

describe('HR (2026-10-28)', () => {
  it('is granted per person, and its pages ask for the right level', async () => {
    const { GRANTABLE } = await import('./sectionAccess.js')
    expect(GRANTABLE).toContain('hr')
    const view = { sections: { hr: 'view' } }
    expect(canVisit('/hr', view)).toBe(true)
    expect(canVisit('/hr/employee', view)).toBe(true)
    expect(canVisit('/hr/documents', view)).toBe(false)
    // His hr.manage papers and hr.contracts are Manage here; Work is his hr.attendance.
    expect(canVisit('/hr/documents', { sections: { hr: 'work' } })).toBe(false)
    expect(canVisit('/hr/documents', { sections: { hr: 'manage' } })).toBe(true)
    expect(canVisit('/hr/contracts', { sections: { hr: 'work' } })).toBe(false)
    expect(canVisit('/hr/contracts', { sections: { hr: 'manage' } })).toBe(true)
    expect(canVisit('/hr/contract', { sections: { hr: 'manage' } })).toBe(true)
    expect(canVisit('/hr/settings', { sections: { hr: 'work' } })).toBe(false)
    expect(canVisit('/hr/settings', { sections: { hr: 'manage' } })).toBe(true)
    expect(canVisit('/hr', { sections: { sales: 'manage' } })).toBe(false)
    expect(pageTitle('/hr/leave', 'ar')).toBe('الإجازات')
  })
})

describe('CRM (2026-10-28)', () => {
  it('is its own section, granted per person, its pages at the right level', async () => {
    const { GRANTABLE } = await import('./sectionAccess.js')
    expect(GRANTABLE).toContain('crm')
    const view = { sections: { crm: 'view' } }
    for (const p of ['/crm', '/crm/mine', '/crm/list', '/crm/activities', '/crm/analysis', '/crm/settings', '/crm/lead']) expect(canVisit(p, view)).toBe(true)
    expect(canVisit('/crm/new', view)).toBe(false)
    expect(canVisit('/crm/edit', view)).toBe(false)
    expect(canVisit('/crm/new', { sections: { crm: 'work' } })).toBe(true)
    // Sales' own pipeline does not open the CRM, and the reverse.
    expect(canVisit('/crm', { sections: { sales: 'manage' } })).toBe(false)
    expect(canVisit('/sales/leads', view)).toBe(false)
    expect(pageTitle('/crm/activities', 'ar')).toBe('الأنشطة المخططة')
    expect(pageTitle('/crm/lead', 'en')).toBe('Opportunity')
  })

})

describe('Documents (2026-10-29)', () => {
  it('view reads, work uploads and sets the types, nothing is open without the grant', async () => {
    const { GRANTABLE } = await import('./sectionAccess.js')
    expect(GRANTABLE).toContain('documents')
    const view = { sections: { documents: 'view' } }
    for (const p of ['/documents', '/documents/document']) expect(canVisit(p, view)).toBe(true)
    for (const p of ['/documents/types', '/documents/new', '/documents/review']) expect(canVisit(p, view)).toBe(false)
    for (const p of ['/documents/types', '/documents/new', '/documents/review']) expect(canVisit(p, { sections: { documents: 'work' } })).toBe(true)
    expect(canVisit('/documents', { sections: { hr: 'manage' } })).toBe(false)
    expect(pageTitle('/documents/types', 'ar')).toBe('أنواع المستندات')
    expect(pageTitle('/documents/document', 'en')).toBe('Document')
  })
})
