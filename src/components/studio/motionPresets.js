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

// ── Motion strength ────────────────────────────────────────────────────────
// Higgsfield's motion API takes `inputMotion(motionId, strength)` — you pick
// the move AND how hard it lands. That second dial is the difference between
// a move that reads as intentional and one that reads as a zoom, and it's the
// thing people actually adjust between takes.
//
// Our models take prose, not a number, so strength is expressed the way these
// models respond to: an explicit instruction about magnitude and pace. Medium
// is the default because it's what the preset prose already implies on its own.
export const MOTION_STRENGTHS = [
  { id: 'subtle', label: 'Subtle', hint: 'Barely there',
    suffix: 'Keep the movement very restrained and small in magnitude — it should be felt rather than noticed.' },
  { id: 'medium', label: 'Medium', hint: 'Natural', suffix: '' },
  { id: 'strong', label: 'Strong', hint: 'Bold, obvious',
    suffix: 'Make the movement pronounced and clearly visible, covering real distance across the clip — still smooth and controlled, never fast or jerky.' },
]

export function applyStrength(prompt, strengthId) {
  const s = MOTION_STRENGTHS.find(x => x.id === strengthId)
  return s && s.suffix ? `${prompt} ${s.suffix}` : prompt
}

// Longer clips need the move paced across the extra seconds, or the model
// finishes the gesture early and spends the remainder drifting aimlessly.
export function paceForDuration(prompt, seconds) {
  const s = Number(seconds) || 5
  if (s <= 5) return prompt
  return `${prompt} Pace the movement evenly across the full ${s} seconds — one continuous gesture, not repeated.`
}

// ── Looks ──────────────────────────────────────────────────────────────────
// The other half of what Higgsfield sells: Soul's style library, where you
// pick a look instead of writing one. Same conclusion as the motion gallery —
// it's a curated prompt library, not a model capability, so it lives here.
//
// Only offered for text-to-video. When you animate an existing still, the look
// is already decided by that image, and asking the model for a grade on top is
// an invitation to redraw the frame it should be leaving alone.
export const LOOK_PRESETS = [
  {
    id: 'architectural',
    label: 'Architectural film',
    hint: 'Clean, wide, considered',
    prompt: 'Shot like an architectural film: wide anamorphic framing, deep focus, level horizon lines, natural colour, restrained contrast. Every line in the frame deliberate.',
  },
  {
    id: 'golden',
    label: 'Golden hour',
    hint: 'Warm, low sun',
    prompt: 'Golden-hour cinematography: low warm sunlight raking across surfaces, long soft shadows, gentle lens bloom, rich amber and honey tones.',
  },
  {
    id: 'nocturne',
    label: 'Night / dusk',
    hint: 'Where fixtures shine',
    prompt: 'Nocturnal cinematography: deep blue ambient sky against warm installed lighting, pools of light on darker surfaces, high contrast with clean shadow detail and no crushed blacks.',
  },
  {
    id: 'editorial',
    label: 'Editorial product',
    hint: 'Studio, close, precise',
    prompt: 'Editorial product cinematography: shallow depth of field, controlled studio lighting, soft gradient backdrop, crisp specular highlights on metal and glass, minimal styling.',
  },
  {
    id: 'documentary',
    label: 'Documentary',
    hint: 'Real spaces, real people',
    prompt: 'Naturalistic documentary cinematography: available light, honest colour, mid-range depth of field, unstyled real-world detail.',
  },
  {
    id: 'none',
    label: 'No preset',
    hint: 'Just my description',
    prompt: '',
  },
]

// ── Style bible ────────────────────────────────────────────────────────────
// The multi-clip equivalent of a look preset, written by hand: the tonal
// parameters that must not re-roll between shots. Every platform that builds
// long video out of short clips converges on this — Flow, Higgsfield and LTX
// all repeat a fixed block across every shot — because a model given only the
// shot description re-decides the lens, the grade and the light each time.
//
// It goes AFTER the scene for the same reason the look preset does (see
// below), not at the top. Prepending it is the intuitive move and it's wrong:
// it puts the least specific text in the position these models weight most.
export const STYLE_BIBLE_PLACEHOLDER =
  'Shared across every clip — camera signature, lighting, grade, texture.\n' +
  'e.g. Shot on 35mm anamorphic, T2.8. Warm 3000K practical light against a cool ambient. ' +
  'Gentle film grain, soft highlight rolloff, no crushed blacks.'

// Appended to a clip that continues from the one before it. Without this, an
// image-to-video model reads the handed-over last frame as a fresh scene to
// reinterpret, which is exactly the seam this feature exists to hide.
export const CONTINUITY_PREFACE =
  'This shot continues directly from the previous one — the opening frame is the ' +
  'previous shot’s final frame. Keep the same subject, wardrobe, lighting, lens and ' +
  'camera position, and carry the existing motion through without resetting it.'

// Scene, then look, then style bible, then movement — in that order, because
// these models weight the opening of the prompt most heavily and the subject
// must win. Kept as one assembly function so the composer and any future
// caller can't drift apart on ordering, which measurably changes the render.
export function buildVideoPrompt({ scene, lookId, styleBible, motion, strength, duration, continues }) {
  const look = LOOK_PRESETS.find(l => l.id === lookId)
  const parts = [String(scene || '').trim()]
  if (look && look.prompt) parts.push(look.prompt)
  const bible = String(styleBible || '').trim()
  if (bible) parts.push(bible)
  const move = String(motion || '').trim()
  if (move) parts.push(paceForDuration(applyStrength(move, strength), duration))
  // Last, deliberately: it's an instruction about how to treat the input
  // frame rather than a description of the shot, and burying it among the
  // scene text gets it read as scene content.
  if (continues) parts.push(CONTINUITY_PREFACE)
  return parts.filter(Boolean).join('\n\n')
}

// Cost and duration/resolution options moved to videoModels.js — they're now
// per-model (Seedance 2.0's own $/s rates, allowed durations, etc.) rather
// than a single global table, now that the model picker offers more than one.
