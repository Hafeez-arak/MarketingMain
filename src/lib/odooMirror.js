import { supabase } from './supabaseClient'
import { monthReadFrom, projectOrder } from './finance/finance'

// ─── The Odoo mirror, read from the browser (v2) ───────────────────────────
// 2026-10-19. odoo_records holds what the hourly round read from Odoo
// (api/leads/_odooSync.js). The database decides what each person may read
// (odoo_record_visible, migration 20261105): Finance and the CEO the money,
// a project manager only their own projects' tasks and updates. So these
// reads ask for everything of a model and get what they are allowed.

const PAGE = 1000 // the API's most rows per request

/**
 * { model: [data…] } for these models, a page at a time. Throws on an
 * error, so a failed read is said as one and never drawn as "no records".
 */
export async function readModels(workspaceId, models) {
  const records = Object.fromEntries(models.map(m => [m, []]))
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('odoo_records')
      .select('model,data')
      .eq('workspace_id', workspaceId)
      .in('model', models)
      .order('model', { ascending: true })
      .order('odoo_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    for (const r of data || []) records[r.model].push(r.data)
    if (!data || data.length < PAGE) return records
  }
}

/**
 * The money models, as financeFacts needs them, without reading them whole
 * (2026-10-25: Arak's Odoo has 23,562 invoices and 56,230 analytic lines,
 * which never finished loading). Payments, sales orders and projects are
 * small and read as they are. Invoices come from the database narrowed to the
 * ones the math uses (odoo_finance_moves), and analytic lines as one income
 * and one cost line per account (odoo_analytic_totals), which sum the same.
 * Who may read money is checked there: CEO or Finance, else none.
 */
export async function readMoneyRecords(workspaceId, { now = Date.now(), with: also = [] } = {}) {
  const records = await readModels(workspaceId, [...new Set(['account.payment', 'sale.order', 'project.project', ...also])])
  const orders = records['sale.order'] || []
  const byId = new Map(orders.map(o => [o.id, o]))
  const origins = [...new Set((records['project.project'] || []).map(p => projectOrder(p, orders, byId)?.name).filter(Boolean))]
  const moves = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.rpc('odoo_finance_moves', { ws: workspaceId, month_start: monthReadFrom(now), origins }).range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    moves.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  const { data: totals, error } = await supabase.rpc('odoo_analytic_totals', { ws: workspaceId })
  if (error) throw new Error(error.message)
  records['account.move'] = moves
  records['account.analytic.line'] = (totals || []).flatMap(t => [
    { account_id: [t.account_id], amount: Number(t.income) || 0 },
    { account_id: [t.account_id], amount: -(Number(t.cost) || 0) },
  ])
  return records
}

/** When the mirror last read Odoo, which apps it found, the Odoo address, and any error. null before the first round. */
export async function readSyncState(workspaceId) {
  const { data, error } = await supabase
    .from('odoo_sync')
    .select('last_ok_at,last_error,models,odoo_url')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

/** Any record's form in Odoo; the /web# address still opens in 18. */
export const odooLink = (url, model, id) => (url ? `${url}/web#id=${id}&model=${model}&view_type=form` : '')
