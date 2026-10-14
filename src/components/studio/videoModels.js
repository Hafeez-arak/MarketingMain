// ─── Video models ──────────────────────────────────────────────────────────
// Seedance 2.0 used to be the only option. This is the catalog behind the
// model picker in both video surfaces (the Animate modal and the "A video"
// tab) — durations, quality tiers and audio support are read from here
// rather than assumed, because they're real constraints of each model's own
// fal.ai endpoint, not a UI convenience:
//  · Kling and Hailuo don't take a resolution parameter at all (one implicit
//    quality tier) and only accept two fixed duration values.
//  · Veo 3.1 bills audio separately; the others don't do audio at all, or do
//    it for free.
//  · Seedance 2.5 HAS a 1080p tier now. It did not when this list was written
//    (2026-08-10), which is why the picker used to call that a regression and
//    default the model to 480p. Re-checked against fal's live schema
//    2026-09-15: 480p/720p/1080p, and durations every second from 4 to 30.
//  · Seedance 2.5 also takes real aspect ratios again. Its enum was 'auto' and
//    nothing else, so the workflow sent no ratio at all and the picker warned
//    that text-to-video offered no shape control. Both are fixed.
//
// Seedance 2.5 is the DEFAULT (2026-08-11): the marketing team asked for
// finished videos of 15–30s, and it is the only model here whose endpoint
// reaches past 15s at all.
//
// Its 1080p tier is NOT the default, and that is the one place cost outranks
// quality on this screen: 1080p is $1.164/s, so the 20s default length would
// be $23.28 a click — against $4.41 at 480p. Re-rendering until it looks right
// is the normal way this tool gets used, and it must not quietly do that at
// twenty-odd dollars a take. The Arabic text layer is composited by us
// afterwards at whatever resolution the clip came back at, so a draft take
// loses nothing but sharpness.
//
// Cost verified against fal.ai's published rates, 2026-09-15:
//  · Seedance 2.0: $0.3034/s @720p, $0.682/s @1080p
//  · Seedance 2.5: $0.2205/s @480p, $0.4730/s @720p, $1.164/s @1080p
//  · Kling 3 Pro: $0.112/s without audio, $0.168/s with (replaced Kling 2.5
//    Turbo Pro, $0.35 flat for 5s + $0.07/s, on 2026-10-13)
//  · Veo 3.1 Lite: $0.03/s @720p / $0.05/s @1080p without audio, $0.05/s /
//    $0.08/s with (replaced Veo 3.1 Fast, $0.10/$0.15 a second, 2026-10-13)
//  · MiniMax Hailuo 2.3: $0.28 flat for 6s, $0.56 flat for 10s — NOT linear
//    per second, hence a duration lookup instead of a rate
//  · Wan 3.0 Prime: $0.068/s @480p, $0.14/s @720p, $0.28/s @1080p
//  · MiniMax H3 Max: $0.05/s @480P, $0.08/s @768P, $0.16/s @1080P. These are
//    the POST-promotional rates. fal ran a 75%-off launch discount that ended
//    2026-09-14, so the cheaper numbers still on its model page are stale as
//    of today and would under-quote every button by a factor of four.
//  · Gemini Omni Flash 1.1: $0.03/s @360p, $0.10/s @720p, $0.15/s @1080p,
//    $0.30/s @4K
//
// Seedance 2.0 quietly gained 480p and 4K tiers too. They are deliberately NOT
// offered: fal publishes those two as token rates rather than a per-second
// price, and every quality button on this screen states what it costs before
// it is pressed. A tier we cannot price honestly does not belong in a picker
// whose whole design is the price being on the button.
export const VIDEO_MODELS = [
  {
    id: 'seedance-2',
    label: 'Seedance 2.0',
    hint: 'Reliable and sharp, but stops at 15s',
    durations: ['4', '5', '6', '8', '10', '12', '15'],
    defaultDuration: '5',
    resolutions: [
      { value: '720p', label: 'Draft', hint: 'For checking the movement' },
      { value: '1080p', label: 'Final', hint: 'For the post itself' },
    ],
    defaultResolution: '720p',
    audio: 'free',
    cost: ({ resolution, duration }) => (resolution === '1080p' ? 0.682 : 0.3034) * (Number(duration) || 5),
  },
  {
    id: 'seedance-2.5',
    label: 'Seedance 2.5',
    hint: 'Default — the only model that reaches 15–30s, now up to 1080p',
    durations: ['4', '5', '6', '8', '10', '12', '15', '20', '25', '30'],
    // 20s: the middle of the 15–30s the team asked for. Draft tier by
    // default like every other model here — at 20s the Sharp tier is $23.28 a
    // click, which is exactly the "re-rendering until it's right quietly runs
    // at the expensive setting" habit the price-per-button exists to prevent.
    defaultDuration: '20',
    resolutions: [
      { value: '480p', label: 'Draft', hint: 'For checking the movement' },
      { value: '720p', label: 'Final', hint: 'For the post itself' },
      { value: '1080p', label: 'Sharp', hint: 'Crisp on a big screen — priciest here' },
    ],
    defaultResolution: '480p',
    audio: 'free',
    cost: ({ resolution, duration }) => (
      resolution === '1080p' ? 1.164 : resolution === '720p' ? 0.4730 : 0.2205
    ) * (Number(duration) || 5),
  },
  // ── Moved up 2026-10-13 ──────────────────────────────────────────────────
  // Kling 2.5 Turbo Pro → Kling 3 Pro, and Veo 3.1 Fast → Veo 3.1 Lite. Both
  // old ids are still accepted (see MODEL_ALIASES below), because every row
  // and storyboard ever saved stores the id it was rendered with.
  {
    id: 'kling-3-pro',
    label: 'Kling 3 Pro',
    // fal's v3 endpoint takes every whole second from 3 to 15. Not all
    // thirteen are listed: the picker is a dropdown, and these cover every
    // length the team actually asks for.
    hint: 'Strongest camera control and physics — up to 15s, start and end frame',
    durations: ['3', '5', '6', '8', '10', '12', '15'],
    defaultDuration: '5',
    resolutions: null,
    defaultResolution: '',
    // Billed: sound moves the rate from $0.112 to $0.168 a second. The
    // endpoint DEFAULTS IT ON, which is why the workflow always sends it.
    audio: 'paid',
    cost: ({ duration, audio }) => (audio ? 0.168 : 0.112) * (Number(duration) || 5),
  },
  {
    id: 'veo-3.1-lite',
    label: 'Veo 3.1 Lite (Google)',
    hint: 'Cheapest 1080p with real sound — 4, 6 or 8s',
    durations: ['4', '6', '8'],
    defaultDuration: '8',
    resolutions: [
      { value: '720p', label: 'Draft', hint: 'For checking the movement' },
      { value: '1080p', label: 'Final', hint: 'For the post itself' },
    ],
    defaultResolution: '720p',
    audio: 'paid',
    cost: ({ resolution, duration, audio }) => (
      resolution === '1080p' ? (audio ? 0.08 : 0.05) : (audio ? 0.05 : 0.03)
    ) * (Number(duration) || 8),
  },
  {
    id: 'hailuo-2.3',
    label: 'MiniMax Hailuo 2.3',
    hint: 'Expressive on unusual motion — 6 or 10s, 768p only',
    durations: ['6', '10'],
    defaultDuration: '6',
    resolutions: null,
    defaultResolution: '',
    audio: 'unsupported',
    cost: ({ duration }) => (String(duration) === '10' ? 0.56 : 0.28),
  },
  // ── Added 2026-09-15 ─────────────────────────────────────────────────────
  // All three reach 1080p for a fraction of Seedance 2.5's $1.164/s, which is
  // the point of adding them: 1080p stops being the tier nobody dares press.
  {
    id: 'wan-3.0-prime',
    label: 'Wan 3.0 Prime',
    hint: 'Best value at 1080p — every shape we post in, free sound',
    // fal states no maximum for this one (duration is free-form, and null asks
    // the model to choose its own length from the prompt). Offered up to 10s
    // rather than guessing higher: an unstated ceiling is a failed render at
    // full price, and Seedance 2.5 already covers the 15–30s case.
    durations: ['4', '5', '6', '8', '10'],
    defaultDuration: '5',
    resolutions: [
      { value: '480p', label: 'Draft', hint: 'For checking the movement' },
      { value: '720p', label: 'Final', hint: 'For the post itself' },
      { value: '1080p', label: 'Sharp', hint: 'Crisp on a big screen' },
    ],
    defaultResolution: '480p',
    audio: 'free',
    cost: ({ resolution, duration }) => (
      resolution === '1080p' ? 0.28 : resolution === '720p' ? 0.14 : 0.068
    ) * (Number(duration) || 5),
  },
  {
    id: 'h3-max',
    label: 'MiniMax H3 Max',
    hint: 'Cheapest way to 1080p — up to 15s, every shape, no sound',
    durations: ['5', '6', '8', '10', '12', '15'],
    defaultDuration: '6',
    // Lowercase here on purpose even though the endpoint spells them '480P',
    // '768P', '1080P'. The workflow uppercases on the way out, so every model
    // in this file stays comparable and the cost lookups below all key the
    // same way. Sending the wrong case is rejected outright, not coerced.
    resolutions: [
      { value: '480p', label: 'Draft', hint: 'For checking the movement' },
      { value: '768p', label: 'Final', hint: 'For the post itself' },
      { value: '1080p', label: 'Sharp', hint: 'Upscaled from a 768p original' },
    ],
    defaultResolution: '480p',
    audio: 'unsupported',
    cost: ({ resolution, duration }) => (
      resolution === '1080p' ? 0.16 : resolution === '768p' ? 0.08 : 0.05
    ) * (Number(duration) || 5),
  },
  {
    id: 'gemini-omni-flash-1.1',
    label: 'Gemini Omni Flash 1.1',
    hint: 'Only 4K here, and always has sound — but 16:9 or 9:16 only',
    durations: ['4', '6', '8', '10'],
    defaultDuration: '8',
    resolutions: [
      { value: '360p', label: 'Draft', hint: 'For checking the movement' },
      { value: '720p', label: 'Final', hint: 'For the post itself' },
      { value: '1080p', label: 'Sharp', hint: 'Crisp on a big screen' },
      { value: '4k', label: 'Master', hint: 'Far past what a feed shows' },
    ],
    defaultResolution: '360p',
    // Not 'free' and not 'unsupported': this endpoint has no audio parameter
    // at all and generates sound regardless, so a toggle here would be a
    // control that does nothing. See AudioToggle.
    audio: 'always',
    cost: ({ resolution, duration }) => (
      resolution === '4k' ? 0.30 : resolution === '1080p' ? 0.15 : resolution === '720p' ? 0.10 : 0.03
    ) * (Number(duration) || 8),
  },
]

// Ids that were retired in favour of a newer model. The id a clip was made
// with is saved on its row (creative_versions.model) and in every storyboard,
// and both are read back by Re-render and by the cost on its button. Without
// this, an old Kling row fell through to VIDEO_MODELS[0] here and to Seedance
// 2.0 in the workflow — a re-render that silently changed model, with no
// error. Kept in step with MODEL_ALIASES in the Creative Video workflow.
export const MODEL_ALIASES = {
  'kling-2.5-turbo-pro': 'kling-3-pro',
  'veo-3.1-fast': 'veo-3.1-lite',
}

export function resolveVideoModelId(id) {
  return MODEL_ALIASES[id] || id
}

export function getVideoModel(id) {
  const want = resolveVideoModelId(id)
  return VIDEO_MODELS.find(m => m.id === want) || VIDEO_MODELS[0]
}

// ─── What a model does with extra images ───────────────────────────────────
// Not every model has a reference-to-video endpoint. The workflow picks one
// with `useRefs = referenceUrls.length && !!cfg.r2v`, so references handed to
// a model without one fall through to text-to-video and are **discarded
// without an error** — the render succeeds, costs full price, and simply
// ignored the pictures. That was invisible in the UI until 2026-08-12, and it
// is why this set has to stay in step with MODEL_CONFIGS in the generator
// rather than being guessed at from the model's reputation.
//
// Seedance was the only one when this was written. The three models added
// 2026-09-15 all have reference endpoints too (verified against fal's
// schemas), so Kling, Veo and Hailuo are now the only exceptions.
//
// Every model does accept a single start image. So one picker serves both,
// and this is what says which meaning applies:
//
//   'references' — up to 9, sent to the model's reference-to-video endpoint
//   'start'      — the first image only, as a start frame (everything else)
//
// 9 is the common floor across the reference endpoints, not one model's limit:
// Seedance takes 30, Wan and Gemini Omni 10, H3 Max 9. One number that is
// valid everywhere beats a per-model cap that has to be right four times.
const MODELS_WITH_REFERENCES = new Set([
  'seedance-2', 'seedance-2.5', 'wan-3.0-prime', 'h3-max', 'gemini-omni-flash-1.1',
])

export function modelImageRole(modelId) {
  return MODELS_WITH_REFERENCES.has(resolveVideoModelId(modelId)) ? 'references' : 'start'
}

export function modelImageMax(modelId) {
  return modelImageRole(modelId) === 'references' ? 9 : 1
}

export function estimateVideoCost(modelId, { resolution, duration, audio } = {}) {
  return getVideoModel(modelId).cost({ resolution, duration, audio })
}

// ─── In-context video editing ──────────────────────────────────────────────
// Kling O3 Pro Edit (fal-ai/kling-video/o3/pro/video-to-video/edit) — the
// model behind
// "ask for a change" in a video lane's chat box. Distinct from every model
// above: those generate a NEW clip from a prompt (and optionally a still);
// this one takes an EXISTING clip and applies a natural-language change to it
// while preserving the source's own camera movement and motion, which is what
// makes "change the background to marble" a genuine edit rather than a
// from-scratch re-roll. Verified against fal's schema, 2026-08-11.
//
// Moved from Kling O1 Edit to O3 Pro Edit on 2026-10-13: the same $0.168 a
// second, but the source clip may now run to 15s rather than 10s, which is
// what brings Seedance 2.5's 12s and 15s takes into reach of an edit.
export const VIDEO_EDIT_RATE = 0.168 // $/second of the SOURCE clip's duration
// fal's own hard limit on the input video — not a choice made here. Outside
// this range the endpoint rejects the request outright, so the UI checks
// before offering the action rather than letting the click fail.
export const VIDEO_EDIT_DURATION_RANGE = [3, 15]
// What an edit row stores in creative_versions.model. Rows made before the
// move say 'kling-o1-edit', and both have to read as "an edit of a clip"
// rather than as a model the picker could re-render with.
export const VIDEO_EDIT_MODEL_ID = 'kling-o3-edit'
const VIDEO_EDIT_MODEL_IDS = new Set([VIDEO_EDIT_MODEL_ID, 'kling-o1-edit'])
export function isVideoEditModel(id) {
  return VIDEO_EDIT_MODEL_IDS.has(id)
}
export const VIDEO_EDIT_MAX_REFERENCES = 4 // fal's cap: elements + reference images combined

export function estimateVideoEditCost(duration) {
  return VIDEO_EDIT_RATE * (Number(duration) || 5)
}

export function canEditVideoDuration(duration) {
  const d = Number(duration)
  return d >= VIDEO_EDIT_DURATION_RANGE[0] && d <= VIDEO_EDIT_DURATION_RANGE[1]
}

// ─── Make 1080p (upscale) ──────────────────────────────────────────────────
// Added 2026-10-13. The studio's cheap way to a sharp clip: Topaz on fal
// enlarges the clip that already exists, so the take — its movement, timing,
// everything — is exactly the one that was approved, just at 1080p. That is
// the point of the button and why it is not a re-render: Draft stays the
// cheap way to check the movement, and 1080p costs cents rather than a second
// render. (A native 1080p render of the same take, Seedance 2.5's draft
// completion at $1.164/s, was built first and dropped on the owner's call —
// $23 for a 20s clip against ~$0.40 here.)
//
// An upscaled clip is a new row whose model is UPSCALE_MODEL_ID — the same
// way an edit is marked — and whose parent is the clip it enlarged. Retry,
// Re-render and the storyboard's seam check all read that marker.
export const UPSCALE_MODEL_ID = 'topaz-upscale'
// fal: $0.20 per started 10 seconds of 1080p output (precision models).
export const UPSCALE_PER_10S = 0.20

// The short side of each tier below 1080p that a clip here can come back at.
// Kling and Hailuo store no resolution: Hailuo is 768p by definition, Kling 3
// is not offered (its single tier is not stated, and paying to enlarge a clip
// that may already be 1080p is the one mistake this must not make).
const BELOW_1080 = { '360p': 1, '480p': 1, '720p': 1, '768p': 1 }

export function isUpscaleModel(id) {
  return id === UPSCALE_MODEL_ID
}

// The tier to send the upscaler, or '' when the clip can't or needn't go.
export function upscaleSourceTier(version) {
  if (!version || version.status !== 'ready' || version.kind !== 'video' || !version.video_url) return ''
  if (isUpscaleModel(version.model)) return ''
  const tier = String(version.resolution || '').toLowerCase()
    || (resolveVideoModelId(version.model) === 'hailuo-2.3' ? '768p' : '')
  return BELOW_1080[tier] ? tier : ''
}

export function canUpscale(version) {
  return !!upscaleSourceTier(version)
}

export function estimateUpscaleCost(duration) {
  return UPSCALE_PER_10S * Math.max(1, Math.ceil((Number(duration) || 5) / 10))
}
