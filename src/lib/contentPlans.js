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

export async function fetchPlanWithIdeas(accessToken, planId) {
  try {
    const [planRes, ideasRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/content_plans?id=eq.${planId}&select=*`, { headers: authHeaders(accessToken) }),
      fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?plan_id=eq.${planId}&select=*&order=position.asc`, { headers: authHeaders(accessToken) }),
    ])
    const plan  = (await planRes.json())?.[0] || null
    const ideas = ideasRes.ok ? await ideasRes.json() : []
    return { plan, ideas }
  } catch { return { plan: null, ideas: [] } }
}

// Cross-month anti-repetition memory: past ideas from OTHER plans in this
// workspace, most recent first. Sent to the Campaign Planner as history so a
// new month doesn't repeat last month's angle — deliberate recurring series
// (idea.series set) are called out separately as "continue this," not
// "avoid repeating this." All statuses included (even rejected — the AI
// shouldn't independently re-propose something that was already turned down
// either), capped to keep the prompt lean.
export async function fetchPastIdeas(workspaceId, accessToken, excludePlanId, limit = 60) {
  if (!workspaceId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/plan_ideas?workspace_id=eq.${workspaceId}&plan_id=neq.${excludePlanId || '00000000-0000-0000-0000-000000000000'}` +
      `&select=platform,topic,angle,content_pillar,occasion,series,created_at&order=created_at.desc&limit=${limit}`,
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
export async function markIdeasProcessing(accessToken, planId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?plan_id=eq.${planId}&status=eq.approved`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ generation_status: 'processing', generation_error: '', generation_started_at: new Date().toISOString() }),
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
