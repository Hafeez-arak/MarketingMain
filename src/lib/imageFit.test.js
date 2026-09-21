import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabaseClient', () => ({ supabase: {}, SUPABASE_URL: 'https://x.test' }))
import { fitTarget, publishedRatio } from './imageFit'

describe('fitTarget', () => {
  it('leaves an accepted shape alone', () => {
    expect(fitTarget(1080, 1350)).toBeNull()
    expect(fitTarget(1080, 1080)).toBeNull()
    expect(fitTarget(1910, 1000)).toBeNull()
  })
  it('pads the 8416x2945 logo from the failed post onto a square', () => {
    const t = fitTarget(8416, 2945)
    expect(t.canvasWidth).toBe(t.canvasHeight)
    expect(Math.max(t.canvasWidth, t.canvasHeight)).toBeLessThanOrEqual(1440)
  })
  it('pads a too-tall picture onto 4:5', () => {
    const t = fitTarget(500, 1200)
    expect(t.canvasWidth / t.canvasHeight).toBeCloseTo(0.8, 2)
  })
})

describe('publishedRatio (what the previews draw)', () => {
  it('shows the wide logo as a padded square, not a 4:5 crop', () => {
    expect(publishedRatio(8416, 2945)).toEqual({ ratio: 1, padded: true })
  })
  it('keeps an accepted picture at its own ratio, held to the feed range', () => {
    expect(publishedRatio(1600, 1200).padded).toBe(false)
    expect(publishedRatio(1600, 1200).ratio).toBeCloseTo(1.333, 2)
    expect(publishedRatio(1080, 1920).ratio).toBe(0.8)
  })
})
