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

/** "arak-co.odoo.com/odoo" → "https://arak-co.odoo.com". '' if it is not an address. */
export function normalizeUrl(raw) {
  const v = String(raw || '').trim()
  if (!v) return ''
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
    if (!u.hostname.includes('.')) return ''
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

// ─── The battle card as fields, and the lead's history (2026-10-20) ────────

/** The sales teams, for choosing where our leads go. */
export async function listTeams(fetchFn, cfg) {
  const uid = await login(fetchFn, cfg)
  return call(fetchFn, cfg, uid, 'crm.team', 'search_read', [[]], { fields: ['name', 'user_id', 'member_ids', 'use_leads'], order: 'name' })
}

/** A team's properties definition (the fields its leads carry). */
export async function readTeamDefinition(fetchFn, cfg, teamId) {
  const uid = await login(fetchFn, cfg)
  const [team] = await call(fetchFn, cfg, uid, 'crm.team', 'read', [[Number(teamId)]], { fields: ['name', 'lead_properties_definition'] })
  if (!team) throw new OdooError(`Sales team ${teamId} is not in Odoo.`)
  return team
}

/** Write a team's properties definition. Needs Sales: Administrator. */
export async function writeTeamDefinition(fetchFn, cfg, teamId, definition) {
  const uid = await login(fetchFn, cfg)
  await call(fetchFn, cfg, uid, 'crm.team', 'write', [[Number(teamId)], { lead_properties_definition: definition }])
  return true
}

/** A new sales team with these members. Needs Sales: Administrator. */
export async function createTeam(fetchFn, cfg, name, memberIds = []) {
  const uid = await login(fetchFn, cfg)
  return call(fetchFn, cfg, uid, 'crm.team', 'create', [{ name, use_leads: true, use_opportunities: true, member_ids: [[6, 0, memberIds.map(Number)]] }])
}

/** { odooLeadId: { props: [{ name, value, … }], teamId } } for these leads, archived ones too. */
export async function readLeadProps(fetchFn, cfg, ids) {
  if (!ids.length) return {}
  const uid = await login(fetchFn, cfg)
  const rows = await call(fetchFn, cfg, uid, 'crm.lead', 'read', [ids.map(Number)], { fields: ['lead_properties', 'team_id'], context: { active_test: false } })
  return Object.fromEntries(rows.map((r) => [String(r.id), { props: r.lead_properties || [], teamId: Array.isArray(r.team_id) ? r.team_id[0] : null }]))
}

/** Write the lead's properties WHOLE ({ name: value }): Odoo replaces the set. */
export async function writeLeadProps(fetchFn, cfg, leadId, values) {
  const uid = await login(fetchFn, cfg)
  await call(fetchFn, cfg, uid, 'crm.lead', 'write', [[Number(leadId)], { lead_properties: values }])
  return true
}

/** An internal note in the lead's history (never emailed to the customer). */
export async function postNote(fetchFn, cfg, leadId, html) {
  const uid = await login(fetchFn, cfg)
  return call(fetchFn, cfg, uid, 'crm.lead', 'message_post', [[Number(leadId)]], {
    body: html, body_is_html: true, message_type: 'comment', subtype_xmlid: 'mail.mt_note',
  })
}
