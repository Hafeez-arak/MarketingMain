import { describe, it, expect } from 'vitest'
import {
  rag, deadlines, routeLead, leadsToRoute, controlKpis, controlDecisions, repRows, keyAccounts,
  topOpportunities, weeklyLines, dailyAlertItems, dailyAlertEmail, weeklyEmail, marketingNumbers, MAX_DECISIONS,
} from './panel.js'
import { regionOf, leadRegion } from './region.js'

const NOW = new Date('2026-10-18T09:00:00Z')
const hAgo = h => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const lead = (over = {}) => ({ id: over.id || Math.random().toString(36).slice(2), verdict: 'qualified', received_at: hAgo(2), company: 'Nour Contracting', ...over })
const TEAM = [{ id: 'u-ammar', name: 'Ammar' }, { id: 'u-haitham', name: 'Haitham' }]

describe('rag', () => {
  it('is grey with no target or no value, never green by default', () => {
    expect(rag(5, null)).toBe('none')
    expect(rag(null, 10)).toBe('none')
  })
  it('colours higher-is-better with an amber band', () => {
    expect(rag(100, 100)).toBe('good')
    expect(rag(92, 100, { amberPct: 10 })).toBe('watch')
    expect(rag(80, 100, { amberPct: 10 })).toBe('bad')
  })
  it('colours lower-is-better, and a zero target allows one before red', () => {
    expect(rag(3, 4, { better: 'lower' })).toBe('good')
    expect(rag(4.3, 4, { better: 'lower', amberPct: 10 })).toBe('watch')
    expect(rag(6, 4, { better: 'lower', amberPct: 10 })).toBe('bad')
    expect(rag(0, 0, { better: 'lower' })).toBe('good')
    expect(rag(1, 0, { better: 'lower' })).toBe('watch')
    expect(rag(2, 0, { better: 'lower' })).toBe('bad')
  })
})

describe('deadlines', () => {
  it('counts both clocks from arrival and stops when done', () => {
    const d = deadlines(lead({ received_at: hAgo(5) }), undefined, NOW)
    expect(d.reply.late).toBe(true)
    expect(d.quote.late).toBe(false)
    expect(deadlines(lead({ received_at: hAgo(5), first_reply_at: hAgo(4) }), undefined, NOW).reply.late).toBe(false)
    expect(deadlines(lead({ received_at: hAgo(80) }), undefined, NOW).quote.late).toBe(true)
  })
})

describe('region', () => {
  it('reads English and Arabic, first place named wins', () => {
    expect(regionOf('Riyadh, KSA')).toBe('central')
    expect(regionOf('جدة')).toBe('western')
    expect(regionOf('مشروع في الخبر')).toBe('eastern')
    expect(regionOf('Jeddah project, office in Riyadh')).toBe('western')
    expect(regionOf('')).toBe('')
    expect(leadRegion({ details: { location: '' }, subject: 'RFQ – Dammam hospital' })).toBe('eastern')
  })
})

describe('routing', () => {
  const rules = [
    { id: 'r2', position: 2, sender_type: '', region: '', project_type: 'tender', assign_to: 'u-haitham' },
    { id: 'r1', position: 1, sender_type: 'contractor', region: 'western', project_type: '', assign_to: 'u-ammar' },
  ]
  it('takes the first matching rule by position, blanks match anything', () => {
    expect(routeLead({ sender_type: 'contractor', details: { location: 'Jeddah' } }, rules)).toMatchObject({ to: 'u-ammar', ruleId: 'r1' })
    expect(routeLead({ sender_type: 'consultant', project_final: 'tender' }, rules)).toMatchObject({ to: 'u-haitham', ruleId: 'r2' })
  })
  it('falls back, else gives nobody', () => {
    expect(routeLead({ sender_type: 'owner' }, rules, 'u-fallback')).toMatchObject({ to: 'u-fallback', ruleId: null })
    expect(routeLead({ sender_type: 'owner' }, rules)).toBeNull()
  })
  it('routes only new unowned qualified leads, and only when switched on', () => {
    const leads = [
      lead({ id: 'old', received_at: hAgo(48) }),
      lead({ id: 'new', received_at: hAgo(1) }),
      lead({ id: 'owned', received_at: hAgo(1), assigned_to: 'u-ammar' }),
      lead({ id: 'dup', received_at: hAgo(1), duplicate_of: 'new' }),
      lead({ id: 'junk', received_at: hAgo(1), verdict: 'unqualified' }),
    ]
    expect(leadsToRoute(leads, { routing_enabled: false })).toEqual([])
    expect(leadsToRoute(leads, { routing_enabled: true, routing_since: hAgo(24) }).map(l => l.id)).toEqual(['new'])
  })
})

describe('controlKpis', () => {
  it('has six tiles, and Odoo-only ones wait instead of showing zero', () => {
    const tiles = controlKpis({ leads: [], now: NOW })
    expect(tiles.map(t => t.key)).toEqual(['pipeline', 'response', 'revenue', 'unowned', 'projects', 'invoices'])
    for (const k of ['pipeline', 'revenue', 'projects', 'invoices']) {
      const tile = tiles.find(t => t.key === k)
      expect(tile.tone).toBe('waiting')
      expect(tile.value.en).toBe('—')
    }
  })
  it('counts unowned leads in the last 30 days and names the older ones', () => {
    const leads = [lead(), lead(), lead({ received_at: hAgo(24 * 40) }), lead({ assigned_to: 'u-ammar' })]
    const tile = controlKpis({ leads, now: NOW }).find(t => t.key === 'unowned')
    expect(tile.value.en).toBe('2')
    expect(tile.sub.en).toContain('1 older')
    expect(tile.tone).toBe('bad')
  })
  it('gives the median first reply against the target', () => {
    const leads = [
      lead({ received_at: hAgo(10), first_reply_at: hAgo(8), assigned_to: 'u-ammar' }),
      lead({ received_at: hAgo(10), first_reply_at: hAgo(7), assigned_to: 'u-ammar' }),
    ]
    const tile = controlKpis({ leads, now: NOW, targets: { first_reply_hours: 4 } }).find(t => t.key === 'response')
    expect(tile.value.en).toBe('2.5 h')
    expect(tile.tone).toBe('good')
  })
  it('uses Odoo numbers when the sync provides them', () => {
    const tiles = controlKpis({ leads: [], odoo: { revenue_month_sar: 900_000, pipeline_sar: 5e6, pipeline_deals: 12 }, targets: { revenue_month_sar: 1e6 }, now: NOW })
    expect(tiles.find(t => t.key === 'revenue')).toMatchObject({ source: 'odoo', tone: 'watch' })
    expect(tiles.find(t => t.key === 'pipeline').value.en).toBe('SAR 5M')
  })
})

describe('controlDecisions', () => {
  it('shows at most three, one of each kind before a second of any', () => {
    const leads = [
      lead({ id: 'q1', received_at: hAgo(100), assigned_to: 'u-ammar' }),
      lead({ id: 'q2', received_at: hAgo(90), assigned_to: 'u-haitham' }),
      lead({ id: 'o1', received_at: hAgo(10) }),
      lead({ id: 'o2', received_at: hAgo(9) }),
    ]
    const accounts = [{ id: 'a1', name: 'Big Client', value_sar: 9e6, last_contact_at: hAgo(24 * 45) }]
    const out = controlDecisions({ leads, accounts, team: TEAM, now: NOW })
    expect(out).toHaveLength(MAX_DECISIONS)
    expect(out.map(d => d.kind)).toEqual(['late_quote', 'unassigned', 'account_quiet'])
    expect(out[0]).toMatchObject({ owner: 'Ammar', action: { type: 'remind', leadId: 'q1', userId: 'u-ammar' } })
    expect(out[1].action).toMatchObject({ type: 'assign', leadId: 'o1' })
  })
  it('suggests the routing rule\'s person on an unowned lead', () => {
    const out = controlDecisions({ leads: [lead({ sender_type: 'contractor' })], rules: [{ sender_type: 'contractor', assign_to: 'u-ammar' }], now: NOW })
    expect(out[0].action.suggested).toBe('u-ammar')
  })
  it('is empty when nothing needs him', () => {
    expect(controlDecisions({ leads: [lead({ assigned_to: 'u-ammar', first_reply_at: hAgo(1) })], now: NOW })).toEqual([])
  })
})

describe('repRows', () => {
  it('counts open, quotes this month and late per person; won value waits for stages', () => {
    const leads = [
      lead({ assigned_to: 'u-ammar', received_at: hAgo(100) }),
      lead({ assigned_to: 'u-ammar', received_at: hAgo(3), quote_sent_at: hAgo(1) }),
      lead({ assigned_to: 'u-haitham', received_at: hAgo(1) }),
    ]
    const rows = repRows({ leads, team: TEAM, now: NOW })
    expect(rows[0]).toMatchObject({ name: 'Ammar', open: 2, quotes: 1, late: 1, wonValue: null, tone: 'bad' })
    expect(rows[1]).toMatchObject({ name: 'Haitham', open: 1, late: 0 })
  })
  it('adds won value this month once leads carry stages', () => {
    const leads = [lead({ assigned_to: 'u-ammar', stage: 'won', stage_at: hAgo(5), deal_value_sar: 250_000 })]
    expect(repRows({ leads, team: TEAM, now: NOW })[0].wonValue).toBe(250_000)
  })
})

describe('keyAccounts', () => {
  it('keeps the ten biggest, red after 30 quiet days, amber when never recorded', () => {
    const accounts = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, name: `A${i}`, value_sar: i * 1000, last_contact_at: hAgo(24 * 5) }))
    accounts[11].last_contact_at = hAgo(24 * 31)
    accounts[10].last_contact_at = null
    accounts[9].status = 'parked'
    const out = keyAccounts(accounts, null, NOW)
    expect(out).toHaveLength(10)
    expect(out.map(a => a.id)).not.toContain('a9')
    expect(out[0]).toMatchObject({ id: 'a11', tone: 'bad', quietDays: 31 })
    expect(out[1]).toMatchObject({ id: 'a10', tone: 'watch', quietDays: null })
    expect(out[2].tone).toBe('good')
  })
})

describe('topOpportunities', () => {
  it('takes this week\'s unsent ones, high relevance and bigger share first, five at most', () => {
    const opps = Array.from({ length: 8 }, (_, i) => ({ id: `o${i}`, first_seen_at: hAgo(24), relevance: i === 7 ? 'high' : 'medium', package_value_sar: i * 10 }))
    opps.push({ id: 'old', first_seen_at: hAgo(24 * 10), relevance: 'high' }, { id: 'sent', first_seen_at: hAgo(1), relevance: 'high', sent_at: hAgo(1) })
    const out = topOpportunities(opps, NOW)
    expect(out).toHaveLength(5)
    expect(out[0].id).toBe('o7')
    expect(out.map(o => o.id)).not.toContain('old')
    expect(out.map(o => o.id)).not.toContain('sent')
  })
})

describe('weeklyLines and emails', () => {
  it('is five lines, says plainly when win rate cannot be measured', () => {
    const lines = weeklyLines({ brief: { found: [{ tone: 'good', text: { en: 'Leads up.', ar: 'زادت.' } }] }, now: NOW })
    expect(lines).toHaveLength(5)
    expect(lines[0].en).toBe('Improved: Leads up.')
    expect(lines[3].en).toMatch(/not measurable yet/)
    const mail = weeklyEmail(lines, { company: 'Arak', pageUrl: 'https://x/ceo' })
    expect(mail.html).toContain('dir="rtl"')
    expect(mail.text.indexOf('تحسّن')).toBeLessThan(mail.text.indexOf('Improved'))
  })
  it('counts win rate from stages and quotes from the last seven days', () => {
    const leads = [
      lead({ stage: 'won', stage_at: hAgo(24) }), lead({ stage: 'lost', stage_at: hAgo(24) }),
      lead({ quote_sent_at: hAgo(24) }), lead({ quote_sent_at: hAgo(24 * 9) }),
    ]
    const lines = weeklyLines({ leads, targets: { quotes_week: 5 }, now: NOW })
    expect(lines[3].en).toContain('50%')
    expect(lines[4].en).toBe('Quotes sent this week: 1 (target 5).')
  })
})

describe('daily alert', () => {
  it('lists each lateness once, then nothing new', () => {
    const l = lead({ id: 'x', received_at: hAgo(80), assigned_to: 'u-ammar' })
    const items = dailyAlertItems({ leads: [l, lead({ id: 'y' })], team: TEAM, now: NOW })
    expect(items.map(i => i.kind).sort()).toEqual(['late_quote', 'unassigned'])
    expect(dailyAlertItems({ leads: [{ ...l, late_alerted: { late_quote: hAgo(24) } }], team: TEAM, now: NOW })).toEqual([])
    expect(dailyAlertEmail([])).toBeNull()
    const mail = dailyAlertEmail(items, { company: 'Arak' })
    expect(mail.subject).toContain('2 items')
    expect(mail.html).toContain('Late quotes')
  })
})

describe('marketingNumbers', () => {
  it('shows posts against plan and does not fake social leads', () => {
    const [posts, web, li] = marketingNumbers({ planned: 12, published: 3, websiteLeads: 4, linkedinFollowers: 4900 })
    expect(posts.value.en).toBe('3 / 12')
    expect(posts.tone).toBe('bad')
    expect(web.sub.en).toMatch(/not tracked/)
    expect(li.value.en).toBe('4,900')
  })
})

describe('with Odoo\'s numbers (v2 mirror)', () => {
  it('the revenue tile says invoiced or confirmed orders', () => {
    const inv = controlKpis({ odoo: { revenue_month_sar: 1e6, revenue_basis: 'invoiced' }, now: NOW }).find(t => t.key === 'revenue')
    expect(inv.sub.en).toMatch(/^Invoiced/)
    const ord = controlKpis({ odoo: { revenue_month_sar: 1e6, revenue_basis: 'orders' }, now: NOW }).find(t => t.key === 'revenue')
    expect(ord.sub.en).toMatch(/^Confirmed orders/)
  })
  it('the weekly lines take quotes and win rate from Odoo', () => {
    const lines = weeklyLines({ odoo: { quotes_week: 4, won: 3, decided: 4 }, targets: { quotes_week: 6 }, now: NOW })
    expect(lines[3].en).toContain('75% (3 of 4')
    expect(lines[4].en).toBe('Quotes sent this week: 4 (target 6).')
  })
  it('the daily alert lists what to fix in Odoo', () => {
    const items = dailyAlertItems({ odoo: { missing: [{ kind: 'deal_no_owner', name: 'Hotel lobby' }, { kind: 'project_no_date', name: 'Tower' }] }, now: NOW })
    expect(items.map(i => i.en)).toEqual(['1 deal with no salesperson: Hotel lobby', '1 project with no delivery date: Tower'])
  })
})

describe('projects on the CEO panel (v2)', () => {
  const flags = [
    { odoo_project_id: 402, name: 'Tower phase 1', level: 'red', red_since: hAgo(50), reasons: [{ kind: 'stage_late', level: 'red', days: 6, stage: 'client_review', planned: '2026-10-12' }] },
    { odoo_project_id: 404, name: 'Hotel lobby', level: 'red', red_since: hAgo(10), reasons: [{ kind: 'off_track', level: 'red' }] },
    { odoo_project_id: 401, name: 'Clinic', level: 'amber', red_since: null, reasons: [] },
  ]
  const managers = [{ odoo_project_id: 402, user_id: 'u-khalid', name: 'Khalid PM' }, { odoo_project_id: 404, user_id: null, name: 'Nadia (no login)' }]

  it('a red project is a decision with its project manager and a Remind button, longest red first', () => {
    const d = controlDecisions({ projectFlags: flags, projectManagers: managers, now: NOW })
    expect(d.map(x => x.key)).toEqual(['project:402', 'project:404'])
    expect(d[0]).toMatchObject({ kind: 'project_red', owner: 'Khalid PM', action: { type: 'remind_project', projectId: 402, userId: 'u-khalid' } })
    expect(d[0].why.en).toBe('6 days past the planned date in Client review')
    expect(d[0].why.ar).toContain('مراجعة العميل')
    // A manager with no login: the button is there but has nobody to remind.
    expect(d[1].action.userId).toBeNull()
  })

  it('reps take quotes and won value from Odoo when their email is an Odoo user', () => {
    const team = [{ id: 'u-omar', name: 'Omar', email: 'Omar@Example.com' }, { id: 'u-new', name: 'New', email: 'new@example.com' }]
    const leads = [lead({ assigned_to: 'u-new', quote_sent_at: hAgo(3) })]
    const odoo = { byUser: { 'omar@example.com': { wonMonth: 1, wonValueMonth: 380000, quotesMonth: 2 } } }
    const rows = repRows({ leads, team, odoo, now: NOW })
    expect(rows.find(r => r.id === 'u-omar')).toMatchObject({ quotes: 2, wonValue: 380000, source: 'odoo' })
    // Not in Odoo: Campai's own marks, not a made-up zero.
    expect(rows.find(r => r.id === 'u-new')).toMatchObject({ quotes: 1, source: 'campai' })
  })
})
