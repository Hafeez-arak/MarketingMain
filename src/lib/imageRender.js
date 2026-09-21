// ─── Drawing a fitted picture ──────────────────────────────────────────────
//
// The canvas half of the image fitter. Separate from cropGeometry.js because
// that is pure arithmetic with a test beside it, and separate from
// ImageFitter.jsx because the fitter is not the only caller: ticking "put
// every other slide in this shape too" re-renders slides nobody opened, with
// no frame on screen and no pointer events, and that path must produce
// byte-identical results to the interactive one or a carousel would come out
// subtly inconsistent.
//
// One render function, therefore, and the interactive frame is just a caller
// that happens to have a human choosing the numbers.
//
// Not lib/imageFit.js — that module pads a picture Instagram would otherwise
// refuse, automatically, with no person involved. This is the opposite case:
// somebody chose to reframe a picture by hand, to a shape of their choosing,
// on any platform. The two never need to agree with each other.

import {
  coverScale, containScale, centreOffset, clampOffset, outputSize, drawRect,
  parseRatio,
} from './cropGeometry'

/** Decode a URL into an image the canvas may read back out of. */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Before src, always. A decoded image cannot be retro-fitted with CORS:
    // without this the canvas is tainted and toBlob throws a SecurityError at
    // the very last step, after all the work has been done.
    img.crossOrigin = 'anonymous'
    img.onload  = () => resolve(img)
    img.onerror = () => reject(new Error('That image could not be loaded for editing.'))
    img.src = url
  })
}

/**
 * Render one placement to a JPEG blob.
 *
 * `frameW` is the width of the frame the placement was decided in — the
 * on-screen one when a person dragged it, a notional one when nobody did.
 * Scale and offset mean the same thing in both, which is what keeps the saved
 * file and the preview the same picture. The frame's HEIGHT is not taken:
 * it is frameW ÷ ratio by construction, and accepting it as a second,
 * independent number would let a caller pass a pair that disagree.
 */
export async function renderFitted(img, {
  ratio, mode = 'fill', frameW, scale, offsetX, offsetY, background = '#ffffff',
}) {
  const out = outputSize(ratio)
  const canvas = document.createElement('canvas')
  canvas.width = out.width
  canvas.height = out.height
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'

  const imgW = img.naturalWidth
  const imgH = img.naturalHeight

  if (mode === 'fit') {
    if (background === 'blur') {
      // The picture itself, scaled to cover and blurred — what every social
      // app does with a mismatched photo, and truer to the image than asking
      // somebody to choose a colour that will probably be wrong.
      const cover = coverScale({ imgW, imgH, frameW: out.width, frameH: out.height })
      ctx.filter = 'blur(28px)'
      ctx.drawImage(img,
        (out.width - imgW * cover) / 2, (out.height - imgH * cover) / 2,
        imgW * cover, imgH * cover)
      ctx.filter = 'none'
    } else {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, out.width, out.height)
    }
  }

  const rect = drawRect({ imgW, imgH, frameW, scale, offsetX, offsetY, outWidth: out.width })
  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height)

  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92))
  if (!blob) throw new Error('The adjusted image could not be rendered.')
  return { blob, width: out.width, height: out.height }
}

/**
 * The same render with nobody choosing anything: centred, at the scale that
 * just covers (or just fits) the shape.
 *
 * This is what "apply to all slides" uses. Centre-cover is the right default
 * precisely because it is the least opinionated one — it keeps the middle of
 * the picture, which is where the subject of a photograph almost always is,
 * and every slide it touches can still be opened and adjusted by hand
 * afterwards from the untouched original.
 */
export async function autoFit(url, ratioLabel, { mode = 'fill', background = '#ffffff' } = {}) {
  const ratio = parseRatio(ratioLabel)
  if (!(ratio > 0)) throw new Error(`Not a shape: ${ratioLabel}`)
  const img = await loadImage(url)
  const imgW = img.naturalWidth
  const imgH = img.naturalHeight

  // A notional frame at the target shape. Its absolute size is irrelevant —
  // every number below is relative to it — so it is taken from the output,
  // which keeps the arithmetic in whole pixels.
  const out = outputSize(ratio)
  const frame = { frameW: out.width, frameH: out.height }
  const scale = mode === 'fill'
    ? coverScale({ imgW, imgH, ...frame })
    : containScale({ imgW, imgH, ...frame })
  const placed = clampOffset({
    imgW, imgH, ...frame, scale, ...centreOffset({ imgW, imgH, ...frame, scale }),
  })

  return renderFitted(img, { ratio, mode, ...frame, scale, ...placed, background })
}
