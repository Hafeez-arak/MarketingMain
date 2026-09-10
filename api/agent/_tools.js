import { db } from './_supabase.js'
import { loadBrandContext } from './_context.js'
import { findTool, isFree, ALL_TOOLS, WRITE_TOOLS, WEB_TOOLS } from '../../src/lib/agent/tools.js'
import { searchWeb, readPage } from './_web.js'
import { WRITE_EXECUTORS, checkOwnership, isWriteTool } from './_writeTools.js'
import { ourPerformance, competitorBoard } from '../../src/lib/agent/aggregate.js'

// ─── Running a tool ────────────────────────────────────────────────────────
// The executors behind the definitions in src/lib/agent/tools.js.
//
// Every function here takes `workspaceId` as its FIRST argument and the
// model's arguments as its second, and the two are never merged. The
// workspace id comes from the verified session (api/agent/_supabase.js proves
// membership with the caller's own token before anything reaches here); the
// model's object is only ever read for filters and limits.
//
// Every query carries its own `workspace_id=eq.` filter. That is not belt and
// braces on top of RLS — it is the isolation itself. The operators belong to
// all three workspaces, so RLS lets every workspace's rows through at once,
// and a query that forgets the filter returns another brand's data without
// erroring. That lesson is already written down in this repo and it applies
// with more force to an agent, because an agent composes its own queries.

// Row caps. Layers 2 and 3 are fetched on demand precisely so they do not
// bloat the prompt (AGENT.md §3), and an uncapped tool result would undo that
// on the first workspace with real history.
const CAPS = { posts: 100, schedule: 100, plans: 50, media: 200, runs: 20 }

const clamp = (value, fallback, max) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
}

/** An ISO date `days` before now — the look-back windows every tool takes. */
function since(days, fallback) {
  const d = clamp(days, fallback, 365)
  return new Date(Date.now() - d * 86_400_000).toISOString()
}

const ws = workspaceId => `workspace_id=eq.${encodeURIComponent(workspaceId)}`

// ─── The executors ─────────────────────────────────────────────────────────

async function getBrandContext(workspaceId, args) {
  const { ctx } = await loadBrandContext(workspaceId, args?.task || 'chat')
  return {
    brand_name: ctx.brandName || '',
    brand_descriptor: ctx.brandDescriptor || '',
    // The blocks rather than the flat string: the agent already has the
    // assembled text in its system prompt, so what is useful here is being
    // able to see WHICH blocks exist and read one exactly.
    blocks: (ctx.blocks || [])
      .filter(b => !b.muted)
      .map(b => ({ key: b.key, label: b.label, text: b.text })),
    note: ctx.instructions ? '' : 'Nothing has been written in the Brand Brain for this workspace yet.',
  }
}

async function getCompetitors(workspaceId) {
  const rows = await db(
    `research_agenda?${ws(workspaceId)}&kind=eq.competitor&order=subject.asc` +
    `&select=id,subject,why,status,ig_handle,ig_status,ig_confidence,ig_verified_at,created_by`,
  )
  return {
    competitors: (rows || []).map(r => ({
      id: r.id,
      name: r.subject,
      why_we_watch: r.why || '',
      status: r.status,
      ig_handle: r.ig_handle || '',
      ig_status: r.ig_status,
      ig_confidence: r.ig_confidence === null ? null : Number(r.ig_confidence),
      // The load-bearing flag. A handle that was FOUND but not VERIFIED must
      // never be treated as that rival's numbers: two similarly-named
      // companies in one workspace, and a confident week of numbers attached
      // to the wrong one is the kind of wrong that does not look wrong.
      verified: Boolean(r.ig_verified_at) || r.ig_status === 'human_set',
      added_by: r.created_by,
    })),
    note: (rows || []).length ? '' : 'No competitors are on the watchlist for this workspace yet.',
  }
}

async function getMemory(workspaceId, args) {
  const status = String(args?.status || 'all')
  const filter = status && status !== 'all' ? `&status=eq.${encodeURIComponent(status)}` : ''
  const rows = await db(
    `brand_memory?${ws(workspaceId)}${filter}&order=created_at.desc` +
    `&select=id,rule,detail,scope,status,tasks,confidence,source,created_at`,
  )
  const all = rows || []
  return {
    rules: all,
    active: all.filter(r => r.status === 'active').length,
    proposed: all.filter(r => r.status === 'proposed').length,
    // Surfaced as its own count so it is impossible to miss: these are the
    // rules a person said no to, and re-proposing one is how an assistant
    // becomes something people stop reading.
    rejected: all.filter(r => r.status === 'rejected').length,
    note: all.length ? 'Only "active" rules steer generation. Never re-propose a rejected rule.' : '',
  }
}

async function getPriorResearch(workspaceId, args) {
  const limit = clamp(args?.limit, 5, CAPS.runs)
  const [runs, agenda] = await Promise.all([
    db(`research_runs?${ws(workspaceId)}&order=started_at.desc&limit=${limit}` +
       `&select=id,status,stage,started_at,finished_at,report,error`),
    db(`research_agenda?${ws(workspaceId)}&kind=eq.question&order=created_at.desc` +
       `&select=id,subject,why,status,cadence,created_by`),
  ])
  return {
    runs: (runs || []).map(r => ({
      id: r.id,
      status: r.status,
      stage: r.stage,
      started_at: r.started_at,
      headline: r.report?.headline || '',
      error: r.error || '',
    })),
    // The steering wheel (AGENT.md §5b). A question sitting at 'proposed' is
    // one you suggested and nobody has accepted yet — it is not yet a
    // standing instruction.
    agenda_questions: agenda || [],
    note: (runs || []).length ? '' : 'No research run has completed for this workspace yet.',
  }
}

async function getCompetitorMetrics(workspaceId, args) {
  const name = String(args?.competitor || '').trim()
  const filter = name ? `&competitor_name=ilike.${encodeURIComponent(`%${name}%`)}` : ''
  // Two snapshots per rival is all a delta needs, but the series is short
  // anyway (one row per rival per run) so this stays small.
  const rows = await db(
    `competitor_snapshots?${ws(workspaceId)}${filter}&order=captured_at.desc&limit=200` +
    `&select=competitor_name,ig_handle,data_source,followers,media_count,posts_in_period,` +
    `posts_per_week,format_mix,avg_engagement,engagement_per_1k,sample_size,top_posts,captured_at`,
  )
  // Computed in code, handed to the model as fact. AGENT.md §7.
  return competitorBoard(rows || [])
}

async function getOurPerformance(workspaceId, args) {
  const cutoff = since(args?.days, 90)
  const platform = args?.platform ? `&platform=eq.${encodeURIComponent(args.platform)}` : ''
  const posts = await db(
    `generated_posts?${ws(workspaceId)}${platform}&created_at=gte.${cutoff}` +
    `&order=created_at.desc&limit=${CAPS.posts}` +
    `&select=id,platform,format,media_type,post_kind,topic,status,publish_status,` +
    `published_at,scheduled_date`,
  )
  const ids = (posts || []).map(p => p.id).filter(Boolean)
  const analytics = ids.length
    ? await db(
        `post_analytics?${ws(workspaceId)}&post_id=in.(${ids.join(',')})` +
        `&select=post_id,metric_date,likes,comments,shares,saves,reach,views`,
      )
    : []
  return ourPerformance(posts || [], analytics || [])
}

async function getPosts(workspaceId, args) {
  const limit = clamp(args?.limit, 25, CAPS.posts)
  const parts = [ws(workspaceId)]
  if (args?.id) parts.push(`id=eq.${encodeURIComponent(args.id)}`)
  if (args?.status) parts.push(`status=eq.${encodeURIComponent(args.status)}`)
  if (args?.platform) parts.push(`platform=eq.${encodeURIComponent(args.platform)}`)
  // A specific id is an exact lookup — a date window would only get in its
  // way, since the post the person is looking at may be older than any
  // default window we would pick.
  if (!args?.id) parts.push(`created_at=gte.${since(args?.days, 90)}`)

  const posts = await db(
    `generated_posts?${parts.join('&')}&order=created_at.desc&limit=${limit}` +
    `&select=id,platform,caption,caption_ar,caption_en,hashtags,topic,format,media_type,` +
    `post_kind,status,publish_status,published_at,scheduled_date,publish_time,` +
    `platform_post_url,plan_id,created_at`,
  )
  const ids = (posts || []).map(p => p.id).filter(Boolean)
  const analytics = ids.length
    ? await db(
        `post_analytics?${ws(workspaceId)}&post_id=in.(${ids.join(',')})` +
        `&select=post_id,metric_date,likes,comments,shares,saves,reach,views,impressions`,
      )
    : []
  const byPost = {}
  for (const a of analytics || []) (byPost[a.post_id] ||= []).push(a)

  return {
    posts: (posts || []).map(p => ({
      ...p,
      // Attached rather than left for a second call: "why did this flop" needs
      // the caption and the numbers in the same breath.
      analytics: byPost[p.id] || [],
      has_analytics: Boolean(byPost[p.id]?.length),
    })),
    count: (posts || []).length,
    note: (posts || []).length ? '' : 'No posts match that filter in this workspace.',
  }
}

async function getSchedule(workspaceId, args) {
  const limit = clamp(args?.limit, 50, CAPS.schedule)
  const ahead = clamp(args?.days, 30, 365)
  const until = new Date(Date.now() + ahead * 86_400_000).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  const rows = await db(
    `scheduled_posts?${ws(workspaceId)}&scheduled_date=gte.${today}&scheduled_date=lte.${until}` +
    `&order=scheduled_date.asc&limit=${limit}` +
    `&select=id,platform,topic,format,media_type,post_kind,caption,scheduled_date,publish_time,` +
    `status,publish_status,scheduled_publish_at`,
  )
  return {
    scheduled: rows || [],
    count: (rows || []).length,
    window: { from: today, to: until },
    note: (rows || []).length ? '' : 'Nothing is scheduled in that window.',
  }
}

async function getPlans(workspaceId, args) {
  const limit = clamp(args?.limit, 10, CAPS.plans)
  const planFilter = args?.plan_id ? `&id=eq.${encodeURIComponent(args.plan_id)}` : ''
  const plans = await db(
    `content_plans?${ws(workspaceId)}${planFilter}&order=created_at.desc&limit=${limit}` +
    `&select=id,name,month,start_date,end_date,goal,goal_category,platforms,status,kind`,
  )
  const ids = (plans || []).map(p => p.id).filter(Boolean)
  const ideas = ids.length
    ? await db(
        `plan_ideas?${ws(workspaceId)}&plan_id=in.(${ids.join(',')})&order=scheduled_date.asc` +
        `&select=id,plan_id,title,topic,angle,content_pillar,suggested_format,status,` +
        `scheduled_date,platform,source,reject_reason`,
      )
    : []
  const byPlan = {}
  for (const i of ideas || []) (byPlan[i.plan_id] ||= []).push(i)

  return {
    plans: (plans || []).map(p => ({ ...p, ideas: byPlan[p.id] || [] })),
    count: (plans || []).length,
    note: (plans || []).length ? '' : 'This workspace has no content plans yet.',
  }
}

async function getMedia(workspaceId, args) {
  const limit = clamp(args?.limit, 50, CAPS.media)
  const tag = args?.tag ? `&tags=cs.{${encodeURIComponent(args.tag)}}` : ''
  const rows = await db(
    `media_library?${ws(workspaceId)}${tag}&order=created_at.desc&limit=${limit}` +
    `&select=id,name,platform,topic,source,mime_type,tags,created_at`,
  )
  return {
    media: rows || [],
    count: (rows || []).length,
    note: (rows || []).length ? '' : 'The media library is empty for this workspace.',
  }
}

const EXECUTORS = {
  get_brand_context:      getBrandContext,
  get_competitors:        getCompetitors,
  get_memory:             getMemory,
  get_prior_research:     getPriorResearch,
  get_competitor_metrics: getCompetitorMetrics,
  get_our_performance:    getOurPerformance,
  get_posts:              getPosts,
  get_schedule:           getSchedule,
  get_plans:              getPlans,
  get_media:              getMedia,
}

/**
 * Run one tool call on behalf of a workspace.
 *
 * @param {string} workspaceId  from the VERIFIED session. Never from the model.
 * @param {string} name         the tool the model asked for
 * @param {object} args         the model's arguments — filters and limits only
 * @returns {Promise<{ok:boolean, result?:object, error?:string, free:boolean}>}
 */
export async function runTool(workspaceId, name, args = {}) {
  if (!workspaceId) {
    // Defensive, and it should be unreachable: the endpoint proves membership
    // before constructing a loop. Unreachable checks around tenant isolation
    // are worth their cost.
    return { ok: false, error: 'No workspace in session.', free: true }
  }

  // ── Writes ──
  // Separated because they need a check reads do not: a write tool takes ids
  // the MODEL supplied, and an id from another tenant would attach a row to a
  // workspace the caller cannot see. See _writeTools.js.
  if (isWriteTool(name)) {
    try {
      const bad = await checkOwnership(workspaceId, name, args || {})
      if (bad) return { ok: false, error: bad, free: true }
      const result = await WRITE_EXECUTORS[name](workspaceId, args || {})
      if (result?.error) return { ok: false, error: result.error, free: true }
      return { ok: true, result, free: true }
    } catch (err) {
      return { ok: false, error: err?.message || String(err), free: true }
    }
  }

  // ── The open web ──
  // Metered, and reported as such: these draw down a free tier, so a caller
  // that cannot tell them from a Supabase read cannot pace itself.
  if (name === 'read_page' || name === 'search_web') {
    const out = name === 'read_page'
      ? await readPage(args?.url)
      : await searchWeb(args?.query, { limit: Math.min(Number(args?.limit) || 5, 10) })
    if (!out.ok) return { ok: false, error: out.error, free: false }
    return {
      ok: true,
      free: false,
      result: name === 'read_page'
        ? { ...out.page, served_by: out.used }
        : { results: out.results, served_by: out.used },
      // Surfaced so a run can report that it fell back rather than leaving it
      // to be discovered on a bill.
      notes: out.notes || [],
    }
  }

  const def = findTool(name, [...ALL_TOOLS, ...WRITE_TOOLS, ...WEB_TOOLS])
  const exec = EXECUTORS[name]
  if (!def || !exec) {
    // Named back to the model rather than thrown. A model that asked for a
    // tool that does not exist can recover if it is told so; an exception ends
    // the turn and bills for everything up to it.
    return { ok: false, error: `There is no tool called "${name}".`, free: true }
  }

  try {
    const result = await exec(workspaceId, args || {})
    return { ok: true, result, free: isFree(name) }
  } catch (err) {
    return { ok: false, error: err?.message || String(err), free: isFree(name) }
  }
}

export { EXECUTORS }
