import { Buffer } from 'node:buffer'
import { db, isConfigured } from '../../api/agent/_supabase.js'
import { authorise } from '../../api/agent/_serviceAuth.js'
import { callModel } from '../../api/agent/_provider.js'
import { loadBrandContext } from '../../api/agent/_context.js'
import { gatherCalendar } from '../../api/agent/_calendar.js'
import { textIn } from '../../src/lib/agent/loop.js'
import { modelFor } from '../../src/lib/agent/models.js'
import { brandDateKey } from '../../src/lib/brandTime.js'
import {
  WEEKLY_IDENTITY, WEEKLY_SCHEMA, WEEKLY_MAX, weekOf, daysBetweenIso, marketingFindings, storyPosts, audienceSummary,
  weeklyPrompt, inputsSummary, parseWeekly, wantsArabic, websiteOf, sitePages, explainModelError,
} from '../../src/lib/email/weekly.js'

// ─── POST /api/agent/emailWeekly ───────────────────────────────────────────
// Writes this week's (Sunday-start, Riyadh) three marketing-email options for one workspace and
// stores them in email_ai_drafts. Runs ONLY in the agent container beside
// n8n: the "Agent — weekly email drafts" workflow calls it every Monday after
// the research run, and the Marketing tab's "Write this week's drafts" button
// reaches it through the same workflow's webhook. Nothing on Vercel calls it.
//
// Body: { workspace_id, force?: boolean, trigger?: 'scheduled'|'manual' }
//
// Auth: AGENT_RUN_SECRET (n8n's schedule) or the signed-in user's token
// forwarded by the n8n webhook (the app's button). See _serviceAuth.js.
//
// Model: Sonnet (job `email_weekly`), through callModel so the workspace's
// monthly cap is checked first and the spend lands in the ledger.
//
// What the model is told, and why, is documented in src/lib/email/weekly.js.

const RUNNING_FOR = 15 * 60_000   // a 'running' row older than this is treated as dead

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

const q = s => encodeURIComponent(s)

/** Everything the prompt needs, read with the service key for ONE workspace. */
export async function gatherWeeklyInputs(workspaceId, { now = new Date(), brand } = {}) {
  const ws = q(workspaceId)
  const today = brandDateKey(now)
  const week = weekOf(now)
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const horizon = new Date(now.getTime() + 75 * 86_400_000).toISOString().slice(0, 10)
  const safe = p => p.catch(() => [])

  const [contacts, groups, members, campaigns, lastWeekRows, posts, runs, events, leads] = await Promise.all([
    safe(db(`email_contacts?workspace_id=eq.${ws}&audience=eq.marketing&status=eq.active&select=language,contact_type&limit=20000`)),
    safe(db(`email_groups?workspace_id=eq.${ws}&audience=eq.marketing&select=id,name,description&order=name.asc`)),
    safe(db(`email_group_members?workspace_id=eq.${ws}&select=group_id&limit=50000`)),
    safe(db(`email_campaigns?workspace_id=eq.${ws}&audience=eq.marketing&status=in.(sending,sent)&order=launched_at.desc.nullslast&limit=${WEEKLY_MAX.campaigns}&select=id,subject,launched_at,recipients`)),
    safe(db(`email_ai_drafts?workspace_id=eq.${ws}&week_of=lt.${week}&status=eq.ready&order=week_of.desc&limit=1&select=options`)),
    safe(db(`generated_posts?workspace_id=eq.${ws}&publish_status=eq.published&published_at=gte.${since30}&order=published_at.desc&limit=30&select=platform,topic,caption,caption_en,published_at`)),
    safe(db(`research_runs?workspace_id=eq.${ws}&status=eq.complete&order=finished_at.desc&limit=1&select=id,finished_at,headline:report->>headline,findings:report->findings`)),
    safe(db(`research_events?workspace_id=eq.${ws}&status=in.(upcoming,tbc)&relevance=in.(high,medium)&or=(start_date.is.null,and(start_date.gte.${today},start_date.lte.${horizon}))&order=start_date.asc.nullslast&limit=${WEEKLY_MAX.events}&select=name,start_date,city,recommendation,decision`)),
    safe(db(`research_opportunities?workspace_id=eq.${ws}&status=in.(new,assigned,pursued)&relevance=eq.high&order=last_seen_at.desc&limit=${WEEKLY_MAX.leads}&select=name,client,headline,location,stage`)),
  ])

  const stats = campaigns.length
    ? await safe(db(`email_campaign_stats?workspace_id=eq.${ws}&campaign_id=in.(${campaigns.map(c => `"${c.id}"`).join(',')})&select=campaign_id,sent,opened,clicked`))
    : []
  const statById = new Map(stats.map(s => [s.campaign_id, s]))

  // Computed dates (national days, Islamic calendar) for the next six weeks.
  // Free: it is date arithmetic plus two public calendar APIs, no model.
  let calendar = []
  if (brand?.profile) {
    const cal = await gatherCalendar({
      profile: brand.profile, ctx: brand.ctx, now,
      window: { from: today, to: new Date(now.getTime() + 45 * 86_400_000).toISOString().slice(0, 10) },
    })
    calendar = (cal.events || []).slice(0, WEEKLY_MAX.calendar).map(e => ({
      name: e.name, date: e.date, days_until: e.days_until, note: e.note || '',
    }))
  }

  const run = runs[0] || null
  const website = websiteOf(brand?.profile)

  return {
    today,
    weekOf: week,
    website,
    pages: sitePages(brand?.profile, website),
    audience: audienceSummary({ contacts, groups, members }),
    campaigns: campaigns.map(c => {
      const s = statById.get(c.id) || {}
      return {
        sent_on: String(c.launched_at || '').slice(0, 10), subject: c.subject, recipients: c.recipients || 0,
        sent: Number(s.sent || 0), opened: Number(s.opened || 0), clicked: Number(s.clicked || 0),
      }
    }),
    lastWeek: (lastWeekRows[0]?.options || []).map(o => `${o.angle}: ${o.subject}`).slice(0, WEEKLY_MAX.lastWeek),
    posts: storyPosts(posts.map(p => ({
      date: String(p.published_at || '').slice(0, 10), platform: p.platform || '',
      topic: p.topic || '', caption: p.caption_en || p.caption || '',
    }))),
    research: run ? {
      id: run.id,
      finished_on: String(run.finished_at || '').slice(0, 10),
      age_days: daysBetweenIso(run.finished_at, now.toISOString()) ?? 0,
      headline: run.headline || '',
      findings: marketingFindings(run.findings, { today }),
    } : null,
    calendar,
    events: events.map(e => ({ name: e.name, start_date: e.start_date, city: e.city, recommendation: e.recommendation, decision: e.decision })),
    leads,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only.' })
  if (!isConfigured) return res.status(500).json({ ok: false, error: 'Supabase is not configured on this deployment.' })

  let body
  try { body = await readBody(req) } catch { return res.status(400).json({ ok: false, error: 'Body must be JSON.' }) }
  const workspaceId = String(body.workspace_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return res.status(400).json({ ok: false, error: 'workspace_id is required.' })

  const auth = await authorise(req, workspaceId)
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error })

  const trigger = body.trigger === 'manual' || auth.as === 'user' ? 'manual' : 'scheduled'
  const force = body.force === true || trigger === 'manual'
  const now = new Date()
  const week = weekOf(now)
  const ws = q(workspaceId)

  try {
    // ── One writer per workspace-week ──
    const [existing] = await db(`email_ai_drafts?workspace_id=eq.${ws}&week_of=eq.${week}&select=id,status,started_at`) || []
    if (existing?.status === 'ready' && !force) {
      return res.status(200).json({ ok: true, skipped: 'This week\'s drafts are already written.', id: existing.id })
    }
    if (existing?.status === 'running' && now - new Date(existing.started_at) < RUNNING_FOR) {
      return res.status(409).json({ ok: false, error: 'This week\'s drafts are being written right now. Check back in a minute.' })
    }

    // The schedule skips a workspace that has no email list: drafts nobody
    // can send are money spent on nothing. A person pressing the button gets
    // them anyway — they may be about to import the list.
    const brand = await loadBrandContext(workspaceId, 'caption')
    const inputs = await gatherWeeklyInputs(workspaceId, { now, brand })
    if (trigger === 'scheduled' && inputs.audience.total === 0 && body.force !== true) {
      return res.status(200).json({ ok: true, skipped: 'No marketing contacts yet, so no drafts were written.' })
    }

    const [row] = await db('email_ai_drafts?on_conflict=workspace_id,week_of', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
      body: {
        workspace_id: workspaceId, week_of: week, status: 'running', trigger, error: '',
        started_at: now.toISOString(), finished_at: null, updated_at: now.toISOString(),
        inputs: inputsSummary(inputs), research_run_id: inputs.research?.id || null,
      },
    }) || []

    const out = await callModel({
      workspaceId,
      job: 'email_weekly',
      surface: 'run',
      stage: 'email-weekly',
      identity: WEEKLY_IDENTITY,
      brand: brand.brand,
      messages: [{ role: 'user', content: weeklyPrompt(inputs) }],
      maxTokens: 8_000,
      effort: 'medium',
      estimateUsd: 0.1,
      outputFormat: WEEKLY_SCHEMA,
    })

    const finish = patch => db(`email_ai_drafts?id=eq.${row.id}&workspace_id=eq.${ws}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { ...patch, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    })

    if (!out.ok) {
      const error = explainModelError(out.error)
      await finish({ status: 'failed', error: error.slice(0, 500), cost_usd: out.cost || 0 })
      return res.status(out.refused ? 200 : 502).json({ ok: false, capped: Boolean(out.refused), error })
    }

    const parsed = parseWeekly(textIn(out.response), { arabic: wantsArabic(inputs.audience), website: inputs.website })
    if (!parsed.ok) {
      await finish({ status: 'failed', error: parsed.error, cost_usd: out.cost || 0, model: modelFor('email_weekly') })
      return res.status(502).json({ ok: false, error: parsed.error })
    }

    await finish({
      status: 'ready', options: parsed.options, note: parsed.note, error: '',
      cost_usd: out.cost || 0, model: modelFor('email_weekly'),
    })
    return res.status(200).json({ ok: true, id: row.id, week_of: week, options: parsed.options.length, cost: out.cost || 0 })
  } catch (err) {
    // A row left 'running' here would block the button for 15 minutes, so it
    // is closed as failed with the reason.
    await db(`email_ai_drafts?workspace_id=eq.${ws}&week_of=eq.${week}&status=eq.running`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { status: 'failed', error: String(err.message || err).slice(0, 500), finished_at: new Date().toISOString() },
    }).catch(() => {})
    return res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 300) })
  }
}
