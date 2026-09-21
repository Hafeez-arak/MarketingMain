import { supabase, SUPABASE_URL } from './supabaseClient'

// ─── Fit a picture to what the platform accepts ────────────────────────────
// Instagram refuses a feed image outside 0.5625–1.91 (9:16 to 1.91:1) with a
// Zernio 400 — after the row was claimed, so the post lands as FAILED over a
// shape problem the app could have seen. A wide logo (2.86:1) is the usual
// culprit, but any upload can do it.
//
// Rather than fail, publishing pads the picture onto a canvas of an accepted
// shape. Padding, never cropping: a crop can silently cut off a logo or a
// product, and a bar of background colour cannot.

export const IG_MIN_RATIO = 0.5625
export const IG_MAX_RATIO = 1.91
const MAX_SIDE = 1440

// Pure. null when the ratio is already accepted, otherwise the canvas to pad
// onto. Too wide -> a square (the profile grid's shape); too tall -> 4:5.
export function fitTarget(width, height) {
  if (!(width > 0) || !(height > 0)) return null
  const ratio = width / height
  if (ratio >= IG_MIN_RATIO && ratio <= IG_MAX_RATIO) return null
  const target = ratio > IG_MAX_RATIO ? 1 : 0.8
  // Grow the canvas around the image, so nothing is scaled down more than
  // the fit requires; then cap the long side.
  let cw = ratio > IG_MAX_RATIO ? width : Math.round(height * target)
  let ch = ratio > IG_MAX_RATIO ? Math.round(width / target) : height
  const scale = Math.min(1, MAX_SIDE / Math.max(cw, ch))
  cw = Math.round(cw * scale); ch = Math.round(ch * scale)
  return { canvasWidth: cw, canvasHeight: ch, scale, ratio }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load the picture to check its shape.'))
    img.src = url
  })
}

// The colour at the picture's top-left corner, so the padding blends with a
// picture that has its own background and is plain white for a transparent one.
function cornerColour(img) {
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return a < 200 ? '#ffffff' : `rgb(${r},${g},${b})`
}

// Returns the same url when it already fits, otherwise the url of a padded
// copy in Storage. Throws with a sentence a person can act on.
export async function fitImageUrl(url, workspaceId) {
  // A picture that cannot be inspected (a host without CORS) is sent as it is:
  // failing here would block a post that Instagram might have accepted.
  let img
  try { img = await loadImage(url) } catch { return url }
  const t = fitTarget(img.naturalWidth, img.naturalHeight)
  if (!t) return url

  const canvas = document.createElement('canvas')
  canvas.width = t.canvasWidth
  canvas.height = t.canvasHeight
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = cornerColour(img)
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // Contain: the picture fills the canvas on its tight side, bars on the other.
  const s = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight)
  const w = img.naturalWidth * s, h = img.naturalHeight * s
  ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)

  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92))
  if (!blob) throw new Error('Could not resize the picture to fit Instagram.')

  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in again to resize the picture for Instagram.')
  const path = `${workspaceId || 'shared'}/fitted/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/brand-assets/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'image/jpeg' },
    body: blob,
  })
  if (!up.ok) throw new Error(`Could not save the resized picture: ${await up.text()}`)
  return `${SUPABASE_URL}/storage/v1/object/public/brand-assets/${path}`
}

// The shape a picture will have on Instagram, for previews. Padded pictures
// get the canvas they are padded onto; the rest keep their own ratio, held to
// what the feed shows (4:5 to 1.91:1 - anything taller is cropped by the feed
// itself). `colour` is the padding colour. null when it cannot be measured.
export const FEED_MIN_RATIO = 0.8
export function publishedRatio(width, height) {
  const t = fitTarget(width, height)
  if (t) return { ratio: t.canvasWidth / t.canvasHeight, padded: true }
  const r = width / height
  return { ratio: Math.min(IG_MAX_RATIO, Math.max(FEED_MIN_RATIO, r)), padded: false }
}

export async function previewFit(url) {
  let img
  try { img = await loadImage(url) } catch { return null }
  const shape = publishedRatio(img.naturalWidth, img.naturalHeight)
  if (!shape.padded) return shape
  try { return { ...shape, colour: cornerColour(img) } } catch { return { ...shape, colour: '#ffffff' } }
}
