import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { getVideoModel, estimateVideoCost, modelImageRole } from '../components/studio/videoModels'
import { buildVideoPrompt } from '../components/studio/motionPresets'

// ─── Multi-clip storyboard ─────────────────────────────────────────────────
// A long video is several short clips, chained for continuity and stitched
// afterwards. This module owns the PLAN — what the marketer typed, before and
// between renders — while creative_versions keeps the results, one row per
// clip, exactly like every other generated asset in the studio.
//
// The plan lives on creative_sessions.storyboard rather than on the version
// rows for one hard reason: the video workflow REPLACES creative_versions.
// overlay_state wholesale when it records a fal request id, so anything the
// browser writes there on a video row is destroyed the moment the render is
// submitted. n8n never writes creative_sessions.
//
// Kept out of creativeStudio.js because that file is already the studio's
// whole data layer; this is a self-contained second shape on top of it.

// Matches the cap in the Creative Stitch workflow's own validation. Two
// numbers that must agree — if this one is raised, raise MAX_CLIPS in
// build_creative_stitch() too, or the storyboard will offer a reel the
// workflow refuses to assemble.
export const MULTI_CLIP_MAX = 12

// ── Shape ──────────────────────────────────────────────────────────────────

// Stable per-clip id. Array position is `clip_index` and it is what the
// rendered rows are keyed by, so it can't double as identity — this survives
// a clip being renamed, retimed or re-rendered.
let clipSeq = 0
function clipKey() {
  clipSeq += 1
  return `c_${Date.now().toString(36)}_${clipSeq}`
}

export function newClip(modelId, overrides = {}) {
  const model = getVideoModel(modelId)
  return {
    key: clipKey(),
    prompt: '',
    duration: model.defaultDuration,
    resolution: model.defaultResolution,
    motion: '',
    motionStrength: 'medium',
    // Images for THIS shot alone, on top of the board's shared set. What they
    // mean depends on the model (modelImageRole): style references on
    // Seedance, a start frame everywhere else. Ignored entirely on a chained
    // clip, whose start frame is the previous clip's last one.
    refs: [],
    // Ignored on clip 0 — there is nothing before it to continue from.
    continueFromPrevious: true,
    transition: 'cut',
    transitionDuration: 0.5,
    ...overrides,
  }
}

export function emptyStoryboard({ model, lookId, prompt } = {}) {
  // Seedance 2.5 is the studio default and the only model that reaches past
  // 15s, but for multi-clip that matters less — length comes from clip count
  // now, so the pick is about look and price rather than ceiling.
  const modelId = model || 'seedance-2.5'
  return {
    version: 1,
    styleBible: '',
    sharedRefs: [],
    model: modelId,
    // Off by default, and the UI says why: a handed-over last frame carries
    // no audio state, so each clip would invent its own ambience and every
    // seam would have an audible discontinuity. It also roughly halves the
    // bill on the models that charge for it.
    audio: false,
    lookId: lookId || 'none',
    clips: [newClip(modelId, { prompt: prompt || '', continueFromPrevious: false })],
  }
}

// A storyboard read back from the DB may predate any field added later, and a
// half-written jsonb blob must never crash the page it's rendered on.
export function normalizeStoryboard(raw, fallback = {}) {
  const base = emptyStoryboard(fallback)
  if (!raw || typeof raw !== 'object') return base
  const clips = Array.isArray(raw.clips) && raw.clips.length ? raw.clips : base.clips
  return {
    ...base,
    ...raw,
    clips: clips.slice(0, MULTI_CLIP_MAX).map((c, i) => ({
      ...newClip(raw.model || base.model),
      ...c,
      key: c.key || clipKey(),
      continueFromPrevious: i === 0 ? false : !!c.continueFromPrevious,
      // Predates the field on any board saved before 2026-08-12.
      refs: Array.isArray(c.refs) ? c.refs.slice(0, 9) : [],
    })),
    sharedRefs: Array.isArray(raw.sharedRefs) ? raw.sharedRefs.slice(0, 9) : [],
  }
}

// ── Persistence ────────────────────────────────────────────────────────────

function headers(accessToken) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  }
}

export async function saveStoryboard(accessToken, sessionId, storyboard) {
  if (!sessionId) return { error: 'No session to save against.' }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/creative_sessions?id=eq.${sessionId}`, {
      method: 'PATCH',
      headers: headers(accessToken),
      body: JSON.stringify({ storyboard, updated_at: new Date().toISOString() }),
    })
    if (!res.ok) return { error: await res.text() }
    return { ok: true }
  } catch (err) { return { error: err.message } }
}

// Whether a render run was still going when this tab last had the session
// open. Drives the "this run stopped — Continue?" banner and nothing else:
// it is deliberately NOT a lock (see the migration's comment), because a
// crashed tab would wedge the session forever and it cannot see a second tab
// anyway. The unique index on (session_id, clip_index, clip_attempt) is what
// actually prevents a double render.
export async function setRunStatus(accessToken, sessionId, status) {
  if (!sessionId) return { ok: true }
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/creative_sessions?id=eq.${sessionId}`, {
      method: 'PATCH',
      headers: headers(accessToken),
      body: JSON.stringify({ clip_run_status: status || '' }),
    })
    return { ok: true }
  } catch { return { ok: true } /* cosmetic — never fail a render over it */ }
}

// ── Reading rendered rows back ─────────────────────────────────────────────

// The latest attempt at each clip, in shot order.
//
// Explicitly by clip_index and clip_attempt, NEVER by array position: rows
// inserted in one batch all share a created_at (now() is the transaction
// timestamp, not the statement's) and fetchVersions orders by it, so the
// order rows come back in is arbitrary the moment more than one lands
// together.
export function clipRowsByIndex(versions, count) {
  const best = new Map()
  for (const v of versions || []) {
    if (v.clip_index == null || v.clip_role) continue
    const cur = best.get(v.clip_index)
    if (!cur || (v.clip_attempt ?? 0) > (cur.clip_attempt ?? 0)) best.set(v.clip_index, v)
  }
  return Array.from({ length: count }, (_, i) => best.get(i) || null)
}

export function nextClipAttempt(versions, clipIndex) {
  let max = -1
  for (const v of versions || []) {
    if (v.clip_index === clipIndex && !v.clip_role) max = Math.max(max, v.clip_attempt ?? 0)
  }
  return max + 1
}

// Stitched reels, newest first. Re-stitching never overwrites — a marketer
// comparing hard cuts against a crossfade needs both to still exist.
export function stitchRowsOf(versions) {
  return (versions || [])
    .filter(v => v.clip_role === 'stitch')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

export function clipState(row) {
  if (!row) return 'missing'
  return row.status === 'ready' ? 'ready' : row.status === 'failed' ? 'failed' : 'pending'
}

// ── Seams that no longer connect ───────────────────────────────────────────
// Re-rendering one shot does NOT re-render the shots that continue from it.
// Clip N+1 was generated from a still of the take clip N *used* to be, so the
// moment clip N is replaced, that seam is joining two shots that were never
// continuous — and nothing about the footage says so. The reel just has a jump
// in the middle of what was sold as one unbroken move.
//
// Derived from created_at rather than tracked, because the ordering already
// carries the answer: a chained clip is always rendered AFTER the clip it
// continues from, so a chained clip older than its predecessor can only mean
// the predecessor was re-rendered underneath it. Clips are inserted one at a
// time here, so they never share the batch-insert timestamp that makes
// created_at unreliable elsewhere in this file (strict `<`, so a tie is never
// read as stale).
//
// The comparison is against the underlying TAKE, not the row: stamping text on
// clip 2 mints a fresh overlay row that becomes clip 2's current take, and
// comparing that row's timestamp would report clip 3's seam as broken when the
// footage beneath the lettering never changed.
function takeTimeOf(row, byId) {
  let cur = row
  for (let hops = 0; cur && cur.kind === 'overlay' && cur.parent_version_id && hops < 8; hops += 1) {
    const parent = byId.get(cur.parent_version_id)
    if (!parent) break
    cur = parent
  }
  return cur?.created_at || row?.created_at || ''
}

export function staleSeams(sb, clipRows, versions) {
  const out = new Set()
  const clips = sb?.clips || []
  const byId = new Map((versions || []).map(v => [v.id, v]))
  for (let i = 1; i < clips.length; i += 1) {
    if (!clips[i]?.continueFromPrevious) continue
    const here = takeTimeOf(clipRows?.[i], byId)
    const prev = takeTimeOf(clipRows?.[i - 1], byId)
    if (!here || !prev) continue
    if (new Date(here) < new Date(prev)) out.add(i)
  }
  return out
}

// The clips that continue, unbroken, from clip `index` — i.e. everything a
// re-render of that clip leaves stranded. Stops at the first new shot, since a
// hard cut was never continuous in the first place.
export function chainedAfter(sb, index) {
  const clips = sb?.clips || []
  const out = []
  for (let i = index + 1; i < clips.length; i += 1) {
    if (!clips[i]?.continueFromPrevious) break
    out.push(i)
  }
  return out
}

// ── Totals ─────────────────────────────────────────────────────────────────

// Crossfades shorten the reel: each one overlaps its two neighbours, so the
// finished runtime is the sum of the clips MINUS every fade. Same arithmetic
// the stitch workflow does on the real probed durations — this is the
// estimate shown before spending, from the requested durations.
export function storyboardTotals(sb) {
  const clips = sb?.clips || []
  let seconds = 0
  let cost = 0
  let overlap = 0
  clips.forEach((c, i) => {
    seconds += Number(c.duration) || 0
    cost += estimateVideoCost(sb.model, {
      resolution: c.resolution, duration: c.duration, audio: sb.audio,
    })
    if (i > 0 && c.transition === 'crossfade') overlap += Number(c.transitionDuration) || 0
  })
  return { seconds: Math.max(0, seconds - overlap), rawSeconds: seconds, cost, count: clips.length }
}

// ── The prompt a clip actually renders with ────────────────────────────────

// Assembled here rather than in the sequencer so the storyboard can show the
// marketer exactly what will be sent, and so the stored user_prompt is the
// text that genuinely produced the clip.
export function clipPromptFor(sb, index) {
  const c = sb?.clips?.[index]
  if (!c) return ''
  return buildVideoPrompt({
    scene: c.prompt,
    lookId: sb.lookId,
    styleBible: sb.styleBible,
    motion: c.motion,
    strength: c.motionStrength,
    duration: c.duration,
    continues: index > 0 && !!c.continueFromPrevious,
  })
}

// Whether a clip hands its last frame to the next one. Clip 0 never does, and
// a clip that isn't marked to continue starts fresh from the shared refs.
export function chainsFrom(sb, index) {
  return index > 0 && !!sb?.clips?.[index]?.continueFromPrevious
}

// ── What images a clip actually sends ──────────────────────────────────────
// One place, so the board can promise exactly what the sequencer will do.
// Three-way, and the third case is the one that used to fail silently:
//
//  · chained  — the previous clip's last frame is the start image, and
//    reference_image_urls must be EMPTY (Seedance's build() early-returns on
//    references and never reads image_url, so sending both drops the frame).
//  · references — Seedance only. Its reference-to-video endpoint takes up to 9.
//  · start — every other model has no reference endpoint at all, so extra
//    images would be dropped without an error. The first one is sent as the
//    clip's start frame instead, which every model does support.
export function clipImagePlan(sb, index) {
  if (chainsFrom(sb, index)) return { mode: 'chained', refs: [], startFrom: '' }
  const own = (sb?.clips?.[index]?.refs || []).map(r => r?.url).filter(Boolean)
  const shared = (sb?.sharedRefs || []).map(r => r?.url).filter(Boolean)
  const all = [...own, ...shared]
  if (modelImageRole(sb?.model) === 'references') {
    return { mode: 'references', refs: all.slice(0, 9), startFrom: '' }
  }
  // Own images win over the board's: "this shot features THAT lamp" is a more
  // specific instruction than the set applied to everything.
  return { mode: 'start', refs: [], startFrom: all[0] || '' }
}

// ── Reorder ────────────────────────────────────────────────────────────────
// clip_index is positional and is what rendered rows are keyed by, so moving a
// clip that has a take would silently relabel finished renders — clip 3's
// footage would start answering to "clip 2". Only unrendered clips move, and
// the swap partner has to be unrendered too.
export function canMoveClip(clipRows, from, to) {
  const clips = clipRows || []
  if (to < 0 || to >= clips.length) return false
  return !clips[from] && !clips[to]
}

export function moveClip(sb, from, to) {
  const clips = [...(sb?.clips || [])]
  if (to < 0 || to >= clips.length) return sb
  const [moved] = clips.splice(from, 1)
  clips.splice(to, 0, moved)
  // Whatever lands first can't continue from something before it.
  if (clips[0]) clips[0] = { ...clips[0], continueFromPrevious: false }
  return { ...sb, clips }
}
