import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// ─── Insights ──────────────────────────────────────────────────────────────
// Reads the two logs the rest of the loop writes — idea_events (what people
// decided) and post_analytics (what audiences did) — and turns them into the
// summaries the Insights page shows.
//
// All of the aggregation happens here, in the browser, over a few hundred
// rows. That is a deliberate choice over SQL views or an edge function: the
// numbers are small, the shapes change while the page is still finding its
// form, and keeping it in one readable module beats a migration every time a
// column is added to a table.
//
// EVERY query below carries its own workspace_id filter. RLS on these tables
// is per-USER, and the operators belong to all three workspaces — so RLS
// alone would happily return every brand's rows at once.

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}

async function getJson(url, accessToken) {
  try {
    const res = await fetch(url, { headers: authHeaders(accessToken) })
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

// A conclusion drawn from three posts is a coincidence with a percentage
// sign. The page still SHOWS those rows — hiding them would misrepresent how
// much data exists — but marks them, and this is the threshold it marks by.
export const WEAK_SAMPLE = 5

// brand_memory.scope, which is a wider vocabulary than the task tags — it
// includes things a rule can be ABOUT (timing, a competitor, a trend) as well
// as the generation tasks it applies to.
export const MEMORY_SCOPES = ['plan', 'caption', 'image', 'timing', 'competitor', 'trend', 'global']

export const SCOPE_LABELS = {
  plan:       'Idea planning',
  caption:    'Caption & copy',
  image:      'Image prompts',
  timing:     'Timing',
  competitor: 'Competitors',
  trend:      'Trends',
  global:     'Everything',
}

// Mirrors the taxonomy the planner's reject dialog writes (CampaignPlanner's
// REJECT_REASONS), plus the bucket for a rejection recorded without one.
export const REJECT_REASON_LABELS = {
  off_brand:     'Off-brand',
  repetitive:    'Repetitive',
  wrong_product: 'Wrong product',
  weak_idea:     'Weak idea',
  unspecified:   'No reason given',
}

// ─── Fetching ──────────────────────────────────────────────────────────────

export async function fetchIdeaEvents(workspaceId, accessToken, limit = 1000) {
  if (!workspaceId) return []
  return getJson(
    `${SUPABASE_URL}/rest/v1/idea_events?workspace_id=eq.${workspaceId}` +
    `&select=id,plan_id,idea_id,event,reason,before,after,created_at` +
    `&order=created_at.desc&limit=${limit}`,
    accessToken,
  )
}

export async function fetchIdeasForInsights(workspaceId, accessToken, limit = 1000) {
  if (!workspaceId) return []
  return getJson(
    `${SUPABASE_URL}/rest/v1/plan_ideas?workspace_id=eq.${workspaceId}` +
    `&select=id,plan_id,platform,status,reject_reason,content_pillar,occasion,format,` +
    `media_type,scheduled_date,publish_time,topic,title&order=created_at.desc&limit=${limit}`,
    accessToken,
  )
}

// The analytics half needs three hops: a metric row knows its post, the post
// knows its plan idea, and only the idea knows the pillar and format the
// content was planned as. PostgREST cannot express that join across
// `post_table`, which is a discriminator rather than a foreign key, so the
// two sides are fetched separately and stitched below.
export async function fetchPerformance(workspaceId, accessToken) {
  if (!workspaceId) return { metrics: [], posts: [] }
  const [metrics, posts] = await Promise.all([
    getJson(
      `${SUPABASE_URL}/rest/v1/post_analytics?workspace_id=eq.${workspaceId}` +
      `&select=post_id,post_table,platform,metric_date,impressions,reach,likes,comments,` +
      `shares,saves,clicks,views,metrics_present&order=metric_date.desc&limit=2000`,
      accessToken,
    ),
    getJson(
      `${SUPABASE_URL}/rest/v1/instagram_generated_posts?workspace_id=eq.${workspaceId}` +
      `&select=id,plan_idea_id,published_at&limit=2000`,
      accessToken,
    ),
  ])
  return { metrics, posts }
}

// ─── Triggering a review ───────────────────────────────────────────────────
// One Claude Sonnet call over the summaries above. It writes brand_memory
// rows as `proposed` — never `active` — so nothing it infers reaches a prompt
// before a human has agreed to it on this page.
export async function requestInsightsReview(webhookUrl, workspaceId) {
  if (!webhookUrl) return { error: 'Insights review webhook not configured. Go to Settings → Integrations.' }
  if (!workspaceId) return { error: 'No active workspace.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId }),
    })
    if (!res.ok) return { error: `Review webhook returned ${res.status}` }
    const data = await res.json()
    const row = Array.isArray(data) ? data[0] : data
    if (!row || row.ok !== true) return { error: (row && row.error) || 'The review returned nothing usable.' }
    // `skipped` is a successful outcome, not a failure: the workflow declined
    // to infer rules from too little history, and the caller should say so
    // rather than reporting an error.
    return { ok: true, skipped: !!row.skipped, reason: row.reason || '', proposed: row.proposed || 0, note: row.note || '' }
  } catch (err) { return { error: err.message } }
}

// The names in whatever section this brand keeps its rivals in.
//
// Read from the directory rather than asked for, because every workspace
// names that section itself — the seed calls it "Competitor Watch", but a
// renamed one should keep working. Matched on the section title/key, and the
// first in-prompt column is the row's name by the same convention
// buildDirectoryIndex uses.
export function competitorNamesFrom(schema, directory) {
  const sections = (schema?.sections || []).filter(
    s => s.kind === 'directory' && s.enabled !== false && /competitor|rival/i.test(`${s.key} ${s.title}`),
  )
  const names = []
  for (const section of sections) {
    const cols = (schema.columns || []).filter(
      c => c.section_key === section.key && c.enabled !== false && c.in_prompt !== false,
    )
    if (!cols.length) continue
    for (const row of directory?.rowsBySection?.[section.key] || []) {
      const name = String(row.data?.[cols[0].key] || '').trim()
      if (name) names.push(name)
    }
  }
  return [...new Set(names)]
}

// One Tavily search pass plus one Claude call. Writes brand_memory rows as
// `proposed`, exactly like the review — research lands on the same page and
// goes through the same approval, rather than getting a silo of its own.
export async function requestBrandResearch(webhookUrl, payload) {
  if (!webhookUrl) return { error: 'Brand research webhook not configured. Go to Settings → Integrations.' }
  if (!payload?.workspace_id) return { error: 'No active workspace.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return { error: `Research webhook returned ${res.status}` }
    const data = await res.json()
    const row = Array.isArray(data) ? data[0] : data
    if (!row || row.ok !== true) return { error: (row && row.error) || 'The research returned nothing usable.' }
    return {
      ok: true, skipped: !!row.skipped, reason: row.reason || '',
      proposed: row.proposed || 0, note: row.note || '', warning: row.warning || '',
    }
  } catch (err) { return { error: err.message } }
}

// ─── Aggregation ───────────────────────────────────────────────────────────

const ENGAGEMENT_METRICS = ['likes', 'comments', 'shares', 'saves']

// Engagement counted only from metrics the platform actually reported. A
// missing metric is not a zero — post_analytics keeps `metrics_present`
// precisely so a real 0 stays distinguishable from "not measured here", and
// averaging the two together would quietly punish whichever platform
// reports fewer of them.
export function engagementOf(row) {
  const present = Array.isArray(row.metrics_present) ? row.metrics_present : null
  let total = 0
  for (const m of ENGAGEMENT_METRICS) {
    if (present && !present.includes(m)) continue
    total += Number(row[m]) || 0
  }
  return total
}

function summarise(groups) {
  return [...groups]
    .map(([key, values]) => ({
      key,
      sampleSize: values.length,
      avgEngagement: values.reduce((a, b) => a + b, 0) / values.length,
      weak: values.length < WEAK_SAMPLE,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)
}

// What people decided — computed from the append-only log, not from the
// ideas' current state, because the log is the only place a decision that was
// later reversed still exists.
export function summariseDecisions(events, ideas) {
  const byEvent = {}
  for (const e of events) byEvent[e.event] = (byEvent[e.event] || 0) + 1

  const decided = (byEvent.approved || 0) + (byEvent.rejected || 0)
  const approvalRate = decided ? (byEvent.approved || 0) / decided : null

  const rejectReasons = new Map()
  for (const e of events) {
    if (e.event !== 'rejected') continue
    const key = e.reason || 'unspecified'
    rejectReasons.set(key, (rejectReasons.get(key) || 0) + 1)
  }

  // Which ideas needed a second pass at the copy. A high count here is the
  // signal that the BRIEF was wrong, not the writing — the same idea being
  // re-drafted repeatedly means the plan never said enough.
  const redraftsByIdea = new Map()
  for (const e of events) {
    if (e.event !== 'redrafted' || !e.idea_id) continue
    redraftsByIdea.set(e.idea_id, (redraftsByIdea.get(e.idea_id) || 0) + 1)
  }
  const ideaById = new Map(ideas.map(i => [i.id, i]))
  const mostRedrafted = [...redraftsByIdea]
    .map(([id, count]) => ({ id, count, idea: ideaById.get(id) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // Which FIELDS people rewrite by hand is the most direct statement there
  // is about where generation falls short: an edited caption is a caption
  // the model got wrong.
  const editedFields = new Map()
  for (const e of events) {
    if (e.event !== 'edited') continue
    const before = e.before || {}, after = e.after || {}
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (String(before[k] ?? '') === String(after[k] ?? '')) continue
      editedFields.set(k, (editedFields.get(k) || 0) + 1)
    }
  }

  return {
    totals: byEvent,
    approvalRate,
    decided,
    rejectReasons: [...rejectReasons].sort((a, b) => b[1] - a[1]),
    mostRedrafted,
    editedFields: [...editedFields].sort((a, b) => b[1] - a[1]).slice(0, 8),
  }
}

// What performed — every breakdown carries its own sample size, because the
// whole risk with this section is a confident-looking average built on two
// posts.
export function summarisePerformance({ metrics, posts }, ideas) {
  const ideaById = new Map(ideas.map(i => [i.id, i]))
  const ideaByPostId = new Map()
  for (const p of posts) {
    if (p.plan_idea_id && ideaById.has(p.plan_idea_id)) ideaByPostId.set(p.id, ideaById.get(p.plan_idea_id))
  }

  // One post can have several daily metric rows; the latest row per post is
  // its current standing, and summing them would count the same likes once
  // per sync.
  const latestByPost = new Map()
  for (const m of metrics) {
    if (m.post_table !== 'instagram_generated_posts' || !m.post_id) continue
    const seen = latestByPost.get(m.post_id)
    if (!seen || String(m.metric_date) > String(seen.metric_date)) latestByPost.set(m.post_id, m)
  }

  const byPillar = new Map(), byFormat = new Map(), byWeekday = new Map(), byPlatform = new Map()
  const add = (map, key, value) => {
    if (!key) return
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(value)
  }

  let matched = 0
  for (const [postId, row] of latestByPost) {
    const engagement = engagementOf(row)
    add(byPlatform, row.platform, engagement)
    const idea = ideaByPostId.get(postId)
    if (!idea) continue
    matched += 1
    add(byPillar, idea.content_pillar, engagement)
    add(byFormat, idea.format || idea.media_type, engagement)
    if (idea.scheduled_date) {
      const d = new Date(`${idea.scheduled_date}T00:00:00`)
      if (!Number.isNaN(d.valueOf())) {
        add(byWeekday, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()], engagement)
      }
    }
  }

  return {
    postsWithMetrics: latestByPost.size,
    postsTracedToIdeas: matched,
    byPillar: summarise(byPillar),
    byFormat: summarise(byFormat),
    byWeekday: summarise(byWeekday),
    byPlatform: summarise(byPlatform),
  }
}
