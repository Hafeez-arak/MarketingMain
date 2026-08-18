import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { describeWebhookFailure } from './n8nWebhooks'
import { tableForPlatform } from './studioBridge'
import { markIdeasDrafting, fetchIdeaDrafts, updateIdea } from './contentPlans'

// ─── Campaign Planner ───────────────────────────────────────────────────────
// Turns a single stated goal into a set of dated, platform-specific post
// ideas. This module decides WHAT to post and WHEN; it does not write post
// rows — publishIdeasAsPosts in studioBridge does that, at finalize.
//
// It no longer writes to instagram_schedule either. That table backed the old
// manual-scheduling path, and writeCampaignPosts (its only writer here) was
// dead code by the time the Instagram generation workflows were retired.

const INSTAGRAM_TONE_FALLBACK = 'professional'

// Ask n8n to decompose a goal into a list of post ideas. The webhook is
// expected to return JSON shaped like:
//   { campaignName?: string, posts: [{ platform, date, topic, tone, angle,
//     suggested_style, suggested_aspect_ratio, design_tip }] }
// See the accompanying n8n spec doc for the full contract.
export async function requestCampaignPlan(webhookUrl, payload) {
  if (!webhookUrl) return { error: 'No Campaign Planner webhook configured. Go to Settings → Integrations → Workflow Webhooks.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return { error: await describeWebhookFailure(res) }
    const data = await res.json()
    const raw  = Array.isArray(data) ? data[0] : data
    const posts = Array.isArray(raw?.posts) ? raw.posts : []
    if (posts.length === 0) return { error: 'The workflow returned no posts. Check the n8n response shape against the spec.' }
    const normalized = posts.map((p, i) => ({
      _rowId:   `plan_${i}_${Date.now()}`,
      platform: 'instagram',
      date:     p.date    || '',
      time:     p.time    || '',
      title:    p.title   || p.topic || '',
      topic:    p.topic   || '',
      angle:    p.angle   || '',
      tone:     p.tone    || INSTAGRAM_TONE_FALLBACK,
      // Planning metadata — surfaced in the review/approval UI so each idea can
      // be judged on WHAT it is (occasion, pillar) and WHY (rationale) before
      // it's approved for generation. All optional; blank if the workflow
      // doesn't return them.
      occasion:   p.occasion       || '',
      pillar:     p.content_pillar || p.pillar || '',
      rationale:  p.rationale      || '',
      // What this post is FOR (objective) and its specific call-to-action —
      // lets the reviewer judge purpose, not just topic.
      objective:  p.objective || '',
      cta:        p.cta       || '',
      format:     p.suggested_format || p.format || 'post',
      // Design suggestion from the planning workflow itself — it had the
      // full topic/angle/brand context when it made this call, so it's
      // preferred over the local heuristic fallback used for manually
      // added posts (which never go through n8n).
      suggestedStyle:       p.suggested_style       || '',
      suggestedAspectRatio: p.suggested_aspect_ratio || '',
      designTip:            p.design_tip            || '',
      // The human's own creative direction for the visual ("what I'm
      // imagining"). The planner may pre-fill it from a seed post; otherwise
      // it's added on the editable board (Stage 3) before generation.
      imageIdea:            p.image_idea            || '',
      // Recurring-series marker ("Tip Tuesday") — lets cross-month history
      // tell "deliberate repeat format" apart from "already covered angle."
      series:               p.series                || '',
    }))
    return { ok: true, posts: normalized, suggestedName: raw?.campaignName || '' }
  } catch (err) {
    return { error: err.message }
  }
}

// A manually-typed idea only ever has a thin topic/tone — this asks the same
// AI persona used for full-month planning to flesh out ONE idea into a real
// brief (angle, objective, cta, image direction) before the user approves it.
// Synchronous (one Sonnet call, no image generation) — the caller can just
// await it inline instead of polling like the generation webhooks.
export async function elongateIdea(webhookUrl, payload) {
  if (!webhookUrl) return { error: 'No Idea Elongation webhook configured. Go to Settings → Integrations → Workflow Webhooks.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return { error: await describeWebhookFailure(res) }
    const data = await res.json()
    const raw  = Array.isArray(data) ? data[0] : data
    if (!raw || raw.ok === false) return { error: raw?.error || 'Elongation failed.' }
    return { ok: true, ...raw }
  } catch (err) {
    return { error: err.message }
  }
}

// Caption Studio — on-demand caption rewriting from the review screen.
// mode='variants' returns 3 alternatives; mode='piece' regenerates one piece
// (caption/hook/body/hashtags) keeping the rest. Synchronous (one Sonnet
// call), so the caller awaits it inline. Only fires when the reviewer asks,
// so it never adds cost to normal generation.
export async function requestCaptionStudio(webhookUrl, payload) {
  if (!webhookUrl) return { error: 'Caption Studio webhook not configured. Go to Settings → Integrations → Workflow Webhooks.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return { error: await describeWebhookFailure(res) }
    const data = await res.json()
    const raw  = Array.isArray(data) ? data[0] : data
    if (!raw || raw.ok === false) return { error: raw?.error || 'Caption rewrite failed.' }
    return { ok: true, ...raw }
  } catch (err) {
    return { error: err.message }
  }
}

// Draft Copy — one call per idea, fired the moment a plan's ideas exist (or
// whenever the reviewer asks for a fresh set on one card). Async: the
// webhook responds "accepted" immediately and writes caption_options /
// media_prompt_options onto the plan_ideas row in the background; the
// caller doesn't await the actual draft, it polls plan_ideas for it
// (see startDraftPoll below). Best-effort — a rejected/unconfigured call
// just means that one card's draft_status never leaves 'drafting' until a
// retry, it never blocks the rest of the board.
export async function requestDraftCopy(webhookUrl, payload) {
  if (!webhookUrl) return { error: 'Draft Copy webhook not configured. Go to Settings → Integrations → Workflow Webhooks.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { ok: res.ok, error: res.ok ? null : `Webhook returned ${res.status}` }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// Media Options — on-demand, synchronous. The reviewer clicked "Generate
// image options" and is watching a loading state, so this awaits the real
// 2-3 candidate image URLs (fal.ai) rather than firing and polling.
export async function requestMediaOptions(webhookUrl, payload) {
  if (!webhookUrl) return { error: 'Media Options webhook not configured. Go to Settings → Integrations → Workflow Webhooks.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return { error: await describeWebhookFailure(res) }
    const data = await res.json()
    const raw  = Array.isArray(data) ? data[0] : data
    if (!raw || raw.ok === false) return { error: raw?.error || 'Image generation failed.' }
    return { ok: true, images: raw.images || [] }
  } catch (err) {
    return { error: err.message }
  }
}

// Video Render — fire-and-forget, one call per video idea (batched by the
// caller firing several at once, not by one call carrying an array).
export async function requestVideoRender(webhookUrl, payload) {
  if (!webhookUrl) return { error: 'Video Render webhook not configured. Go to Settings → Integrations → Workflow Webhooks.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { ok: res.ok, error: res.ok ? null : `Webhook returned ${res.status}` }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// Batch-trigger every approved video-format idea's render, all at once —
// "Finalize" pulls together every outstanding video render in a single action.
//
// The poll below is kept even though the race that motivated it is gone. It
// existed because Generate Post uploaded each cover image asynchronously, so
// firing a render immediately after finalize could catch an empty
// cover_image_url. Finalize now writes the post row itself, cover included,
// before this runs — so in the normal case the first poll finds the cover and
// returns straight away. What it still buys is the case where the cover is
// mid-upload from Studio; the cost when it isn't is one 5s tick.
//
// Never awaited by the caller — this runs in the background; the UI doesn't
// block on video rendering to consider Finalize done.
export async function triggerVideoRenders({ webhooks, videoIdeas, accessToken }) {
  const videoRenderUrl = webhooks?.videoRender
  if (!videoRenderUrl || !videoIdeas?.length) return
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }

  async function waitForCoverThenRender(idea) {
    // Resolved through studioBridge rather than a local map. This used to
    // hardcode instagram_generated_posts, which is now frozen history — a
    // hardcoded lookup would poll a table the row can never appear in, wait
    // out the full two minutes, and give up silently with no render and no
    // error. tableForPlatform is the one place that mapping lives.
    const table = tableForPlatform(idea.platform) || 'generated_posts'
    const deadline = Date.now() + 2 * 60 * 1000
    let coverUrl = ''
    while (Date.now() < deadline && !coverUrl) {
      await new Promise(r => setTimeout(r, 5000))
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?plan_idea_id=eq.${idea.id}&select=cover_image_url&limit=1`, { headers })
        const rows = res.ok ? await res.json() : []
        coverUrl = rows[0]?.cover_image_url || ''
      } catch { /* keep polling */ }
    }
    if (!coverUrl) return // cover never showed up (generation failed/still running) — no render possible
    requestVideoRender(videoRenderUrl, {
      plan_idea_id: idea.id, platform: idea.platform,
      cover_image_url: coverUrl, motion_prompt: idea.motionPrompt || '',
    })
  }

  Promise.allSettled(videoIdeas.map(waitForCoverThenRender))
}

// ─── Guaranteeing copy before a plan is finalised ──────────────────────────
// This replaced requestPlanContentGeneration, which fired the plan's approved
// ideas at the Instagram Plan Generation workflow and let n8n write both the
// caption AND the image into a post row in the background.
//
// That workflow is gone. Creative Studio is the only thing that makes an
// image now, and the post row is written directly by publishIdeasAsPosts from
// what the idea already carries. Which leaves exactly one gap: the old path
// guaranteed a caption existed, because it wrote one. Nothing else did.
//
// So this closes that gap and nothing else. An approved idea reaches finalize
// with a caption already on it in the normal case — Draft Copy runs at review
// time and the reviewer picks one, which writes caption_en/caption_ar onto
// plan_ideas. This handles the ideas that slipped through: approved without a
// caption ever being chosen, or drafted while the reviewer was elsewhere.
//
// Deliberately auto-selects the first option rather than blocking finalize and
// sending someone back to the board. A caption nobody chose is still reviewable
// — every post lands in Approvals as pending_review, with the words right
// there next to the picture, which is the check that actually matters. An
// empty caption is not reviewable in the same way; it is a hole that only
// shows up at publish time.
export async function ensureCaptions({ draftCopyUrl, ideas, accessToken, buildPayload, timeoutMs = 90000, pollMs = 4000 }) {
  const list = ideas || []
  const wantsCopy = i => i.wantsCaption !== false
  const hasCopy   = i => !!((i.captionEn || '').trim() || (i.captionAr || '').trim())

  // An idea that deliberately has no caption (image-only post) is not missing
  // one — leave it alone rather than drafting words nobody asked for.
  const missing = list.filter(i => wantsCopy(i) && !hasCopy(i))
  if (!missing.length) return { ideas: list, errors: [] }

  const errors = []
  const resolved = new Map()   // idea id -> { captionEn, captionAr }

  // First pass, free: some of these already have drafted options sitting
  // unpicked from review. No webhook needed, no waiting — take option one.
  const stillMissing = []
  for (const idea of missing) {
    const opt = (idea.captionOptions || [])[0]
    if (opt && (opt.caption_en || opt.caption_ar)) {
      resolved.set(idea.id, { captionEn: opt.caption_en || '', captionAr: opt.caption_ar || '' })
    } else {
      stillMissing.push(idea)
    }
  }

  // Second pass: actually draft the rest.
  if (stillMissing.length) {
    if (!draftCopyUrl) {
      // Named individually rather than as a count — "3 ideas have no caption"
      // sends someone hunting through a month of cards to find which three.
      for (const i of stillMissing) errors.push(`${i.title || i.topic || 'Untitled idea'}: no caption, and the Draft Copy webhook isn't configured (Settings → Integrations).`)
      return { ideas: applyCaptions(list, resolved), errors }
    }

    const ids = stillMissing.map(i => i.id)
    await markIdeasDrafting(accessToken, ids)
    await Promise.allSettled(stillMissing.map(idea => requestDraftCopy(draftCopyUrl, buildPayload(idea))))

    // Poll plan_ideas rather than trusting the webhook's response: Draft Copy
    // answers "accepted" immediately and writes caption_options later, which
    // is the whole reason the board polls too.
    const deadline = Date.now() + timeoutMs
    const pending = new Set(ids)
    while (pending.size && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollMs))
      const rows = await fetchIdeaDrafts(accessToken, [...pending])
      for (const row of rows) {
        // 'drafting' is the only non-terminal state, and markIdeasDrafting set
        // every one of these to it before firing — so a row that has left it
        // has finished, whatever it finished with. Anything else here is
        // terminal, including 'ready' with no usable option: waiting longer
        // cannot produce one, and treating that as "keep polling" would spin
        // out the whole timeout before reporting a failure already known.
        if (row.draft_status === 'drafting') continue
        const opt = (row.caption_options || [])[0]
        if (opt && (opt.caption_en || opt.caption_ar)) {
          resolved.set(row.id, { captionEn: opt.caption_en || '', captionAr: opt.caption_ar || '' })
        }
        pending.delete(row.id)
      }
    }

    for (const idea of stillMissing) {
      if (!resolved.has(idea.id)) {
        errors.push(`${idea.title || idea.topic || 'Untitled idea'}: couldn't write a caption for this one.`)
      }
    }
  }

  // Persist, so the caption survives a reload and the board shows what was
  // actually used — the post row is written from these same values below.
  await Promise.allSettled([...resolved.entries()].map(([id, c]) =>
    updateIdea(accessToken, id, { caption_en: c.captionEn, caption_ar: c.captionAr })
  ))

  return { ideas: applyCaptions(list, resolved), errors }
}

function applyCaptions(ideas, resolved) {
  if (!resolved.size) return ideas
  return ideas.map(i => resolved.has(i.id) ? { ...i, ...resolved.get(i.id) } : i)
}
