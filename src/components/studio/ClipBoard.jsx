import { useState } from 'react'
import { Button, ConfirmDialog, Modal, Spinner, Textarea, Toggle } from '../ui/index'
import { MultiRefRow } from './MediaPicker'
import { LookPicker, ModelPicker } from './VideoSettings'
import { STYLE_BIBLE_PLACEHOLDER } from './motionPresets'
import { getVideoModel, estimateVideoCost, modelImageMax, modelImageRole } from './videoModels'
import {
  MULTI_CLIP_MAX, canMoveClip, chainedAfter, clipImagePlan, clipPromptFor, staleSeams,
  storyboardTotals,
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
//  · IMAGES are both. A board-wide set for the look, plus a per-shot set for
//    "this shot features THAT product".

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
function Seam({ clip, index, startFrameUrl, stale, onPatch, onPreviewFrame, disabled }) {
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
      </div>

      {/* Chaining is the one mechanism here that fails invisibly: a chained
          clip is generated from ONE still grabbed a hair before the previous
          clip ends, and when that grab lands on a motion-blurred frame the
          only symptom is "this shot looks wrong". It's already uploaded and
          already on the row, so show it. */}
      {continues && (
        <div className="flex items-center gap-2">
          {startFrameUrl ? (
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
          )}
        </div>
      )}

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

// ── What this shot is built from, in the shot's own words ──────────────────
// The three cases differ in a way nobody can guess from the UI, and getting it
// wrong is expensive: images handed to a model with no reference endpoint used
// to be dropped in silence, at full price.
function ImageNote({ plan, model, index }) {
  if (plan.mode === 'chained') {
    return (
      <p className="text-[10px] text-text-tertiary leading-snug">
        Continues from clip {index}, so it starts on that clip's last frame — images can't be added
        to a continued shot.
      </p>
    )
  }
  if (plan.mode === 'references') {
    return (
      <p className="text-[10px] text-text-tertiary leading-snug">
        {model.label} reads these as style references — describe them in the prompt
        (“@Image1 is the fixture”) or it treats them as loose inspiration.
      </p>
    )
  }
  return (
    <p className="text-[10px] text-text-tertiary leading-snug">
      {model.label} has no reference mode, so the first image becomes this shot's
      <span className="font-medium"> opening frame</span> and the prompt says what happens to it.
    </p>
  )
}

// ── One shot ───────────────────────────────────────────────────────────────
function ClipCard({
  clip, index, row, state, model, audio, active, promptText, preparing, plan,
  canRender, renderBlockedWhy, busy,
  onPatch, onRemove, onRender, onCancel, onAddText, onPreview, onMove, onAddRef, onRemoveRef,
  canRemove, canUp, canDown, disabled,
}) {
  const cost = estimateVideoCost(model.id, { resolution: clip.resolution, duration: clip.duration, audio })
  const ready = state === 'ready' && !!row?.video_url
  const pending = state === 'pending'
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

        {/* Reorder. Only between two shots that have no take: clip_index is
            positional and rendered rows are keyed by it, so moving a rendered
            clip would quietly relabel finished footage. */}
        <div className="flex">
          <button type="button" onClick={() => onMove(index, index - 1)} disabled={disabled || !canUp}
            title={canUp ? 'Move up' : 'Only shots with no take can be reordered'}
            className="text-text-tertiary hover:text-text text-[10px] leading-none px-1 disabled:opacity-25">▲</button>
          <button type="button" onClick={() => onMove(index, index + 1)} disabled={disabled || !canDown}
            title={canDown ? 'Move down' : 'Only shots with no take can be reordered'}
            className="text-text-tertiary hover:text-text text-[10px] leading-none px-1 disabled:opacity-25">▼</button>
        </div>

        <div className="flex-1" />

        {pending && (
          // Real money is in flight. Whether cancelling saves it depends on
          // whether fal has started, which we can't know from here — the
          // dialog behind this says so rather than promising a refund.
          <Button size="xs" variant="secondary" onClick={() => onCancel(index)}>✕ Cancel</Button>
        )}
        {ready && (
          <>
            <Button size="xs" variant="secondary" onClick={() => onAddText(row)} disabled={disabled || !!preparing}>
              {preparing ? <><Spinner size="sm" /> Opening…</> : '✏️ Text'}
            </Button>
            <Button size="xs" variant="secondary" onClick={() => onRender(index)} disabled={busy}>
              ↻ Re-render · {money(cost)}
            </Button>
          </>
        )}
        {!ready && !pending && (
          // One shot at a time, without committing to the whole board. The
          // price is on the button for the same reason it is on Render all.
          <Button size="xs" onClick={() => onRender(index)} disabled={busy || !canRender || !clip.prompt.trim()}
            title={renderBlockedWhy || undefined}>
            {state === 'failed' ? '↻ Try again' : '▶ Render'} · {money(cost)}
          </Button>
        )}
        {canRemove && (
          <button type="button" onClick={() => onRemove(index)} disabled={disabled}
            title="Remove this clip"
            className="text-text-tertiary hover:text-red-500 text-xs leading-none px-1 disabled:opacity-40">×</button>
        )}
      </div>

      {!ready && !pending && !canRender && renderBlockedWhy && (
        <p className="text-[10px] text-text-tertiary">{renderBlockedWhy}</p>
      )}

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
            : pending
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

          {/* Images for this shot alone. Hidden on a chained clip, which has
              already spent its one image slot on the previous clip's tail. */}
          {plan.mode !== 'chained' && (
            <div className="space-y-1">
              <MultiRefRow
                label={plan.mode === 'references' ? 'References for this shot' : 'Start this shot from an image'}
                items={clip.refs || []} max={modelImageMax(model.id)}
                onAdd={(clip.refs || []).length < modelImageMax(model.id) ? () => onAddRef(index) : null}
                onRemove={n => onRemoveRef(index, n)} />
              <ImageNote plan={plan} model={model} index={index} />
            </div>
          )}
          {plan.mode === 'chained' && <ImageNote plan={plan} model={model} index={index} />}

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
  storyboard, clipRows, versions, states, activeIndex, running, allReady, busy,
  stitchRow, stitching, preparingClipId, runStatus,
  onPatchClip, onPatchBoard, onAddClip, onRemoveClip, onMoveClip,
  onStart, onStop, onRenderClip, onCancelClip, onStitch,
  onAddRef, onRemoveRef, onAddClipRef, onRemoveClipRef,
  onOpenClip, onDownloadStitch, onUseThis,
}) {
  const [confirming, setConfirming] = useState(false)
  // Which clip a re-render is being confirmed for. A number, not a boolean —
  // the dialog names the shot and its downstream damage.
  const [rerendering, setRerendering] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  // { url, kind } — a still handed between clips, or a clip played at size.
  const [preview, setPreview] = useState(null)

  const model = getVideoModel(storyboard.model)
  const totals = storyboardTotals(storyboard)
  const clips = storyboard.clips
  const locked = running
  const renderedCount = clipRows.filter(Boolean).length
  const stale = staleSeams(storyboard, clipRows, versions)

  // What pressing the button ACTUALLY costs, which is not the board total once
  // some clips are already rendered — a Continue after four of six shots is a
  // third of the price, and quoting the full figure would train people to
  // ignore it.
  const maxSingleTake = Number(model.durations[model.durations.length - 1]) || 0

  const pending = clips.filter((_, i) => states[i] !== 'ready')
  const pendingCost = pending.reduce(
    (sum, c) => sum + estimateVideoCost(model.id, { resolution: c.resolution, duration: c.duration, audio: !!storyboard.audio }),
    0,
  )

  // A shot with no description still renders — it just goes out carrying the
  // style bible and nothing else, and comes back as an expensive continuation
  // of whatever preceded it. That happened for real on 2026-08-12 and read as
  // a model problem rather than an empty box, because nothing on the board
  // said the box was empty. Render-all used to require only that SOME clip had
  // a prompt; it now names the ones that don't.
  const blank = clips
    .map((c, i) => (states[i] !== 'ready' && !c.prompt.trim() ? i + 1 : 0))
    .filter(Boolean)

  // A chained shot cannot be rendered before the shot it continues from —
  // there would be no frame to start it on. This is what keeps "render them
  // one at a time" honest about order.
  const renderBlock = i => {
    if (!clips[i]?.continueFromPrevious || i === 0) return ''
    return states[i - 1] === 'ready'
      ? ''
      : `Continues from clip ${i}, so clip ${i} has to render first.`
  }

  const rerenderClip = rerendering == null ? null : clips[rerendering]
  const rerenderCost = rerenderClip
    ? estimateVideoCost(model.id, { resolution: rerenderClip.resolution, duration: rerenderClip.duration, audio: !!storyboard.audio })
    : 0
  const stranded = rerendering == null ? [] : chainedAfter(storyboard, rerendering).filter(i => clipRows[i])

  // The run died with work outstanding — a closed tab, a failure, a cancel.
  // Only worth saying when the board can't already be read as finished.
  const showStopped = !running && !allReady && renderedCount > 0
    && (runStatus === 'running' || runStatus === 'paused')

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

        <div className="space-y-1">
          <MultiRefRow label="Images for every new shot" items={storyboard.sharedRefs}
            max={9} onRemove={onRemoveRef} onAdd={onAddRef} />
          {/* Said out loud because it was silently untrue for three of the
              five models: only Seedance has a reference endpoint, and the
              others discarded these images at full price without an error. */}
          <p className="text-[10px] text-text-tertiary leading-snug">
            {modelImageRole(model.id) === 'references'
              ? `${model.label} takes these as style references on any shot that isn't continued.`
              : `${model.label} has no reference mode — on a new shot the first image is used as its opening frame instead. A shot's own image, set below, is used before these.`}
          </p>
        </div>

        {model.audio === 'unsupported' ? (
          <p className="text-[11px] text-text-tertiary">{model.label} doesn't generate audio.</p>
        ) : (
          <div>
            <Toggle checked={!!storyboard.audio} onChange={e => onPatchBoard({ audio: e.target.checked })}
              label={model.audio === 'paid' ? 'Generate sound too (adds to the cost)' : 'Generate sound too (free)'} />
            <p className="text-[10px] text-text-tertiary mt-1 leading-snug">
              Left off for multi-clip: each clip would invent its own ambience, so every seam gets an audible jump.
              Lay one track over the finished reel instead.
            </p>
          </div>
        )}
      </div>

      {showStopped && (
        <div className="border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-[11px] text-amber-900 leading-snug">
            This run stopped with {pending.length} shot{pending.length === 1 ? '' : 's'} left — a closed tab,
            a failure or a cancel. Nothing is rendering now, and nothing restarts on its own.
            Pick it up with the button below, or render a single shot from its own card.
          </p>
        </div>
      )}

      {/* ── The shots ── */}
      <div className="space-y-1">
        {clips.map((clip, i) => {
          const plan = clipImagePlan(storyboard, i)
          const why = renderBlock(i)
          return (
            <div key={clip.key}>
              {i > 0 && (
                <Seam clip={clip} index={i} onPatch={onPatchClip} disabled={locked}
                  startFrameUrl={clipRows[i]?.image_url || ''}
                  stale={stale.has(i)}
                  onPreviewFrame={url => setPreview({ url, kind: 'image' })} />
              )}
              <ClipCard
                clip={clip} index={i} row={clipRows[i]} state={states[i]} model={model}
                audio={!!storyboard.audio} active={activeIndex === i && states[i] === 'pending'}
                promptText={clipPromptFor(storyboard, i)}
                preparing={preparingClipId && preparingClipId === clipRows[i]?.id}
                plan={plan} canRender={!why} renderBlockedWhy={why} busy={busy}
                onPatch={onPatchClip} onRemove={onRemoveClip}
                onRender={idx => (clipRows[idx] ? setRerendering(idx) : onRenderClip(idx))}
                onCancel={setCancelling}
                onAddText={onOpenClip}
                onPreview={row => setPreview({ url: row.video_url, kind: 'video', index: i })}
                onMove={onMoveClip}
                onAddRef={onAddClipRef} onRemoveRef={onRemoveClipRef}
                canRemove={clips.length > 1 && !clipRows[i]}
                canUp={canMoveClip(clipRows, i, i - 1)}
                canDown={canMoveClip(clipRows, i, i + 1)}
                disabled={locked} />
            </div>
          )
        })}
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
            Every model here prices per second, so the same footage costs the
            same whether it arrives as one clip or six — the saving comes from
            picking a cheaper MODEL. Past the model's ceiling the argument
            isn't money at all: a single render cannot produce the length. */}
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
            <span className="text-[11px] text-emerald-700 font-medium">✓ Every clip is rendered</span>
          ) : (
            <Button size="sm" onClick={() => setConfirming(true)}
              disabled={busy || blank.length > 0 || pending.length === 0}>
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

        {blank.length > 0 && !running && (
          <p className="text-[10px] text-amber-700 leading-snug">
            {blank.length === 1 ? `Clip ${blank[0]} has` : `Clips ${blank.join(', ')} have`} no description yet.
            A shot with an empty box still costs full price and comes back as more of the shot before it —
            say what happens in {blank.length === 1 ? 'it' : 'them'} first.
          </p>
        )}

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
          continues from it — it silently invalidates those takes too. */}
      <ConfirmDialog
        open={rerendering != null}
        onClose={() => setRerendering(null)}
        onConfirm={() => { const i = rerendering; setRerendering(null); onRenderClip(i) }}
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

      {/* Cancelling is not a refund and the dialog must not imply one. fal
          only drops a request still sitting in its queue; once generation has
          started the money is gone whatever we send. */}
      <ConfirmDialog
        open={cancelling != null}
        onClose={() => setCancelling(null)}
        danger
        onConfirm={() => { const i = cancelling; setCancelling(null); onCancelClip(i) }}
        title={`Cancel clip ${(cancelling ?? 0) + 1}?`}
        message={
          'This asks fal to drop the render and frees the board straight away. It only avoids the ' +
          'charge if the job is still queued — once fal has started generating, that take is paid for ' +
          'either way. The run stops here rather than moving on to the next shot.'
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
                {/* The finished long video's way out. It is the stitch row —
                    not any single clip — that is the deliverable here, which
                    is why this lives on this row and nowhere else on the
                    board: sending one shot of a five-shot reel would be a
                    quietly wrong post rather than an obvious mistake. */}
                {onUseThis && (
                  <Button size="xs" onClick={() => onUseThis(stitchRow)}
                    title="Turn this finished video into a post — pick the platforms, get a caption, then queue, schedule or publish it">
                    Use this →
                  </Button>
                )}
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
