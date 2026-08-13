import { layerTiming } from './document'

// ─── What a layer looks like at time t ─────────────────────────────────────
// The editor used to show frame one of a clip as a still and nothing else, so
// "when does this appear" was a number you typed and found out about after the
// render. This module is what lets the canvas answer the question live.
//
// The rule that governs every line below: **this has to agree with ffmpeg, not
// merely resemble it.** The compose workflow's filter graph
// (`CREATIVE_COMPOSE_JS` in n8n/gen_workflows.py) is the thing that actually
// ships, so anything the preview shows that the graph would not produce is a
// lie the marketer only discovers after paying for a render. Each function
// here names the ffmpeg construct it mirrors.

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

// Mirrors two constructs at once, which is why they're computed together:
//
//   · the `enable` gate      — overlay=…:enable='between(t,tIn,tOut)'
//                              (or 'gte(t,tIn)' when the layer runs to the end)
//   · the alpha fades        — fade=t=in:st=tIn:d=fade:alpha=1
//                              fade=t=out:st=tOut-fade:d=fade:alpha=1
//
// The asymmetry in the fades is deliberate and is copied from the graph rather
// than tidied up: ffmpeg only adds the OUT fade when the layer has a real
// `tOut`. A layer running to the end of the clip therefore fades in and then
// simply stops when the footage does. Showing a fade-out here that the render
// would not produce would be exactly the kind of preview/export drift the text
// pipeline was built to avoid.
export function layerAlphaAt(layer, t) {
  if (!layer || layer.visible === false) return 0
  const { tIn, tOut, fade } = layerTiming(layer)
  const base = layer.opacity ?? 1

  if (t < tIn) return 0
  if (tOut !== null && t > tOut) return 0

  if (fade > 0) {
    if (t < tIn + fade) return base * clamp01((t - tIn) / fade)
    if (tOut !== null && t > tOut - fade) return base * clamp01((tOut - t) / fade)
  }
  return base
}

// Whether the layer is on screen at all — the `enable` gate on its own, with
// no regard for how transparent it happens to be mid-fade. Used for the
// timeline's own hit testing, where "is this layer live right now" is a
// different question from "how much of it can you see".
export function layerLiveAt(layer, t) {
  if (!layer || layer.visible === false) return false
  const { tIn, tOut } = layerTiming(layer)
  return t >= tIn && (tOut === null || t <= tOut)
}

// ─── Motion ────────────────────────────────────────────────────────────────
// Canva draws a hard line between *timing* — when an element is on screen —
// and *animation*, how it arrives and leaves. We had the first and none of the
// second, which is most of why our overlays read as stamped on rather than
// designed.
//
// What makes this cheap is a property of the compose graph rather than of the
// editor: each overlay is already a looped PNG fed through `overlay`, and
// ffmpeg's `overlay` takes **expressions in `t` for x and y**. So a slide is a
// formula in a filter chain that already exists — no per-frame rendering, no
// second pass, no extra render cost. `buildMotionExpr` below emits that
// formula, and `motionOffsetAt` is the same curve in JS for the preview: one
// definition, two consumers, exactly as `drawBox` is for text.
//
// Deliberately translations only. Scale ("pop") would need a time-varying
// `scale` filter, which ffmpeg has no equivalent of, and per-letter effects
// like a typewriter need glyph-by-glyph placement, which breaks Arabic
// shaping — the same reason curved text stayed out of the image editor.

// Where the element comes FROM, as a unit vector in screen space.
const MOTION_VECTORS = {
  rise: [0, 1],           // starts below, travels up into place
  fall: [0, -1],          // starts above, drops in
  'slide-left': [1, 0],   // starts right, moves left
  'slide-right': [-1, 0], // starts left, moves right
}

export const MOTIONS = ['none', 'rise', 'fall', 'slide-left', 'slide-right']
export const MOTION_LABELS = {
  none: 'None', rise: 'Rise', fall: 'Drop', 'slide-left': 'Slide left', 'slide-right': 'Slide right',
}

// How far it travels, as a fraction of the document's HEIGHT on both axes —
// height on both so a slide on a 9:16 reel and a slide on a 16:9 frame feel
// like the same gesture rather than one being three times the other.
export const MOTION_DISTANCE = 0.06
export const DEFAULT_MOTION_SECONDS = 0.4

export function layerMotion(layer) {
  const a = layer?.anim
  if (!a) return null
  const inM = MOTION_VECTORS[a.in] ? a.in : 'none'
  const outM = MOTION_VECTORS[a.out] ? a.out : 'none'
  if (inM === 'none' && outM === 'none') return null
  return { in: inM, out: outM, duration: Math.max(0.05, Number(a.duration) || DEFAULT_MOTION_SECONDS) }
}

// Ease-out cubic, written as the REMAINING distance rather than the progress:
// `(1-p)^3` is what both this and the ffmpeg expression multiply the travel by,
// so there is one shape to get right instead of two that have to agree.
const remaining = p => Math.pow(1 - clamp01(p), 3)

// The layer's offset from its resting position at time t, in document pixels.
// Zero everywhere outside the two ramps, which is nearly all of the clip.
export function motionOffsetAt(layer, t, docH) {
  const m = layerMotion(layer)
  if (!m) return null
  const { tIn, tOut } = layerTiming(layer)
  const travel = MOTION_DISTANCE * docH
  let dx = 0
  let dy = 0

  if (m.in !== 'none' && t < tIn + m.duration) {
    const k = remaining((t - tIn) / m.duration) * travel
    const v = MOTION_VECTORS[m.in]
    dx += v[0] * k
    dy += v[1] * k
  }
  // Only when there is a real tOut to leave at. A layer running to the end of
  // the clip has no exit to animate — the same asymmetry the fades have, and
  // for the same reason: ffmpeg has nothing to anchor the ramp to.
  if (m.out !== 'none' && tOut !== null && t > tOut - m.duration) {
    const k = remaining((tOut - t) / m.duration) * travel
    const v = MOTION_VECTORS[m.out]
    // Negated: on the way out it keeps travelling in the direction it was
    // already going rather than reversing back the way it came.
    dx -= v[0] * k
    dy -= v[1] * k
  }
  return dx || dy ? { dx, dy } : null
}

// ─── The centre-crop, mirrored ─────────────────────────────────────────────
// The document is composed against a STILL — the frame the clip was animated
// from — while the clip itself comes back in whatever shape the model would
// accept (a 4:5 session renders 3:4 on Seedance, 9:16 on Veo). The compose
// script reconciles the two by centre-cropping the CLIP to the overlay's
// aspect, so the text lands where it was put.
//
// Which means a preview that draws the raw clip is showing a frame the render
// will never produce. This returns the same window the shell arithmetic does:
//
//   if [ $((CW*OH)) -gt $((CH*OW)) ]; then TH=$CH; TW=$((CH*OW/OH));
//   else TW=$CW; TH=$((CW*OH/OW)); fi
//   OX=$(((CW-TW)/2)); OY=$(((CH-TH)/2))
//
// minus the force-to-even, which exists only because yuv420p rejects odd
// dimensions on encode. A canvas has no such constraint and rounding here
// would put the preview up to a pixel away from the render for no gain.
export function centreCropRect(videoW, videoH, docW, docH) {
  if (!videoW || !videoH || !docW || !docH) return null
  let width, height
  if (videoW * docH > videoH * docW) {
    height = videoH
    width = (videoH * docW) / docH
  } else {
    width = videoW
    height = (videoW * docH) / docW
  }
  return { x: (videoW - width) / 2, y: (videoH - height) / 2, width, height }
}
