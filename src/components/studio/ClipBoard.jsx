import { useState } from 'react'
import { Button, ConfirmDialog, Modal, Spinner, Textarea, Toggle } from '../ui/index'
import { MultiRefRow } from './MediaPicker'
import { LookPicker, ModelPicker } from './VideoSettings'
import { STYLE_BIBLE_PLACEHOLDER } from './motionPresets'
import { getVideoModel, estimateVideoCost } from './videoModels'
import {
  MULTI_CLIP_MAX, chainedAfter, clipPromptFor, staleSeams, storyboardTotals,
} from '../../lib/creativeStoryboard'

// ─── The storyboard ────────────────────────────────────────────────────────
// A long video is a list of shots. Each gets its own prompt, its own length
// and its own take; the seam between two shots gets its own decision. This is
// the same shape every platform that does long-form AI video has landed on —
// Pika's keyframes, Flow's Scenebuilder, LTX's shot list — because a single
// prompt cannot direct a minute of footage.
//
// Presentational. Every action is a prop, matching BranchChat's contract, so
// the render run's state machine lives entirely in useClipSequencer. The one
// exception is the preview modal below, which only ever displays a URL the
// board already holds.
//
// What is session-level and what is per-clip is deliberate:
//  · MODEL is session-level. Mixing Veo (8s, its own grade, 16:9 only) with
//    Hailuo (6s, no aspect input) across a chained sequence guarantees a
//    visible aesthetic jump at every seam — the exact thing this is for.
//  · LENGTH is per-clip. Pacing is the whole craft of a cut.

const money = n => `$${n.toFixed(2)}`

function StateDot({ state }) {
  const map = {
    ready:   ['bg-emerald-500', 'Rendered'],
    pending: ['bg-amber-400 animate-pulse', 'Rendering…'],
    failed:  ['bg-red-500', 'Failed'],
    missing: ['bg-stone-300', 'Not rendered yet'],
  }
  const [cls, title] = map[state] || map.missing
  return <span title={title} className={`inline-block w-2 h-2 flex-shrink-0 ${cls}`} />
}

// ── The seam between two clips ─────────────────────────────────────────────
// Two independent decisions that are easy to conflate:
//  · CONTINUE vs CUT is about generation — does clip N+1 start from clip N's
//    last frame? That is what makes a seam invisible, and it forces the clips
//    to render one after another.
//  · CROSSFADE vs HARD CUT is about assembly — what ffmpeg does at the join.
// A continued seam almost always wants a hard cut at assembly, because the
// footage already flows; crossfading it would blur a continuous shot.
function Seam({ clip, index, startFrameUrl, sharedRefs, stale, onPatch, onPreviewFrame, disabled }) {
  const continues = !!clip.continueFromPrevious
  return (
    <div className="pl-3 py-1.5 border-l-2 border-dashed border-stone-300 ml-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex">
          <button type="button" disabled={disabled}
            onClick={() => onPatch(index, { continueFromPrevious: true })}
            className={`text-[10px] px-2 py-1 border transition-colors disabled:opacity-40 ${
              continues ? 'border-amber-500 bg-amber-50 text-amber-800 font-semibold' : 'border-border text-text-tertiary hover:border-amber-300'
            }`}>
            Continue from previous
          </button>
          <button type="button" disabled={disabled}
            onClick={() => onPatch(index, { continueFromPrevious: false })}
            className={`text-[10px] px-2 py-1 border border-l-0 transition-colors disabled:opacity-40 ${
              !continues ? 'border-amber-500 bg-amber-50 text-amber-800 font-semibold' : 'border-border text-text-tertiary hover:border-amber-300'
            }`}>
            New shot
          </button>
        </div>

        <span className="text-[10px] text-text-tertiary">·</span>

        <div className="flex">
          <button type="button" disabled={disabled}
            onClick={() => onPatch(index, { transition: 'cut' })}
            className={`text-[10px] px-2 py-1 border transition-colors disabled:opacity-40 ${
              clip.transition !== 'crossfade' ? 'border-stone-400 bg-surface-subtle text-text font-semibold' : 'border-border text-text-tertiary hover:border-stone-400'
            }`}>
            Hard cut
          </button>
          <button type="button" disabled={disabled}
            onClick={() => onPatch(index, { transition: 'crossfade' })}
            className={`text-[10px] px-2 py-1 border border-l-0 transition-colors disabled:opacity-40 ${
              clip.transition === 'crossfade' ? 'border-stone-400 bg-surface-subtle text-text font-semibold' : 'border-border text-text-tertiary hover:border-stone-400'
            }`}>
            Crossfade
          </button>
        </div>

        {clip.transition === 'crossfade' && (
          <select value={clip.transitionDuration} disabled={disabled}
            onChange={e => onPatch(index, { transitionDuration: Number(e.target.value) })}
            className="text-[10px] bg-white border border-border px-1.5 py-1 focus:outline-none focus:border-amber-400">
            {[0.25, 0.5, 0.75, 1, 1.5].map(d => <option key={d} value={d}>{d}s</option>)}
          </select>
        )}

        {/* The one thing a marketer cannot discover on their own: the render
            endpoint takes EITHER a start frame or style references, never both,
            so continuing a shot silently costs it the shared references. */}
        {continues && (
          <span className="text-[10px] text-text-tertiary leading-snug">
            Uses the previous clip's last frame, so the shared references don't apply here.
          </span>
        )}
      </div>

      {/* ── What clip N+1 is actually born from ──
          The single most invisible thing in this feature. A chained clip is
          generated from ONE still — the previous clip's final frame, grabbed
          by seeking a hair before the end — and when that grab lands on a
          motion-blurred or half-faded frame, the only symptom is "this shot
          looks wrong" with nothing to inspect. It's already uploaded and
          already on the row, so show it. */}
      <div className="flex items-center gap-2">
        {continues ? (
          startFrameUrl ? (
            <>
              <button type="button" onClick={() => onPreviewFrame(startFrameUrl)}
                title="See this frame full size"
                className="w-11 h-11 border border-border hover:border-amber-400 overflow-hidden flex-shrink-0">
                <img src={startFrameUrl} alt="" className="w-full h-full object-cover" />
              </button>
              <span className="text-[10px] text-text-tertiary leading-snug">
                Clip {index + 1} starts from this frame.
              </span>
            </>
          ) : (
            <span className="text-[10px] text-text-tertiary leading-snug">
              Clip {index + 1} will start from clip {index}'s last frame, once clip {index} has rendered.
            </span>
          )
        ) : sharedRefs.length ? (
          <>
            <div className="flex gap-1">
              {sharedRefs.slice(0, 4).map((r, n) => (
                <button key={n} type="button" onClick={() => onPreviewFrame(r.url)}
                  className="w-11 h-11 border border-border hover:border-amber-400 overflow-hidden flex-shrink-0">
                  <img src={r.url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
            <span className="text-[10px] text-text-tertiary leading-snug">
              Clip {index + 1} starts fresh, guided by {sharedRefs.length === 1 ? 'this reference' : `these ${sharedRefs.length} references`}.
            </span>
          </>
        ) : (
          <span className="text-[10px] text-text-tertiary leading-snug">
            Clip {index + 1} starts fresh from its prompt alone.
          </span>
        )}
      </div>

      {stale && (
        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 leading-snug">
          This seam no longer connects — clip {index} was re-rendered after clip {index + 1},
          so clip {index + 1} still continues from a frame that isn't in the reel any more.
          Re-render clip {index + 1} to close it.
        </p>
      )}
    </div>
  )
}

// ── One shot ───────────────────────────────────────────────────────────────
function ClipCard({
  clip, index, row, state, model, audio, active, promptText, preparing,
  onPatch, onRemove, onRetry, onRerender, onAddText, onPreview,
  canRemove, disabled,
}) {
  const cost = estimateVideoCost(model.id, { resolution: clip.resolution, duration: clip.duration, audio })
  const ready = state === 'ready' && !!row?.video_url
  // A composite has been through the text editor; the take you'd re-render is
  // still the clip underneath it.
  const composited = row?.kind === 'overlay'

  return (
    <div className={`border p-3 space-y-2 transition-colors ${
      active ? 'border-amber-500 ring-1 ring-amber-300 bg-amber-50/40' : 'border-border bg-white'
    }`}>
      <div className="flex items-center gap-2 flex-wrap">
        <StateDot state={state} />
        <p className="text-xs font-semibold text-text">Clip {index + 1}</p>
        <span className="text-[10px] text-text-tertiary">{clip.duration}s · {money(cost)}</span>
        {composited && <span className="text-[10px] text-emerald-700">· text added</span>}
        <div className="flex-1" />
        {state === 'failed' && (
          <Button size="xs" variant="secondary" onClick={() => onRetry(index)} disabled={disabled}>Retry</Button>
        )}
        {ready && (
          <>
            <Button size="xs" variant="secondary" onClick={() => onAddText(row)} disabled={disabled || !!preparing}>
              {preparing ? <><Spinner size="sm" /> Opening…</> : '✏️ Text'}
            </Button>
            {/* Re-rendering one shot is the only way to fix a take that came
                back wrong, and it costs the same as the first one did — so the
                price is on the button, exactly like Render all. */}
            <Button size="xs" variant="secondary" onClick={() => onRerender(index)} disabled={disabled}>
              ↻ Re-render · {money(cost)}
            </Button>
          </>
        )}
        {canRemove && (
          <button type="button" onClick={() => onRemove(index)} disabled={disabled}
            title="Remove this clip"
            className="text-text-tertiary hover:text-red-500 text-xs leading-none px-1 disabled:opacity-40">×</button>
        )}
      </div>

      <div className="flex gap-3">
        {/* The render itself once there is one, so the board reads as a
            storyboard rather than a form. Hover previews the movement; click
            opens it at a size you can actually judge. */}
        <button type="button" disabled={!ready} onClick={() => onPreview(row, index)}
          title={ready ? 'Watch this clip' : undefined}
          className={`w-24 h-24 flex-shrink-0 border border-border bg-surface-subtle flex items-center justify-center overflow-hidden ${
            ready ? 'hover:border-amber-400 cursor-pointer' : 'cursor-default'
          }`}>
          {row?.video_url
            ? <video src={row.video_url} className="w-full h-full object-cover" muted playsInline controls={false}
                onMouseEnter={e => e.currentTarget.play().catch(() => {})}
                onMouseLeave={e => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }} />
            : state === 'pending'
              ? <Spinner size="sm" />
              : <span className="text-[10px] text-text-tertiary text-center px-1">No take yet</span>}
        </button>

        <div className="flex-1 min-w-0 space-y-2">
          <Textarea rows={2} autoGrow value={clip.prompt} disabled={disabled}
            onChange={e => onPatch(index, { prompt: e.target.value })}
            placeholder={index === 0 ? 'What happens in the opening shot?' : 'What happens in this shot?'} />

          <div className="flex flex-wrap items-center gap-2">
            <select value={clip.duration} disabled={disabled}
              onChange={e => onPatch(index, { duration: e.target.value })}
              className="text-[11px] bg-white border border-border px-2 py-1 focus:outline-none focus:border-amber-400">
              {model.durations.map(d => <option key={d} value={d}>{d}s</option>)}
            </select>

            {model.resolutions && (
              <select value={clip.resolution} disabled={disabled}
                onChange={e => onPatch(index, { resolution: e.target.value })}
                className="text-[11px] bg-white border border-border px-2 py-1 focus:outline-none focus:border-amber-400">
                {model.resolutions.map(q => <option key={q.value} value={q.value}>{q.label} · {q.value}</option>)}
              </select>
            )}

            <input type="text" value={clip.motion} disabled={disabled}
              onChange={e => onPatch(index, { motion: e.target.value })}
              placeholder="Camera move (optional)"
              className="flex-1 min-w-[8rem] text-[11px] bg-white border border-border px-2 py-1 focus:outline-none focus:border-amber-400" />
          </div>

          {/* What the model is SENT, which is never what was typed: the look
              preset, the style bible and the continuity line are all folded in
              on the way out. Collapsed, because it's only wanted when a shot
              keeps coming back wrong — and then it's the first thing to read. */}
          {clip.prompt.trim() && (
            <details className="group">
              <summary className="text-[10px] text-text-tertiary cursor-pointer hover:text-text-secondary list-none marker:content-['']">
                <span className="group-open:hidden">▸ See the exact prompt this shot renders with</span>
                <span className="hidden group-open:inline">▾ The exact prompt this shot renders with</span>
              </summary>
              <p className="mt-1 text-[10px] text-text-secondary bg-surface-subtle border border-border p-2 whitespace-pre-wrap leading-snug">
                {promptText}
              </p>
            </details>
          )}

          {row?.status === 'failed' && row.error && (
            <p className="text-[10px] text-red-600 leading-snug">{row.error}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── The board ──────────────────────────────────────────────────────────────
export function ClipBoard({
  storyboard, clipRows, versions, states, activeIndex, running, allReady, stitchRow, stitching,
  preparingClipId,
  onPatchClip, onPatchBoard, onAddClip, onRemoveClip,
  onStart, onStop, onRetryClip, onRerenderClip, onStitch, onAddRef, onRemoveRef,
  onOpenClip, onDownloadStitch,
}) {
  const [confirming, setConfirming] = useState(false)
  // Which clip a re-render is being confirmed for. A number, not a boolean —
  // the dialog names the shot and its downstream damage.
  const [rerendering, setRerendering] = useState(null)
  // { url, kind } — a still handed between clips, or a clip played at size.
  const [preview, setPreview] = useState(null)

  const model = getVideoModel(storyboard.model)
  const totals = storyboardTotals(storyboard)
  const clips = storyboard.clips
  const locked = running
  // A clip that already has a take can't be removed: clip_index is positional,
  // so deleting one re-labels every rendered clip after it. Re-render freely,
  // append freely, delete only what hasn't been paid for.
  const renderedCount = clipRows.filter(Boolean).length
  const stale = staleSeams(storyboard, clipRows, versions)

  // What pressing the button ACTUALLY costs, which is not the board total once
  // some clips are already rendered — a Continue after four of six shots is a
  // third of the price, and quoting the full figure would train people to
  // ignore it.
  // The longest single render this model can produce — durations are listed
  // shortest-first in the catalog, so the ceiling is the last one.
  const maxSingleTake = Number(model.durations[model.durations.length - 1]) || 0

  const pending = clips.filter((_, i) => states[i] !== 'ready')
  const pendingCost = pending.reduce(
    (sum, c) => sum + estimateVideoCost(model.id, { resolution: c.resolution, duration: c.duration, audio: !!storyboard.audio }),
    0,
  )

  // The re-render dialog's two facts: the price, and what it strands.
  const rerenderClip = rerendering == null ? null : clips[rerendering]
  const rerenderCost = rerenderClip
    ? estimateVideoCost(model.id, { resolution: rerenderClip.resolution, duration: rerenderClip.duration, audio: !!storyboard.audio })
    : 0
  const stranded = rerendering == null ? [] : chainedAfter(storyboard, rerendering).filter(i => clipRows[i])

  return (
    <div className="space-y-3">
      {/* ── Shared across every clip ── */}
      <div className="border border-border bg-white p-3 space-y-3">
        <p className="text-xs font-semibold text-text">Shared by every clip</p>

        <ModelPicker modelId={storyboard.model} onPick={id => onPatchBoard({ model: id })} />

        <LookPicker lookId={storyboard.lookId} onPick={id => onPatchBoard({ lookId: id })} />

        <div>
          <p className="text-xs font-medium text-text-secondary mb-1.5">
            Style bible
            <span className="font-normal text-text-tertiary"> — repeated into every clip's prompt</span>
          </p>
          <Textarea rows={3} autoGrow value={storyboard.styleBible}
            onChange={e => onPatchBoard({ styleBible: e.target.value })}
            placeholder={STYLE_BIBLE_PLACEHOLDER} />
        </div>

        <MultiRefRow label="Style references (new shots only)" items={storyboard.sharedRefs}
          max={9} onRemove={onRemoveRef} onAdd={onAddRef} />

        {model.audio === 'unsupported' ? (
          <p className="text-[11px] text-text-tertiary">{model.label} doesn't generate audio.</p>
        ) : (
          <div>
            <Toggle checked={!!storyboard.audio} onChange={e => onPatchBoard({ audio: e.target.checked })}
              label={model.audio === 'paid' ? 'Generate sound too (adds to the cost)' : 'Generate sound too (free)'} />
            {/* Off by default and worth saying why — a handed-over last frame
                carries no audio state, so each clip invents its own ambience. */}
            <p className="text-[10px] text-text-tertiary mt-1 leading-snug">
              Left off for multi-clip: each clip would invent its own ambience, so every seam gets an audible jump.
              Lay one track over the finished reel instead.
            </p>
          </div>
        )}
      </div>

      {/* ── The shots ── */}
      <div className="space-y-1">
        {clips.map((clip, i) => (
          <div key={clip.key}>
            {i > 0 && (
              <Seam clip={clip} index={i} onPatch={onPatchClip} disabled={locked}
                startFrameUrl={clipRows[i]?.image_url || ''}
                sharedRefs={storyboard.sharedRefs || []}
                stale={stale.has(i)}
                onPreviewFrame={url => setPreview({ url, kind: 'image' })} />
            )}
            <ClipCard
              clip={clip} index={i} row={clipRows[i]} state={states[i]} model={model}
              audio={!!storyboard.audio} active={activeIndex === i && running}
              promptText={clipPromptFor(storyboard, i)}
              preparing={preparingClipId && preparingClipId === clipRows[i]?.id}
              onPatch={onPatchClip} onRemove={onRemoveClip} onRetry={onRetryClip}
              onRerender={setRerendering} onAddText={onOpenClip}
              onPreview={row => setPreview({ url: row.video_url, kind: 'video', index: i })}
              canRemove={clips.length > 1 && !clipRows[i]} disabled={locked} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onAddClip}
          disabled={locked || clips.length >= MULTI_CLIP_MAX}>
          + Add clip
        </Button>
        <span className="text-[10px] text-text-tertiary">
          {clips.length}/{MULTI_CLIP_MAX} clips
          {clips.length >= MULTI_CLIP_MAX && ' — the most the stitcher will assemble at once'}
        </span>
      </div>

      {/* ── Totals + the expensive button ── */}
      <div className="border border-border bg-surface-subtle p-3 space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="text-xs text-text-secondary">
            Finished length <span className="font-semibold text-text">{totals.seconds.toFixed(1)}s</span>
            {totals.seconds !== totals.rawSeconds && (
              <span className="text-text-tertiary"> ({totals.rawSeconds}s of footage, crossfades overlap)</span>
            )}
          </p>
          <p className="text-xs text-text-secondary">
            Cost to render all <span className="font-semibold text-text">{money(totals.cost)}</span>
          </p>
        </div>

        {/* What splitting the video ACTUALLY buys, which depends on the length.
            An earlier version of this line quoted "one single render would
            cost X" as if that were a saving — it isn't: every model here
            prices per second, so the same footage costs the same whether it
            arrives as one clip or six. The saving comes from picking a cheaper
            MODEL, which is the picker above, not from splitting. Past the
            model's ceiling the argument isn't money at all — it's that a
            single render cannot produce the length. */}
        {totals.count > 1 && (
          <p className="text-[10px] text-text-tertiary leading-snug">
            {totals.rawSeconds > maxSingleTake
              ? `${model.label} renders at most ${maxSingleTake}s in one take, so ${Math.round(totals.rawSeconds)}s can only be built as separate clips.`
              : `${Math.round(totals.rawSeconds)}s would also fit in one ${maxSingleTake}s render on ${model.label} — clips are for directing each shot separately, and they cost the same per second.`}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {running ? (
            <>
              <Button size="sm" variant="danger" onClick={onStop}>Stop after this clip</Button>
              <span className="text-[11px] text-text-secondary inline-flex items-center gap-1.5">
                <Spinner size="sm" /> Rendering clip {activeIndex + 1} of {clips.length}
              </span>
            </>
          ) : allReady ? (
            // Nothing left to spend on. A disabled "Render the remaining
            // 0 · $0.00" was technically correct and read like a stuck
            // button — every clip really is done, so say that instead.
            <span className="text-[11px] text-emerald-700 font-medium">✓ Every clip is rendered</span>
          ) : (
            // The cost is ON the button, not only in the dialog behind it.
            // This is the most expensive control in the app and the amount
            // changes with every length and quality tweak above it.
            <Button size="sm" onClick={() => setConfirming(true)}
              disabled={!clips.some(c => c.prompt.trim()) || pending.length === 0}>
              {renderedCount > 0
                ? `▶ Render the remaining ${pending.length} · ${money(pendingCost)}`
                : `▶ Render all ${clips.length} clips · ${money(pendingCost)}`}
            </Button>
          )}

          <Button size="sm" variant="secondary" onClick={onStitch}
            disabled={!allReady || running || stitching}>
            {stitching ? <><Spinner size="sm" /> Stitching…</> : '🎞 Stitch into one video'}
          </Button>
        </div>

        {!allReady && renderedCount > 0 && !running && (
          <p className="text-[10px] text-text-tertiary">
            Stitching needs every clip rendered — {renderedCount} of {clips.length} so far.
          </p>
        )}

        {allReady && stale.size > 0 && (
          <p className="text-[10px] text-amber-700 leading-snug">
            {stale.size === 1 ? 'One seam' : `${stale.size} seams`} above no longer connect after a re-render.
            Stitching now would put a visible jump where a continuous move was intended.
          </p>
        )}
      </div>

      {/* Real money, spent by one click, and nothing recovers it once fal has
          run. The dialog names the amount and the shot count rather than
          asking "are you sure" — the number is the thing worth reading. */}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={onStart}
        title={renderedCount > 0 ? 'Render the rest?' : 'Render the storyboard?'}
        message={
          `This renders ${pending.length} clip${pending.length === 1 ? '' : 's'} on ${model.label} ` +
          `and costs about ${money(pendingCost)}. They render one at a time, so if one fails the run ` +
          `stops there rather than paying for the rest.`
        }
      />

      {/* A re-render is a second full charge for one shot, and — if anything
          continues from it — it silently invalidates those takes too. Both
          facts belong in front of the click, not after it. */}
      <ConfirmDialog
        open={rerendering != null}
        onClose={() => setRerendering(null)}
        onConfirm={() => { const i = rerendering; setRerendering(null); onRerenderClip(i) }}
        title={`Render clip ${(rerendering ?? 0) + 1} again?`}
        message={
          `This is a fresh take on ${model.label} and costs another ${money(rerenderCost)}. ` +
          'The current take is kept — you can compare them.' +
          (stranded.length
            ? ` Clip${stranded.length === 1 ? '' : 's'} ${stranded.map(i => i + 1).join(' and ')} ` +
              `continue${stranded.length === 1 ? 's' : ''} from this one, and ` +
              `${stranded.length === 1 ? 'its take was' : 'their takes were'} generated from the frame this shot ends on today. ` +
              `Re-rendering here leaves ${stranded.length === 1 ? 'that seam' : 'those seams'} broken until you re-render ` +
              `${stranded.length === 1 ? 'it' : 'them'} too — the board will flag which.`
            : '')
        }
      />

      {/* ── The reel ── */}
      {stitchRow && (
        <div className="border border-border bg-white p-3 space-y-2">
          <div className="flex items-center gap-2">
            <StateDot state={stitchRow.status === 'ready' ? 'ready' : stitchRow.status === 'failed' ? 'failed' : 'pending'} />
            <p className="text-xs font-semibold text-text">The reel</p>
            <div className="flex-1" />
            {stitchRow.status === 'ready' && (
              <>
                <Button size="xs" variant="secondary" onClick={() => onOpenClip(stitchRow)}>✏️ Add text</Button>
                <Button size="xs" variant="secondary" onClick={() => onDownloadStitch(stitchRow)}>⬇ Download</Button>
              </>
            )}
          </div>
          {stitchRow.status === 'ready' && stitchRow.video_url && (
            // Muted on load. Half these reels are stitched from a model that
            // generates no audio at all, so the only thing unmuting buys is a
            // room full of sound nobody asked for; the controls are right there.
            <video src={stitchRow.video_url} controls muted playsInline className="w-full max-h-96 bg-black" />
          )}
          {stitchRow.status === 'pending' && (
            // A div, not a p: Spinner renders a div, and a div inside a p is
            // invalid HTML that React logs as a hydration error on every paint.
            <div className="text-[11px] text-text-tertiary inline-flex items-center gap-1.5">
              <Spinner size="sm" /> Re-encoding every clip to a common shape, then joining them. Takes a minute or two.
            </div>
          )}
          {stitchRow.status === 'failed' && (
            <p className="text-[11px] text-red-600 leading-snug">{stitchRow.error || 'The stitch failed.'}</p>
          )}
        </div>
      )}

      {/* Judging a take from a 96px thumbnail is not judging it. */}
      <Modal open={!!preview} onClose={() => setPreview(null)} width="max-w-3xl"
        title={preview?.kind === 'video' ? `Clip ${(preview.index ?? 0) + 1}` : 'The frame handed to the next clip'}>
        {preview?.kind === 'video'
          ? <video src={preview.url} controls muted autoPlay playsInline className="w-full max-h-[70vh] bg-black" />
          : <img src={preview?.url} alt="" className="w-full max-h-[70vh] object-contain bg-black" />}
      </Modal>
    </div>
  )
}
