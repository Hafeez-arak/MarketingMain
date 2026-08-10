import { Toggle } from '../ui/index'
import { MOTION_PRESETS, MOTION_STRENGTHS, LOOK_PRESETS } from './motionPresets'
import { VIDEO_MODELS, estimateVideoCost } from './videoModels'

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
        // Clicking the already-selected preset again clears it — onPick(null)
        // rather than re-picking the same one, so there's a way back to blank.
        <button key={p.id} type="button" onClick={() => onPick(selectedId === p.id ? null : p)}
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
          <span className="text-[10px] text-text-tertiary flex-shrink-0 inline-flex items-center gap-1">
            Strength
            <span
              title="How much the camera move stands out. Subtle: barely there. Medium: the natural pace the preset already implies. Strong: bold and clearly visible across the whole clip."
              className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-text-tertiary/60 text-[8px] leading-none text-text-tertiary cursor-help select-none">
              i
            </span>
          </span>
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
      <PresetGrid presets={LOOK_PRESETS} selectedId={lookId} onPick={p => onPick(p ? p.id : '')} />
    </div>
  )
}

// Which fal model actually renders the clip. Sits above Length/Quality
// because switching models can change what those even offer (Kling and
// Hailuo have no resolution dial at all, and every model has its own
// allowed durations) — pick the model first, then its options.
export function ModelPicker({ modelId, onPick }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-secondary mb-1.5">Model</p>
      <select value={modelId} onChange={e => onPick(e.target.value)}
        className="w-full text-sm bg-white border border-border rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400">
        {VIDEO_MODELS.map(m => <option key={m.id} value={m.id}>{m.label} — {m.hint}</option>)}
      </select>
    </div>
  )
}

// Length + quality, with the price on each quality button. Per-second rates
// differ a lot by model (Seedance 2.5 is ~56% pricier than 2.0 at 720p; Kling
// and Hailuo don't even take a resolution parameter), so the draft/final
// split is shown as money rather than jargon — otherwise the natural habit
// of re-rendering until it's right quietly runs at the expensive setting.
export function QualityRow({ model, duration, onDuration, resolution, onResolution, audio = false }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <p className="text-xs font-medium text-text-secondary mb-1.5">Length</p>
        <select value={duration} onChange={e => onDuration(e.target.value)}
          className="w-full text-sm bg-white border border-border rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400">
          {model.durations.map(d => <option key={d} value={d}>{d} seconds</option>)}
        </select>
      </div>
      <div>
        <p className="text-xs font-medium text-text-secondary mb-1.5">Quality</p>
        {model.resolutions ? (
          <div className="grid grid-cols-2 gap-2">
            {model.resolutions.map(q => (
              <button key={q.value} type="button" onClick={() => onResolution(q.value)}
                className={`rounded-xl border px-2 py-1.5 text-left transition-all ${
                  resolution === q.value ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-300' : 'border-border hover:border-amber-300'
                }`}>
                <p className="text-[11px] font-semibold text-text leading-tight">{q.label}</p>
                <p className="text-[10px] text-text-tertiary leading-tight">
                  {q.value} · ${estimateVideoCost(model.id, { resolution: q.value, duration, audio }).toFixed(2)}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border px-2 py-1.5 text-[11px] text-text-tertiary leading-tight">
            One quality tier · ${estimateVideoCost(model.id, { duration, audio }).toFixed(2)}
          </div>
        )}
      </div>
    </div>
  )
}

// Kling and Hailuo have no audio input at all; Veo bills it separately from
// the clip itself, so it can't be "free" the way Seedance's is. The toggle's
// label (and whether it even renders) follows model.audio rather than
// assuming every model behaves like Seedance.
export function AudioToggle({ model, audio, onAudio }) {
  if (model.audio === 'unsupported') {
    return <p className="text-[11px] text-text-tertiary">{model.label} doesn't generate audio.</p>
  }
  return (
    <Toggle checked={audio} onChange={e => onAudio(e.target.checked)}
      label={model.audio === 'paid'
        ? 'Generate sound too (adds to the cost below)'
        : 'Generate sound too (free, but invented by the model)'} />
  )
}

export function CostLine({ model, resolution, duration, audio = false }) {
  return (
    <p className="text-[11px] text-text-tertiary">
      This render: <span className="font-semibold text-text-secondary">${estimateVideoCost(model.id, { resolution, duration, audio }).toFixed(2)}</span>
    </p>
  )
}
