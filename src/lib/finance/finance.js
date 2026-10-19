// ─── Finance: invoices, collections and project margins from Odoo ──────────
// 2026-10-19 (v2). Read only, from the Odoo mirror (odoo_records): Odoo
// Accounting owns every number here, and nothing is typed into Campai
// (the CEO's rule 7). His requirements 30 and 31:
//
//   · invoices and collections, overdue more than 60 days, and how long the
//     unpaid ones have been outstanding;
//   · % collected per project;
//   · planned against actual margin per project, red when the actual is more
//     than 5 points below the plan.
//
// Where each number comes from, said on screen as well:
//   · amounts are the invoice totals with VAT (what the customer owes);
//   · collected this month = Odoo's customer payments dated this month;
//   · outstanding = what is still unpaid on posted invoices (amount_residual);
//   · a project's invoices are those whose origin names its sales order
//     (the project's sale_order_id, or the order's project_id);
//   · planned margin = that sales order's margin (Odoo's Sales margin);
//   · actual margin = the project's analytic account to date: income less
//     costs on its analytic lines.
//
// Pure: no React, no IO. Tested in finance.test.js.

const DAY = 86_400_000
const RIYADH = 3 * 3_600_000
/** Points below plan at which a margin turns red. */
export const MARGIN_RED_POINTS = 5
export const OVERDUE_DAYS = 60

const m2oId = v => (Array.isArray(v) ? v[0] : null)
const m2oName = v => (Array.isArray(v) ? String(v[1] || '') : '')
const num = v => Number(v) || 0
export const odooTime = s => {
  if (!s) return null
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : `${String(s).replace(' ', 'T')}Z`)
  return Number.isFinite(t) ? t : null
}
const monthStart = now => {
  const r = new Date(now + RIYADH)
  return Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), 1) - RIYADH
}

export const AGING = [
  { key: '0_30', max: 30, en: '0–30 days', ar: '٠–٣٠ يومًا' },
  { key: '31_60', max: 60, en: '31–60 days', ar: '٣١–٦٠ يومًا' },
  { key: '61_90', max: 90, en: '61–90 days', ar: '٦١–٩٠ يومًا' },
  { key: '91_180', max: 180, en: '91–180 days', ar: '٩١–١٨٠ يومًا' },
  { key: '180_plus', max: Infinity, en: 'Over 180 days', ar: 'أكثر من ١٨٠ يومًا' },
]

const PAID = new Set(['paid', 'in_payment', 'reversed'])

/** The sales order names an invoice came from: "S00201, S00202" → ['S00201', 'S00202']. */
const origins = inv => String(inv.invoice_origin || '').split(',').map(s => s.trim()).filter(Boolean)

/**
 * Everything the Finance pages show. `records` = { model: [data…] } from the
 * mirror; `models` = the models Odoo has. Without Accounting the invoice
 * numbers are null and the page says Accounting is not in use.
 */
export function financeFacts(records = {}, { now = Date.now(), models = [], url = '' } = {}) {
  const n = typeof now === 'number' ? now : now.getTime()
  const hasAccounting = models.includes('account.move')
  const link = (model, id) => (url ? `${url}/web#id=${id}&model=${model}&view_type=form` : '')

  const moves = (records['account.move'] || []).filter(m => m.state === 'posted')
  const invoices = moves.filter(m => m.move_type === 'out_invoice')
  const refunds = moves.filter(m => m.move_type === 'out_refund')
  const mStart = monthStart(n)

  // ── Invoices and collections ──
  const unpaid = invoices
    .filter(m => num(m.amount_residual) > 0 && !PAID.has(m.payment_state))
    .map(m => {
      const issued = odooTime(m.invoice_date)
      const due = odooTime(m.invoice_date_due)
      const outstanding = issued == null ? null : Math.max(0, Math.floor((n - issued) / DAY))
      const pastDue = due == null ? null : Math.floor((n - due) / DAY)
      return {
        id: m.id, name: m.name, customer: m2oName(m.partner_id), salesperson: m2oName(m.invoice_user_id),
        invoiceDate: m.invoice_date || null, dueDate: m.invoice_date_due || null,
        total: num(m.amount_total), residual: num(m.amount_residual), partial: m.payment_state === 'partial',
        daysOutstanding: outstanding, daysPastDue: pastDue != null && pastDue > 0 ? pastDue : 0,
        overdue60: pastDue != null && pastDue > OVERDUE_DAYS, url: link('account.move', m.id),
      }
    })
    .sort((a, b) => (b.daysOutstanding ?? -1) - (a.daysOutstanding ?? -1) || b.residual - a.residual)

  const aging = AGING.map(b => ({ ...b, count: 0, amount: 0 }))
  for (const u of unpaid) {
    const d = u.daysOutstanding ?? 0
    const b = aging.find(x => d <= x.max)
    b.count += 1
    b.amount += u.residual
  }
  const outstanding = unpaid.reduce((s, u) => s + u.residual, 0)
  const overdue = unpaid.filter(u => u.overdue60)

  const payments = records['account.payment'] || null
  const collectedMonth = payments && models.includes('account.payment')
    ? payments
      .filter(p => p.payment_type === 'inbound' && !['draft', 'cancel', 'canceled', 'rejected'].includes(p.state))
      .filter(p => (odooTime(p.date) ?? 0) >= mStart)
      .reduce((s, p) => s + num(p.amount), 0)
    : null

  const invoicedMonth = invoices.filter(m => (odooTime(m.invoice_date) ?? 0) >= mStart).reduce((s, m) => s + num(m.amount_total), 0)
    - refunds.filter(m => (odooTime(m.invoice_date) ?? 0) >= mStart).reduce((s, m) => s + num(m.amount_total), 0)

  const weighted = outstanding > 0
    ? Math.round(unpaid.reduce((s, u) => s + (u.daysOutstanding ?? 0) * u.residual, 0) / outstanding)
    : null

  // ── Per project ──
  const orders = records['sale.order'] || []
  const orderById = new Map(orders.map(o => [o.id, o]))
  const lines = records['account.analytic.line'] || []
  const byAccount = new Map()
  for (const l of lines) {
    const a = m2oId(l.account_id)
    if (a == null) continue
    const b = byAccount.get(a) || { income: 0, cost: 0 }
    const amt = num(l.amount)
    if (amt >= 0) b.income += amt
    else b.cost += -amt
    byAccount.set(a, b)
  }

  const projects = (records['project.project'] || [])
    .filter(p => p.active !== false)
    .map(p => {
      const so = orderById.get(m2oId(p.sale_order_id)) || orders.find(o => m2oId(o.project_id) === p.id && o.state !== 'cancel') || null
      const own = so ? [...invoices, ...refunds].filter(m => origins(m).includes(so.name)) : []
      const sign = m => (m.move_type === 'out_refund' ? -1 : 1)
      const invoiced = own.reduce((s, m) => s + sign(m) * num(m.amount_total), 0)
      const unpaidAmt = own.filter(m => m.move_type === 'out_invoice' && !PAID.has(m.payment_state)).reduce((s, m) => s + num(m.amount_residual), 0)
      const collected = Math.max(0, invoiced - unpaidAmt)
      const account = m2oId(p.account_id) ?? m2oId(p.analytic_account_id)
      const a = account != null ? byAccount.get(account) : null
      const planned = so ? plannedMargin(so) : null
      const actual = a && a.income > 0 ? round1(((a.income - a.cost) / a.income) * 100) : null
      const gap = planned != null && actual != null ? round1(actual - planned) : null
      return {
        id: p.id, name: p.name, customer: m2oName(p.partner_id),
        order: so ? { id: so.id, name: so.name, total: num(so.amount_total), url: link('sale.order', so.id) } : null,
        invoiced, collected, unpaid: unpaidAmt,
        pctCollected: invoiced > 0 ? Math.round((collected / invoiced) * 100) : null,
        pctInvoiced: so && num(so.amount_total) > 0 ? Math.round((invoiced / num(so.amount_total)) * 100) : null,
        income: a ? a.income : null, cost: a ? a.cost : null,
        plannedMargin: planned, actualMargin: actual, marginGap: gap,
        marginRed: gap != null && gap < -MARGIN_RED_POINTS,
        url: link('project.project', p.id),
        missing: [
          !so && 'no_order',
          account == null && 'no_account',
          so && planned == null && 'no_planned_margin',
        ].filter(Boolean),
      }
    })
    .sort((a, b) => Number(b.marginRed) - Number(a.marginRed) || (a.pctCollected ?? 101) - (b.pctCollected ?? 101) || a.name.localeCompare(b.name))

  return {
    hasAccounting,
    invoicedMonth: hasAccounting ? invoicedMonth : null,
    collectedMonth,
    outstanding: hasAccounting ? outstanding : null,
    unpaidCount: hasAccounting ? unpaid.length : null,
    avgDaysOutstanding: hasAccounting ? weighted : null,
    overdueCount: hasAccounting ? overdue.length : null,
    overdueAmount: hasAccounting ? overdue.reduce((s, u) => s + u.residual, 0) : null,
    aging: hasAccounting ? aging : [],
    unpaid: hasAccounting ? unpaid : [],
    projects,
  }
}

/** Odoo's margin on a sales order, in percent: margin_percent is a fraction; else margin over the untaxed amount. */
export function plannedMargin(so) {
  if (so.margin_percent !== undefined && so.margin_percent !== false && so.margin_percent !== null) return round1(num(so.margin_percent) * 100)
  if (so.margin !== undefined && so.margin !== false && num(so.amount_untaxed) > 0) return round1((num(so.margin) / num(so.amount_untaxed)) * 100)
  return null
}

const round1 = v => Math.round(v * 10) / 10
