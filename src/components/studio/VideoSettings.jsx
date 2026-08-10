import { Toggle } from '../ui/index'
import { MOTION_PRESETS, MOTION_STRENGTHS, LOOK_PRESETS, DURATIONS, estimateCost } from './motionPresets'

// ─── Shared video controls ─────────────────────────────────────────────────
// The same settings appear in two places — the Animate modal (image → video)
// and the "A video" tab (text → video). They were built for the modal first
// and the tab had none of them, which is the whole reason this file exists:
// one definition, so the two surfaces can't drift into offering different
// options for the same model.
//
// What differs between the two is genuinely different, not accidental:
//  · Looks are text-to-video only. Animating an existing still means the look
//    is already decided by that image; asking for a grade on top invites the
//    model to redraw a frame it should leave alone.
//  · In the modal a motion preset REPLACES the box (the still is the subject,
//    so the prompt is only ever the move). In the tab it's a separate field
//    that gets appended, because there the prompt is the scene itself.

function PresetGrid({ presets, selectedId, onPick, cols = 'sm:grid-cols-3' }) {
  return (
    <div className={`grid grid-cols-2 ${cols} gap-2`}>
      {presets.map(p => (
        <button key={p.id} type="button" onClick={() => onPick(p)}
          className={`text-left rounded-xl border p-2 transition-all ${
            selectedId === p.id ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-300' : 'border-border hover:border-amber-300'
          }`}>
          <p className="text-[11px] font-semibold text-text leading-tight">{p.label}</p>
          <p className="text-[10px] text-text-tertiary mt-0.5 leading-snug">{p.hint}</p>
        </button>
      ))}
    </div>
  )
}

export function MotionPicker({ presetId, onPickPreset, strength, onStrength, label = 'How should the camera move?' }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-secondary mb-1.5">{label}</p>
      <PresetGrid presets={MOTION_PRESETS} selectedId={presetId} onPick={onPickPreset} />

      {/* Higgsfield's motion API pairs every move with a strength, and it's
          the dial people actually turn between takes — the move is right, it's
          just too much or too little. Only shown once a move is chosen, since
          on its own it has nothing to modify. */}
      {presetId && (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] text-text-tertiary flex-shrink-0">Strength</span>
          <div className="flex gap-1.5">
            {MOTION_STRENGTHS.map(s => (
              <button key={s.id} type="button" onClick={() => onStrength(s.id)}
                title={s.hint}
                className={`text-[10px] px-2 py-1 rounded-lg border transition-colors ${
                  strength === s.id ? 'border-amber-500 bg-amber-50 text-amber-800 font-semibold' : 'border-border text-text-tertiary hover:border-amber-300'
                }`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function LookPicker({ lookId, onPick }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-secondary mb-1.5">What should it look like?</p>
      <PresetGrid presets={LOOK_PRESETS} selectedId={lookId} onPick={p => onPick(p.id)} />
    </div>
  )
}

const QUALITIES = [
  { value: '720p',  label: 'Draft',  hint: 'For checking the movement' },
  { value: '1080p', label: 'Final',  hint: 'For the post itself' },
]

// Length + quality, with the price on each quality button. Seedance 2.0 bills
// per second and 1080p is 2.3x the cost of 720p, so the draft/final split is
// shown as money rather than jargon — otherwise the natural habit of
// re-rendering until it's right quietly runs at the expensive setting.
export function QualityRow({ duration, onDuration, resolution, onResolution }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <p className="text-xs font-medium text-text-secondary mb-1.5">Length</p>
        <select value={duration} onChange={e => onDuration(e.target.value)}
          className="w-full text-sm bg-white border border-border rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400">
          {DURATIONS.map(d => <option key={d} value={d}>{d} seconds</option>)}
        </select>
      </div>
      <div>
        <p className="text-xs font-medium text-text-secondary mb-1.5">Quality</p>
        <div className="grid grid-cols-2 gap-2">
          {QUALITIES.map(q => (
            <button key={q.value} type="button" onClick={() => onResolution(q.value)}
              className={`rounded-xl border px-2 py-1.5 text-left transition-all ${
                resolution === q.value ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-300' : 'border-border hover:border-amber-300'
              }`}>
              <p className="text-[11px] font-semibold text-text leading-tight">{q.label}</p>
              <p className="text-[10px] text-text-tertiary leading-tight">
                {q.value} · ${estimateCost(q.value, duration).toFixed(2)}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// Off by default. It costs nothing extra on Seedance 2.0, but a model
// inventing ambient sound under a brand asset is a liability rather than a
// bonus — it should be asked for, not arrive by surprise.
export function AudioToggle({ audio, onAudio }) {
  return (
    <Toggle checked={audio} onChange={e => onAudio(e.target.checked)}
      label="Generate sound too (free, but invented by the model)" />
  )
}

export function CostLine({ resolution, duration }) {
  return (
    <p className="text-[11px] text-text-tertiary">
      This render: <span className="font-semibold text-text-secondary">${estimateCost(resolution, duration).toFixed(2)}</span>
    </p>
  )
}
