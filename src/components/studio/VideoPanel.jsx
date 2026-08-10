import { useState } from 'react'
import { Button, Spinner, Textarea } from '../ui/index'
import { applyStrength, paceForDuration } from './motionPresets'
import { AudioToggle, CostLine, MotionPicker, QualityRow } from './VideoSettings'

// ─── Animate (image → video) ───────────────────────────────────────────────
// The controls themselves live in VideoSettings.jsx, shared with the "A video"
// tab so the two surfaces can't offer different options for the same model.
// What's specific to this screen is the source still and the rule that a
// motion preset REPLACES the box: the image already is the subject, so the
// prompt here is only ever the camera move.

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
  const [strength, setStrength] = useState('medium')
  const [duration, setDuration] = useState(initialDuration)
  const [resolution, setResolution] = useState(initialResolution)
  const [audio, setAudio] = useState(initialAudio)

  function pickPreset(preset) {
    // Replaces rather than appends: two stacked camera moves is the single
    // most reliable way to get a drifting, unusable render.
    setPresetId(preset.id)
    setPrompt(preset.prompt)
  }

  function submit() {
    const text = prompt.trim()
    if (!text) return
    onSubmit({
      // Strength is only meaningful against a preset's own wording — on a
      // hand-written note it would be appending a magnitude instruction to a
      // sentence that may already specify one, and contradicting yourself in
      // a prompt is worse than saying nothing.
      prompt: paceForDuration(presetId ? applyStrength(text, strength) : text, duration),
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

      <MotionPicker
        presetId={presetId}
        onPickPreset={pickPreset}
        strength={strength}
        onStrength={setStrength}
      />

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

      <QualityRow
        duration={duration} onDuration={setDuration}
        resolution={resolution} onResolution={setResolution}
      />

      <AudioToggle audio={audio} onAudio={setAudio} />

      <p className="text-[11px] text-text-tertiary leading-snug">
        Takes a minute or two. Longer reels are cut together from several clips — 15 seconds is
        the most one render can produce. Need a change? Edit the still and re-render.
      </p>

      <div className="flex items-center justify-between gap-2 pt-1">
        <CostLine resolution={resolution} duration={duration} />
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
