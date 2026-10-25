import { describe, it, expect } from 'vitest'
import { financeFacts, plannedMargin, MARGIN_RED_POINTS, monthReadFrom } from './finance.js'
import { fakeOdooData } from '../../../dev/v2db/fakeOdoo.js'

// The fake Odoo's dates are relative to the moment it is built, so these
// run against "now" as well.
const records = fakeOdooData()
const models = Object.keys(records)
const f = financeFacts(records, { now: Date.now(), models, url: 'https://odoo.example' })
const by = Object.fromEntries(f.projects.map(p => [p.id, p]))

describe('invoices and collections', () => {
  it('counts only posted customer invoices; drafts are not owed yet', () => {
    expect(f.unpaid.map(u => u.name)).not.toContain('INV/2026/0400')
    expect(f.unpaidCount).toBe(4)
    expect(f.outstanding).toBe(437000 + 300000 + 1035000 + 138000)
  })
  it('overdue = unpaid more than 60 days past the due date (requirement 30)', () => {
    expect(f.unpaid.filter(u => u.overdue60).map(u => u.name).sort()).toEqual(['INV/2026/0122', 'INV/2026/0210'])
    expect(f.overdueCount).toBe(2)
    expect(f.overdueAmount).toBe(300000 + 138000)
    // 45 days past due is late, not yet "overdue" in his sense.
    expect(f.unpaid.find(u => u.name === 'INV/2026/0251')).toMatchObject({ daysPastDue: 45, overdue60: false, daysOutstanding: 75 })
  })
  it('ages the unpaid by days since the invoice, oldest first', () => {
    expect(f.unpaid[0].name).toBe('INV/2026/0122')
    const count = Object.fromEntries(f.aging.map(b => [b.key, b.count]))
    expect(count).toEqual({ '0_30': 1, '31_60': 0, '61_90': 1, '91_180': 1, '180_plus': 1 })
    expect(f.avgDaysOutstanding).toBeGreaterThan(60)
  })
  it('collected this month = posted customer payments dated this month', () => {
    // 350,750 three days ago counts (when the month is at least 4 days old);
    // the draft never does.
    const d = new Date(Date.now() + 3 * 3_600_000)
    if (d.getUTCDate() > 3) expect(f.collectedMonth).toBe(350750)
  })
  it('links to Odoo', () => {
    expect(f.unpaid[0].url).toBe('https://odoo.example/web#id=305&model=account.move&view_type=form')
  })
})

describe('per project', () => {
  it('% collected from the project\'s sales order\'s invoices, refunds taken off', () => {
    expect(by[402]).toMatchObject({ invoiced: 1380000, collected: 1080000, pctCollected: 78 })
    expect(by[403]).toMatchObject({ invoiced: 373750 - 23000, unpaid: 0, pctCollected: 100 })
    expect(by[401]).toMatchObject({ pctCollected: 0 })
  })
  it('finds the order from either side (the project\'s order, or the order\'s project)', () => {
    expect(by[404].order.name).toBe('S00205')
  })
  it('margin: planned from the order, actual from the analytic account; red when more than 5 points under', () => {
    expect(by[401]).toMatchObject({ plannedMargin: 28, actualMargin: 28.9, marginRed: false })
    expect(by[402]).toMatchObject({ plannedMargin: 22, actualMargin: 15.8, marginGap: -6.2, marginRed: true })
    expect(by[404]).toMatchObject({ plannedMargin: 30, actualMargin: 23.3, marginRed: true })
    expect(by[403].marginRed).toBe(false)
    expect(f.projects[0].marginRed).toBe(true)
  })
  it('says what Odoo is missing', () => {
    expect(by[405].missing).toEqual(['no_account', 'no_planned_margin'])
  })
  it('exactly 5 points under is not red', () => {
    expect(MARGIN_RED_POINTS).toBe(5)
    const r = financeFacts({
      'project.project': [{ id: 1, name: 'P', active: true, sale_order_id: [9, 'S9'], account_id: [3, 'A'] }],
      'sale.order': [{ id: 9, name: 'S9', amount_total: 100, margin_percent: 0.25 }],
      'account.analytic.line': [{ amount: 100, account_id: [3, 'A'] }, { amount: -80, account_id: [3, 'A'] }],
    }, { models: ['account.move'] })
    expect(r.projects[0]).toMatchObject({ plannedMargin: 25, actualMargin: 20, marginRed: false })
  })
})

describe('without Accounting', () => {
  it('invoice numbers are null, not zero', () => {
    const r = financeFacts({}, { models: ['sale.order'] })
    expect(r).toMatchObject({ hasAccounting: false, outstanding: null, overdueCount: null, collectedMonth: null })
  })
})

describe('plannedMargin', () => {
  it('reads margin_percent (a fraction) or works it out from margin', () => {
    expect(plannedMargin({ margin_percent: 0.284 })).toBe(28.4)
    expect(plannedMargin({ margin: 50, amount_untaxed: 200 })).toBe(25)
    expect(plannedMargin({ margin_percent: false, margin: false })).toBeNull()
  })
})

describe('the narrow read gives the same facts (odooMoneyRecords, 2026-10-25)', () => {
  it('analytic lines summed per account (income, cost) give the same margins as the lines', () => {
    const records = {
      'sale.order': [{ id: 1, name: 'S001', state: 'sale', amount_total: 1000, margin: 300, amount_untaxed: 1000, project_id: [7, 'P'] }],
      'project.project': [{ id: 7, name: 'P', active: true, account_id: [70, 'A'] }, { id: 8, name: 'Q', active: true, account_id: [80, 'B'] }],
      'account.analytic.line': [
        { account_id: [70, 'A'], amount: 600 }, { account_id: [70, 'A'], amount: 400 }, { account_id: [70, 'A'], amount: -250 },
        { account_id: [70, 'A'], amount: -0 }, { account_id: [80, 'B'], amount: -90 }, { account_id: false, amount: 55 },
      ],
    }
    // What odoo_analytic_totals returns: per account, the positives and the negatives.
    const totals = new Map()
    for (const l of records['account.analytic.line']) {
      if (!Array.isArray(l.account_id)) continue
      const t = totals.get(l.account_id[0]) || { income: 0, cost: 0 }
      if (l.amount >= 0) t.income += l.amount; else t.cost += -l.amount
      totals.set(l.account_id[0], t)
    }
    const summed = [...totals].flatMap(([a, t]) => [{ account_id: [a], amount: t.income }, { account_id: [a], amount: -t.cost }])
    const opts = { now: Date.UTC(2026, 9, 25), models: ['account.analytic.line', 'sale.order'], url: '' }
    expect(financeFacts({ ...records, 'account.analytic.line': summed }, opts)).toEqual(financeFacts(records, opts))
    expect(financeFacts(records, opts).projects.find(p => p.id === 7)).toMatchObject({ income: 1000, cost: 250 })
  })

  it('monthReadFrom starts a day before the month does in Riyadh', () => {
    // 2026-10-31 22:30 UTC is already 1 November in Riyadh, which began at
    // 21:00 UTC on the 31st; a day earlier is the 30th (a safe superset).
    expect(monthReadFrom(Date.UTC(2026, 9, 31, 22, 30))).toBe('2026-10-30')
    expect(monthReadFrom(Date.UTC(2026, 9, 25, 12))).toBe('2026-09-29')
  })
})
