import { describe, it, expect } from 'vitest'
import { newImageLayer, cornerBox } from './document'

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
