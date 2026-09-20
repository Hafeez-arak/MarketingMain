import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { promotable, promotionNote, ideasFromReport, RESEARCH_SOURCE } from './researchIdeas'

// ─── Content Plans ──────────────────────────────────────────────────────────
// The monthly planning layer. A plan is created up front, its ideas are
// generated (with seasonal awareness), and each idea is approved/rejected.
// Only approved ideas advance to content generation (later phase). Persisted
// so the whole plan + approval state survives reloads.

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}

// ── Plans ──
export async function fetchPlans(workspaceId, accessToken) {
  if (!workspaceId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/content_plans?workspace_id=eq.${workspaceId}&select=*&order=created_at.desc`,
      { headers: authHeaders(accessToken) }
    )
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

// ─── Waiting for a plan n8n is still writing ───────────────────────────────
// Plan generation is asynchronous (see 20260920_plan_generation_async.sql).
// The browser creates the plan in status 'generating', hands the id to n8n,
// and n8n PATCHes the result onto the row whenever Opus finishes — which is
// routinely longer than any HTTP request in front of it survives.
//
// So this is the read the planner loops on. Four outcomes, and keeping them
// distinct is the whole job: "still working" and "n8n died" look identical
// from a single row unless the clock is consulted, and treating the second as
// the first is what produces a spinner nobody can escape.

// How long a plan may sit in 'generating' before we stop believing in it.
// Generous on purpose: an Opus month plan with adaptive thinking is minutes,
// not seconds, and calling it dead early is worse than waiting — the user's
// only recovery is to generate again, which pays for the same month twice.
export const PLAN_GENERATION_TIMEOUT_MS = 15 * 60 * 1000

/**
 * Where a generating plan has got to.
 *
 *   { state: 'working' }            — n8n has it, keep polling.
 *   { state: 'ready',  result }     — the posts are on the row, consume them.
 *   { state: 'failed', error }      — n8n recorded a reason; show it.
 *   { state: 'stale' }              — nothing came back in time.
 *   { state: 'unknown' }            — the read itself failed (offline, 5xx).
 *                                     NOT an error about the plan: the caller
 *                                     must keep waiting rather than declare a
 *                                     run dead because one poll missed.
 *   { state: 'gone' }               — no such plan in this workspace.
 *
 * Workspace-scoped like every other read here, for the same reason: a plan id
 * alone says nothing about who owns it.
 */
export async function readPlanGeneration(workspaceId, accessToken, planId) {
  if (!workspaceId || !planId) return { state: 'unknown' }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/content_plans?id=eq.${planId}&workspace_id=eq.${workspaceId}` +
      `&select=id,status,generation_result,generation_error,generation_started_at,generation_mode`,
      { headers: authHeaders(accessToken) },
    )
    if (!res.ok) return { state: 'unknown' }
    const [row] = await res.json()
    if (!row) return { state: 'gone' }

    // The error is checked before the result and before the status, because
    // n8n writes `generation_error` and flips the status back to 'draft' in
    // the same PATCH — reading status first would call a failed run finished.
    const error = String(row.generation_error || '').trim()
    if (error) return { state: 'failed', error, mode: row.generation_mode || 'new' }

    const result = row.generation_result
    if (result && Array.isArray(result.posts) && result.posts.length) {
      return { state: 'ready', result, mode: row.generation_mode || 'new' }
    }

    // Anything not still marked 'generating', with no result and no error, is
    // a run that ended without leaving a trace — treat it as finished rather
    // than poll a row that will never change again.
    if (row.status !== 'generating') return { state: 'stale', mode: row.generation_mode || 'new' }

    const started = Date.parse(row.generation_started_at || '') || 0
    if (started && Date.now() - started > PLAN_GENERATION_TIMEOUT_MS) {
      return { state: 'stale', mode: row.generation_mode || 'new' }
    }
    return { state: 'working', mode: row.generation_mode || 'new' }
  } catch {
    return { state: 'unknown' }
  }
}

/**
 * Put the plan back to a state a person can act on.
 *
 * Called once the posts on the row have been turned into plan_ideas, and also
 * when a run is abandoned. Clearing `generation_result` is what makes the row
 * idempotent: a non-null result always means "work nobody has picked up yet",
 * so leaving a consumed one behind would insert the same month twice on the
 * next mount.
 */
export async function settlePlanGeneration(accessToken, planId, { error = '' } = {}) {
  return updatePlan(accessToken, planId, {
    status: 'draft',
    generation_result: null,
    generation_error: error,
    generation_started_at: null,
  })
}

// Workspace-scoped on purpose, like every other read in this file: a plan id
// on its own says nothing about which company owns it, so a stale one left
// over from another company would happily load that company's ideas onto the
// board. `plan: null` with no ideas is the honest answer for a plan this
// workspace doesn't own — callers already treat that as "nothing to restore."
// `ok` separates the two ways this comes back empty, because callers act on
// them very differently: ok:false is "the lookup failed" (offline, 5xx) and
// means leave whatever is on screen alone, while ok:true with plan:null is a
// definite "this workspace does not own that plan" — the answer a caller can
// safely discard a stale draft on.
export async function fetchPlanWithIdeas(workspaceId, accessToken, planId) {
  if (!workspaceId || !planId) return { ok: false, plan: null, ideas: [] }
  try {
    const [planRes, ideasRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/content_plans?id=eq.${planId}&workspace_id=eq.${workspaceId}&select=*`, { headers: authHeaders(accessToken) }),
      fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?plan_id=eq.${planId}&workspace_id=eq.${workspaceId}&select=*&order=position.asc`, { headers: authHeaders(accessToken) }),
    ])
    if (!planRes.ok) return { ok: false, plan: null, ideas: [] }
    const plan = (await planRes.json())?.[0] || null
    // No row means the id isn't this workspace's — don't hand back ideas for
    // it either, whatever the second query happened to return.
    if (!plan) return { ok: true, plan: null, ideas: [] }
    const ideas = ideasRes.ok ? await ideasRes.json() : []
    return { ok: true, plan, ideas }
  } catch { return { ok: false, plan: null, ideas: [] } }
}

// Cross-month anti-repetition memory: past ideas from OTHER plans in this
// workspace, most recent first. Sent to the Campaign Planner as history so a
// new month doesn't repeat last month's angle — deliberate recurring series
// (idea.series set) are called out separately as "continue this," not
// "avoid repeating this."
//
// `status` and `reject_reason` are selected because without them an idea a
// human REJECTED came back to the planner in the same "already covered,
// don't repeat" list as one that was approved and published. Those are
// opposite signals: one means the ground is taken, the other means the brand
// does not want that shape of idea at all. The workflow now splits them into
// separate buckets (see pastIdeasSection in gen_workflows.py), which it
// cannot do unless the status actually travels with the row.
export async function fetchPastIdeas(workspaceId, accessToken, excludePlanId, limit = 60) {
  if (!workspaceId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/plan_ideas?workspace_id=eq.${workspaceId}&plan_id=neq.${excludePlanId || '00000000-0000-0000-0000-000000000000'}` +
      `&select=platform,topic,angle,content_pillar,occasion,series,status,reject_reason,scheduled_date,created_at` +
      `&order=created_at.desc&limit=${limit}`,
      { headers: authHeaders(accessToken) }
    )
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

// Everything the AI planner should know beyond the Brand Brain, in one read:
//
//   research      the newest completed research run's headline, findings and
//                 proposed ideas — evidence for what is worth posting now
//   agentMemory   the research agent's own digest, which already lists every
//                 idea it has proposed, so the planner is not the only part of
//                 the app unaware of them
//   recentPosts   what has actually been made lately, beyond the plan_ideas
//                 history — a post written in Studio never had an idea row
//
// All best-effort. A plan must still be buildable on a workspace that has
// never run research, and one failed read only costs that one section.
// Workspace-scoped on every query, as always: RLS is per user, not per brand.
const RESEARCH_MAX_AGE_DAYS = 45

/**
 * The latest run's proposed ideas, for the planner's "From your research"
 * panel.
 *
 * Separate from fetchPlannerMemory even though both read the same run, and
 * deliberately so: that one clips everything hard because it is building a
 * PROMPT and every character costs tokens on a cached block. This one is
 * building a LIST A PERSON READS AND TICKS, where the rationale is the whole
 * reason to tick one, and clipping it to 300 characters would cut off the
 * sentence that justifies the idea. Same source, different budgets.
 *
 * Best-effort like every other read here: a workspace that has never run
 * research just gets no panel, and the plan is still buildable.
 */
export async function fetchResearchIdeas(workspaceId, accessToken) {
  const empty = { runDate: '', runId: '', ideas: [], latestRunDate: '', staleIdeas: false }
  if (!workspaceId) return empty
  try {
    const since = new Date(Date.now() - RESEARCH_MAX_AGE_DAYS * 86400000).toISOString()
    // ── Several runs, not one ──────────────────────────────────────────
    // This read `limit=1`, and that one row was a single point of failure
    // for the whole research-to-planner loop. On 2026-09-17 a run finished
    // `complete`, with a headline that had plainly read all 33 of its
    // findings, and every synthesis array empty — no ideas, no gaps, no
    // top three. The picker renders nothing when there are no ideas, so
    // the entire "From your research" panel silently disappeared, and the
    // two earlier runs that DID propose ideas were four and five days old
    // and perfectly good. One bad run should not erase the feature.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/research_runs?workspace_id=eq.${workspaceId}&status=eq.complete` +
      `&started_at=gte.${since}&select=id,started_at,report&order=started_at.desc&limit=6`,
      { headers: authHeaders(accessToken) },
    )
    if (!res.ok) return empty
    const runs = (await res.json()).filter(r => r?.report)
    if (!runs.length) return empty

    const latestRunDate = String(runs[0].started_at || '').slice(0, 10)
    // The newest run that actually proposed something. Usually runs[0];
    // when it is not, the panel says so rather than quietly serving older
    // ideas as though they were this week's.
    for (const run of runs) {
      const ideas = ideasFromReport(run.report)
      if (!ideas.length) continue
      const runDate = String(run.started_at || '').slice(0, 10)
      return { runDate, runId: run.id || '', ideas, latestRunDate, staleIdeas: runDate !== latestRunDate }
    }
    // Runs exist, none proposed anything. Distinct from "never ran": the
    // picker uses `latestRunDate` to say that out loud instead of vanishing.
    return { ...empty, latestRunDate }
  } catch { return empty }
}

/**
 * The research ideas this workspace has already turned into plan ideas, as
 * the same normalised-title keys ideasFromReport() produces.
 *
 * Used only to LABEL a row "already used" in the picker, never to hide it.
 * The same angle is sometimes genuinely worth running again, and a picker
 * that silently dropped ideas would be overruling the person it exists to
 * inform. Matching is by title for the reason alreadySent() gives: a research
 * idea has no id, it lives inside a run's report JSON.
 */
export async function fetchUsedResearchKeys(workspaceId, accessToken) {
  if (!workspaceId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/plan_ideas?workspace_id=eq.${workspaceId}&source=eq.${RESEARCH_SOURCE}` +
      `&select=title&limit=500`,
      { headers: authHeaders(accessToken) },
    )
    if (!res.ok) return []
    const rows = await res.json()
    return [...new Set(rows.map(r => String(r.title || '').trim().toLowerCase()).filter(Boolean))]
  } catch { return [] }
}

export async function fetchPlannerMemory(workspaceId, accessToken) {
  const empty = { research: null, agentMemory: '', recentPosts: [] }
  if (!workspaceId) return empty
  const headers = authHeaders(accessToken)
  const getJson = async url => {
    try {
      const res = await fetch(url, { headers })
      return res.ok ? await res.json() : []
    } catch { return [] }
  }
  const since = new Date(Date.now() - RESEARCH_MAX_AGE_DAYS * 86400000).toISOString()
  const [runs, digests, posts] = await Promise.all([
    getJson(`${SUPABASE_URL}/rest/v1/research_runs?workspace_id=eq.${workspaceId}&status=eq.complete` +
      `&started_at=gte.${since}&select=started_at,report&order=started_at.desc&limit=1`),
    getJson(`${SUPABASE_URL}/rest/v1/agent_digest?workspace_id=eq.${workspaceId}&select=digest&limit=1`),
    getJson(`${SUPABASE_URL}/rest/v1/scheduled_posts?workspace_id=eq.${workspaceId}` +
      `&select=platform,topic,caption,caption_en,scheduled_date,status&order=created_at.desc&limit=40`),
  ])

  const report = runs?.[0]?.report || null
  const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
  const research = report ? {
    date: String(runs[0].started_at || '').slice(0, 10),
    headline: clip(report.headline, 400),
    // Findings are long-form and cite sources; the planner needs the claim,
    // not the essay, so each is clipped to a sentence or two.
    findings: (Array.isArray(report.market) ? report.market : [])
      .map(f => clip(f?.finding || f?.detail || f, 300)).filter(Boolean).slice(0, 6),
    ideas: (Array.isArray(report.proposed_ideas) ? report.proposed_ideas : [])
      .map(i => ({ title: clip(i?.title, 160), angle: clip(i?.angle, 400), rationale: clip(i?.rationale, 300) }))
      .filter(i => i.title).slice(0, 10),
  } : null

  return {
    research: research && (research.headline || research.findings.length || research.ideas.length) ? research : null,
    agentMemory: String(digests?.[0]?.digest || '').slice(0, 6000),
    recentPosts: (posts || [])
      .map(p => ({
        platform: p.platform || '',
        date: p.scheduled_date || '',
        topic: clip(p.topic, 160),
        caption: clip(p.caption_en || p.caption, 200),
      }))
      .filter(p => p.topic || p.caption),
  }
}

export async function createPlan(workspaceId, accessToken, plan) {
  if (!workspaceId) return { error: 'No active workspace. Try signing out and back in.' }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/content_plans`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ workspace_id: workspaceId, ...plan }),
    })
    if (!res.ok) return { error: await res.text() }
    const [row] = await res.json()
    return { ok: true, plan: row }
  } catch (err) { return { error: err.message } }
}

export async function updatePlan(accessToken, planId, patch) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/content_plans?id=eq.${planId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    })
    if (!res.ok) return { error: await res.text() }
    const [row] = await res.json()
    return { ok: true, plan: row }
  } catch (err) { return { error: err.message } }
}

export async function deletePlan(accessToken, planId) {
  try {
    // plan_ideas cascade-delete via FK
    await fetch(`${SUPABASE_URL}/rest/v1/content_plans?id=eq.${planId}`, { method: 'DELETE', headers: authHeaders(accessToken) })
    return { ok: true }
  } catch (err) { return { error: err.message } }
}

// ── Ideas ──
// Bulk-insert the freshly generated ideas for a plan. Returns the DB rows
// (with ids) so the UI can drive per-idea approval against real records.
// `startPosition` offsets the position column so incremental inserts
// ("generate more" / "add idea") append after existing ideas instead of
// colliding at 0 and scrambling the order on reload (which sorts by position).
export async function insertIdeas(workspaceId, accessToken, planId, ideas, startPosition = 0) {
  if (!workspaceId || !ideas?.length) return { ok: true, rows: [] }
  // platform_options (a LinkedIn poll, today) is sent only when an idea in
  // the batch actually carries some. The column arrived in
  // 20260915_plan_idea_platform_options.sql, applied by hand; a database that
  // has not had it yet would refuse EVERY insert naming it, and an
  // Instagram-only plan has no reason to be the thing that finds out. And it
  // is all-or-none across the batch, because PostgREST rejects a bulk insert
  // whose rows do not share the same keys.
  const withOptions = ideas.some(idea => nonEmptyOptions(idea.platformOptions))
  // Same all-or-none rule, same reason: `source` is only named when some idea
  // in this batch actually came from research, and then it is named on every
  // row. (`source` has shipped since 20260824_research_agent.sql, so unlike
  // platform_options this is about PostgREST's uniform-keys rule alone, not
  // about a migration that might be missing.)
  const withResearch = ideas.some(idea => idea.fromResearch)
  const body = ideas.map((idea, i) => ({
    workspace_id:     workspaceId,
    plan_id:          planId,
    platform:         idea.platform || 'instagram',
    scheduled_date:   idea.date || null,
    publish_time:     idea.time || '',
    title:            idea.title || idea.topic || '',
    topic:            idea.topic || '',
    angle:            idea.angle || '',
    tone:             idea.tone || '',
    occasion:         idea.occasion || '',
    content_pillar:   idea.pillar || '',
    rationale:        idea.rationale || '',
    objective:        idea.objective || '',
    cta:              idea.cta || '',
    hashtags:         idea.hashtags || '',
    first_comment:    idea.firstComment || '',
    series:           idea.series || '',
    suggested_format: idea.format || 'post',
    suggested_style:  idea.suggestedStyle || '',
    suggested_aspect_ratio: idea.suggestedAspectRatio || '',
    image_idea:       idea.imageIdea || '',
    post_kind:        idea.postKind || (idea.format === 'carousel' ? 'carousel' : 'caption_image'),
    slide_count:      idea.slideCount || (idea.format === 'carousel' ? 3 : 1),
    image_text:       idea.imageText || '',
    // Studio by default. Plan generation renders with flux-schnell while the
    // studio uses gpt-image-2 / nano-banana-2, so a bulk image arrives looking
    // finished, isn't, and can't be iterated on — 'generate' stays available
    // as a deliberate opt-out for low-stakes formats, not as the default.
    image_mode:       idea.imageMode || 'studio',
    reference_image_urls: idea.references || [],
    // Format & orientation system — the human-editable fields generation
    // actually reads now; suggested_format/suggested_aspect_ratio above stay
    // as AI telemetry only. post_kind is still sent for the current engine,
    // but it's derived (see postFormats.js#derivePostKind), never independent.
    format:           idea.postFormat || '',
    aspect_ratio:     idea.aspectRatio || '',
    media_type:       idea.mediaType || 'image',
    group_id:         idea.groupId || null,
    wants_caption:    idea.wantsCaption !== false,
    // Whose words go out. 'own' means the caption below is final and must
    // reach the post verbatim — finalize writes the row itself instead of
    // briefing the AI writer. See 20260815_manual_copy_mode.sql.
    copy_mode:        idea.copyMode === 'own' ? 'own' : 'ai',
    caption_ar:       idea.captionAr || '',
    caption_en:       idea.captionEn || '',
    status:           'proposed',
    // Where this idea came from. 'research' means the planner built it from
    // an idea the research agent proposed and a person ticked on the setup
    // step — the same value SendIdeasToPlan writes when the ideas are pushed
    // the other way, so the board can say so regardless of which direction
    // they arrived from. See researchIdeas.js#RESEARCH_SOURCE.
    //
    // Named on EVERY row of a batch where any row needs it, never per row:
    // PostgREST rejects a bulk insert whose rows do not share the same keys,
    // which is the same trap `withOptions` above exists to avoid. Rows that
    // did not come from research get the column's own 'planner' default
    // spelled out rather than omitted.
    ...(withResearch ? { source: idea.fromResearch ? RESEARCH_SOURCE : 'planner' } : {}),
    position:         startPosition + i,
    // Only when some idea in this batch has any — see below.
    ...(withOptions ? { platform_options: nonEmptyOptions(idea.platformOptions) || {} } : {}),
  }))
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return { error: await res.text() }
    return { ok: true, rows: await res.json() }
  } catch (err) { return { error: err.message } }
}

function nonEmptyOptions(opts) {
  return opts && typeof opts === 'object' && Object.keys(opts).length ? opts : null
}

export async function updateIdea(accessToken, ideaId, patch) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?id=eq.${ideaId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) return { error: await res.text() }
    const [row] = await res.json()
    return { ok: true, idea: row }
  } catch (err) { return { error: err.message } }
}

// Approve or reject every still-'proposed' idea in one call (bulk action).
// "Reset" (status === 'proposed') really does mean touch everything; Approve
// all / Reject all must NOT — without the status=eq.proposed scope, clicking
// "Approve all" would also flip already-rejected ideas back to approved
// (and vice versa), silently overturning decisions the user already made.
//
// `exceptIds` leaves those ideas alone whatever the status — the planner passes
// the ideas whose posts have already gone out, which keep their approval.
export async function setAllIdeaStatus(accessToken, planId, status, { exceptIds = [] } = {}) {
  try {
    const scope = (status === 'proposed' ? '' : '&status=eq.proposed') +
      (exceptIds.length ? `&id=not.in.(${exceptIds.join(',')})` : '')
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?plan_id=eq.${planId}${scope}`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) return { error: await res.text() }
    return { ok: true, rows: await res.json() }
  } catch (err) { return { error: err.message } }
}

// ── Draft copy tracking ──────────────────────────────────────────────────
// Durable per-idea state: not_started -> drafting -> ready/failed. Marked
// 'drafting' the instant ideas are created (before the draft-copy webhook
// even responds — it's async) so the board shows real state on reload, not
// just while the tab that created them stays open.
export async function markIdeasDrafting(accessToken, ideaIds) {
  if (!ideaIds?.length) return { ok: true }
  try {
    const idList = ideaIds.join(',')
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?id=in.(${idList})`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ draft_status: 'drafting', draft_error: '', drafted_at: new Date().toISOString() }),
    })
    return { ok: res.ok }
  } catch (err) { return { error: err.message } }
}

// The other end of markIdeasDrafting, for the cases n8n will never answer.
//
// 'drafting' is written here, in the browser, but only ever cleared by the
// Draft Copy workflow PATCHing the row. So anything that stops the request
// from reaching that workflow — a rejected webhook call, a workflow that dies
// before its Supabase node — leaves the row 'drafting' in the DATABASE
// forever, and every later page load starts a spinner for a job nobody is
// running. Found 2026-08-19 with rows still 'drafting' three days later:
// the board's own 5-minute timeout only ever patched React state, so it
// looked handled while the row underneath it never changed.
//
// Whoever notices the failure writes it down, so the card comes back as
// 'failed' with a Retry instead of a spinner.
export async function markIdeaDraftFailed(accessToken, ideaId, message) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?id=eq.${ideaId}&draft_status=eq.drafting`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ draft_status: 'failed', draft_error: String(message || 'Drafting failed.').slice(0, 500) }),
    })
    return { ok: res.ok }
  } catch (err) { return { error: err.message } }
}

// Poll target for the plan board — just the fields that change while a
// draft is in flight, for just the ideas currently 'drafting'.
export async function fetchIdeaDrafts(accessToken, ideaIds) {
  if (!ideaIds?.length) return []
  try {
    const idList = ideaIds.join(',')
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/plan_ideas?id=in.(${idList})&select=id,caption_options,media_prompt_options,draft_status,draft_error,drafted_at`,
      { headers: authHeaders(accessToken) }
    )
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

// ── Generation status tracking ──────────────────────────────────────────
// Durable per-idea state: not_started -> processing -> completed/failed.
// Marked 'processing' the instant a plan is finalized (or a retry fires) —
// before n8n even responds — so Post Approvals shows real state on reload,
// not just while the browser tab that fired it stays open.
// `copyMode` scopes this to one side of the finalize partition. Only ideas
// actually being generated may be marked 'processing' — a manually-written
// post never enters the generation engine, so flagging it would leave it
// stuck in Post Approvals waiting for a workflow that is never coming.
export async function markIdeasProcessing(accessToken, planId, { copyMode } = {}) {
  const scope = copyMode ? `&copy_mode=eq.${copyMode}` : ''
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?plan_id=eq.${planId}&status=eq.approved${scope}`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ generation_status: 'processing', generation_error: '', generation_started_at: new Date().toISOString() }),
    })
    return { ok: res.ok }
  } catch (err) { return { error: err.message } }
}

// The other end of markIdeasProcessing, and the reason it needs one.
//
// 'processing' used to be cleared by the Instagram Plan Generation workflow
// when it finished writing the post row. That workflow is gone and finalize
// writes the row itself — so without this, every finalized idea would sit at
// generation_status='processing' forever and Approvals would show a spinner
// (then a "stale" warning) next to a post that has been sitting there,
// finished, the whole time.
export async function markIdeasGenerated(accessToken, ideaIds, { status = 'completed', error = '' } = {}) {
  if (!ideaIds?.length) return { ok: true }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?id=in.(${ideaIds.join(',')})`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ generation_status: status, generation_error: error }),
    })
    return { ok: res.ok }
  } catch (err) { return { error: err.message } }
}

export async function markIdeaProcessing(accessToken, ideaId) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?id=eq.${ideaId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ generation_status: 'processing', generation_error: '', generation_started_at: new Date().toISOString() }),
    })
    return { ok: true }
  } catch (err) { return { error: err.message } }
}

// ── Everything Post Approvals needs to render the grouped-by-plan view:
// every plan (for section headers) + every approved idea across all plans
// (for processing/failed/completed state), workspace-scoped. ──
export async function fetchApprovalsData(workspaceId, accessToken) {
  if (!workspaceId) return { plans: [], ideas: [] }
  try {
    const headers = authHeaders(accessToken)
    const [plansRes, ideasRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/content_plans?workspace_id=eq.${workspaceId}&select=*&order=created_at.desc`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?workspace_id=eq.${workspaceId}&status=eq.approved&select=*&order=created_at.desc`, { headers }),
    ])
    const plans = plansRes.ok ? await plansRes.json() : []
    const ideas = ideasRes.ok ? await ideasRes.json() : []
    return { plans, ideas }
  } catch { return { plans: [], ideas: [] } }
}

export async function deleteIdea(accessToken, ideaId) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?id=eq.${ideaId}`, { method: 'DELETE', headers: authHeaders(accessToken) })
    return { ok: true }
  } catch (err) { return { error: err.message } }
}

// ── Promoting a research idea ────────────────────────────────────────────
// Lives here rather than beside the mapping in researchIdeas.js, so that file
// stays pure — no supabaseClient import, no `import.meta.env`, importable by
// anything including a plain Node process. The network half belongs with the
// other plan_ideas writes anyway.

/**
 * Put research ideas into a plan.
 *
 * Reads the destination FIRST, because the duplicate check has to run against
 * what is actually in the plan rather than what this page believed a minute
 * ago. Two people with the brief open would otherwise both send the same idea.
 *
 * Workspace-scoped on the read as well as the write, like every other query in
 * this file: a plan id on its own says nothing about who owns it.
 */
export async function sendIdeasToPlan({ workspaceId, accessToken, planId, planName = '', ideas, platform = 'instagram' }) {
  if (!workspaceId) return { error: 'No active workspace.' }
  if (!planId) return { error: 'Choose a plan first.' }
  if (!ideas?.length) return { error: 'Nothing to send.' }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/plan_ideas?plan_id=eq.${planId}&workspace_id=eq.${workspaceId}` +
      `&select=id,title,topic,position`,
      { headers: authHeaders(accessToken) },
    )
    if (!res.ok) return { error: `Could not read that plan (${res.status}).` }
    const existing = await res.json()

    const { rows, skipped } = promotable(ideas, existing, { workspaceId, planId, platform })
    if (!rows.length) {
      return { ok: true, sent: 0, skipped: skipped.length, note: promotionNote({ sent: 0, skipped: skipped.length, planName }) }
    }

    const write = await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(rows),
    })
    if (!write.ok) return { error: (await write.text()).slice(0, 300) }
    const written = await write.json()

    return {
      ok: true,
      sent: written.length,
      skipped: skipped.length,
      note: promotionNote({ sent: written.length, skipped: skipped.length, planName }),
    }
  } catch (err) {
    return { error: String(err?.message || err) }
  }
}
