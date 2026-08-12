import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { defaultAspectRatio, getFormat } from './postFormats'

// ─── Plan ↔ Creative Studio bridge ─────────────────────────────────────────
// The join between the two halves of the app that never spoke: contentPlans
// (a planned POST — topic, date, caption) and creativeStudio (an ASSET, where
// the asset is the deliverable and there may be no post at all).
//
// Deliberately its own module rather than more surface on creativeStudio.js.
// That file is about making assets and is the largest lib here; this is about
// the relationship between an idea and a session. Keeping the bridge separate
// also means the studio's own code path is untouched by anything here.
//
// Same contract as every other lib in this project: raw fetch against
// PostgREST, `{ ok: true, ... }` or `{ error: string }` on writes, and reads
// that swallow failures into an empty value rather than throwing across the
// boundary.

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}
function jsonHeaders(accessToken, prefer = 'return=representation') {
  return { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: prefer }
}


// ── Pure helpers (no I/O — safe to unit test and to call during render) ────

// What the composer should open with. Priority is deliberate: the drafted
// media prompt is the most specific thing anyone has written about this
// idea's visual, the human's own "image idea" comes next, and the topic is
// the last resort. Falling straight through to `topic` when a media prompt
// exists would throw away the drafting step's whole output.
export function seedPromptFromIdea(idea) {
  if (!idea) return ''
  const fromDraft = (idea.mediaPrompt || '').trim()
  if (fromDraft) return fromDraft
  const vision = (idea.imageIdea || '').trim()
  if (vision) return vision
  const topic = (idea.topic || idea.title || '').trim()
  const angle = (idea.angle || '').trim()
  if (topic && angle) return `${topic} — ${angle}`
  return topic
}

// Snapshot of the idea as it was when the session opened. A SNAPSHOT, not a
// live join: the session records what was actually asked for, so editing the
// idea afterwards doesn't silently rewrite the brief an asset was made
// against. Only the fields worth showing above a composer.
export function buildBriefFromIdea(idea) {
  if (!idea) return null
  return {
    ideaId:    idea.id || null,
    title:     idea.title || idea.topic || '',
    topic:     idea.topic || '',
    angle:     idea.angle || '',
    tone:      idea.tone || '',
    occasion:  idea.occasion || '',
    pillar:    idea.pillar || '',
    objective: idea.objective || '',
    cta:       idea.cta || '',
    imageIdea: idea.imageIdea || '',
    style:     idea.suggestedStyle || '',
    format:    idea.postFormat || '',
    platform:  idea.platform || '',
    platforms: idea.platforms?.length ? idea.platforms : [idea.platform || 'instagram'],
    aspectRatio: idea.aspectRatio || '',
    date:      idea.date || '',
    seedPrompt: seedPromptFromIdea(idea),
    capturedAt: new Date().toISOString(),
  }
}

// Which Studio mode an idea should open in.
//
// Note what is NOT here: 'multi_video'. A long video is a storyboard of
// several chained clips with its own cost model and its own sequencer, and
// nothing about a plan idea says "this should be five shots". Opening one
// from a plan card would start a materially more expensive run than the
// operator asked for. Long-form stays something you choose explicitly inside
// the studio.
export function studioIntentForIdea(idea) {
  const mediaType = idea?.mediaType
    || getFormat(idea?.platform || 'instagram', idea?.postFormat)?.media
    || 'image'
  return mediaType === 'video' ? 'video' : 'image'
}

// One 9:16 render covers IG Reel + TikTok + Snapchat Spotlight, which is the
// whole reason targets are chosen before generation rather than after.
export function studioAspectForIdea(idea) {
  return idea?.aspectRatio
    || defaultAspectRatio(idea?.platform || 'instagram', idea?.postFormat)
    || '4:5'
}


// ── Reads ─────────────────────────────────────────────────────────────────

// Every Studio session opened from any of these ideas, newest first. One
// call for the whole board — the same shape contentPlans.js#fetchIdeaDrafts
// uses for draft state, and the reason the FK lives on creative_sessions
// rather than being mirrored back onto plan_ideas.
export async function fetchSessionsForIdeas(accessToken, ideaIds) {
  if (!ideaIds?.length) return []
  try {
    const idList = ideaIds.join(',')
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/creative_sessions?plan_idea_id=in.(${idList})` +
      `&select=id,plan_idea_id,title,intent,aspect_ratio,status,updated_at&order=updated_at.desc`,
      { headers: authHeaders(accessToken) },
    )
    return res.ok ? await res.json() : []
  } catch { return [] }
}

// Newest non-archived session for one idea, or null.
export async function findSessionForIdea(accessToken, ideaId) {
  if (!ideaId) return null
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/creative_sessions?plan_idea_id=eq.${ideaId}&status=eq.active` +
      `&select=*&order=updated_at.desc&limit=1`,
      { headers: authHeaders(accessToken) },
    )
    if (!res.ok) return null
    return (await res.json())[0] || null
  } catch { return null }
}


// ── The bridge ────────────────────────────────────────────────────────────

// Route a plan idea into Creative Studio.
//
// Returns the EXISTING session if there is one, and null otherwise — it
// deliberately does not create anything. The studio has one and only one code
// path that turns a prompt into a session, and it runs at the moment of the
// first generation. Creating an empty session here instead would land the
// operator on a session with no versions, which the studio renders as
// "Nothing here yet" with no composer — a dead end.
//
// So: an existing session is opened directly; a new one is set up by
// pre-filling the studio's own composer (see fetchIdeaForStudio) and letting
// the studio create the session when it normally would. Reusing rather than
// re-creating is also what keeps a second click from abandoning work the
// workspace already paid fal for.
//
// Either way the idea is flipped to image_mode='studio' — the other half of
// the double-spend guard, telling plan generation not to pay for an image for
// an idea a human is making by hand.
export async function openStudioForIdea(accessToken, idea) {
  if (!idea?.id) return { error: 'Save this idea first — a draft card has no id to attach a session to.' }

  const existing = await findSessionForIdea(accessToken, idea.id)
  // Marked in both branches on purpose: an idea whose mode was reverted in
  // between must not silently fall back to paid auto-generation just because
  // its session already existed.
  const marked = await markIdeaStudioMode(accessToken, idea.id)
  return { ok: true, session: existing, warning: marked.error }
}

// One plan idea, in the shape the studio composer needs. Used when arriving
// at /studio?ideaId=<id> with no session yet.
//
// Returns the raw row alongside the derived values so the caller doesn't need
// to import dbIdeaToDraft (which lives in campaignPlan.js and drags plan
// concepts into the studio).
export async function fetchIdeaForStudio(accessToken, ideaId) {
  if (!ideaId) return null
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/plan_ideas?id=eq.${ideaId}&select=*&limit=1`,
      { headers: authHeaders(accessToken) },
    )
    if (!res.ok) return null
    const row = (await res.json())[0]
    if (!row) return null
    // Map the few fields the composer and the brief actually read. Kept local
    // rather than reusing dbIdeaToDraft so the studio never has to import the
    // planner's draft shape.
    const idea = {
      id: row.id,
      title: row.title || '',
      topic: row.topic || '',
      angle: row.angle || '',
      tone: row.tone || '',
      occasion: row.occasion || '',
      pillar: row.content_pillar || '',
      objective: row.objective || '',
      cta: row.cta || '',
      imageIdea: row.image_idea || '',
      mediaPrompt: row.media_prompt || '',
      suggestedStyle: row.suggested_style || '',
      platform: row.platform || 'instagram',
      platforms: row.platforms?.length ? row.platforms : [row.platform || 'instagram'],
      postFormat: row.format || '',
      aspectRatio: row.aspect_ratio || '',
      mediaType: row.media_type || 'image',
      date: row.scheduled_date || '',
    }
    return {
      idea,
      brief:  buildBriefFromIdea(idea),
      prompt: seedPromptFromIdea(idea),
      intent: studioIntentForIdea(idea),
      aspect: studioAspectForIdea(idea),
    }
  } catch { return null }
}

// Set / clear the 'a human is making this in Studio' flag.
//
// Kept as its own export so the plan board can revert an idea to paid
// auto-generation without needing to know how the session is stored.
export async function markIdeaStudioMode(accessToken, ideaId, on = true) {
  if (!ideaId) return { error: 'No idea id.' }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?id=eq.${ideaId}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken, 'return=minimal'),
      body: JSON.stringify({ image_mode: on ? 'studio' : 'generate' }),
    })
    if (!res.ok) return { error: await res.text() }
    return { ok: true }
  } catch (err) { return { error: err.message } }
}

// Persist the platform targets for an idea.
//
// This writes `platforms` ONLY. `platform` (singular) is left exactly as it
// is, and that restraint is the important part: it is what every workflow,
// all three generated-post tables and fetchPastIdeas read, and it is also
// what picks the format catalog and the tone vocabulary. Re-pointing it from
// a chip row would silently invalidate the idea's already-chosen format —
// 'feed_image' does not exist on TikTok — and the card would fall back to a
// different format than the one the operator reviewed.
//
// So `platform` stays the primary, and `platforms` is the additive target
// set. The primary is always forced into the set so the two can never
// describe different intentions.
export async function saveIdeaPlatforms(accessToken, ideaId, platforms, primaryPlatform) {
  if (!ideaId) return { error: 'No idea id.' }
  const list = [...new Set([primaryPlatform, ...(platforms || [])].filter(Boolean))]
  if (!list.length) return { error: 'Pick at least one platform.' }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?id=eq.${ideaId}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken, 'return=minimal'),
      body: JSON.stringify({ platforms: list }),
    })
    if (!res.ok) return { error: await res.text() }
    return { ok: true, platforms: list }
  } catch (err) { return { error: err.message } }
}
