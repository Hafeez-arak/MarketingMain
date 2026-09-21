import { describe, it, expect } from 'vitest'
import {
  parseRatio, aspectOf, nearestRatio, coverScale, containScale, centreOffset,
  clampOffset, outputSize, drawRect,
} from './cropGeometry'

describe('ratio parsing', () => {
  it('reads the catalog labels', () => {
    expect(parseRatio('1:1')).toBe(1)
    expect(parseRatio('4:5')).toBeCloseTo(0.8)
    expect(parseRatio('1.91:1')).toBeCloseTo(1.91)
    expect(parseRatio('9:16')).toBeCloseTo(0.5625)
  })
  it('refuses nonsense rather than returning a plausible number', () => {
    expect(parseRatio('')).toBeNull()
    expect(parseRatio('4/5')).toBeNull()
    expect(parseRatio('0:5')).toBeNull()
  })
  it('treats a missing dimension as unknown, not zero', () => {
    expect(aspectOf(1080, null)).toBeNull()
    expect(aspectOf(undefined, 500)).toBeNull()
    expect(aspectOf(1080, 1080)).toBe(1)
  })
})

describe('nearestRatio', () => {
  it('defaults to the shape closest to what the image already is', () => {
    expect(nearestRatio(2.54, ['4:5', '1:1', '1.91:1'])).toBe('1.91:1')
    expect(nearestRatio(0.81, ['4:5', '1:1'])).toBe('4:5')
    expect(nearestRatio(1.02, ['4:5', '1:1'])).toBe('1:1')
  })
  it('takes the first shape for an unmeasured image', () => {
    expect(nearestRatio(null, ['4:5', '1:1'])).toBe('4:5')
  })
})

describe('pan and zoom', () => {
  // A wide banner (2.54:1), dropped into a 4:5 frame 400px wide.
  const frame = { frameW: 400, frameH: 500 }
  const img = { imgW: 1239, imgH: 488 }

  it('covers the frame at the cover scale and no less', () => {
    const s = coverScale({ ...img, ...frame })
    expect(img.imgW * s).toBeGreaterThanOrEqual(frame.frameW - 0.001)
    expect(img.imgH * s).toBeGreaterThanOrEqual(frame.frameH - 0.001)
    // The short side is what binds here: 500/488, not 400/1239.
    expect(s).toBeCloseTo(500 / 488)
  })

  it('fits the whole image inside at the contain scale', () => {
    const s = containScale({ ...img, ...frame })
    expect(img.imgW * s).toBeLessThanOrEqual(frame.frameW + 0.001)
    expect(img.imgH * s).toBeLessThanOrEqual(frame.frameH + 0.001)
  })

  it('centres a freshly opened image', () => {
    const scale = containScale({ ...img, ...frame })
    const o = centreOffset({ ...img, ...frame, scale })
    expect(o.offsetX).toBeCloseTo((400 - 1239 * scale) / 2)
    expect(o.offsetY).toBeCloseTo((500 - 488 * scale) / 2)
  })

  it('never lets a covering image pull away and leave a hole', () => {
    const scale = coverScale({ ...img, ...frame })
    const dragged = clampOffset({ ...img, ...frame, scale, offsetX: 900, offsetY: 400 })
    expect(dragged.offsetX).toBe(0)              // left edge flush, not past it
    expect(dragged.offsetY).toBeCloseTo(0)
    const other = clampOffset({ ...img, ...frame, scale, offsetX: -99999, offsetY: -99999 })
    expect(other.offsetX).toBeCloseTo(400 - 1239 * scale)   // right edge flush
  })

  it('keeps a padded image inside the frame instead', () => {
    const scale = containScale({ ...img, ...frame }) * 0.5
    const dragged = clampOffset({ ...img, ...frame, scale, offsetX: -500, offsetY: -500 })
    expect(dragged.offsetX).toBe(0)
    expect(dragged.offsetY).toBe(0)
    const far = clampOffset({ ...img, ...frame, scale, offsetX: 9999, offsetY: 9999 })
    expect(far.offsetX).toBeCloseTo(400 - 1239 * scale)
    expect(far.offsetY).toBeCloseTo(500 - 488 * scale)
  })
})

describe('outputSize', () => {
  it('renders the feed shapes at Instagram width', () => {
    expect(outputSize(parseRatio('4:5'))).toEqual({ width: 1080, height: 1350 })
    expect(outputSize(parseRatio('1:1'))).toEqual({ width: 1080, height: 1080 })
  })
  it('caps the long edge so the canvas can always be allocated', () => {
    const tall = outputSize(0.2)
    expect(Math.max(tall.width, tall.height)).toBeLessThanOrEqual(1920)
  })
})

describe('drawRect', () => {
  it('restates the on-screen transform at output resolution', () => {
    const r = drawRect({ imgW: 1239, imgH: 488, frameW: 400, scale: 1, offsetX: -20, offsetY: -10, outWidth: 1080 })
    const k = 1080 / 400
    expect(r.x).toBeCloseTo(-20 * k)
    expect(r.y).toBeCloseTo(-10 * k)
    expect(r.width).toBeCloseTo(1239 * k)
  })
  it('a covering preview still covers the canvas', () => {
    const frameW = 400; const frameH = 500; const imgW = 1239; const imgH = 488
    const scale = coverScale({ imgW, imgH, frameW, frameH })
    const { offsetX, offsetY } = clampOffset({
      imgW, imgH, frameW, frameH, scale, ...centreOffset({ imgW, imgH, frameW, frameH, scale }),
    })
    const out = outputSize(frameW / frameH)
    const r = drawRect({ imgW, imgH, frameW, scale, offsetX, offsetY, outWidth: out.width })
    expect(r.x).toBeLessThanOrEqual(0.001)
    expect(r.y).toBeLessThanOrEqual(0.001)
    expect(r.x + r.width).toBeGreaterThanOrEqual(out.width - 0.001)
    expect(r.y + r.height).toBeGreaterThanOrEqual(out.height - 0.001)
  })
})
