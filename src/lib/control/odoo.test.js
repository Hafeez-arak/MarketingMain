import { describe, it, expect } from 'vitest'
import { odooFacts, dealState, odooTime, withOdoo, looseName } from './odoo.js'

// Made-up Odoo records in Odoo 18's own shapes. 10:00 Riyadh, 19 Oct 2026.
const NOW = new Date('2026-10-19T07:00:00Z')
const ALL = ['crm.stage', 'crm.lead', 'sale.order', 'account.move', 'project.project']
const stages = [{ id: 1, name: 'New', is_won: false }, { id: 4, name: 'Won', is_won: true }]
const deal = (o) => ({ id: o.id, name: o.name || `Deal ${o.id}`, type: 'opportunity', active: true, probability: 30, expected_revenue: 100000, stage_id: [1, 'New'], user_id: [7, 'Omar'], partner_id: [50, 'Crescent Developments Co.'], write_date: '2026-10-10 08:00:00', ...o })

const records = {
  'crm.stage': stages,
  'crm.lead': [
    deal({ id: 1, expected_revenue: 400000 }),
    deal({ id: 2, expected_revenue: 0, user_id: false }),
    deal({ id: 3, stage_id: [4, 'Won'], date_closed: '2026-10-01 10:00:00' }),
    deal({ id: 4, active: false, probability: 0, write_date: '2026-09-20 10:00:00' }),
    deal({ id: 5, active: false, probability: 0, write_date: '2026-01-01 10:00:00' }), // lost long ago
    { id: 6, name: 'A raw lead', type: 'lead', active: true, expected_revenue: 999999 },
  ],
  'sale.order': [
    { id: 10, state: 'sale', amount_untaxed: 250000, date_order: '2026-10-05 09:00:00', create_date: '2026-10-01 09:00:00', partner_id: [50, 'Crescent Developments Co.'] },
    { id: 11, state: 'sale', amount_untaxed: 90000, date_order: '2026-09-28 09:00:00', create_date: '2026-09-20 09:00:00', partner_id: [51, 'Palm Tower'] },
    { id: 12, state: 'sent', amount_untaxed: 120000, date_order: '2026-10-17 09:00:00', create_date: '2026-10-17 09:00:00', partner_id: [51, 'Palm Tower'] },
    { id: 13, state: 'cancel', amount_untaxed: 1, date_order: '2026-10-18 09:00:00', create_date: '2026-10-18 09:00:00', partner_id: false },
  ],
  'account.move': [
    { id: 20, move_type: 'out_invoice', state: 'posted', amount_untaxed: 200000, amount_residual: 0, payment_state: 'paid', invoice_date: '2026-10-06', invoice_date_due: '2026-11-05' },
    { id: 21, move_type: 'out_refund', state: 'posted', amount_untaxed: 20000, amount_residual: 0, payment_state: 'paid', invoice_date: '2026-10-08', invoice_date_due: '2026-10-08' },
    { id: 22, move_type: 'out_invoice', state: 'posted', amount_untaxed: 50000, amount_residual: 57500, payment_state: 'not_paid', invoice_date: '2026-07-01', invoice_date_due: '2026-07-31' },
    { id: 23, move_type: 'out_invoice', state: 'posted', amount_untaxed: 50000, amount_residual: 57500, payment_state: 'not_paid', invoice_date: '2026-09-01', invoice_date_due: '2026-10-01' },
    { id: 24, move_type: 'out_invoice', state: 'draft', amount_untaxed: 999999, amount_residual: 999999, payment_state: 'not_paid', invoice_date: '2026-10-10', invoice_date_due: '2026-01-01' },
  ],
  'project.project': [
    { id: 30, name: 'Tower lighting', active: true, last_update_status: 'at_risk', date: '2026-12-01' },
    { id: 31, name: 'Hospital', active: true, last_update_status: 'on_track', date: false },
    { id: 32, name: 'Old', active: false, last_update_status: 'off_track' },
  ],
}

describe('odooFacts', () => {
  const f = odooFacts(records, { now: NOW, models: ALL, url: 'https://odoo.example' })

  it('open pipeline = open opportunities only (not leads, won, lost)', () => {
    expect(f.pipeline_deals).toBe(2)
    expect(f.pipeline_sar).toBe(400000)
  })
  it('revenue this month = posted invoices less refunds when Accounting is installed', () => {
    expect(f.revenue_basis).toBe('invoiced')
    expect(f.revenue_month_sar).toBe(180000)
  })
  it('falls back to confirmed orders without Accounting', () => {
    const g = odooFacts(records, { now: NOW, models: ['crm.stage', 'crm.lead', 'sale.order'] })
    expect(g.revenue_basis).toBe('orders')
    expect(g.revenue_month_sar).toBe(250000)
    expect(g.overdue_invoices_sar).toBeNull()
    expect(g.projects_at_risk).toBeNull()
  })
  it('quotes this week, win rate over 90 days', () => {
    expect(f.quotes_week).toBe(1)
    expect([f.won, f.decided, f.win_rate_pct]).toEqual([1, 2, 50])
  })
  it('overdue = unpaid more than 60 days past due, posted only', () => {
    expect(f.overdue_invoices).toBe(1)
    expect(f.overdue_invoices_sar).toBe(57500)
  })
  it('projects at risk from Odoo\'s own status, active only', () => {
    expect([f.projects_at_risk, f.projects_open]).toEqual([1, 2])
  })
  it('lists what is missing in Odoo, with links', () => {
    expect(f.missing.map(m => [m.kind, m.id])).toEqual([['deal_no_owner', 2], ['deal_no_value', 2], ['project_no_date', 31]])
    expect(f.missing[0].url).toBe('https://odoo.example/web#id=2&model=crm.lead&view_type=form')
  })
  it('gives key accounts live numbers by customer name', () => {
    const a = withOdoo({ name: 'Crescent Developments', last_order: '2025-01-01', open_deals: 9, open_value_sar: 1 }, f)
    expect(a).toMatchObject({ odoo: true, last_order: '2026-10-05', open_deals: 2, open_value_sar: 400000 })
    expect(withOdoo({ name: 'Nobody Ltd' }, f).odoo).toBe(false)
  })
})

describe('helpers', () => {
  it('reads Odoo times as UTC', () => {
    expect(odooTime('2026-10-05 09:00:00')).toBe(Date.parse('2026-10-05T09:00:00Z'))
    expect(odooTime('2026-10-05')).toBe(Date.parse('2026-10-05T00:00:00Z'))
    expect(odooTime(false)).toBeNull()
  })
  it('a lost deal is archived at 0%; archived otherwise is not lost', () => {
    expect(dealState({ active: false, probability: 0 })).toBe('lost')
    expect(dealState({ active: false, probability: 40 })).toBe('archived')
    expect(dealState({ active: true, stage_id: [4, 'Won'] }, new Set([4]))).toBe('won')
  })
  it('compares company names loosely', () => {
    expect(looseName('Crescent Developments Co.')).toBe(looseName('crescent developments'))
  })
})
