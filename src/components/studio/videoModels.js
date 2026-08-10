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
//  · Seedance 2.5 drops the 1080p tier Seedance 2.0 has, and costs more per
//    second even at matching quality — a real regression, not an oversight,
//    kept here so the picker states it instead of hiding it.
//
// Cost verified against fal.ai's published rates, 2026-08-10:
//  · Seedance 2.0: $0.3024/s @720p, $0.682/s @1080p
//  · Seedance 2.5: $0.2205/s @480p, $0.4730/s @720p (no 1080p tier)
//  · Kling 2.5 Turbo Pro: $0.35 flat for 5s, +$0.07/s beyond (linear, $0.07/s)
//  · Veo 3.1 Fast: $0.10/s without audio, $0.15/s with — same rate @720p/1080p
//  · MiniMax Hailuo 2.3: $0.28 flat for 6s, $0.56 flat for 10s — NOT linear
//    per second, hence a duration lookup instead of a rate
export const VIDEO_MODELS = [
  {
    id: 'seedance-2',
    label: 'Seedance 2.0',
    hint: 'Default — reliable, up to 1080p',
    durations: ['4', '5', '6', '8', '10', '12', '15'],
    defaultDuration: '5',
    resolutions: [
      { value: '720p', label: 'Draft', hint: 'For checking the movement' },
      { value: '1080p', label: 'Final', hint: 'For the post itself' },
    ],
    defaultResolution: '720p',
    audio: 'free',
    cost: ({ resolution, duration }) => (resolution === '1080p' ? 0.682 : 0.3024) * (Number(duration) || 5),
  },
  {
    id: 'seedance-2.5',
    label: 'Seedance 2.5',
    hint: 'Newer, clips up to 30s — no 1080p yet, pricier per second',
    durations: ['4', '5', '6', '8', '10', '12', '15', '20', '25', '30'],
    defaultDuration: '5',
    resolutions: [
      { value: '480p', label: 'Draft', hint: 'For checking the movement' },
      { value: '720p', label: 'Final', hint: 'For the post itself' },
    ],
    defaultResolution: '480p',
    audio: 'free',
    cost: ({ resolution, duration }) => (resolution === '720p' ? 0.4730 : 0.2205) * (Number(duration) || 5),
  },
  {
    id: 'kling-2.5-turbo-pro',
    label: 'Kling 2.5 Turbo Pro',
    hint: 'Strongest camera control and physics — 5 or 10s, one quality tier',
    durations: ['5', '10'],
    defaultDuration: '5',
    resolutions: null,
    defaultResolution: '',
    audio: 'unsupported',
    cost: ({ duration }) => 0.35 + Math.max(0, (Number(duration) || 5) - 5) * 0.07,
  },
  {
    id: 'veo-3.1-fast',
    label: 'Veo 3.1 (Google)',
    hint: 'Best dialogue and native audio — 4, 6 or 8s',
    durations: ['4', '6', '8'],
    defaultDuration: '8',
    resolutions: [
      { value: '720p', label: 'Draft', hint: 'For checking the movement' },
      { value: '1080p', label: 'Final', hint: 'For the post itself' },
    ],
    defaultResolution: '720p',
    audio: 'paid',
    cost: ({ duration, audio }) => (audio ? 0.15 : 0.10) * (Number(duration) || 8),
  },
  {
    id: 'hailuo-2.3',
    label: 'MiniMax Hailuo 2.3',
    hint: 'Cheapest, expressive on unusual motion — 6 or 10s, 768p only',
    durations: ['6', '10'],
    defaultDuration: '6',
    resolutions: null,
    defaultResolution: '',
    audio: 'unsupported',
    cost: ({ duration }) => (String(duration) === '10' ? 0.56 : 0.28),
  },
]

export function getVideoModel(id) {
  return VIDEO_MODELS.find(m => m.id === id) || VIDEO_MODELS[0]
}

export function estimateVideoCost(modelId, { resolution, duration, audio } = {}) {
  return getVideoModel(modelId).cost({ resolution, duration, audio })
}
