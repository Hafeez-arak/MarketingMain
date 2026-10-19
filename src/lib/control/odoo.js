// ─── The CEO's numbers from Odoo's records ─────────────────────────────────
// 2026-10-19 (v2). The mirror (odoo_records, filled by api/leads/_odooSync.js)
// holds Odoo's deals, quotes and orders, invoices, projects and customers as
// Odoo sent them. This turns them into the facts the control panel shows
// (src/lib/control/panel.js reads `odoo`). Pure, so every number is tested
// without an Odoo.
//
// Odoo 18's shapes: a many-to-one is [id, "Name"] or false; datetimes are
// "YYYY-MM-DD HH:MM:SS" in UTC; dates are "YYYY-MM-DD".
//
// Choices, each said on screen where it matters:
//   · open pipeline: open opportunities' expected revenue (Odoo's own field);
//   · revenue this month: posted customer invoices less refunds (untaxed)
//     when Odoo Accounting is installed, else confirmed sales orders;
//   · a deal is WON in a won stage, LOST when archived with 0% (that is how
//     Odoo marks a lost deal), otherwise open;
//   · an invoice is overdue when unpaid more than 60 days past its due date
//     (the CEO's requirement 30);
//   · a project is at risk when its last status update says at risk or off
//     track (Odoo Project's own status).

const DAY = 86_400_000
const RIYADH = 3 * 3_600_000

export const SYNC_MODELS = {
  'crm.stage': { fields: ['name', 'is_won', 'sequence'], full: true },
  'crm.lead': {
    fields: ['name', 'type', 'active', 'probability', 'expected_revenue', 'stage_id', 'user_id', 'partner_id',
      'partner_name', 'date_deadline', 'date_closed', 'create_date', 'lost_reason_id'],
  },
  'sale.order': { fields: ['name', 'state', 'amount_untaxed', 'amount_total', 'date_order', 'create_date', 'user_id', 'partner_id', 'opportunity_id'] },
  'account.move': {
    fields: ['name', 'move_type', 'state', 'payment_state', 'amount_untaxed', 'amount_residual', 'invoice_date', 'invoice_date_due', 'partner_id', 'invoice_user_id'],
    domain: [['move_type', 'in', ['out_invoice', 'out_refund']]],
  },
  'project.project': { fields: ['name', 'active', 'partner_id', 'user_id', 'date_start', 'date', 'last_update_status', 'stage_id'] },
}

export const m2oId = v => (Array.isArray(v) ? v[0] : null)
export const m2oName = v => (Array.isArray(v) ? String(v[1] || '') : '')
/** Odoo's UTC datetime or date, as ms. */
export const odooTime = s => {
  if (!s || s === false) return null
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : `${String(s).replace(' ', 'T')}Z`)
  return Number.isFinite(t) ? t : null
}

/** 'won' | 'lost' | 'open' for an opportunity. */
export function dealState(lead, wonStages = new Set()) {
  if (lead.active === false) return Number(lead.probability) === 0 ? 'lost' : 'archived'
  if (wonStages.has(m2oId(lead.stage_id))) return 'won'
  return 'open'
}

/** The first moment of this month in Riyadh, as ms. */
const monthStart = now => {
  const r = new Date(now.getTime() + RIYADH)
  return Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), 1) - RIYADH
}

/** Names compared loosely: "Crescent Developments Co." ≈ "crescent developments". */
export const looseName = s => String(s || '').toLowerCase().replace(/\b(co|company|ltd|llc|est|establishment|group)\b\.?/g, '').replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim()

/**
 * The facts for the control panel. `records` = { model: [data…] };
 * `models` = the models Odoo has (installed apps). A fact whose app is not
 * installed is null, and the panel keeps saying what it needs.
 */
export function odooFacts(records = {}, { now = new Date(), models = [], url = '' } = {}) {
  const has = m => models.includes(m)
  const n = now.getTime()
  const stages = records['crm.stage'] || []
  const wonStages = new Set(stages.filter(s => s.is_won).map(s => s.id))
  const deals = (records['crm.lead'] || []).filter(l => l.type === 'opportunity')
  const orders = records['sale.order'] || []
  const invoices = (records['account.move'] || []).filter(m => m.state === 'posted')
  const projects = (records['project.project'] || []).filter(p => p.active !== false)

  const open = deals.filter(d => dealState(d, wonStages) === 'open')
  const since90 = n - 90 * DAY
  const won = deals.filter(d => dealState(d, wonStages) === 'won' && (odooTime(d.date_closed) ?? 0) >= since90)
  const lost = deals.filter(d => dealState(d, wonStages) === 'lost' && (odooTime(d.write_date) ?? 0) >= since90)

  const mStart = monthStart(now)
  let revenue = null, revenueBasis = null
  if (has('account.move')) {
    revenueBasis = 'invoiced'
    revenue = invoices
      .filter(m => (odooTime(m.invoice_date) ?? 0) >= mStart)
      .reduce((s, m) => s + (m.move_type === 'out_refund' ? -1 : 1) * (Number(m.amount_untaxed) || 0), 0)
  } else if (has('sale.order')) {
    revenueBasis = 'orders'
    revenue = orders.filter(o => o.state === 'sale' && (odooTime(o.date_order) ?? 0) >= mStart)
      .reduce((s, o) => s + (Number(o.amount_untaxed) || 0), 0)
  }

  const quotesWeek = has('sale.order')
    ? orders.filter(o => o.state !== 'cancel' && (odooTime(o.create_date) ?? 0) >= n - 7 * DAY).length
    : null

  const overdueCut = n - 60 * DAY
  const overdue = has('account.move')
    ? invoices.filter(m => m.move_type === 'out_invoice' && Number(m.amount_residual) > 0
      && !['paid', 'in_payment', 'reversed'].includes(m.payment_state) && (odooTime(m.invoice_date_due) ?? Infinity) < overdueCut)
    : null

  const atRisk = has('project.project') ? projects.filter(p => ['at_risk', 'off_track'].includes(p.last_update_status)) : null

  // ── Per customer, for the key accounts ──
  const byPartner = {}
  const bucket = (name) => (byPartner[looseName(name)] ||= { lastOrder: null, openDeals: 0, openValue: 0 })
  for (const o of orders.filter(o => o.state === 'sale')) {
    const b = bucket(m2oName(o.partner_id))
    const t = odooTime(o.date_order)
    if (t !== null && (b.lastOrder === null || t > b.lastOrder)) b.lastOrder = t
  }
  for (const d of open) {
    const b = bucket(m2oName(d.partner_id) || d.partner_name)
    b.openDeals += 1
    b.openValue += Number(d.expected_revenue) || 0
  }
  delete byPartner['']

  // ── What is missing in Odoo (requirement 33) ──
  const link = (model, id) => (url ? `${url}/web#id=${id}&model=${model}&view_type=form` : '')
  const missing = [
    ...open.filter(d => !m2oId(d.user_id)).map(d => ({ kind: 'deal_no_owner', model: 'crm.lead', id: d.id, name: d.name, url: link('crm.lead', d.id) })),
    ...open.filter(d => !(Number(d.expected_revenue) > 0)).map(d => ({ kind: 'deal_no_value', model: 'crm.lead', id: d.id, name: d.name, url: link('crm.lead', d.id) })),
    ...(has('project.project') ? projects.filter(p => !p.date).map(p => ({ kind: 'project_no_date', model: 'project.project', id: p.id, name: p.name, url: link('project.project', p.id) })) : []),
  ]

  return {
    pipeline_sar: open.reduce((s, d) => s + (Number(d.expected_revenue) || 0), 0),
    pipeline_deals: open.length,
    revenue_month_sar: revenue,
    revenue_basis: revenueBasis,
    quotes_week: quotesWeek,
    won: won.length,
    decided: won.length + lost.length,
    win_rate_pct: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    overdue_invoices: overdue ? overdue.length : null,
    overdue_invoices_sar: overdue ? overdue.reduce((s, m) => s + (Number(m.amount_residual) || 0), 0) : null,
    projects_open: atRisk ? projects.length : null,
    projects_at_risk: atRisk ? atRisk.length : null,
    byPartner,
    missing,
  }
}

/** A key account with Odoo's live numbers where its name matches a customer there. */
export function withOdoo(account, facts) {
  const live = facts?.byPartner?.[looseName(account.name)]
  if (!live) return { ...account, odoo: false }
  return {
    ...account,
    odoo: true,
    last_order: live.lastOrder === null ? account.last_order : new Date(live.lastOrder).toISOString().slice(0, 10),
    open_deals: live.openDeals,
    open_value_sar: live.openValue,
  }
}

export const MISSING_LABEL = {
  deal_no_owner: { en: 'Deal with no salesperson', ar: 'صفقة بلا مندوب' },
  deal_no_value: { en: 'Deal with no expected value', ar: 'صفقة بلا قيمة متوقعة' },
  project_no_date: { en: 'Project with no delivery date', ar: 'مشروع بلا تاريخ تسليم' },
}
