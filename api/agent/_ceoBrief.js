import { db } from './_supabase.js'
import { callModel } from './_provider.js'
import { loadBrandContext } from './_context.js'
import { liveZernioAnalytics } from './_zernioLive.js'
import { readLinkedInAudience } from './_linkedinAudience.js'
import { COMPANY_EXECUTORS } from './_company.js'
import { textIn } from '../../src/lib/agent/loop.js'
import {
  briefWindow, ceoKpis, CEO_BRIEF_SCHEMA, CEO_BRIEF_IDENTITY, ceoBriefPrompt,
  normaliseBrief, socialFacts, postsByWeek,
} from '../../src/lib/agent/ceoBrief.js'

// ─── Writing the CEO's brief ───────────────────────────────────────────────
// src/lib/agent/ceoBrief.js says why it is built this way. In short: the
// facts are gathered here in code, the four headline numbers are computed
// from them in code, and the model is called ONCE, with no tools, to write
// the judgement in Arabic and English. No tool loop means nothing to wander
// off and fetch, a predictable cost, and no number the code did not compute.
//
// Called by the CEO page's "Write a fresh brief" (an admin, through
// api/agent/chat.js) and by the Sunday cron.

const ws = workspaceId => `workspace_id=eq.${encodeURIComponent(workspaceId)}`
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** A promise that gives up after `ms` with `fallback`, so one slow source cannot sink the brief. */
const within = (p, ms, fallback) => Promise.race([
  p.catch(() => fallback),
  new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
])

const run = async (name, workspaceId, args) => {
  const out = await COMPANY_EXECUTORS[name](workspaceId, args)
  if (out?.error) throw new Error(out.error)
  return out
}

/** Everything the brief may say, gathered from the company's own records. */
export async function gatherFacts(workspaceId, now = new Date()) {
  const w = briefWindow(now)
  const since = encodeURIComponent(w.from)
  const [leads, qualified, snapshot, targets, deals, opps, signals, requests, live, audience] = await Promise.all([
    within(run('get_leads_summary', workspaceId, { days: 7 }), 30_000, null),
    within(run('get_leads', workspaceId, { days: 7, verdict: 'qualified', limit: 12 }), 30_000, null),
    within(run('get_company_snapshot', workspaceId, { days: 7 }), 30_000, null),
    within(run('get_sales_targets', workspaceId, {}), 30_000, null),
    within(run('get_deal_outcomes', workspaceId, {}), 20_000, null),
    within(db(`research_opportunities?${ws(workspaceId)}&first_seen_at=gte.${since}&order=first_seen_at.desc&limit=12` +
      '&select=name,client,location,stage,deadline,relevance,suggested_action,value_sar,package_value_sar,package,line'), 20_000, []),
    within(db(`research_signals?${ws(workspaceId)}&first_seen_at=gte.${since}&order=first_seen_at.desc&limit=12` +
      '&select=competitor,category,summary,relevance'), 20_000, []),
    within(db(`requests?${ws(workspaceId)}&or=(status.in.(new,in_progress),closed_at.gte.${since})&order=updated_at.desc&limit=30` +
      '&select=title,kind,status,resolution,assigned_to,closed_at'), 20_000, []),
    within(liveZernioAnalytics(workspaceId, { days: 14 }), 45_000, { available: false }),
    within(readLinkedInAudience(workspaceId), 20_000, { available: false }),
  ])

  const pick = x => x && ({
    total: x.total, qualified: x.qualified, waiting_for_review: x.waiting_for_review,
    qualified_unassigned: x.qualified_unassigned, approved: x.approved, sent_to_odoo: x.sent_to_odoo,
    by_project_type: x.by_project_type, median_hours_to_review: x.median_hours_to_review,
  })

  const posts = postsByWeek(live?.post_analytics?.posts || [], w)
  return {
    window: w,
    leads: leads ? {
      this_week: pick(leads.current),
      last_week: pick(leads.previous),
      review_queue_now: leads.queue_now,
      qualified_this_week: (qualified?.leads || []).map(l => ({
        from: l.company || l.sender_name, wants: l.summary, project_type: l.project_type,
        request_type: l.request_type, arrived: l.arrived, owner: l.assigned_to || 'nobody yet',
      })),
    } : { unavailable: true },
    money: {
      targets: targets ? {
        open: targets.open, open_value_sar: targets.open_value_sar, next_step_overdue: targets.next_step_overdue,
        priority_accounts: (targets.accounts || []).filter(a => a.priority === 1).slice(0, 7).map(a => ({
          name: a.name, open_value_sar: a.open_value_sar, lifetime_value_sar: a.lifetime_value_sar,
          why: a.why, owner: a.owner || 'nobody', next_step_on: a.next_step_on,
        })),
      } : null,
      deals: deals ? { won: deals.won, lost: deals.lost, win_rate: deals.win_rate, note: deals.note } : null,
      opportunities_this_week: (opps || []).map(o => ({
        name: clip(o.name, 120), client: clip(o.client, 80), location: clip(o.location, 60), stage: o.stage,
        deadline: o.deadline, our_package: clip(o.package, 80), our_share_sar: o.package_value_sar ?? null,
        project_value_sar: o.value_sar ?? null, suggested_action: clip(o.suggested_action, 200),
      })),
    },
    social: socialFacts(live, posts),
    // Who follows the LinkedIn page, this week against last (see src/lib/linkedinAudience.js).
    linkedin_audience: audience,
    email: snapshot?.email || null,
    market: {
      latest_research: snapshot?.latest_research_run || null,
      competitor_and_market_news: (signals || []).map(s => ({
        who: s.competitor || '', kind: s.category, what: clip(s.summary, 220),
      })),
    },
    requests: {
      open: (requests || []).filter(r => ['new', 'in_progress'].includes(r.status)).map(r => ({ title: r.title, status: r.status })),
      done_this_week: (requests || []).filter(r => r.status === 'done').map(r => ({ title: r.title, note: clip(r.resolution, 160) })),
    },
  }
}

/**
 * Gather, write, store. Returns the stored row, or { error }.
 * @param {{ trigger?: 'manual'|'schedule', userId?: string|null, now?: Date }} [opts]
 */
export async function writeCeoBrief(workspaceId, { trigger = 'manual', userId = null, now = new Date() } = {}) {
  const started = Date.now()
  const facts = await gatherFacts(workspaceId, now)
  const kpis = ceoKpis(facts)
  const { brand } = await loadBrandContext(workspaceId, 'chat')

  const out = await callModel({
    workspaceId, job: 'ceo_brief', surface: 'ceo_brief', stage: trigger,
    identity: CEO_BRIEF_IDENTITY,
    brand,
    messages: [{ role: 'user', content: ceoBriefPrompt(facts) }],
    maxTokens: 6_000, effort: 'high',
    outputFormat: CEO_BRIEF_SCHEMA,
    // Inside the 300s function ceiling with room to store the result.
    deadline: started + 240_000,
  })
  if (!out.ok) return { error: out.error || 'The brief could not be written.', refused: Boolean(out.refused) }

  let parsed
  try { parsed = JSON.parse(textIn(out.response)) } catch {
    return { error: 'The brief came back in a shape that could not be read.' }
  }
  const brief = normaliseBrief(parsed)
  const rows = await db('ceo_briefs', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      workspace_id: workspaceId,
      period_start: facts.window.from,
      period_end: facts.window.to,
      kpis, facts, brief, trigger,
      created_by: userId,
      model: out.response?.model || '',
      cost_usd: Number((out.cost || 0).toFixed(6)),
    },
  })
  return rows?.[0] || { error: 'The brief was written but could not be saved.' }
}
