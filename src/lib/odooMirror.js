import { supabase } from './supabaseClient'

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
