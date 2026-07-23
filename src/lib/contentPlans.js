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
    suggested_format: idea.format || 'post',
    suggested_style:  idea.suggestedStyle || '',
    suggested_aspect_ratio: idea.suggestedAspectRatio || '',
    image_idea:       idea.imageIdea || '',
    post_kind:        idea.postKind || (idea.format === 'carousel' ? 'carousel' : 'caption_image'),
    slide_count:      idea.slideCount || (idea.format === 'carousel' ? 3 : 1),
    image_text:       idea.imageText || '',
    image_mode:       idea.imageMode || 'generate',
    reference_image_urls: idea.references || [],
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
export async function setAllIdeaStatus(accessToken, planId, status) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?plan_id=eq.${planId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) return { error: await res.text() }
    return { ok: true, rows: await res.json() }
  } catch (err) { return { error: err.message } }
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
      body: JSON.stringify({ generation_status: 'processing', generation_error: '' }),
    })
    return { ok: res.ok }
  } catch (err) { return { error: err.message } }
}

export async function markIdeaProcessing(accessToken, ideaId) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?id=eq.${ideaId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ generation_status: 'processing', generation_error: '' }),
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
