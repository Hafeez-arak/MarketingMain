import { describe, it, expect } from 'vitest'
import { newImageLayer, cornerBox, layersFromSplit, layerLabel } from './document'

// Pixel aspect of a layer box on a W×H canvas — what the eye actually sees.
const pixelRatio = (box, W, H) => (box.w * W) / (box.h * H)

describe('newImageLayer', () => {
  it('keeps the image undistorted on a non-square canvas', () => {
    // 4:5 post, 2:1 logo — this used to come out 1.6:1.
    const l = newImageLayer('u', { naturalRatio: 2, canvasRatio: 1024 / 1280 })
    expect(pixelRatio(l, 1024, 1280)).toBeCloseTo(2, 6)
  })

  it('is unchanged on a square canvas', () => {
    const l = newImageLayer('u', { naturalRatio: 2 })
    expect(l.w).toBe(0.4)
    expect(l.h).toBeCloseTo(0.2, 6)
  })
})

describe('cornerBox', () => {
  const shapes = [[1080, 1080], [1024, 1280], [1080, 1920], [1920, 1080]]

  it.each(shapes)('keeps the logo undistorted and inside a %ix%i canvas', (W, H) => {
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      for (const nr of [3, 1, 0.5]) {
        const b = cornerBox(corner, { naturalRatio: nr, canvasRatio: W / H })
        expect(pixelRatio(b, W, H)).toBeCloseTo(nr, 6)
        expect(b.x).toBeGreaterThan(0)
        expect(b.y).toBeGreaterThan(0)
        expect(b.x + b.w).toBeLessThan(1)
        expect(b.y + b.h).toBeLessThan(1)
      }
    }
  })

  it.each(shapes)('leaves the same pixel margin on both axes of a %ix%i canvas', (W, H) => {
    const b = cornerBox('bottom-right', { naturalRatio: 2, canvasRatio: W / H })
    const rightGap = (1 - b.x - b.w) * W
    const bottomGap = (1 - b.y - b.h) * H
    expect(rightGap).toBeCloseTo(bottomGap, 6)
    expect(rightGap).toBeCloseTo(0.04 * Math.min(W, H), 6)
  })

  it('caps a tall logo by height instead of width', () => {
    const b = cornerBox('top-left', { naturalRatio: 0.5, canvasRatio: 1 })
    expect(b.h).toBeCloseTo(0.12, 6)
    expect(b.w).toBeLessThan(0.2)
  })
})

describe('layersFromSplit', () => {
  const split = {
    base: { url: 'bg.png', width: 1000, height: 1000 },
    layers: [{ url: 'lamp.png', name: 'Pendant lamp', width: 200, height: 400, box: [0.4, 0.2, 0.6, 0.6] }],
  }

  it('places elements where they were on an uncropped photo, background locked underneath', () => {
    const [bg, lamp] = layersFromSplit(split, null)
    expect(bg).toMatchObject({ url: 'bg.png', x: 0, y: 0, w: 1, h: 1, locked: true })
    expect(lamp).toMatchObject({ url: 'lamp.png', name: 'Pendant lamp', locked: false })
    expect(lamp.x).toBeCloseTo(0.4); expect(lamp.y).toBeCloseTo(0.2)
    expect(lamp.w).toBeCloseTo(0.2); expect(lamp.h).toBeCloseTo(0.4)
    expect(layerLabel(lamp)).toBe('Pendant lamp')
  })

  it('maps photo fractions into a cropped document', () => {
    // The document shows the right half of the photo.
    const [bg, lamp] = layersFromSplit(split, { x: 0.5, y: 0, w: 0.5, h: 1 })
    // The background still covers the whole photo, so it hangs off the left.
    expect(bg.x).toBeCloseTo(-1); expect(bg.w).toBeCloseTo(2)
    // 0.4 of the photo is 0.1 left of the crop's edge, i.e. -0.2 of the page.
    expect(lamp.x).toBeCloseTo(-0.2); expect(lamp.w).toBeCloseTo(0.4)
    expect(lamp.y).toBeCloseTo(0.2); expect(lamp.h).toBeCloseTo(0.4)
  })

  it('skips an element with no position rather than dropping it at the corner', () => {
    const out = layersFromSplit({ base: split.base, layers: [{ url: 'x.png', box: null }] }, null)
    expect(out).toHaveLength(1)
  })
})
