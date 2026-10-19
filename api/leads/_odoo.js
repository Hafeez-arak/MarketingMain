// ─── Odoo, behind one small adapter ────────────────────────────────────────
// Arak's Odoo is Odoo Online 18.0 Enterprise (arak-co.odoo.com). 18 has no
// JSON-2 API, so this speaks the external JSON-RPC (/jsonrpc, execute_kw).
// That API is deprecated and goes in Online 21.1; everything Odoo-specific
// lives in this file so the switch is one file. On Odoo Online the external
// API is officially the Custom plan's, and a Standard plan's refusal arrives
// as an ordinary error, shown to the admin as Odoo worded it.
//
// Nothing here reads the database: callers pass the connection in.

const TIMEOUT_MS = 15_000

/**
 * "arak-co.odoo.com/odoo" → "https://arak-co.odoo.com". '' if it is not an
 * address. Always https, except a server on this machine (127.0.0.1), which
 * is the fake Odoo v2 is developed against (dev/v2db/fake-odoo.mjs).
 */
export function normalizeUrl(raw) {
  const v = String(raw || '').trim()
  if (!v) return ''
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
    if (!u.hostname.includes('.')) return ''
    if (u.hostname === '127.0.0.1' && u.protocol === 'http:') return `http://${u.host}`
    return `https://${u.host}`
  } catch { return '' }
}

/** Odoo Online names the database after the subdomain: arak-co.odoo.com → "arak-co". */
export function defaultDb(url) {
  const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
  return /\.odoo\.com$/i.test(host) ? host.split('.')[0] : ''
}

/**
 * The database's real name, as the server itself lists it. Odoo Online's
 * is not the subdomain: arak-co.odoo.com runs "profaccountant-arak-co-main-
 * 17902620" (found 2026-10-14), so the guess above fails to sign in. Online
 * answers this one public call with its single database; '' when it won't.
 */
export async function discoverDb(fetchFn, url) {
  try {
    const res = await fetchFn(`${url}/web/database/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {}, id: Date.now() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const list = (await res.json().catch(() => null))?.result
    return Array.isArray(list) && list.length === 1 ? String(list[0]) : ''
  } catch { return '' }
}

class OdooError extends Error {}

async function rpc(fetchFn, url, service, method, args) {
  let res
  try {
    res = await fetchFn(`${url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw new OdooError(`Could not reach ${url}: ${err.message}`)
  }
  const body = await res.json().catch(() => null)
  if (!body) throw new OdooError(`${url} answered ${res.status} with something that is not Odoo's API.`)
  if (body.error) {
    // Odoo's own words are in data.message; the outer message is "Odoo Server Error".
    throw new OdooError(String(body.error.data?.message || body.error.message || 'Odoo refused the request.').slice(0, 400))
  }
  return body.result
}

async function login(fetchFn, cfg) {
  const uid = await rpc(fetchFn, cfg.url, 'common', 'authenticate', [cfg.db, cfg.login, cfg.apiKey, {}])
  if (!uid) throw new OdooError('Odoo did not accept that login and API key.')
  return uid
}

const call = (fetchFn, cfg, uid, model, method, args, kwargs = {}) =>
  rpc(fetchFn, cfg.url, 'object', 'execute_kw', [cfg.db, uid, cfg.apiKey, model, method, args, kwargs])

/**
 * Read only: can we sign in, may this user create CRM leads, how many leads
 * are there. Returns { ok, uid, version, canCreate, leadCount } or { ok:false, error }.
 */
export async function testConnection(fetchFn, cfg) {
  try {
    const info = await rpc(fetchFn, cfg.url, 'common', 'version', [])
    const uid = await login(fetchFn, cfg)
    const canCreate = await call(fetchFn, cfg, uid, 'crm.lead', 'check_access_rights', ['create'], { raise_exception: false })
    const leadCount = await call(fetchFn, cfg, uid, 'crm.lead', 'search_count', [[]])
    return { ok: true, uid, version: String(info?.server_version || ''), canCreate: Boolean(canCreate), leadCount: Number(leadCount) || 0 }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** The CRM tag ids for these names, making any that do not exist yet. */
async function tagIds(fetchFn, cfg, uid, names) {
  const ids = []
  for (const name of names) {
    const found = await call(fetchFn, cfg, uid, 'crm.tag', 'search', [[['name', '=', name]]], { limit: 1 })
    ids.push(found[0] || await call(fetchFn, cfg, uid, 'crm.tag', 'create', [{ name }]))
  }
  return ids
}

/** The record's address in Odoo; the /web# form still opens in 18. */
export const leadUrl = (url, id) => `${url}/web#id=${id}&model=crm.lead&view_type=form`

/**
 * Create the lead, unless Odoo already holds one carrying this reference
 * (a push that died after Odoo saved it). Returns { id, url, existed }.
 * `values` comes from odooLeadValues (_crm.js); `ref` is our lead id.
 */
export async function createLead(fetchFn, cfg, values, ref) {
  const uid = await login(fetchFn, cfg)
  const [already] = await call(fetchFn, cfg, uid, 'crm.lead', 'search', [[['description', 'ilike', ref]]], { limit: 1, context: { active_test: false } })
  if (already) return { id: already, url: leadUrl(cfg.url, already), existed: true }
  const { tags = [], ...fields } = values
  const vals = { ...fields }
  if (tags.length) vals.tag_ids = [[6, 0, await tagIds(fetchFn, cfg, uid, tags)]]
  const id = await call(fetchFn, cfg, uid, 'crm.lead', 'create', [vals])
  return { id, url: leadUrl(cfg.url, id), existed: false }
}

/**
 * The Odoo user a salesperson is, by their login (an email here), or null.
 * The email field is asked too, for a user whose login is a username.
 */
export async function findUserId(fetchFn, cfg, loginOrEmail) {
  const who = String(loginOrEmail || '').trim()
  if (!who) return null
  const uid = await login(fetchFn, cfg)
  const [id] = await call(fetchFn, cfg, uid, 'res.users', 'search', [['|', ['login', '=ilike', who], ['email', '=ilike', who]]], { limit: 1 })
  return id || null
}

/**
 * Make this Odoo user the lead's salesperson. Odoo emails them "You have
 * been assigned", and under "Own Documents Only" the lead is theirs alone.
 */
export async function setLeadOwner(fetchFn, cfg, leadId, userId) {
  const uid = await login(fetchFn, cfg)
  await call(fetchFn, cfg, uid, 'crm.lead', 'write', [[Number(leadId)], { user_id: userId }])
  return true
}

// ─── Reading (v2, 2026-10-19: the Odoo mirror, _odooSync.js) ──────────────

/** Any record's address in Odoo; the /web# form still opens in 18. */
export const recordUrl = (url, model, id) => `${url}/web#id=${id}&model=${model}&view_type=form`

/** Which of these models exist (an app that is not installed has none). */
export async function installedModels(fetchFn, cfg, models) {
  const uid = await login(fetchFn, cfg)
  const rows = await call(fetchFn, cfg, uid, 'ir.model', 'search_read', [[['model', 'in', models]]], { fields: ['model'] })
  return (rows || []).map(r => r.model)
}

/** The field names this Odoo has on a model (fields_get), for asking only for those. */
export async function fieldNames(fetchFn, cfg, model) {
  const uid = await login(fetchFn, cfg)
  const out = await call(fetchFn, cfg, uid, model, 'fields_get', [], { attributes: ['type'] })
  return Object.keys(out || {})
}

/**
 * Every record of a model changed after `since` (Odoo's write_date, UTC
 * "YYYY-MM-DD HH:MM:SS"), oldest change first, a page at a time. Archived
 * records too (active_test off): a lost deal is archived in Odoo, and a
 * mirror that never saw it would count it as still open.
 */
export async function readChanged(fetchFn, cfg, model, { fields, domain = [], since = '', sinceId = 0, pageSize = 500, maxPages = 20 } = {}) {
  const uid = await login(fetchFn, cfg)
  const out = []
  // The cursor is the last record read: its write_date AND its id, so the
  // next round starts after it rather than at its second.
  let cursor = since
  let lastId = Number(sinceId) || 0
  for (let page = 0; page < maxPages; page++) {
    // (write_date > cursor) or (write_date = cursor and id > lastId): a page
    // boundary inside one second's changes neither repeats nor skips a row.
    const after = cursor
      ? ['|', ['write_date', '>', cursor], '&', ['write_date', '=', cursor], ['id', '>', lastId]]
      : []
    const rows = await call(fetchFn, cfg, uid, model, 'search_read', [[...after, ...domain]], {
      fields: [...new Set([...fields, 'id', 'write_date'])], order: 'write_date asc, id asc', limit: pageSize,
      context: { active_test: false },
    })
    out.push(...rows)
    if (rows.length < pageSize) return { rows: out, done: true }
    cursor = rows[rows.length - 1].write_date
    lastId = rows[rows.length - 1].id
  }
  return { rows: out, done: false }
}
