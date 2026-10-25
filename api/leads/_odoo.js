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
export async function createLead(fetchFn, cfg, values, ref, { pipeline = false, phase = '' } = {}) {
  const uid = await login(fetchFn, cfg)
  const [already] = await call(fetchFn, cfg, uid, 'crm.lead', 'search', [[['description', 'ilike', ref]]], { limit: 1, context: { active_test: false } })
  if (already) return { id: already, url: leadUrl(cfg.url, already), existed: true }
  const { tags = [], ...fields } = values
  const vals = { ...fields }
  if (tags.length) vals.tag_ids = [[6, 0, await tagIds(fetchFn, cfg, uid, tags)]]
  // Straight onto the Pipeline board (the owner, 2026-10-20): an opportunity
  // in the column for its phase, not a Lead waiting under the Leads menu.
  if (pipeline) {
    vals.type = 'opportunity'
    const stage = await pipelineStage(fetchFn, cfg, uid, phase, vals.team_id)
    if (stage) vals.stage_id = stage
  }
  const id = await call(fetchFn, cfg, uid, 'crm.lead', 'create', [vals])
  return { id, url: leadUrl(cfg.url, id), existed: false }
}

/**
 * The Pipeline column a new opportunity starts in: the first stage named for
 * its phase ("RFQ Received (TENDER)" before "Quotation (tender)"), else the
 * first stage ("New"). Won stages never; the team's own stages and the
 * shared ones. null when Odoo has none.
 */
async function pipelineStage(fetchFn, cfg, uid, phase = '', teamId = null) {
  const stages = await call(fetchFn, cfg, uid, 'crm.stage', 'search_read', [[['is_won', '=', false], '|', ['team_id', '=', false], ['team_id', '=', teamId || false]]], { fields: ['name', 'sequence'], order: 'sequence, id' })
  if (!stages.length) return null
  const word = { tender: /tender/i, jih: /\bjih\b/i, maintenance: /mainten/i }[phase]
  return (word && stages.find((s) => word.test(s.name)))?.id || stages[0].id
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

/** "YYYY-MM-DD HH:MM:SS" one second later (Odoo's datetimes are UTC). */
export function nextSecond(stamp) {
  const t = Date.parse(`${String(stamp).slice(0, 19).replace(' ', 'T')}Z`)
  return new Date(t + 1000).toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * Every record of a model changed since the cursor, a page at a time, oldest
 * change first. Archived records too (active_test off): a lost deal is
 * archived in Odoo, and a mirror that never saw it would count it as still
 * open.
 *
 * The cursor is a SECOND and how far into it we are: `since` ("YYYY-MM-DD
 * HH:MM:SS") with `sinceId`, the last id read inside that second, or -1 when
 * the whole second is read. Seconds, because Odoo stores write_date with
 * fractions but hands it back without them (found 2026-10-25: 500 of Arak's
 * invoices share 2025-06-18 10:52:44, imported together). Comparing the
 * whole-second value with = matches none of them and > matches all of them
 * again, so a (write_date, id) cursor re-read the same 500 forever.
 *
 * So one second is read in id order (inside a second, write_date order says
 * nothing useful about ids), and pages after it in write_date order keep only
 * the seconds they hold completely: the last second of a full page is left
 * for the next page to read by id. A busy second neither repeats nor skips.
 */
export async function readChanged(fetchFn, cfg, model, { fields, domain = [], since = '', sinceId = 0, pageSize = 500, maxPages = 20 } = {}) {
  const uid = await login(fetchFn, cfg)
  const want = [...new Set([...fields, 'id', 'write_date'])]
  const read = (where, order) => call(fetchFn, cfg, uid, model, 'search_read', [[...where, ...domain]], {
    fields: want, order, limit: pageSize, context: { active_test: false },
  })
  const second = (r) => String(r.write_date || '').slice(0, 19)
  const out = []
  let cursor = since ? String(since).slice(0, 19) : ''
  let lastId = Number(sinceId) || 0
  for (let page = 0; page < maxPages; page++) {
    // 1. Finish the second the cursor is in, by id.
    if (cursor && lastId !== -1) {
      const rows = await read([['write_date', '>=', cursor], ['write_date', '<', nextSecond(cursor)], ['id', '>', lastId]], 'id asc')
      out.push(...rows)
      if (rows.length === pageSize) { lastId = rows[rows.length - 1].id; continue }
      lastId = -1
      continue
    }
    // 2. The seconds after it, oldest first.
    const rows = await read(cursor ? [['write_date', '>=', nextSecond(cursor)]] : [], 'write_date asc, id asc')
    if (rows.length < pageSize) {
      out.push(...rows)
      if (rows.length) cursor = second(rows[rows.length - 1])
      return { rows: out, done: true, cursor: cursor ? `${cursor}|-1` : '' }
    }
    // A full page: its last second may go on past it, so that second is
    // left for step 1 (from its start) and only the seconds before it count.
    const last = second(rows[rows.length - 1])
    out.push(...rows.filter(r => second(r) < last))
    cursor = last
    lastId = 0
  }
  return { rows: out, done: false, cursor: cursor ? `${cursor}|${lastId}` : '' }
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

/**
 * Move deals into another team. Their battle-card values come along when
 * that team already holds the same fields (Odoo keeps a value whose name is
 * in the new team's definition), so the fields go on the team first.
 */
export async function moveLeadsToTeam(fetchFn, cfg, ids, teamId) {
  const uid = await login(fetchFn, cfg)
  for (let i = 0; i < ids.length; i += 100) {
    await call(fetchFn, cfg, uid, 'crm.lead', 'write', [ids.slice(i, i + 100).map(Number), { team_id: Number(teamId) }])
  }
  return ids.length
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
  const rows = await call(fetchFn, cfg, uid, 'crm.lead', 'read', [ids.map(Number)], { fields: ['lead_properties', 'team_id', 'user_id'], context: { active_test: false } })
  return Object.fromEntries(rows.map((r) => [String(r.id), {
    props: r.lead_properties || [], teamId: Array.isArray(r.team_id) ? r.team_id[0] : null, userId: Array.isArray(r.user_id) ? r.user_id[0] : null,
  }]))
}

/** Write the lead's properties WHOLE ({ name: value }): Odoo replaces the set. */
export async function writeLeadProps(fetchFn, cfg, leadId, values) {
  const uid = await login(fetchFn, cfg)
  await call(fetchFn, cfg, uid, 'crm.lead', 'write', [[Number(leadId)], { lead_properties: values }])
  return true
}

// ─── Their history with us, for the battle card (2026-10-20) ───────────────

/**
 * Everything Odoo knows about this customer: their past deals (won, lost and
 * why, open) and their quotations and orders. Found by their email domain,
 * or by the exact email for a free address (gmail…), or by the exact company
 * name. Read only. `exclude` is the lead itself. Returns the raw rows; the
 * summing up is pure (historyLines in src/lib/sales/odooCard.js).
 */
export async function customerHistory(fetchFn, cfg, { email = '', company = '', odooName = '', freeEmail = false, ownDomains = [], exclude = null } = {}) {
  const addr = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const own = new Set([...ownDomains.map((d) => String(d).toLowerCase()), ...PLACEHOLDER_DOMAINS])
  const domain = !freeEmail && addr.includes('@') && !own.has(addr.split('@')[1]) ? addr.split('@')[1] : ''
  const core = companyCore(company)
  const uid = await login(fetchFn, cfg)
  // Companies (commercial partners) behind the contacts matching a condition;
  // more than MAX_COMPANIES means the key is shared or a placeholder
  // ("@1234.com" sits on 37 customers), so it identifies no one.
  const companiesFor = async (cond) => {
    const rows = await call(fetchFn, cfg, uid, 'res.partner', 'search_read', [[cond]], { fields: ['commercial_partner_id'], limit: 60, context: { active_test: false } })
    const ids = [...new Set(rows.map((p) => (Array.isArray(p.commercial_partner_id) ? p.commercial_partner_id[0] : p.id)))]
    return ids.length && ids.length <= MAX_COMPANIES ? ids : []
  }
  let matchedBy = null
  let companies = []
  if (domain) { companies = await companiesFor(['email', '=ilike', `%@${domain}`]); if (companies.length) matchedBy = 'email domain' }
  else if (freeEmail && addr) { companies = await companiesFor(['email', '=ilike', addr]); if (companies.length) matchedBy = 'email' }
  // Our client list knows the sender's domain and Odoo's own name for them
  // (Odoo's customers rarely carry an email): that exact name, whole.
  const exact = String(odooName || '').trim().replace(/[%_]/g, (c) => `\\${c}`)
  if (!companies.length && exact) { companies = await companiesFor(['name', '=ilike', exact]); if (companies.length) matchedBy = 'our client list' }
  if (!companies.length && core) { companies = await companiesFor(['name', 'ilike', core]); if (companies.length) matchedBy = 'company name' }
  const leadEmail = domain ? ['email_from', '=ilike', `%@${domain}`] : null
  if (!companies.length && !leadEmail) return { matchedBy: null, companies: [], deals: [], orders: [] }
  const anyOf = (conds) => [...Array(conds.length - 1).fill('|'), ...conds]
  const dealDomain = anyOf([companies.length ? ['partner_id', 'child_of', companies] : null, leadEmail].filter(Boolean))
  const names = companies.length ? await call(fetchFn, cfg, uid, 'res.partner', 'read', [companies], { fields: ['name'] }) : []
  const [deals, orders] = await Promise.all([
    dealDomain.length
      ? call(fetchFn, cfg, uid, 'crm.lead', 'search_read', [[...dealDomain, ...(exclude ? [['id', '!=', Number(exclude)]] : [])]], {
          fields: ['active', 'probability', 'stage_id', 'lost_reason_id', 'date_closed', 'create_date', 'expected_revenue', 'user_id'],
          order: 'create_date desc', limit: 100, context: { active_test: false },
        })
      : [],
    companies.length
      ? call(fetchFn, cfg, uid, 'sale.order', 'search_read', [[['partner_id', 'child_of', companies], ['state', '!=', 'cancel']]], {
          fields: ['state', 'amount_total', 'date_order', 'user_id'], order: 'date_order desc', limit: 200,
        })
      : [],
  ])
  if (!companies.length && deals.length) matchedBy = 'email domain'
  return { matchedBy: deals.length || orders.length ? matchedBy : null, companies: names.map((n) => ({ id: n.id, name: n.name })), deals, orders }
}

/**
 * Domains that name no company: reserved test domains, and the made-up ones
 * typed into Odoo when a contact's real email was unknown (2026-10-20:
 * "@1234.com" on 37 customers, "@123.com" and "@abc.com" on 7 each).
 */
export const PLACEHOLDER_DOMAINS = ['example.com', 'example.org', 'example.net', 'test.com', 'domain.com', 'email.com', 'mail.com', '123.com', '1234.com', '12345.com', 'abc.com', 'xyz.com', 'none.com', 'na.com']

/** More companies than this behind one email domain or name: it identifies no one. */
const MAX_COMPANIES = 3

// Words that say what kind of company it is, not which one.
const COMPANY_WORDS = /\b(co|company|corp|corporation|est|establishment|llc|ltd|limited|inc|trading|contracting|contractors?|group|holding|international|intl|for|and|the|of|ksa|saudi|arabia|w\.?l\.?l|l\.?l\.?c)\b/gi

/** "Example Contracting Co. Ltd" → "Example". '' when too little is left to identify anyone. */
export function companyCore(name = '') {
  const core = String(name || '').replace(/[().,&/\\-]+/g, ' ').replace(COMPANY_WORDS, ' ').replace(/\s+/g, ' ').trim()
  return core.length >= 5 ? core : ''
}

// ─── The next step as an Activity (a to-do with a due date) ────────────────

/** The ids an activity on a lead needs: crm.lead's model id and the To-Do type. */
async function activityRefs(fetchFn, cfg, uid) {
  const [model] = await call(fetchFn, cfg, uid, 'ir.model', 'search', [[['model', '=', 'crm.lead']]], { limit: 1 })
  const [todo] = await call(fetchFn, cfg, uid, 'mail.activity.type', 'search', [['|', ['name', '=', 'To-Do'], ['name', '=', 'To Do']]], { limit: 1 })
  const type = todo || (await call(fetchFn, cfg, uid, 'mail.activity.type', 'search', [[['res_model', '=', false]]], { limit: 1 }))[0]
  if (!model || !type) throw new OdooError('Odoo has no To-Do activity type to schedule the next step with.')
  return { modelId: model, typeId: type }
}

/** Schedule the next step on the lead for this Odoo user. Returns the activity id. */
export async function createActivity(fetchFn, cfg, leadId, { summary, date, userId }) {
  const uid = await login(fetchFn, cfg)
  const { modelId, typeId } = await activityRefs(fetchFn, cfg, uid)
  return call(fetchFn, cfg, uid, 'mail.activity', 'create', [{
    res_model_id: modelId, res_id: Number(leadId), activity_type_id: typeId,
    summary, date_deadline: date || new Date().toISOString().slice(0, 10), ...(userId ? { user_id: userId } : {}),
  }])
}

/** Change an open activity's text, date or person. */
export async function writeActivity(fetchFn, cfg, id, { summary, date, userId }) {
  const uid = await login(fetchFn, cfg)
  await call(fetchFn, cfg, uid, 'mail.activity', 'write', [[Number(id)], {
    summary, date_deadline: date || new Date().toISOString().slice(0, 10), ...(userId ? { user_id: userId } : {}),
  }])
  return true
}

/** Mark an activity done (it leaves the to-do list; Odoo logs it on the lead). */
export async function doneActivity(fetchFn, cfg, id, feedback = '') {
  const uid = await login(fetchFn, cfg)
  await call(fetchFn, cfg, uid, 'mail.activity', 'action_feedback', [[Number(id)]], { feedback })
  return true
}

/** { id: { summary, date } } for the activities still open; done ones are gone. */
export async function readActivities(fetchFn, cfg, ids) {
  if (!ids.length) return {}
  const uid = await login(fetchFn, cfg)
  const rows = await call(fetchFn, cfg, uid, 'mail.activity', 'search_read', [[['id', 'in', ids.map(Number)]]], { fields: ['summary', 'date_deadline'] })
  return Object.fromEntries(rows.map((r) => [String(r.id), { summary: r.summary || '', date: r.date_deadline || null }]))
}

/** An internal note in the lead's history (never emailed to the customer). */
export async function postNote(fetchFn, cfg, leadId, html) {
  const uid = await login(fetchFn, cfg)
  return call(fetchFn, cfg, uid, 'crm.lead', 'message_post', [[Number(leadId)]], {
    body: html, body_is_html: true, message_type: 'comment', subtype_xmlid: 'mail.mt_note',
  })
}
