import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

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
    position:         startPosition + i,
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
export async function setAllIdeaStatus(accessToken, planId, status) {
  try {
    const scope = status === 'proposed' ? '' : '&status=eq.proposed'
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
