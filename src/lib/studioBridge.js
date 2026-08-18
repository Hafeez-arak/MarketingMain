import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { defaultAspectRatio, getFormat } from './postFormats'
import { finalizeVersion } from './creativeStudio'

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
// Never 'multi_video', and that is about cost rather than capability: a long
// video is a storyboard of several chained clips, and eight 20s shots is an
// order of magnitude more expensive than one render. Nothing on a plan idea
// says "this should be five shots" — `media_type` distinguishes image from
// video and stops there — so defaulting to it would spend far more than the
// operator asked for on a guess.
//
// Long-form therefore stays an explicit choice in the composer. Switching to
// it there keeps the plan link (the multi-clip session carries plan_idea_id
// and the brief exactly as the single-render path does), and the stitched
// result has its own "Use this →" on the clip board, so a long video reaches
// a post the same way everything else does.
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

// The plan a session belongs to — the return leg of the round trip.
//
// A creative_session stores plan_idea_id and nothing about the plan above it,
// because the idea is the thing it was made for. But "take me back" means the
// BOARD, not the idea, so the plan has to be resolved through the idea. One
// embedded select rather than two round trips.
//
// Scoped to the workspace as well as the id: the session is opened from the
// current workspace, and an idea id that resolves into another company's plan
// must not become a navigable link out of this one.
export async function fetchPlanForIdea(workspaceId, accessToken, ideaId) {
  if (!workspaceId || !ideaId) return null
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/plan_ideas?id=eq.${ideaId}&workspace_id=eq.${workspaceId}` +
      `&select=id,title,topic,plan_id,content_plans(id,name,month)&limit=1`,
      { headers: authHeaders(accessToken) },
    )
    if (!res.ok) return null
    const row = (await res.json())[0]
    if (!row?.plan_id) return null
    return {
      planId: row.plan_id,
      planName: row.content_plans?.name || 'this plan',
      ideaTitle: row.title || row.topic || '',
    }
  } catch { return null }
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
  //
  // media_status only moves forward to 'in_studio'. An idea whose picture is
  // already 'ready' and is being reopened for another pass must not lose that
  // — the accepted asset is still accepted until a new one replaces it, and
  // dropping it back would empty the post row for as long as she is iterating.
  const patch = { image_mode: 'studio' }
  if (idea.mediaStatus !== 'ready') patch.media_status = 'in_studio'
  const marked = await patchIdea(accessToken, idea.id, patch)
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

// One place that writes to a plan idea, so the stage transitions below can't
// drift apart in how they talk to PostgREST.
async function patchIdea(accessToken, ideaId, patch) {
  if (!ideaId) return { error: 'No idea id.' }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plan_ideas?id=eq.${ideaId}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken, 'return=minimal'),
      body: JSON.stringify(patch),
    })
    if (!res.ok) return { error: await res.text() }
    return { ok: true }
  } catch (err) { return { error: err.message } }
}

// The picture is finished — she edited and re-iterated until she was happy,
// and this is the one she accepted.
//
// preview_image_url is reused as the board thumbnail rather than adding a
// second image column; it already means "the picture standing in for this idea
// on the board". For a video the still is what goes here, because a thumbnail
// is what a board needs.
export async function markIdeaMediaReady(accessToken, ideaId, { version } = {}) {
  if (!ideaId) return { error: 'No idea id.' }
  // The still is the board thumbnail AND the video's cover, which is what a
  // grid of cards needs either way. The clip itself needs its own column:
  // without it an accepted reel is marked ready and then silently not
  // attached, leaving a post with a caption and no video — indistinguishable
  // from a render that failed.
  const thumb = version?.image_url || version?.cover_image_url || ''
  const clip  = version?.video_url || ''
  return patchIdea(accessToken, ideaId, {
    media_status: 'ready',
    media_version_id: version?.id || null,
    ...(thumb ? { preview_image_url: thumb } : {}),
    // Always written, including as '' — re-accepting a still after a video
    // must clear the old clip rather than leave it to be attached instead.
    preview_video_url: clip,
  })
}

// Put an idea back to "not started" — she rejected what was made, or wants to
// begin again. Deliberately clears the accepted version but NOT the thumbnail:
// seeing what was previously tried is useful context for the next attempt.
export async function resetIdeaMedia(accessToken, ideaId) {
  return patchIdea(accessToken, ideaId, { media_status: 'none', media_version_id: null })
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


// ── Studio asset → post rows ──────────────────────────────────────────────
// The return leg. Everything above gets a plan idea INTO the studio; this is
// what brings the finished asset back out, as real rows in the generated-post
// tables that Approvals already reads and the publish workflow already knows
// how to send.
//
// One table now. Instagram had its own only because it had its own generation
// workflows; those are gone and Creative Studio is the single generation path,
// so every platform writes to generated_posts.
//
// instagram_generated_posts still exists and is still read — 21 historical
// rows, surfaced through the scheduled_posts view — but nothing writes to it
// any more. It is frozen, not live. Do not add it back here: a row written
// there would land in a table no publish or analytics path follows forward.
const PLATFORM_TABLE = {
  instagram: 'generated_posts',
  tiktok:    'generated_posts',
  snapchat:  'generated_posts',
}
export function tableForPlatform(platform) {
  return PLATFORM_TABLE[platform] || null
}
export const SENDABLE_PLATFORMS = Object.keys(PLATFORM_TABLE)

// Where the asset goes on the row.
//
// A video's still is a COVER, not the post image — the same distinction the
// generation workflow makes. Getting this wrong doesn't error, it just
// publishes a photo where a video was meant to go, which is the kind of thing
// nobody notices until it is live.
function mediaFieldsFor(version) {
  const isVideo = version.media_type === 'video' || !!version.video_url
  if (isVideo) {
    return {
      video_url: version.video_url || '',
      cover_image_url: version.image_url || '',
      image_url: '', image_urls: [],
    }
  }
  const url = version.image_url || ''
  return { image_url: url, image_urls: url ? [url] : [], video_url: '', cover_image_url: '' }
}

// Per-table copy fields.
function copyFieldsFor(platform, { caption, captionAr, captionEn, hashtags }) {
  const common = {
    caption_ar: captionAr || '', caption_en: captionEn || '',
    hashtags: hashtags || '',
  }
  return { ...common, caption: caption || '' }
}

// Find the post row a plan idea already has on this table, if any.
//
// This is what makes re-sending an asset UPDATE rather than duplicate. An idea
// marked image_mode='studio' already had a row written for it by the plan
// generation workflow — with an empty image_url, waiting for exactly this.
// Inserting a second row instead would leave the empty one sitting in
// Approvals forever, indistinguishable from a post whose generation failed.
async function findPostForIdea(accessToken, table, ideaId) {
  if (!ideaId) return null
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?plan_idea_id=eq.${ideaId}&select=id,image_url,video_url&order=created_at.desc&limit=1`,
      { headers: authHeaders(accessToken) },
    )
    if (!res.ok) return null
    return (await res.json())[0] || null
  } catch { return null }
}

// Send one finished version to one or more platforms.
//
// `targets` is a list of platform ids. `when` is { mode, at }: 'queue' leaves
// the post in review, 'schedule'/'now' mark it approved and stamp the time —
// but nothing here publishes. Publishing stays with zernio.js#publishPost so
// there is one path to the platform, with one duplicate guard on it.
//
// Partial success is real and reported honestly: three targets can produce two
// rows and one error, and silently succeeding on "some" would be worse than
// saying which.
// `attachOnly` is what keeps the media-first order from producing two rows per
// idea. In that order the picture is finished BEFORE the plan is finalised, so
// there is no post row yet — and creating one here would mean the generation
// workflow later inserts a second, leaving a caption-only row and a media-only
// row for the same idea with nothing to say which is real.
//
// So when the media comes first, this fills in a row if one already exists and
// otherwise writes nothing: markIdeaMediaReady records the choice on the idea
// (including preview_image_url, which the generation workflow already reads to
// skip generating), and finalising the plan produces one complete row.
export async function sendVersionToPosts(workspaceId, accessToken, {
  version, session, targets, caption, captionAr, captionEn, hashtags, when, attachOnly = false,
}) {
  if (!workspaceId) return { error: 'No active workspace. Try signing out and back in.' }
  if (!version?.id) return { error: 'Nothing to send yet.' }
  if (!version.image_url && !version.video_url) return { error: 'This version has no finished media yet.' }
  const list = (targets || []).filter(t => PLATFORM_TABLE[t])
  if (!list.length) return { error: 'Pick at least one platform to send this to.' }

  const mode = when?.mode || 'queue'
  const scheduledAt = mode === 'schedule' ? (when?.at || null) : null
  const media = mediaFieldsFor(version)
  const ideaId = session?.plan_idea_id || null

  const posts = []
  const errors = []
  for (const platform of list) {
    const table = PLATFORM_TABLE[platform]
    // Copy is written only when there is copy to write. Under the media-first
    // flow the picture is finished BEFORE the caption exists, and the post row
    // may already carry a caption that plan generation wrote — sending an
    // empty string here would silently erase it, and the loss would only show
    // up at publish time.
    const hasCopy = !!(caption || captionAr || captionEn || hashtags)
    const base = {
      ...media,
      ...(hasCopy ? copyFieldsFor(platform, { caption, captionAr, captionEn, hashtags }) : {}),
      topic: session?.brief?.topic || session?.title || '',
      aspect_ratio: version.aspect_ratio || session?.aspect_ratio || '',
      post_kind: media.video_url ? 'video' : 'caption_image',
      // Provenance — which session and which exact version this came from.
      creative_session_id: session?.id || null,
      creative_version_id: version.id,
      source: 'studio',
      status: mode === 'queue' ? 'pending_review' : 'pending_publish',
      ...(scheduledAt ? { scheduled_publish_at: scheduledAt } : {}),
      ...(ideaId ? { plan_idea_id: ideaId } : {}),
    }
    // Unconditional now that every platform shares one table. `platform` is
    // NOT NULL there, so guarding this behind a table check would be a
    // constraint violation waiting to happen rather than a safety net.
    base.platform = platform
    base.media_type = media.video_url ? 'video' : 'image'

    try {
      const existing = await findPostForIdea(accessToken, table, ideaId)
      if (!existing && attachOnly) continue      // nothing to fill in yet — finalising the plan will make it
      const url = existing
        ? `${SUPABASE_URL}/rest/v1/${table}?id=eq.${existing.id}`
        : `${SUPABASE_URL}/rest/v1/${table}`
      const res = await fetch(url, {
        method: existing ? 'PATCH' : 'POST',
        headers: jsonHeaders(accessToken),
        body: JSON.stringify(existing ? base : { workspace_id: workspaceId, ...base }),
      })
      if (!res.ok) { errors.push(`${platform}: ${await res.text()}`); continue }
      const [row] = await res.json()
      posts.push({ platform, table, id: row?.id, updated: !!existing })
    } catch (err) { errors.push(`${platform}: ${err.message}`) }
  }

  // attachOnly with nothing to attach to is the normal media-first case, not a
  // failure — the idea is recorded and the row comes later.
  if (!posts.length && attachOnly && !errors.length) return { ok: true, posts: [], deferred: true }
  if (!posts.length) return { error: errors.join(' · ') || 'Could not create the post.' }

  // Sending an asset out as a post is the strongest possible statement that it
  // is the keeper, so it earns its place in the Media Library exactly as
  // pressing Save would. Guarded on is_final because finalizeVersion appends a
  // library row every time it runs, and re-sending to a second platform later
  // should not file the same asset twice.
  //
  // Deliberately after the rows exist and deliberately not awaited into the
  // result: the posts are the deliverable, and a library hiccup must not
  // report the send as failed when the posts are sitting there.
  if (!version.is_final) {
    finalizeVersion(workspaceId, accessToken, version, session?.title).catch(() => {})
  }

  return { ok: true, posts, warning: errors.length ? errors.join(' · ') : undefined }
}


// ─── Manual posts: a plan idea straight to a post row ───────────────────────
// The exit for copy_mode='own' ideas — the ones whose words are already
// written. See 20260815_manual_copy_mode.sql for why that is a stored fact
// and not something inferred from a populated caption field.
//
// This deliberately mirrors sendVersionToPosts rather than extending it. That
// function is about one finished Studio VERSION going to several platforms;
// this is about several plan IDEAS each going to their own. They share the
// table map and the copy splitting (the parts that would actually hurt to
// duplicate) and nothing else.
//
// Nothing here calls a webhook, so a fully manual plan finalises with no n8n
// configured at all — which was the whole point.

// The image for a manual idea, in the order the operator most likely meant it.
//
// A Studio version wins over an uploaded reference: if someone opened the
// Studio for this idea and accepted a version, that is a later and more
// deliberate act than the reference they attached at plan time. References
// are only the post image when image_mode says so — under 'generate' or
// 'studio' they are guides for a picture that does not exist yet, and
// publishing a guide as the post is exactly the silent wrong-image failure
// mediaFieldsFor was written to avoid.
function manualMediaFor(idea) {
  const video = idea.previewVideoUrl || ''
  if (video) {
    return { video_url: video, cover_image_url: idea.previewImageUrl || '', image_url: '', image_urls: [] }
  }
  const refs = idea.imageMode === 'use_reference' ? (idea.references || []).filter(Boolean) : []
  const urls = idea.previewImageUrl ? [idea.previewImageUrl] : refs
  return { image_url: urls[0] || '', image_urls: urls, video_url: '', cover_image_url: '' }
}

// Write one post row per idea per target platform.
//
// Partial success is reported honestly for the same reason it is in
// sendVersionToPosts: eight ideas can produce seven rows and one error, and
// reporting that as a clean success would lose a post silently. The caller
// gets both lists and decides what to say.
export async function publishIdeasAsPosts(workspaceId, accessToken, planId, ideas) {
  if (!workspaceId) return { error: 'No active workspace. Try signing out and back in.' }
  const list = ideas || []
  if (!list.length) return { ok: true, posts: [], errors: [] }

  const posts = []
  const errors = []

  for (const idea of list) {
    const label = idea.title || idea.topic || 'Untitled idea'
    // `platforms` is the operator's full target set; `platform` stays the
    // authoritative single value every existing workflow reads. Falling back
    // to it means an idea saved before multi-target existed still posts once,
    // to the right place, rather than nowhere.
    const targets = (idea.platforms?.length ? idea.platforms : [idea.platform || 'instagram'])
      .filter(p => PLATFORM_TABLE[p])
    if (!targets.length) { errors.push(`${label}: no platform to post to.`); continue }

    const media = manualMediaFor(idea)
    // The operator's own words. caption_en is where the manual editor writes;
    // caption_ar carries the Arabic when the brand posts bilingually.
    const caption = idea.captionEn || idea.captionAr || ''

    // Media is spread unconditionally on the INSERT path below so a new row
    // always carries every media column explicitly, empty or not. An UPDATE is
    // the opposite case: writing image_url:'' over a row that already has a
    // picture would erase it, and the loss would only surface at publish time.
    // Same reasoning as the hasCopy guard in sendVersionToPosts.
    const hasMedia = !!(media.image_url || media.video_url)

    for (const platform of targets) {
      const table = PLATFORM_TABLE[platform]
      const base = {
        ...copyFieldsFor(platform, {
          caption,
          captionAr: idea.captionAr || '',
          captionEn: idea.captionEn || '',
          hashtags: idea.hashtags || '',
        }),
        first_comment: idea.firstComment || '',
        topic: idea.topic || idea.title || '',
        aspect_ratio: idea.aspectRatio || defaultAspectRatio(platform, idea.postFormat || 'post'),
        post_kind: media.video_url ? 'video' : 'caption_image',
        scheduled_date: idea.date || null,
        publish_time: idea.time || '',
        plan_id: planId || null,
        plan_idea_id: idea.id,
        // Provenance, per idea rather than fixed. This path used to run only
        // for hand-written ideas, so 'manual' was always true; it now writes
        // every finalized idea, including ones a model drafted, and calling
        // those 'manual' would quietly lie to Insights about which posts a
        // human actually wrote.
        source: idea.copyMode === 'own' ? 'manual' : 'plan',
        // Still pending_review rather than approved. Writing your own caption
        // is not the same as having checked it against the picture that ended
        // up attached, and Approvals is where that check already happens for
        // every other kind of post.
        status: 'pending_review',
      }
      base.platform = platform
      base.media_type = media.video_url ? 'video' : 'image'

      try {
        // Same duplicate guard as the Studio path: an idea that already has a
        // row (because its media was attached before the plan was finalised)
        // gets that row filled in, not a second one beside it.
        const existing = await findPostForIdea(accessToken, table, idea.id)
        const body = existing
          ? { ...base, ...(hasMedia ? media : {}) }
          : { workspace_id: workspaceId, ...media, ...base }
        const res = await fetch(
          existing ? `${SUPABASE_URL}/rest/v1/${table}?id=eq.${existing.id}` : `${SUPABASE_URL}/rest/v1/${table}`,
          {
            method: existing ? 'PATCH' : 'POST',
            headers: jsonHeaders(accessToken),
            body: JSON.stringify(body),
          },
        )
        if (!res.ok) { errors.push(`${label} (${platform}): ${await res.text()}`); continue }
        const [row] = await res.json()
        posts.push({ platform, table, id: row?.id, ideaId: idea.id, updated: !!existing })
      } catch (err) {
        errors.push(`${label} (${platform}): ${err.message}`)
      }
    }
  }

  if (!posts.length && errors.length) return { error: errors.join(' · ') }
  return { ok: true, posts, errors }
}
