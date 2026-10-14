import { describe, it, expect } from 'vitest'
import {
  VIDEO_MODELS, getVideoModel, estimateVideoCost, modelImageRole, modelImageMax,
  MODEL_ALIASES, resolveVideoModelId, isVideoEditModel, VIDEO_EDIT_MODEL_ID,
  canEditVideoDuration, canUpscale, upscaleSourceTier, estimateUpscaleCost, UPSCALE_MODEL_ID,
} from './videoModels'

// ─── The picker's catalog ──────────────────────────────────────────────────
// Every value in here is sent verbatim to a fal endpoint that rejects anything
// outside its own enum. A default that isn't in its own list is therefore not
// a cosmetic slip — it is a render that fails, or worse, one that succeeds at
// a tier nobody chose. These are the invariants the file has to hold for all
// eight models at once, which is exactly the kind of thing that rots when a
// ninth is added by hand.

describe('video model catalog', () => {
  it.each(VIDEO_MODELS.map(m => [m.id, m]))('%s is internally consistent', (id, m) => {
    expect(m.label).toBeTruthy()
    expect(m.hint).toBeTruthy()
    expect(m.durations.length).toBeGreaterThan(0)

    // The default has to be selectable, or the picker opens showing a value
    // its own dropdown cannot produce.
    expect(m.durations).toContain(m.defaultDuration)

    if (m.resolutions) {
      expect(m.resolutions.map(r => r.value)).toContain(m.defaultResolution)
      for (const r of m.resolutions) {
        expect(r.label, `${id} ${r.value}`).toBeTruthy()
        expect(r.hint, `${id} ${r.value}`).toBeTruthy()
      }
    } else {
      // Kling and Hailuo: no resolution parameter exists on their endpoints,
      // so the dial is hidden and the value must be empty rather than a
      // plausible-looking tier that would be sent and ignored.
      expect(m.defaultResolution).toBe('')
    }

    expect(['free', 'paid', 'unsupported', 'always']).toContain(m.audio)
  })

  it('prices every quality button it offers', () => {
    // The whole design of this screen is that the money is on the button
    // before it is pressed. A tier with no rate would quietly read $0.00.
    for (const m of VIDEO_MODELS) {
      const tiers = m.resolutions ? m.resolutions.map(r => r.value) : ['']
      for (const resolution of tiers) {
        for (const duration of m.durations) {
          const cost = estimateVideoCost(m.id, { resolution, duration, audio: false })
          expect(Number.isFinite(cost), `${m.id} ${resolution} ${duration}s`).toBe(true)
          expect(cost, `${m.id} ${resolution} ${duration}s`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('charges more for a better tier, never less', () => {
    // Resolutions are listed cheapest-first and labelled Draft → Master on
    // that assumption. If a rate is ever mistyped, the Draft button stops
    // being the cheap one and the cost guard silently inverts.
    for (const m of VIDEO_MODELS) {
      if (!m.resolutions) continue
      const costs = m.resolutions.map(r =>
        estimateVideoCost(m.id, { resolution: r.value, duration: m.defaultDuration, audio: false }))
      const sorted = [...costs].sort((a, b) => a - b)
      expect(costs, `${m.id} tiers out of order: ${costs.join(', ')}`).toEqual(sorted)
    }
  })

  it('defaults every model to its cheapest tier', () => {
    // Re-rendering until it looks right is how this tool actually gets used,
    // so the default click must never be the expensive one. Seedance 2.5 at
    // 1080p for 20s is $23.28 against $4.41 at 480p — that gap is the whole
    // reason this rule is asserted rather than trusted.
    for (const m of VIDEO_MODELS) {
      if (!m.resolutions) continue
      expect(m.defaultResolution, m.id).toBe(m.resolutions[0].value)
    }
  })

  it('falls back to a real model for a version made before the picker existed', () => {
    // Old rows store a model id this file may no longer list. Re-rendering one
    // must land on something real rather than crashing the history strip.
    expect(getVideoModel('a-model-that-never-existed').id).toBe(VIDEO_MODELS[0].id)
    expect(getVideoModel(undefined).id).toBe(VIDEO_MODELS[0].id)
  })

  it('opens a retired model id on the model that replaced it', () => {
    // Saved rows and storyboards keep the id they were made with. Without the
    // alias, getVideoModel fell back to VIDEO_MODELS[0] — a re-render that
    // silently changed model and price.
    expect(getVideoModel('kling-2.5-turbo-pro').id).toBe('kling-3-pro')
    expect(getVideoModel('veo-3.1-fast').id).toBe('veo-3.1-lite')
    expect(resolveVideoModelId('seedance-2.5')).toBe('seedance-2.5')
    for (const [from, to] of Object.entries(MODEL_ALIASES)) {
      expect(VIDEO_MODELS.some(m => m.id === from), `${from} is retired`).toBe(false)
      expect(VIDEO_MODELS.some(m => m.id === to), `${to} is offered`).toBe(true)
    }
  })

  it('reads edit rows made before and after the move to O3 as edits', () => {
    expect(isVideoEditModel(VIDEO_EDIT_MODEL_ID)).toBe(true)
    expect(isVideoEditModel('kling-o1-edit')).toBe(true)
    expect(isVideoEditModel('seedance-2.5')).toBe(false)
    // O3 takes 3–15s sources, where O1 stopped at 10.
    expect(canEditVideoDuration('15')).toBe(true)
    expect(canEditVideoDuration('20')).toBe(false)
  })

  it('caps references at a count every reference endpoint accepts', () => {
    for (const m of VIDEO_MODELS) {
      const max = modelImageMax(m.id)
      if (modelImageRole(m.id) === 'references') {
        // 9 is the floor across the four reference endpoints (H3 Max's limit).
        expect(max, m.id).toBe(9)
      } else {
        // Everything else gets a single start frame, not a gallery.
        expect(max, m.id).toBe(1)
      }
    }
  })
})

// ─── When "Make 1080p" is offered ──────────────────────────────────────────
// upscaleSourceTier is the one gate for the button, the handler and Retry.
// Offering it on a clip that is already 1080p is paying to get the same
// clip back; offering it on a composite enlarges the text as pixels.
describe('Make 1080p', () => {
  const clip = (over = {}) => ({
    status: 'ready', kind: 'video', model: 'seedance-2.5', resolution: '480p',
    video_url: 'https://cdn.test/clip.mp4', duration: '20', ...over,
  })

  it('offers a ready clip below 1080p, and says which tier it is', () => {
    expect(upscaleSourceTier(clip())).toBe('480p')
    expect(upscaleSourceTier(clip({ resolution: '720p' }))).toBe('720p')
    // Hailuo stores no resolution but is 768p by definition.
    expect(upscaleSourceTier(clip({ model: 'hailuo-2.3', resolution: '' }))).toBe('768p')
  })

  it('refuses 1080p and up, unknown sizes, composites, pending rows and its own output', () => {
    expect(canUpscale(clip({ resolution: '1080p' }))).toBe(false)
    expect(canUpscale(clip({ resolution: '4k' }))).toBe(false)
    expect(canUpscale(clip({ model: 'kling-3-pro', resolution: '' }))).toBe(false)
    expect(canUpscale(clip({ kind: 'overlay' }))).toBe(false)
    expect(canUpscale(clip({ status: 'pending' }))).toBe(false)
    expect(canUpscale(clip({ model: UPSCALE_MODEL_ID, resolution: '480p' }))).toBe(false)
  })

  it('prices per started 10 seconds, as fal bills it', () => {
    expect(estimateUpscaleCost('20')).toBeCloseTo(0.40, 2)
    expect(estimateUpscaleCost('5')).toBeCloseTo(0.20, 2)
    expect(estimateUpscaleCost('12')).toBeCloseTo(0.40, 2)
  })
})
