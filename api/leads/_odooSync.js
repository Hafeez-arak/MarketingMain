// ─── The Odoo mirror: read Odoo into Campai, hourly ────────────────────────
// 2026-10-19 (v2). The CEO's requirements 16 and 17: pull the data from
// Odoo, at least every hour, with no typing in Campai. Read only: nothing is
// written back to Odoo from here.
//
// Each round, for one company:
//   1. claim the round (at most once an hour, unless forced), so the two
//      five-minute callers and the daily job never run it twice at once;
//   2. ask Odoo which of the models we mirror exist (an app that is not
//      installed has none: no Accounting, no invoices);
//   3. read every record changed since that model's cursor (Odoo's
//      write_date), page by page, and upsert it into odoo_records;
//   4. move the cursors, and record what happened (odoo_sync).
//
// The connection is the lead push's (lead_crm, _crm.js): one Odoo login per
// company, its key sealed. The arithmetic on the mirror is
// src/lib/control/odoo.js.
//
//   deps: db, fetch, now, open (unseal)

import { crmConnection, odooCfg } from './_crm.js'
import { installedModels, readChanged, fieldNames } from './_odoo.js'
import { readAll } from './_technical.js'
import { SYNC_MODELS } from '../../src/lib/control/odoo.js'

const HOUR = 3_600_000
/** A round claimed this long ago that never finished is taken to have died. */
const STALE_MS = 15 * 60_000
const ws = id => `workspace_id=eq.${encodeURIComponent(id)}`

const isMissing = (err) => /does not exist|42P01|PGRST205|schema cache/i.test(String(err?.message || err))

async function state(deps, workspaceId) {
  const [row] = await deps.db(`odoo_sync?${ws(workspaceId)}&select=*`) || []
  if (row) return row
  const [made] = await deps.db('odoo_sync?on_conflict=workspace_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: { workspace_id: workspaceId },
  }) || []
  return made
}

/**
 * One round for one company. Returns { synced: { model: changed } } or
 * { skipped } (ran within the hour), { off } (not connected / no tables),
 * { error }.
 */
export async function syncOdoo(deps, { workspaceId, force = false }) {
  const now = deps.now()
  let s
  try { s = await state(deps, workspaceId) } catch (err) {
    if (isMissing(err)) return { off: true }
    throw err
  }

  // 1. Claim: last run more than an hour ago (or a dead one), unless forced.
  if (!force) {
    const last = Date.parse(s?.last_run_at || '') || 0
    const ok = Date.parse(s?.last_ok_at || '') || 0
    const running = last > ok && now.getTime() - last < STALE_MS
    if (running || now.getTime() - Math.max(ok, last) < HOUR) return { skipped: true }
  }
  const cutoff = new Date(now.getTime() - (force ? 0 : HOUR)).toISOString()
  const claim = force ? '' : `&or=(last_run_at.is.null,last_run_at.lt.${encodeURIComponent(cutoff)})`
  const [claimed] = await deps.db(`odoo_sync?${ws(workspaceId)}${claim}`, {
    method: 'PATCH', prefer: 'return=representation', body: { last_run_at: now.toISOString(), updated_at: now.toISOString() },
  }) || []
  if (!claimed) return { skipped: true }

  const conn = await crmConnection(deps, workspaceId)
  if (!conn?.ready) {
    await deps.db(`odoo_sync?${ws(workspaceId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { last_error: 'Odoo is not connected yet (Leads → Agent settings → CRM).' } })
    return { off: true }
  }
  const cfg = odooCfg(conn)

  try {
    // 2. Which apps are there.
    const models = await installedModels(deps.fetch, cfg, Object.keys(SYNC_MODELS))
    const cursors = { ...(claimed.cursors || {}) }
    const synced = {}
    // 3. What changed, model by model.
    for (const model of Object.keys(SYNC_MODELS).filter(m => models.includes(m))) {
      const spec = SYNC_MODELS[model]
      // "write_date|id" of the last record read (a bare date from an older
      // round is read as id 0).
      const [since = '', sinceId = 0] = spec.full ? [] : String(cursors[model] || '').split('|')
      // Optional fields only where this Odoo has them: asking for one it
      // lacks fails the whole read.
      let fields = spec.fields
      if (spec.optional?.length) {
        const have = new Set(await fieldNames(deps.fetch, cfg, model))
        fields = [...spec.fields, ...spec.optional.filter(f => have.has(f))]
      }
      const { rows, done } = await readChanged(deps.fetch, cfg, model, { fields, domain: spec.domain || [], since, sinceId })
      for (let i = 0; i < rows.length; i += 500) {
        await deps.db('odoo_records?on_conflict=workspace_id,model,odoo_id', {
          method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
          body: rows.slice(i, i + 500).map(r => ({
            workspace_id: workspaceId, model, odoo_id: r.id, data: r, write_date: String(r.write_date || ''), synced_at: now.toISOString(),
          })),
        })
      }
      if (rows.length && !spec.full) cursors[model] = `${rows[rows.length - 1].write_date}|${rows[rows.length - 1].id}`
      synced[model] = { changed: rows.length, done }
    }
    // 4. Done.
    await deps.db(`odoo_sync?${ws(workspaceId)}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { last_ok_at: deps.now().toISOString(), last_error: '', cursors, models, counts: synced, odoo_url: cfg.url, updated_at: deps.now().toISOString() },
    })
    // 5. Technical watches what just arrived (_technical.js): stage changes,
    //    late stages, missing weekly updates, submittals with the client.
    let technical = null
    if (deps.technical && models.includes('project.project')) {
      technical = await deps.technical({ workspaceId }).catch(err => ({ error: String(err?.message || err).slice(0, 300) }))
    }
    return { synced, models, technical }
  } catch (err) {
    const error = String(err?.message || err).slice(0, 400)
    await deps.db(`odoo_sync?${ws(workspaceId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { last_error: error, updated_at: deps.now().toISOString() } })
    return { error }
  }
}

/** Every company with an Odoo connection, one after another. */
export async function syncAllOdoo(deps, { force = false } = {}) {
  let rows
  try { rows = await deps.db('lead_crm?select=workspace_id') || [] } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
  const out = []
  for (const r of rows) out.push({ workspaceId: r.workspace_id, ...(await syncOdoo(deps, { workspaceId: r.workspace_id, force }).catch(err => ({ error: String(err?.message || err) }))) })
  return out
}

/** The mirror as odooFacts wants it: { model: [data…] }, plus the models and the Odoo address. */
export async function readMirror(deps, workspaceId) {
  try {
    // Paged: the API returns at most 1,000 rows a request, and one request
    // for 50,000 silently came back with the first 1,000.
    const [[s], rows, [conn]] = await Promise.all([
      deps.db(`odoo_sync?${ws(workspaceId)}&select=*`).then(r => r || []),
      readAll(deps.db, `odoo_records?${ws(workspaceId)}&select=model,data&order=model.asc,odoo_id.asc`),
      deps.db(`lead_crm?${ws(workspaceId)}&select=url`).then(r => r || []),
    ])
    if (!s?.last_ok_at) return { status: { connected: Boolean(conn), lastOkAt: null, lastError: s?.last_error || '' } }
    const records = {}
    for (const r of rows) (records[r.model] ||= []).push(r.data)
    return {
      records, models: s.models || [], url: conn?.url || '',
      status: { connected: Boolean(conn), lastOkAt: s.last_ok_at, lastError: s.last_error || '' },
    }
  } catch (err) {
    if (isMissing(err)) return { status: null }
    throw err
  }
}
