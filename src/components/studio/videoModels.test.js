import { describe, it, expect } from 'vitest'
import {
  VIDEO_MODELS, getVideoModel, estimateVideoCost, modelImageRole, modelImageMax,
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
