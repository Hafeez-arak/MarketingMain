// ─── Camera moves ──────────────────────────────────────────────────────────
// The one genuinely good idea worth taking from Higgsfield: nobody wants to
// write prose to describe a camera move. You pick "slow push in" from a list
// and the well-written version of that sentence is what reaches the model.
//
// Higgsfield sells this as a feature behind a subscription. It isn't a model
// capability — it's a curated prompt library — so it lives here, in our repo,
// running against the fal key we already pay for.
//
// Rules these were written to, learned from the video models' own guidance:
//  · ONE move per clip. Two stacked moves is how you get a drifting, seasick
//    render — the model tries to satisfy both and commits to neither.
//  · Describe the CAMERA, not the scene. The still already fixes the subject,
//    the lighting and the setting; restating them fights the source frame and
//    invites the model to redraw things it should be leaving alone.
//  · Name a speed. "Slow", "gentle", "steady" are the difference between
//    cinematic and a nature documentary zoom.

export const MOTION_PRESETS = [
  {
    id: 'push_in',
    label: 'Slow push in',
    hint: 'Draws the eye to one detail',
    prompt: 'Slow, steady dolly push straight in toward the subject. Smooth and controlled, no handheld shake. The framing tightens gradually over the whole clip.',
  },
  {
    id: 'pull_back',
    label: 'Pull back to reveal',
    hint: 'Detail first, then the whole space',
    prompt: 'Slow dolly pull backwards, revealing more of the surrounding space as the shot widens. Steady and even, ending on a wide establishing frame.',
  },
  {
    id: 'orbit',
    label: 'Arc around',
    hint: 'Shows depth and form',
    prompt: 'Camera arcs slowly around the subject on a smooth horizontal path, holding the subject centred as the background parallaxes behind it. Gentle, continuous, no cuts.',
  },
  {
    id: 'crane_up',
    label: 'Rise up the facade',
    hint: 'Tall buildings, vertical fixtures',
    prompt: 'Smooth vertical crane move rising slowly upward, tilting gently to follow the surface as it climbs. Steady and architectural.',
  },
  {
    id: 'pan',
    label: 'Drift across',
    hint: 'Wide interiors, long facades',
    prompt: 'Slow lateral tracking move across the scene, left to right, at a constant unhurried speed. The camera stays level; no zoom, no tilt.',
  },
  {
    id: 'rack_focus',
    label: 'Rack focus',
    hint: 'Foreground detail → background',
    prompt: 'Camera holds still. Focus pulls slowly from the foreground detail to the background, the out-of-focus areas blooming softly. No camera movement at all.',
  },
  // Arak-specific, and the one the marketing team will reach for most: the
  // product IS the light, so the light coming up is the product demo.
  {
    id: 'lights_up',
    label: 'Lights come up',
    hint: 'The fixtures switch on',
    prompt: 'Camera holds nearly still with the faintest drift. The lighting in the scene comes up gradually from dim to full warmth, the fixtures glowing on and their light spreading across the surfaces. Everything else in the frame stays exactly as it is.',
  },
  {
    id: 'dusk_settle',
    label: 'Dusk settles',
    hint: 'Daylight fades, lighting takes over',
    prompt: 'Camera almost static, the slowest possible drift forward. The ambient daylight falls away and the installed lighting becomes the dominant light source, warm against the cooling sky. No other change in the frame.',
  },
  {
    id: 'static_life',
    label: 'Almost still',
    hint: 'Safest — keeps the composition exact',
    prompt: 'The camera does not move. Only subtle life within the frame: the faintest shimmer in reflections, a barely perceptible shift in the light. The composition stays exactly as framed.',
  },
]

// Longer clips need the move paced across the extra seconds, or the model
// finishes the gesture early and spends the remainder drifting aimlessly.
export function paceForDuration(prompt, seconds) {
  const s = Number(seconds) || 5
  if (s <= 5) return prompt
  return `${prompt} Pace the movement evenly across the full ${s} seconds — one continuous gesture, not repeated.`
}

// ── Cost ───────────────────────────────────────────────────────────────────
// Seedance 2.0 bills per second of output, and the jump from 720p to 1080p is
// more than double. Shown in the panel because a re-render loop that costs
// $3.41 a go is a different habit from one that costs $1.51, and nobody should
// discover that from an invoice.
export const VIDEO_RATES = { '720p': 0.3024, '1080p': 0.682 }

export function estimateCost(resolution, seconds) {
  const rate = VIDEO_RATES[resolution] ?? VIDEO_RATES['720p']
  return rate * (Number(seconds) || 5)
}

// Seedance 2.0 accepts any integer 4-15s (the old model topped out at 3-12,
// hence '3' used to be offered and no longer validates). Shared with the
// round-0 "video only" composer in studio/index.jsx so both duration pickers
// in the app stay in sync with what the model actually accepts.
export const DURATIONS = ['4', '5', '6', '8', '10', '12', '15']
