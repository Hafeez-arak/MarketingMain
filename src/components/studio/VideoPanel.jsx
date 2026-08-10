import { useState } from 'react'
import { Button, Spinner, Textarea, Toggle } from '../ui/index'
import { MOTION_PRESETS, DURATIONS, estimateCost, paceForDuration } from './motionPresets'

// ─── Animate ───────────────────────────────────────────────────────────────
// Replaces the placeholder "how should it move?" box. Two things it adds that
// a bare textarea can't:
//
//  · A camera-move gallery, so the move is chosen rather than described. See
//    motionPresets.js for why the prompt text is written the way it is.
//  · An honest price. Seedance 2.0 bills per second and 1080p is 2.3× the cost
//    of 720p, so the draft/final split is shown as money, not as jargon —
//    otherwise the natural habit (re-render until it's right) quietly runs at
//    the expensive setting.

const QUALITIES = [
  { value: '720p',  label: 'Draft',  hint: 'For checking the movement' },
  { value: '1080p', label: 'Final',  hint: 'For the post itself' },
]

export function VideoPanel({
  target, busy, onSubmit, onCancel, onEnhance, enhancing,
  // Set when reopening from the 🔄 "re-render with the current image" action
  // on a past render — same words, same settings, new base image. A fresh
  // mount (the Modal that hosts this unmounts on close) means plain useState
  // initializers are enough; there's no stale-prefill risk across opens.
  initialPrompt = '', initialDuration = '5', initialResolution = '720p', initialAudio = false,
}) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [presetId, setPresetId] = useState('')
  const [duration, setDuration] = useState(initialDuration)
  const [resolution, setResolution] = useState(initialResolution)
  const [audio, setAudio] = useState(initialAudio)

  function pickPreset(preset) {
    // Replaces rather than appends: two stacked camera moves is the single
    // most reliable way to get a drifting, unusable render.
    setPresetId(preset.id)
    setPrompt(preset.prompt)
  }

  const cost = estimateCost(resolution, duration)

  function submit() {
    const text = prompt.trim()
    if (!text) return
    onSubmit({
      prompt: paceForDuration(text, duration),
      duration,
      resolution,
      generateAudio: audio,
    })
  }

  return (
    <div className="p-6 space-y-4">
      {target?.image_url && (
        <div className="flex items-center gap-3">
          <img src={target.image_url} alt="" className="w-16 h-20 object-cover rounded-xl border border-border" />
          <div>
            <p className="text-xs font-semibold text-text">Animating this still</p>
            <p className="text-[11px] text-text-tertiary leading-snug">
              The clip is generated clean. Text goes on afterwards, so wording stays changeable.
            </p>
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-text-secondary mb-1.5">How should the camera move?</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {MOTION_PRESETS.map(p => (
            <button key={p.id} onClick={() => pickPreset(p)}
              className={`text-left rounded-xl border p-2 transition-all ${
                presetId === p.id ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-300' : 'border-border hover:border-amber-300'
              }`}>
              <p className="text-[11px] font-semibold text-text leading-tight">{p.label}</p>
              <p className="text-[10px] text-text-tertiary mt-0.5 leading-snug">{p.hint}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Textarea
          label="Or describe it yourself"
          rows={3}
          value={prompt}
          onChange={e => { setPrompt(e.target.value); setPresetId('') }}
          placeholder="e.g. slow push in towards the entrance, the facade lights glow warmer"
        />
        {onEnhance && (
          <button type="button"
            onClick={async () => {
              const res = await onEnhance(prompt, duration)
              if (res) { setPrompt(res); setPresetId('') }
            }}
            disabled={!prompt.trim() || !!enhancing || busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium hover:border-amber-400 hover:bg-amber-50 disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent">
            {enhancing ? <><Spinner size="sm" /> Enhancing…</> : '✨ Enhance motion'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1.5">Length</p>
          <select value={duration} onChange={e => setDuration(e.target.value)}
            className="w-full text-sm bg-white border border-border rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400">
            {DURATIONS.map(d => <option key={d} value={d}>{d} seconds</option>)}
          </select>
        </div>
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1.5">Quality</p>
          <div className="grid grid-cols-2 gap-2">
            {QUALITIES.map(q => (
              <button key={q.value} onClick={() => setResolution(q.value)}
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

      {/* Off by default. It costs nothing, but a model inventing ambient sound
          under a brand asset is a liability rather than a bonus — it should be
          asked for, not arrive by surprise. */}
      <Toggle checked={audio} onChange={e => setAudio(e.target.checked)}
        label="Generate sound too (free, but invented by the model)" />

      <p className="text-[11px] text-text-tertiary leading-snug">
        Takes a minute or two. Longer reels are cut together from several clips — 15 seconds is
        the most one render can produce. Need a change? Edit the still and re-render.
      </p>

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-[11px] text-text-tertiary">
          This render: <span className="font-semibold text-text-secondary">${cost.toFixed(2)}</span>
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !prompt.trim()}>
            {busy ? <><Spinner size="sm" /> Starting…</> : '🎬 Create video'}
          </Button>
        </div>
      </div>
    </div>
  )
}
