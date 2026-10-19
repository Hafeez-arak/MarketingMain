// ─── The CEO's control panel, on the server ────────────────────────────────
// 2026-10-18. Gathers the rows src/lib/control/panel.js turns into six
// numbers, three decisions, one row per salesperson and the top ten
// customers, and does the few things the panel's buttons and clocks need:
//
//   controlPanel     everything the CEO page shows, in one answer (admin)
//   saveTargets      his targets and who gets the emails (admin)
//   saveRouting      the routing rules (admin)
//   markLead         "replied" / "quote sent" / deal value on a lead (sales)
//   remind           a bell notification to the person who owns a late lead
//   accountContacted "we spoke to them today" on a key account
//   sendToSales      a research project handed to a salesperson
//   routeWaiting     give new qualified leads an owner by the rules (the
//                    website Sheet's 5-minute call, and the daily cron)
//   runDailyAlerts   the one daily email (the daily cron, 05:00 UTC = 08:00 Riyadh)
//   sendWeeklySummary the Sunday five lines; weeklyIfDue decides when (the
//                    daily cron at 08:00 Riyadh, an hour after the brief)
//
// Lives behind /api/leads/<action> because Vercel Hobby builds twelve
// functions and all twelve exist. Needs migration 20261025_ceo_control.
//
//   deps: as in _assign.js (db, fetch, now, sendAlert, ms, open, seal).

import {
  targetsOf, controlKpis, controlDecisions, repRows, keyAccounts, topOpportunities,
  marketingNumbers, leadsToRoute, routeLead, dailyAlertItems, dailyAlertEmail, weeklyLines, weeklyEmail,
  leadWho, LOOKBACK_DAYS, redWhy,
} from '../../src/lib/control/panel.js'
import { REGIONS } from '../../src/lib/control/region.js'
import { assignLead } from './_assign.js'
import { readMirror } from './_odooSync.js'
import { odooFacts, withOdoo } from '../../src/lib/control/odoo.js'

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))
const ws = (id) => `workspace_id=eq.${encodeURIComponent(id)}`
const DAY = 86_400_000
const enc = encodeURIComponent

const LEAD_COLS = 'id,source,received_at,created_at,verdict,human_verdict,duplicate_of,company,name,email,subject,summary,details,' +
  'sender_type,project_type,human_project_type,project_final,assigned_to,assigned_at,approved_at,crm_status,crm_url,' +
  'first_reply_at,quote_sent_at,deal_value_sar,late_alerted,routed_by_rule'

/** A daily round that ran this recently is not run again (two crons, retries). */
const ALERTS_EVERY_MS = 20 * 3_600_000
/** Each 5-minute call gives at most this many leads an owner: each forwards an email. */
const ROUTE_PER_ROUND = 5

// Applying supabase/migrations/20261025_ceo_control.sql fixes it (docs/CEO-CONTROL-PANEL.md).
export const MIGRATION_MISSING = 'The CEO panel’s tables are not set up in the database yet, so it has nothing to show.'

/** PostgREST's "column/relation does not exist", as opposed to a real failure. */
const isMissing = (err) => /does not exist|42703|42P01|PGRST204|PGRST205|schema cache/i.test(String(err?.message || err))

/** Leads with the Pipeline's stage when #244's columns exist, without when they do not. */
async function readLeads(deps, workspaceId, filter) {
  const base = `leads?${ws(workspaceId)}&${filter}&order=received_at.desc&limit=2000&select=${LEAD_COLS}`
  try {
    return await deps.db(`${base},stage,stage_at`) || []
  } catch (err) {
    if (!isMissing(err)) throw err
    return await deps.db(base) || []
  }
}

/** The sales team: everyone with an approved sales seat here. */
export async function salesTeam(deps, workspaceId) {
  const seats = await deps.db(`sales_seats?${ws(workspaceId)}&select=user_id`) || []
  if (!seats.length) return []
  const ids = seats.map((s) => s.user_id).filter(isUuid)
  const people = await deps.db(`user_access?user_id=in.(${ids.join(',')})&status=eq.approved&role=eq.sales&select=user_id,email,full_name,leads_approver`) || []
  return people.map((p) => ({ id: p.user_id, email: p.email, name: p.full_name || String(p.email || '').split('@')[0], salesAdmin: Boolean(p.leads_approver) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Everything the panel needs, in parallel. Throws MIGRATION_MISSING when the tables are not there. */
export async function gatherControl(deps, workspaceId, now = deps.now()) {
  const qualified = 'or=(verdict.eq.qualified,human_verdict.eq.qualified)'
  const from120 = new Date(now.getTime() - 120 * DAY).toISOString()
  const week = new Date(now.getTime() - 8 * DAY).toISOString()
  const from90 = new Date(now.getTime() - 90 * DAY).toISOString().slice(0, 10)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const month = monthStart.slice(0, 7)
  let targets, rules
  try {
    ;[[targets], rules] = await Promise.all([
      deps.db(`company_targets?${ws(workspaceId)}&select=*`).then((r) => r || []),
      deps.db(`lead_routing_rules?${ws(workspaceId)}&select=*&order=position`).then((r) => r || []),
    ])
  } catch (err) {
    if (isMissing(err)) throw new Error(MIGRATION_MISSING, { cause: err })
    throw err
  }
  const [leads, team, accounts, opportunities, outcomes, plans, published, websiteLeads, linkedin] = await Promise.all([
    readLeads(deps, workspaceId, `${qualified}&received_at=gte.${enc(from120)}`),
    salesTeam(deps, workspaceId),
    deps.db(`sales_accounts?${ws(workspaceId)}&select=id,name,orders,value_sar,last_order,open_deals,open_value_sar,status,owner,next_step_on,last_contact_at,priority`).then((r) => r || []),
    deps.db(`research_opportunities?${ws(workspaceId)}&first_seen_at=gte.${enc(week)}&order=first_seen_at.desc&limit=60` +
      '&select=id,name,client,location,stage,deadline,relevance,suggested_action,source_url,package,package_value_sar,value_sar,status,first_seen_at,sent_to,sent_at').then((r) => r || []),
    deps.db(`deal_outcomes?${ws(workspaceId)}&decided_on=gte.${from90}&select=outcome,value_sar,decided_on`).then((r) => r || []).catch(() => []),
    deps.db(`content_plans?${ws(workspaceId)}&month=eq.${month}&select=id`).then((r) => r || []).catch(() => []),
    deps.db(`generated_posts?${ws(workspaceId)}&published_at=gte.${enc(monthStart)}&select=id`).then((r) => r || []).catch(() => []),
    deps.db(`leads?${ws(workspaceId)}&source=eq.website_form&received_at=gte.${enc(monthStart)}&duplicate_of=is.null&select=id`).then((r) => r || []).catch(() => []),
    deps.db(`social_accounts?${ws(workspaceId)}&platform=eq.linkedin&select=followers_count`).then((r) => r || []).catch(() => []),
  ])
  // Odoo's numbers, from the mirror (_odooSync.js), when there is one.
  const mirror = await readMirror(deps, workspaceId).catch(() => ({ status: null }))
  const odoo = mirror.records ? odooFacts(mirror.records, { now, models: mirror.models, url: mirror.url }) : null
  // Technical's health per project (project_flags, v2). Where it exists,
  // "projects at risk" is the projects Technical shows red, so the CEO's
  // number, his daily alert and the Technical page agree.
  const projectFlags = await deps.db(`project_flags?${ws(workspaceId)}&select=odoo_project_id,name,level,reasons,red_since,alerted_at`).catch(() => null)
  const projectManagers = Array.isArray(projectFlags) && projectFlags.some(p => p.level === 'red')
    ? await deps.db('rpc/project_managers', { method: 'POST', body: { ws: workspaceId } }).catch(() => []) || []
    : []
  if (odoo && Array.isArray(projectFlags) && odoo.projects_at_risk !== null) odoo.projects_at_risk = projectFlags.filter(p => p.level === 'red').length

  let planned = 0
  if (plans.length) {
    const ideas = await deps.db(`plan_ideas?plan_id=in.(${plans.map((p) => p.id).join(',')})&status=neq.rejected&select=id`).catch(() => []) || []
    planned = ideas.length
  }
  return {
    now, targets: targets || null, rules, leads, team, opportunities, outcomes, odoo, odooStatus: mirror.status || null, projectFlags: projectFlags || [], projectManagers,
    // Key accounts with Odoo's live last order and open deals where the
    // customer's name matches; the October analysis's figures otherwise.
    accounts: odoo ? accounts.map(a => withOdoo(a, odoo)) : accounts,
    marketing: {
      planned,
      published: published.length,
      websiteLeads: websiteLeads.length,
      linkedinFollowers: linkedin.length ? linkedin.reduce((s, a) => s + (Number(a.followers_count) || 0), 0) : null,
    },
  }
}

/** The CEO page's whole answer. */
export async function controlPanel(deps, { workspaceId }) {
  const f = await gatherControl(deps, workspaceId)
  const args = { ...f, targets: f.targets }
  const t = targetsOf(f.targets)
  return {
    targets: { ...t, saved: Boolean(f.targets) },
    rules: f.rules,
    team: f.team,
    regions: REGIONS,
    kpis: controlKpis(args),
    decisions: controlDecisions(args),
    reps: repRows(args),
    accounts: keyAccounts(f.accounts, f.targets, f.now),
    opportunities: topOpportunities(f.opportunities, f.now),
    marketing: marketingNumbers(f.marketing),
    unowned: f.leads.filter((l) => !l.assigned_to && !l.duplicate_of).length,
    lookbackDays: LOOKBACK_DAYS,
    // The facts without the per-customer map (the accounts carry it already).
    odoo: f.odoo ? { ...f.odoo, byPartner: undefined } : null,
    odooStatus: f.odooStatus,
    at: f.now.toISOString(),
  }
}

// ── Saving ──

const NUM_FIELDS = ['revenue_month_sar', 'pipeline_sar', 'quotes_week', 'win_rate_pct', 'first_reply_hours', 'quote_hours', 'key_account_quiet_days', 'amber_pct']
const REQUIRED_NUM = new Set(['first_reply_hours', 'quote_hours', 'key_account_quiet_days', 'amber_pct'])
const emailList = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/))
  .map((s) => String(s).trim().toLowerCase()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)))].slice(0, 10)

/** His targets, the two email lists, and routing on/off with its fallback person. */
export async function saveTargets(deps, { workspaceId, body, user }) {
  const patch = {}
  for (const k of NUM_FIELDS) {
    if (!(k in body)) continue
    const raw = body[k]
    if (raw === null || raw === '') {
      if (REQUIRED_NUM.has(k)) return { status: 400, error: `${k.replace(/_/g, ' ')} cannot be empty.` }
      patch[k] = null
      continue
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return { status: 400, error: `${k.replace(/_/g, ' ')} must be a number of 0 or more.` }
    if (REQUIRED_NUM.has(k) && k !== 'amber_pct' && n === 0) return { status: 400, error: `${k.replace(/_/g, ' ')} must be more than 0.` }
    if ((k === 'win_rate_pct' || k === 'amber_pct') && n > 100) return { status: 400, error: `${k.replace(/_/g, ' ')} is a percentage, 0 to 100.` }
    patch[k] = k === 'quotes_week' || k === 'key_account_quiet_days' ? Math.round(n) : n
  }
  if ('brief_emails' in body) patch.brief_emails = emailList(body.brief_emails)
  if ('alert_emails' in body) patch.alert_emails = emailList(body.alert_emails)
  const [cur] = await deps.db(`company_targets?${ws(workspaceId)}&select=routing_enabled,routing_since`) || []
  if ('routing_fallback' in body) {
    if (body.routing_fallback && !(await salesTeam(deps, workspaceId)).some((p) => p.id === body.routing_fallback)) {
      return { status: 400, error: 'The fallback person must be on the sales team.' }
    }
    patch.routing_fallback = body.routing_fallback || null
  }
  if ('routing_enabled' in body) {
    patch.routing_enabled = Boolean(body.routing_enabled)
    // The clock starts when it is switched on: older leads are never swept up.
    if (patch.routing_enabled && !cur?.routing_enabled) patch.routing_since = deps.now().toISOString()
  }
  const [row] = await deps.db('company_targets?on_conflict=workspace_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
    body: { workspace_id: workspaceId, ...patch, updated_by: user?.id || null, updated_at: deps.now().toISOString() },
  }) || []
  return { targets: targetsOf(row) }
}

/** Replaces the rules with the list given, in its order. */
export async function saveRouting(deps, { workspaceId, body }) {
  const list = Array.isArray(body.rules) ? body.rules.slice(0, 50) : null
  if (!list) return { status: 400, error: 'Send the rules as a list.' }
  const team = new Set((await salesTeam(deps, workspaceId)).map((p) => p.id))
  const regions = new Set(['', ...REGIONS.map((r) => r.key)])
  const rows = []
  for (const [i, r] of list.entries()) {
    if (!team.has(r.assign_to)) return { status: 400, error: `Rule ${i + 1}: pick someone on the sales team.` }
    if (!regions.has(r.region || '')) return { status: 400, error: `Rule ${i + 1}: unknown region.` }
    rows.push({
      workspace_id: workspaceId, position: i + 1,
      sender_type: String(r.sender_type || '').slice(0, 40), region: r.region || '',
      project_type: String(r.project_type || '').slice(0, 40), assign_to: r.assign_to,
      note: String(r.note || '').slice(0, 200),
    })
  }
  await deps.db(`lead_routing_rules?${ws(workspaceId)}`, { method: 'DELETE', prefer: 'return=minimal' })
  const saved = rows.length ? await deps.db('lead_routing_rules', { method: 'POST', prefer: 'return=representation', body: rows }) || [] : []
  return { rules: saved }
}

/**
 * What a salesperson marks on a lead until Odoo says it for them: first
 * reply sent, quote sent (with its value), or either cleared. `at` defaults
 * to now and may not be in the future.
 */
export async function markLead(deps, { workspaceId, body }) {
  if (!isUuid(body.lead_id)) return { status: 400, error: 'Which lead?' }
  const what = String(body.what || '')
  const now = deps.now()
  let at = body.at ? new Date(body.at) : now
  if (Number.isNaN(at.getTime())) return { status: 400, error: 'That date could not be read.' }
  if (at.getTime() > now.getTime() + 60_000) at = now
  const patch = { updated_at: now.toISOString() }
  if (what === 'replied') patch.first_reply_at = at.toISOString()
  else if (what === 'quote_sent') {
    patch.quote_sent_at = at.toISOString()
    if (body.deal_value_sar !== undefined && body.deal_value_sar !== '' && body.deal_value_sar !== null) {
      const v = Number(body.deal_value_sar)
      if (!Number.isFinite(v) || v < 0) return { status: 400, error: 'The quote value must be a number of 0 or more.' }
      patch.deal_value_sar = v
    }
  } else if (what === 'clear_reply') patch.first_reply_at = null
  else if (what === 'clear_quote') { patch.quote_sent_at = null; patch.deal_value_sar = null }
  else return { status: 400, error: 'Mark it replied or quote sent.' }
  // A quote is also a reply.
  if (patch.quote_sent_at) {
    const [cur] = await deps.db(`leads?id=eq.${body.lead_id}&${ws(workspaceId)}&select=first_reply_at`) || []
    if (!cur) return { status: 404, error: 'That lead is not in this company.' }
    if (!cur.first_reply_at) patch.first_reply_at = patch.quote_sent_at
  }
  const [row] = await deps.db(`leads?id=eq.${body.lead_id}&${ws(workspaceId)}`, { method: 'PATCH', prefer: 'return=representation', body: patch }) || []
  if (!row) return { status: 404, error: 'That lead is not in this company.' }
  return { lead: { id: row.id, first_reply_at: row.first_reply_at, quote_sent_at: row.quote_sent_at, deal_value_sar: row.deal_value_sar } }
}

const notify = async (deps, rows) => (rows.length ? deps.db('notifications', { method: 'POST', prefer: 'return=minimal', body: rows }) : null)

/** "Remind": the lead's owner gets it in their bell, with who asked. */
export async function remind(deps, { workspaceId, body, user }) {
  if (!isUuid(body.lead_id)) return { status: 400, error: 'Which lead?' }
  const [lead] = await deps.db(`leads?id=eq.${body.lead_id}&${ws(workspaceId)}&select=id,company,name,email,assigned_to,quote_sent_at,first_reply_at`) || []
  if (!lead) return { status: 404, error: 'That lead is not in this company.' }
  if (!lead.assigned_to) return { status: 400, error: 'Nobody owns this lead yet. Assign it instead.' }
  const [me] = isUuid(user?.id) ? await deps.db(`user_access?user_id=eq.${user.id}&select=full_name,email`) || [] : []
  const by = me?.full_name || String(me?.email || '').split('@')[0] || 'Management'
  const what = lead.first_reply_at ? 'the quote' : 'a first reply'
  await notify(deps, [{
    user_id: lead.assigned_to, workspace_id: workspaceId, kind: 'reminder',
    title: `${by}: ${leadWho(lead)} is waiting for ${what}`,
    body: 'Please send it today, then mark it on the lead.',
    link: '/leads',
  }])
  return { reminded: lead.assigned_to }
}

/**
 * The CEO's "Remind" on a red project: a task for its project manager (the
 * Tasks system then reminds and chases), due tomorrow, at most one a day.
 */
export async function remindProject(deps, { workspaceId, body, user }) {
  const pid = Number(body.project_id)
  if (!Number.isInteger(pid) || pid <= 0) return { status: 400, error: 'Which project?' }
  const [flag] = await deps.db(`project_flags?${ws(workspaceId)}&odoo_project_id=eq.${pid}&select=name,level,reasons`) || []
  if (!flag) return { status: 404, error: 'That project is not watched here.' }
  const managers = await deps.db('rpc/project_managers', { method: 'POST', body: { ws: workspaceId } }) || []
  const pm = managers.find(m => Number(m.odoo_project_id) === pid)
  if (!pm?.user_id) return { status: 400, error: 'Its project manager in Odoo has no login here yet.' }
  const why = redWhy(flag.reasons || [])
  const now = deps.now()
  const day = new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)
  const [made] = await deps.db('tasks?on_conflict=workspace_id,auto_key', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: [{
      workspace_id: workspaceId, title: `Get ${flag.name} back on track: ${why.en}`,
      details: `Asked from the CEO page. ${why.ar}\nSay what is being done in this week's update on the project.`,
      assigned_to: pm.user_id, created_by: isUuid(user?.id) ? user.id : null, updated_by: isUuid(user?.id) ? user.id : null,
      due_at: new Date(now.getTime() + DAY).toISOString(), priority: 'high', section: 'technical', status: 'todo',
      odoo_project_id: pid, auto_key: `ceo_remind:${pid}:${day}`,
    }],
  }) || []
  return { reminded: pm.user_id, task: made?.id || null, already: !made }
}

/** A key account was spoken to today. */
export async function accountContacted(deps, { workspaceId, body }) {
  if (!isUuid(body.account_id)) return { status: 400, error: 'Which account?' }
  const now = deps.now().toISOString()
  const [row] = await deps.db(`sales_accounts?id=eq.${body.account_id}&${ws(workspaceId)}`, {
    method: 'PATCH', prefer: 'return=representation', body: { last_contact_at: now, updated_at: now },
  }) || []
  if (!row) return { status: 404, error: 'That account is not in this company.' }
  return { account: { id: row.id, last_contact_at: row.last_contact_at } }
}

/** A research project becomes a salesperson's task: marked sent, and in their bell with the details. */
export async function sendToSales(deps, { workspaceId, body, user }) {
  if (!isUuid(body.opportunity_id)) return { status: 400, error: 'Which project?' }
  const person = (await salesTeam(deps, workspaceId)).find((p) => p.id === body.user_id)
  if (!person) return { status: 400, error: 'Pick someone on the sales team.' }
  const now = deps.now().toISOString()
  const [o] = await deps.db(`research_opportunities?id=eq.${body.opportunity_id}&${ws(workspaceId)}&sent_at=is.null`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { sent_to: person.id, sent_at: now, sent_by: user?.id || null, status: 'assigned', updated_at: now },
  }) || []
  if (!o) return { status: 409, error: 'That project was already sent to sales, or is not in this company.' }
  const lines = [
    o.client && `Client: ${o.client}`, o.location && `Where: ${o.location}`, o.stage && `Stage: ${o.stage}`,
    o.deadline && `Deadline: ${o.deadline}`, o.package && `Our package: ${o.package}`,
    o.suggested_action && `Suggested next step: ${o.suggested_action}`, o.source_url && `Source: ${o.source_url}`,
  ].filter(Boolean)
  await notify(deps, [{
    user_id: person.id, workspace_id: workspaceId, kind: 'opportunity',
    title: `New project for you: ${String(o.name || '').slice(0, 100)}`,
    body: lines.join('\n').slice(0, 1500),
    link: o.source_url || '',
  }])
  return { opportunity: { id: o.id, sent_to: person.id, sent_at: o.sent_at } }
}

// ── The clocks ──

/** Gives new qualified leads an owner by the rules. Quiet when routing is off. */
export async function routeWaiting(deps, { workspaceId, appUrl = '' }) {
  let targets, rules
  try {
    ;[[targets], rules] = await Promise.all([
      deps.db(`company_targets?${ws(workspaceId)}&select=*`).then((r) => r || []),
      deps.db(`lead_routing_rules?${ws(workspaceId)}&select=*&order=position`).then((r) => r || []),
    ])
  } catch (err) {
    if (isMissing(err)) return { off: true }
    throw err
  }
  const t = targetsOf(targets)
  if (!t.routing_enabled || !t.routing_since) return { off: true }
  const waiting = await deps.db(`leads?${ws(workspaceId)}&assigned_to=is.null&duplicate_of=is.null&received_at=gte.${enc(t.routing_since)}` +
    `&or=(verdict.eq.qualified,human_verdict.eq.qualified)&order=received_at&limit=50&select=${LEAD_COLS}`) || []
  const out = []
  for (const lead of leadsToRoute(waiting, t).slice(0, ROUTE_PER_ROUND)) {
    const pick = routeLead(lead, rules, t.routing_fallback)
    if (!pick) { out.push({ lead: lead.id, to: null }); continue }
    // Assigning forwards the email, exactly as a sales admin's Assign does.
    const a = await assignLead(deps, { workspaceId, leadId: lead.id, to: pick.to, user: { id: null }, appUrl }).catch((err) => ({ error: String(err.message || err) }))
    if (!a.error && pick.ruleId) {
      await deps.db(`leads?id=eq.${lead.id}&${ws(workspaceId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { routed_by_rule: pick.ruleId } }).catch(() => null)
    }
    out.push({ lead: lead.id, to: pick.to, rule: pick.ruleId, error: a.error || '', forwarded: Boolean(a.forward?.ok) })
  }
  return { routed: out }
}

/**
 * The one daily email (requirement 12) to company_targets.alert_emails,
 * and each salesperson's own late leads in their bell. Each lateness is
 * told once (leads.late_alerted).
 */
export async function runDailyAlerts(deps, { workspaceId, force = false, pageUrl = '' }) {
  const now = deps.now()
  let f
  try { f = await gatherControl(deps, workspaceId, now) } catch (err) {
    if (String(err.message) === MIGRATION_MISSING) return { off: true }
    throw err
  }
  const t = targetsOf(f.targets)
  if (!f.targets) return { off: true }
  if (!force && f.targets.last_alerts_at && now.getTime() - Date.parse(f.targets.last_alerts_at) < ALERTS_EVERY_MS) return { skipped: true }

  const items = dailyAlertItems({ ...f, now })
  const to = (t.alert_emails || []).filter(Boolean)
  const [w] = await deps.db(`workspaces?id=eq.${workspaceId}&select=name`) || []
  const mail = dailyAlertEmail(items, { company: w?.name || 'Arak', pageUrl })
  let sent = null
  if (mail && to.length && deps.sendAlert) {
    sent = await deps.sendAlert({ workspaceId, to, ...mail }).catch((err) => ({ ok: false, error: err }))
    // Not sent: nothing is marked told, so tomorrow tries again.
    if (!sent?.ok) return { items: items.length, error: String(sent?.error?.message || sent?.error || 'not sent') }
  }
  const stamp = now.toISOString()
  const byLead = new Map()
  for (const i of items) if (i.leadId) byLead.set(i.leadId, [...(byLead.get(i.leadId) || []), i.kind])
  const redTold = items.filter((i) => i.kind === 'project_red').map((i) => i.projectId)
  if (redTold.length) {
    await deps.db(`project_flags?${ws(workspaceId)}&odoo_project_id=in.(${redTold.join(',')})`, { method: 'PATCH', prefer: 'return=minimal', body: { alerted_at: stamp } }).catch(() => null)
  }
  for (const l of f.leads.filter((x) => byLead.has(x.id))) {
    const told = { ...(l.late_alerted || {}) }
    for (const k of byLead.get(l.id)) told[k] = stamp
    await deps.db(`leads?id=eq.${l.id}&${ws(workspaceId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { late_alerted: told } }).catch(() => null)
  }
  await notify(deps, items.filter((i) => i.userId).map((i) => ({
    user_id: i.userId, workspace_id: workspaceId, kind: i.kind,
    title: i.en, body: i.ar, link: '/leads',
  }))).catch(() => null)
  await deps.db(`company_targets?${ws(workspaceId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { last_alerts_at: stamp } })
  return { items: items.length, sent: Boolean(sent?.ok), to }
}

/** The Sunday five lines (requirement 13), from the brief just written. */
export async function sendWeeklySummary(deps, { workspaceId, brief = null, pageUrl = '' }) {
  const now = deps.now()
  let f
  try { f = await gatherControl(deps, workspaceId, now) } catch (err) {
    if (String(err.message) === MIGRATION_MISSING) return { off: true }
    throw err
  }
  const t = targetsOf(f.targets)
  const to = (t.brief_emails || []).filter(Boolean)
  if (!to.length) return { off: true }
  const decisions = controlDecisions({ ...f, now })
  const lines = weeklyLines({ brief: brief?.brief || brief, decisions, leads: f.leads, outcomes: f.outcomes, odoo: f.odoo, targets: f.targets, now })
  const [w] = await deps.db(`workspaces?id=eq.${workspaceId}&select=name`) || []
  const mail = weeklyEmail(lines, { company: w?.name || 'Arak', pageUrl, weekOf: now.toISOString().slice(0, 10) })
  const sent = await deps.sendAlert({ workspaceId, to, ...mail }).catch((err) => ({ ok: false, error: err }))
  if (sent?.ok) await deps.db(`company_targets?${ws(workspaceId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { last_summary_at: now.toISOString() } })
  return { sent: Boolean(sent?.ok), to, lines, error: sent?.ok ? '' : String(sent?.error?.message || sent?.error || 'not sent') }
}

/** Sunday in Riyadh (UTC+3, no daylight saving). */
const isRiyadhSunday = (now) => new Date(now.getTime() + 3 * 3_600_000).getUTCDay() === 0

/**
 * The daily cron's question: is the Sunday summary due? On a Riyadh Sunday,
 * once (last_summary_at), with the brief written that morning (Sunday 07:00
 * Riyadh, api/agent/chat.js) when there is one. The summary goes out here
 * rather than from the brief's own cron so the agent container, which also
 * serves chat.js, does not have to carry the lead agent's code.
 */
export async function weeklyIfDue(deps, { workspaceId, pageUrl = '' }) {
  const now = deps.now()
  if (!isRiyadhSunday(now)) return { off: true }
  const [row] = await deps.db(`company_targets?${ws(workspaceId)}&select=last_summary_at`).catch(() => []) || []
  if (!row) return { off: true }
  if (row.last_summary_at && now.getTime() - Date.parse(row.last_summary_at) < 6 * DAY) return { skipped: true }
  const since = new Date(now.getTime() - 12 * 3_600_000).toISOString()
  const [brief] = await deps.db(`ceo_briefs?${ws(workspaceId)}&created_at=gte.${enc(since)}&order=created_at.desc&limit=1&select=brief`).catch(() => []) || []
  return sendWeeklySummary(deps, { workspaceId, brief: brief?.brief || null, pageUrl })
}
