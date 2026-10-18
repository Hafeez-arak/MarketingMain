import { db } from './_supabase.js'
import {
  periodBounds, summariseLeads, leadRow, filterLeads, summariseTargets, summariseDeals,
  summariseEmail, sendStats, teamRows, nameIndex, untrusted,
} from '../../src/lib/agent/company.js'

// ─── The company belt's executors ──────────────────────────────────────────
// Definitions in src/lib/agent/companyTools.js, arithmetic in company.js.
// Read that header for who gets which tool; runTool enforces it before
// anything here runs.
//
// Every query carries its own workspace_id filter, like every other agent
// tool. The service key skips RLS, and RLS is not isolation in this app
// anyway: the operators belong to every company.

const ws = workspaceId => `workspace_id=eq.${encodeURIComponent(workspaceId)}`
const PAGE = 1000

/**
 * Every row of a read, paging past PostgREST's 1,000-row cap. A silent cap is
 * how a count of 1,000 gets quoted as the real number. `max` bounds a runaway.
 */
async function readAll(path, max = 10_000) {
  const out = []
  for (let offset = 0; offset < max; offset += PAGE) {
    const rows = await db(`${path}&limit=${PAGE}&offset=${offset}`)
    if (!Array.isArray(rows) || !rows.length) break
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

const LEAD_COLS = [
  'id', 'received_at', 'created_at', 'source', 'mailbox', 'name', 'company', 'subject',
  'verdict', 'human_verdict', 'category', 'project_type', 'human_project_type', 'project_final',
  'request_type', 'sender_type', 'summary', 'ask_next', 'reviewed_at', 'approved_at',
  'assigned_to', 'assigned_at', 'crm_status',
].join(',')

/** Leads that arrived since `since`. received_at can be null on old rows, so created_at backs it up. */
async function leadsSince(workspaceId, since) {
  const s = encodeURIComponent(since)
  return readAll(
    `leads?${ws(workspaceId)}&or=(received_at.gte.${s},and(received_at.is.null,created_at.gte.${s}))` +
    `&order=received_at.desc.nullslast&select=${LEAD_COLS}`,
  )
}

/** Everyone's display name. user_access is app-wide, not per company, by design. */
async function names() {
  const rows = await db('user_access?select=user_id,email,full_name')
  return nameIndex(rows || [])
}

async function getLeadsSummary(workspaceId, args) {
  const p = periodBounds(args?.days)
  // The open review queue is reported whatever the window, so read far
  // enough back to see it: a lead waiting since last quarter still counts.
  const [rows, queue, n] = await Promise.all([
    leadsSince(workspaceId, p.prevFrom),
    readAll(`leads?${ws(workspaceId)}&reviewed_at=is.null&select=${LEAD_COLS}`),
    names(),
  ])
  const seen = new Set(rows.map(r => r.id))
  const all = [...rows, ...queue.filter(r => !seen.has(r.id))]
  return summariseLeads(all, { ...p, names: n })
}

async function getLeads(workspaceId, args) {
  const p = periodBounds(args?.days)
  const limit = Math.min(Math.max(Math.floor(Number(args?.limit) || 25), 1), 100)
  const [rows, n] = await Promise.all([leadsSince(workspaceId, p.from), names()])
  const hits = filterLeads(rows, args || {})
  return {
    window: { from: p.from, to: p.to },
    matching: hits.length,
    shown: Math.min(hits.length, limit),
    leads: hits.slice(0, limit).map(l => leadRow(l, n)),
    note: hits.length ? '' : 'No lead matches those filters in this window.',
  }
}

async function getLead(workspaceId, args) {
  const id = String(args?.id || '').trim()
  if (!id) return { error: 'Give the lead id from get_leads.' }
  const [rows, cards, n] = await Promise.all([
    db(`leads?id=eq.${encodeURIComponent(id)}&${ws(workspaceId)}&select=*&limit=1`),
    db(`lead_cards?lead_id=eq.${encodeURIComponent(id)}&${ws(workspaceId)}&select=card,decision,quote_due,target_price,decides,competitors,built_at&limit=1`),
    names(),
  ])
  const l = rows?.[0]
  if (!l) return { error: 'No lead with that id in this company.' }
  const who = uid => (uid ? n.get(uid) || 'someone no longer listed' : '')
  const card = cards?.[0] || null
  return {
    ...leadRow(l, n),
    contact: {
      email: l.email || '',
      phone: l.phone || '',
      other_phones: Array.isArray(l.phones) ? l.phones : [],
      website: l.website || '',
    },
    // The one place the raw message is returned, wrapped. See company.js.
    message: untrusted(l.message),
    agent_reasoning: String(l.reason || '').slice(0, 1200),
    agent_confidence: l.confidence ?? null,
    sender_evidence: String(l.sender_evidence || '').slice(0, 600),
    project_evidence: String(l.project_evidence || '').slice(0, 600),
    history: {
      reviewed_by: who(l.reviewed_by), reviewed_at: l.reviewed_at || null, person_reason: l.human_reason || '',
      approved_by: who(l.approved_by), approved_at: l.approved_at || null,
      assigned_by: who(l.assigned_by), assigned_at: l.assigned_at || null,
      forwarded: l.forward_status || '', forwarded_to: l.forward_to || '',
      odoo: l.crm_status || '', odoo_error: l.crm_error || '',
    },
    battle_card: card ? {
      decision: card.decision, quote_due: card.quote_due, target_price: card.target_price,
      decides: card.decides, competitors: card.competitors,
      card: JSON.stringify(card.card || {}).slice(0, 5000),
    } : null,
  }
}

async function getSalesTargets(workspaceId) {
  const [accounts, icp, n] = await Promise.all([
    db(`sales_accounts?${ws(workspaceId)}&select=*&order=priority.asc.nullslast`),
    db(`sales_icp?${ws(workspaceId)}&select=config,battle_cards,updated_at&limit=1`),
    names(),
  ])
  const row = icp?.[0] || {}
  return {
    ...summariseTargets(accounts || [], { names: n }),
    // Large and structured; clipped so one call cannot fill the context.
    ideal_customer_profile: JSON.stringify(row.config || {}).slice(0, 4000),
    battle_cards: JSON.stringify(row.battle_cards || {}).slice(0, 5000),
    note: (accounts || []).length ? '' : 'No target accounts have been set up for this company yet.',
  }
}

async function getDealOutcomes(workspaceId) {
  const rows = await db(`deal_outcomes?${ws(workspaceId)}&select=*&order=decided_on.desc.nullslast&limit=500`)
  return summariseDeals(rows || [])
}

const SEND_COLS = 'campaign_id,status,due_at,created_at,sent_at,delivered_at,opened_at,clicked_at,replied_at,bounced_at,complained_at'

async function getEmailOverview(workspaceId, args) {
  const p = periodBounds(args?.days)
  const [campaigns, sends, contacts] = await Promise.all([
    db(`email_campaigns?${ws(workspaceId)}&select=id,name,audience,status,subject,scheduled_for,launched_at,completed_at,created_at&order=created_at.desc&limit=50`),
    readAll(`email_sends?${ws(workspaceId)}&select=${SEND_COLS}&order=created_at.desc`, 20_000),
    readAll(`email_contacts?${ws(workspaceId)}&select=audience,status,subscribed_at,unsubscribed_at,replied_at`, 50_000),
  ])
  return summariseEmail({ campaigns: campaigns || [], sends, contacts }, p)
}

async function getTeam(workspaceId) {
  const [access, members, seats] = await Promise.all([
    db('user_access?select=user_id,email,full_name,role,status,leads_approver'),
    db(`workspace_members?${ws(workspaceId)}&select=workspace_id,user_id`),
    db(`sales_seats?${ws(workspaceId)}&select=workspace_id,user_id`),
  ])
  const team = teamRows({ access: access || [], members: members || [], seats: seats || [] }, workspaceId)
  return { team, count: team.length }
}

async function getCompanySnapshot(workspaceId, args) {
  const p = periodBounds(args?.days || 7)
  const range = (col, from, to) => `${col}=gte.${encodeURIComponent(from)}&${col}=lt.${encodeURIComponent(to)}`
  const [leads, n, sends, campaigns, postsNow, postsBefore, runs, accounts] = await Promise.all([
    leadsSince(workspaceId, p.prevFrom),
    names(),
    readAll(`email_sends?${ws(workspaceId)}&created_at=gte.${encodeURIComponent(p.prevFrom)}&select=${SEND_COLS}`, 20_000),
    db(`email_campaigns?${ws(workspaceId)}&select=id,audience`),
    db(`generated_posts?${ws(workspaceId)}&${range('published_at', p.from, p.to)}&select=platform`),
    db(`generated_posts?${ws(workspaceId)}&${range('published_at', p.prevFrom, p.from)}&select=platform`),
    db(`research_runs?${ws(workspaceId)}&order=started_at.desc&limit=1&select=status,stage,started_at,finished_at,report,error`),
    db(`sales_accounts?${ws(workspaceId)}&select=status,priority,next_step_on,open_value_sar,owner,name,id,value_sar,why,orders,last_order,open_deals`),
  ])
  const ls = summariseLeads(leads, { ...p, names: n })
  const pick = w => ({
    total: w.total, qualified: w.qualified, waiting_for_review: w.waiting_for_review,
    qualified_unassigned: w.qualified_unassigned, approved: w.approved, sent_to_odoo: w.sent_to_odoo,
  })
  const audience = new Map((campaigns || []).map(c => [c.id, c.audience]))
  const sendsIn = (from, to) => sends.filter(s => {
    const t = Date.parse(s.sent_at || s.created_at || '')
    return t >= Date.parse(from) && t < Date.parse(to)
  })
  const emailWindow = list => {
    const all = sendStats(list)
    return {
      sent: all.sent, opened: all.opened, replied: all.replied, bounced: all.bounced,
      open_rate_pct: all.open_rate_pct, reply_rate_pct: all.reply_rate_pct,
      outreach_sent: list.filter(s => audience.get(s.campaign_id) === 'cold' && s.sent_at).length,
      newsletter_sent: list.filter(s => audience.get(s.campaign_id) === 'marketing' && s.sent_at).length,
    }
  }
  const run = runs?.[0]
  const targets = summariseTargets(accounts || [], { names: n })
  return {
    window: { days: p.days, from: p.from, to: p.to },
    leads: { current: pick(ls.current), previous: pick(ls.previous), review_queue_now: ls.queue_now },
    email: { current: emailWindow(sendsIn(p.from, p.to)), previous: emailWindow(sendsIn(p.prevFrom, p.from)) },
    // Posts that went out through this app. Posts made directly on a platform
    // are not here; get_channel_analytics sees the accounts themselves.
    posts_published_through_app: {
      current: (postsNow || []).length,
      previous: (postsBefore || []).length,
      by_platform: Object.fromEntries(
        (postsNow || []).reduce((m, r) => m.set(r.platform || 'unknown', (m.get(r.platform || 'unknown') || 0) + 1), new Map()),
      ),
    },
    latest_research_run: run ? {
      status: run.status, finished_at: run.finished_at || null,
      headline: run.report?.headline || '', error: run.error || '',
    } : null,
    targets: {
      open: targets.open, next_step_overdue: targets.next_step_overdue, open_value_sar: targets.open_value_sar,
      overdue: targets.accounts.filter(a => a.overdue).slice(0, 10).map(a => ({ name: a.name, owner: a.owner, next_step_on: a.next_step_on })),
    },
    note: 'Headline numbers only. Drill in with get_leads_summary, get_email_overview, get_channel_analytics or get_sales_targets. ' +
          'posts_published_through_app excludes posts made directly on Instagram or LinkedIn; use get_channel_analytics for the accounts.',
  }
}

export const COMPANY_EXECUTORS = {
  get_company_snapshot: getCompanySnapshot,
  get_leads_summary:    getLeadsSummary,
  get_leads:            getLeads,
  get_lead:             getLead,
  get_sales_targets:    getSalesTargets,
  get_deal_outcomes:    getDealOutcomes,
  get_email_overview:   getEmailOverview,
  get_team:             getTeam,
}
