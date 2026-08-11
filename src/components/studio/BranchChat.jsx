import { useEffect, useRef, useState } from 'react'
import { Button, Spinner } from '../ui/index'
import { PROVIDER_LABEL, labelFor } from './labels'

// ─── One candidate's own workspace ─────────────────────────────────────────
// The ChatGPT image and the Gemini image are not two options to choose
// between once — they're two threads that stay alive side by side, each with
// its own chat box, so the same brief can be pushed in two directions and
// compared at every step instead of only at the first.
//
// Rebuilt 2026-08-10 around a fixed frame instead of a scrolling transcript.
// The old shape put an overflow-y-auto lane inside the page's own scroll:
// three nested scroll areas, so the wheel did something different depending
// on where the pointer happened to be, and reaching a lane's end chained the
// scroll to the page underneath (the "bounce"). Worse, a 4:5 portrait at the
// lane's width was taller than the box it lived in, so the picture could
// never be seen whole — the one thing this screen exists to let you judge.
//
// Now: the frame is sized in vh so the image always fits inside it entirely,
// every past version is a thumbnail on one strip below it, and clicking the
// picture opens it full-screen to inspect properly. Nothing inside a lane
// scrolls vertically any more.

const DRAG_MIME = 'application/x-arak-version'

// A past version, as one square on the strip. Deliberately uniform: the strip
// is for navigating, and letting each thumb keep its own aspect ratio turns a
// row of them into a ragged edge that's harder to scan.
function Thumb({ version, step, active, onClick, onRetry, retrying }) {
  const failed = version.status === 'failed'
  const pending = version.status === 'pending'
  return (
    <button type="button" onClick={onClick} title={version.user_prompt || labelFor(version) || ''}
      className={`relative w-11 h-11 flex-shrink-0 overflow-hidden border-2 transition-colors ${
        active ? 'border-amber-500' : failed ? 'border-red-200' : 'border-border hover:border-amber-300'
      }`}>
      {/* The strip is the conversation's running order, so it's numbered.
          Without this a row of near-identical edits gives no clue which came
          first — the one thing the old transcript was genuinely good at. */}
      <span className={`absolute top-0 left-0 z-10 px-1 text-[9px] font-bold leading-tight ${
        active ? 'bg-amber-500 text-white' : 'bg-black/55 text-white'
      }`}>{step}</span>
      {pending ? (
        <span className="w-full h-full flex items-center justify-center bg-surface-subtle text-text-tertiary"><Spinner size="sm" /></span>
      ) : failed ? (
        <span className="w-full h-full flex items-center justify-center bg-red-50 text-red-500 text-xs font-bold">!</span>
      ) : version.media_type === 'video' ? (
        <>
          <video src={version.video_url} className="w-full h-full object-cover" muted />
          <span className="absolute inset-0 flex items-center justify-center text-white text-[10px] bg-black/25">▶</span>
        </>
      ) : (
        <img src={version.image_url} alt="" className="w-full h-full object-cover" />
      )}
      {failed && onRetry && (
        <span onClick={e => { e.stopPropagation(); onRetry(version) }}
          className="absolute inset-x-0 bottom-0 bg-red-600 text-white text-[8px] font-bold py-0.5">
          {retrying ? '…' : 'RETRY'}
        </span>
      )}
    </button>
  )
}

export function BranchChat({
  branch,
  composer,                // { text, baseId, attach }
  split,                   // both lanes visible — drives the frame height
  busy,                    // '' | 'edit' | 'video' | 'finalize' — lane-level
  // The raw busy key, for actions scoped to ONE version rather than the lane
  // (download, retry). laneBusy() strips these to a bare label and only
  // matches on the branch root, so a per-version spinner can't read `busy`.
  pendingKey = '',
  onChange,                // (patch) => void
  onSend,
  onActivate,              // typing in a lane focuses it
  onAnimate,               // still → clip. Costs a render.
  onReRender,              // optional: re-run a past render against the current base
  onEditClip,              // text/logos onto a finished clip. Free — ffmpeg, no model.
  reRenderCost,            // (version) => dollars, shown on the button BEFORE the click
  preparingClip = '',      // version id whose first frame is being read
  onOpenEditor,
  onFinalize,
  onDownload,              // downloads the file AND files it in the library if it isn't already
  onRetry,                 // re-run a failed version against the same prompt
  onAttach,                // opens a picker (upload / Media Library) for this lane's composer
  onZoom,                  // opens the full-screen viewer at this version
}) {
  const [dragOver, setDragOver] = useState(false)
  // Which version's instruction is expanded, rather than a bare boolean:
  // keying it to the id means moving along the strip collapses the previous
  // one on its own, with no effect needed to reset it.
  const [expandedId, setExpandedId] = useState(null)
  const composerRef = useRef(null)
  const stripRef = useRef(null)

  const { text = '', baseId = null, attach = null } = composer || {}

  const ready = branch.versions.filter(v => v.status === 'ready')
  const newest = branch.versions[branch.versions.length - 1] || null
  const picked = branch.versions.find(v => v.id === baseId) || null
  // The frame shows whatever was clicked on the strip, else the newest
  // result — including a video, because a render that just finished is the
  // thing you want to watch, not something to go hunting for.
  //
  // Newest of ALL versions, not just the ready ones. Filtering to ready meant
  // a lane whose only render failed had no stage at all, so it fell through to
  // the bare "Working…" spinner below and sat there forever — no error, no
  // reason, no Retry, because both the failed branch and the pending branch's
  // "this is taking too long" escape hatch need a stage to render against.
  const stage = picked || newest
  // An instruction always acts on a STILL: you edit the image and re-animate,
  // because no model edits a finished clip. So selecting a video to watch
  // doesn't drag the conversation onto something it can't act on.
  const base = picked && picked.media_type !== 'video' && picked.status === 'ready'
    ? picked
    : branch.latest

  const isOlderBase = !!base && !!branch.latest && base.id !== branch.latest.id
  const baseLabel = PROVIDER_LABEL[branch.provider] || labelFor(branch.root) || 'Option'
  // buildBranches numbers lanes only when one model produced several
  // candidates this round, so a plain 1-vs-1 round stays "ChatGPT", not "ChatGPT 1".
  const label = branch.variantIndex ? `${baseLabel} ${branch.variantIndex}` : baseLabel
  const canAct = !!base && base.status === 'ready'
  const stageIsVideo = stage?.media_type === 'video' && !!stage?.video_url
  // Shown faintly behind a pending render so the lane isn't a blank rectangle
  // while the next version is on its way — the last thing that actually
  // rendered, which is not the same as the stage now that stage can be a
  // pending or failed row.
  const prevReady = ready[ready.length - 1] || null

  // Ticks only while this lane has something in flight. A render that dies
  // between fal and the database leaves the row 'pending' with nobody left to
  // change it, and without a clock the card has no way to ever notice.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!branch.pending) return
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [branch.pending])
  const STALE_MS = 5 * 60 * 1000
  const stale = stage?.status === 'pending' && !!stage.created_at &&
    now - new Date(stage.created_at).getTime() > STALE_MS

  // Claude/ChatGPT-style grow-with-content. Keyed on `text` (not just
  // onChange) so it also shrinks back down when Send clears the composer.
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [text])

  // Keep the newest work in view on the strip — it grows rightwards, and the
  // version you just made is the one you want to see land.
  useEffect(() => {
    const el = stripRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [branch.versions.length])

  function handleDragStart(e, version) {
    const payload = JSON.stringify({
      versionId: version.id, url: version.image_url,
      branchId: branch.rootId, label: labelFor(version) || label,
      // Carried so that choosing "edit this one instead" on a dropped image
      // edits it with the model that actually made it, rather than this
      // lane's model.
      provider: version.provider || branch.provider || '',
    })
    e.dataTransfer.setData(DRAG_MIME, payload)
    e.dataTransfer.setData('text/plain', version.image_url)
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    let dropped
    try { dropped = JSON.parse(raw) } catch { return }
    // Dropping a lane's image back into itself is a no-op, not an error —
    // it's the most likely misfire of the gesture.
    if (!dropped.url || dropped.branchId === branch.rootId) return
    onChange({ attach: { ...dropped, mode: 'reference' } })
    onActivate()
  }

  // The LANE is the fixed thing, not the frame. Everything inside it comes
  // and goes — a caption that only edits have, the earlier-version warning,
  // a strip that appears at version two, action buttons that wrap at narrow
  // widths — and when the lane sized itself to its contents, every one of
  // those made the whole box jump and put the two lanes at different heights.
  // Pinning the lane and letting the picture absorb the slack keeps the
  // outside perfectly still while the inside changes.
  const laneH = split ? 'h-[72vh] min-h-[520px]' : 'h-[78vh] min-h-[560px]'

  return (
    <div className={`border border-border bg-surface flex flex-col ${laneH}`}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">{label}</p>
        <div className="flex items-center gap-2">
          {branch.pending && (
            <span className="text-[10px] text-text-tertiary flex items-center gap-1.5"><Spinner size="sm" /> working…</span>
          )}
          {ready.length > 1 && stage && ready.indexOf(stage) >= 0 && (
            <span className="text-[10px] text-text-tertiary tabular-nums">{ready.indexOf(stage) + 1}/{ready.length}</span>
          )}
        </div>
      </div>

      {/* ── Frame ── */}
      {/* flex-1 + min-h-0: this is the part that gives, so anything appearing
          below it shrinks the picture slightly instead of resizing the lane. */}
      <div className="group relative flex-1 min-h-0 bg-stone-50 flex items-center justify-center overflow-hidden">
        {!stage ? (
          <div className="flex flex-col items-center gap-2 text-text-tertiary">
            <Spinner />
            <p className="text-[11px]">Working…</p>
          </div>
        ) : stage.status === 'pending' ? (
          // A pending row has no image_url yet. This used to fall through to
          // the <img> below and render src="" — a blank grey frame with no
          // spinner, which read as "broken" rather than "not finished". The
          // version it came from stays on screen underneath so there's still
          // something to look at while the new one renders.
          <>
            {prevReady?.image_url && (
              <img src={prevReady.image_url} alt="" className="max-h-full max-w-full object-contain opacity-25" />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-secondary">
              <Spinner />
              <p className="text-[11px] font-medium">{stale ? 'Still working…' : 'Working on it…'}</p>
              {/* Renders take a minute or two; past about five, something
                  upstream has almost certainly died without saying so, and
                  the honest thing is to offer a way out rather than spin. */}
              {stale && (
                <div className="flex flex-col items-center gap-1.5 px-6 text-center">
                  <p className="text-[10px] text-text-tertiary leading-snug max-w-[15rem]">
                    This is taking much longer than usual. It may have failed without reporting back.
                  </p>
                  {onRetry && (
                    <button type="button" onClick={() => onRetry(stage)} disabled={pendingKey === `retry:${stage.id}`}
                      className="border border-border bg-white px-2.5 py-1 text-[10px] font-semibold text-text hover:border-amber-400 hover:bg-amber-50 disabled:opacity-50">
                      {pendingKey === `retry:${stage.id}` ? 'Retrying…' : '↻ Try this step again'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        ) : stage.status === 'failed' ? (
          <div className="flex flex-col items-center gap-1.5 px-6 text-center">
            <p className="text-[11px] font-semibold text-red-700">{labelFor(stage) || 'That step'} failed</p>
            {/* The real provider message, not a generic apology — an exhausted
                balance and a rejected prompt need very different responses. */}
            <p className="text-[10px] text-red-600 leading-snug line-clamp-3 max-w-xs">{stage.error || 'No reason given.'}</p>
            {onRetry && (
              <button type="button" onClick={() => onRetry(stage)} disabled={pendingKey === `retry:${stage.id}`}
                className="mt-1 inline-flex items-center gap-1.5 border border-red-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                {pendingKey === `retry:${stage.id}` ? <><Spinner size="sm" /> Retrying…</> : '↻ Try again'}
              </button>
            )}
          </div>
        ) : stageIsVideo ? (
          <video src={stage.video_url} controls playsInline className="max-h-full max-w-full" />
        ) : (
          // The element is the drag source rather than the <img>'s own
          // default, so the browser doesn't hand over its URL payload and
          // fight ours.
          <img src={stage.image_url} alt="" draggable
            onDragStart={e => handleDragStart(e, stage)}
            onClick={() => onZoom?.(stage)}
            className="max-h-full max-w-full object-contain cursor-zoom-in" />
        )}

        {stage?.status === 'ready' && (
          <>
            {/* Only worth saying which model made it, which is news exactly
                once — on the original candidate. Stamping "Edit" over every
                subsequent frame is a label for something the strip and the
                caption underneath already make obvious. */}
            {stage.kind === 'generate' && labelFor(stage) && (
              <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur text-white text-[10px] font-semibold pointer-events-none">
                {labelFor(stage)}
              </span>
            )}
            {isOlderBase && base && stage.id === base.id && (
              <span className="absolute top-2 right-2 px-2 py-0.5 bg-amber-500 text-white text-[10px] font-semibold pointer-events-none">
                Editing this
              </span>
            )}
            {!stageIsVideo && (
              <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" onClick={() => onZoom?.(stage)}
                  className="px-2.5 py-1 bg-white/95 text-text text-[10px] font-semibold shadow-dropdown hover:bg-white">
                  🔍 Zoom
                </button>
                <button type="button" onClick={() => onOpenEditor(stage)}
                  className="px-2.5 py-1 bg-white/95 text-text text-[10px] font-semibold shadow-dropdown hover:bg-white">
                  ✏️ Edit
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* What produced what's on screen — the one thing a transcript gave for
          free and a frame doesn't, so it's stated plainly rather than as grey
          fine print. Long instructions clamp to two lines with a real way to
          read the rest, because half a sentence is worse than none: it takes
          the same room and answers nothing. */}
      {/* Always rendered, at a reserved two-line height, even for the opening
          candidate that has no instruction of its own. Showing it only for
          edits meant stepping between versions on the strip added and removed
          a band mid-lane, which moved everything under it.
          Fixed height, not a floor: min-h let a prompt long enough to need
          "Show more" sit taller than one that didn't, and since the picture
          above is the flex-1 that absorbs whatever this band takes, that
          difference showed up as the image itself changing size — one lane
          smaller than its sibling, or a version shrinking the frame just by
          being selected. The toggle is now always rendered, just invisible
          when it has nothing to do, so this band is the same height for
          every stage. It's only allowed to grow — deliberately, on THIS
          version alone — when its own "Show more" is actually clicked. */}
      <div className={`px-3 py-2 border-t border-border bg-amber-50/50 flex flex-col justify-center ${
        expandedId === stage?.id ? 'min-h-[76px]' : 'h-[76px] overflow-hidden'
      }`}>
        {stage?.user_prompt && stage.kind !== 'generate' ? (
          <p className={`text-[12px] text-text leading-relaxed ${expandedId === stage.id ? '' : 'line-clamp-2'}`}>
            <span className="font-semibold text-amber-800">You asked: </span>
            {stage.user_prompt}
          </p>
        ) : (
          <p className="text-[12px] text-text-tertiary leading-relaxed line-clamp-2">
            The first attempt, straight from your brief.
          </p>
        )}
        {/* Roughly two lines at a lane's width — below that the clamp never
            bites and the toggle would be a button that does nothing. Kept in
            the layout either way (invisible, not absent) so its row never
            silently comes and goes. */}
        <button type="button"
          onClick={() => stage && setExpandedId(expandedId === stage.id ? null : stage.id)}
          className={`mt-1 self-start text-[10px] font-semibold text-amber-700 hover:underline ${
            stage?.user_prompt && stage.kind !== 'generate' && stage.user_prompt.length > 90
              ? '' : 'invisible pointer-events-none'
          }`}>
          {expandedId === stage?.id ? 'Show less' : 'Show more'}
        </button>
      </div>

      {/* ── History ── */}
      {branch.versions.length > 1 && (
        <div ref={stripRef}
          className="flex gap-1.5 px-2.5 py-2 border-t border-border bg-surface-subtle/40 overflow-x-auto overscroll-x-contain">
          {branch.versions.map((v, i) => (
            <Thumb key={v.id} version={v} step={i + 1}
              active={stage?.id === v.id}
              onClick={() => onChange({ baseId: v.id })}
              onRetry={onRetry}
              retrying={pendingKey === `retry:${v.id}`}
            />
          ))}
        </div>
      )}

      {/* ── Composer ── */}
      <div
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`mt-auto border-t p-2.5 space-y-2 transition-colors ${
          dragOver ? 'border-amber-400 bg-amber-50' : 'border-border bg-surface'
        }`}
      >
        {isOlderBase && (
          <div className="flex items-center gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1">
            <span>Editing an earlier version.</span>
            <button onClick={() => onChange({ baseId: null })} className="font-semibold underline">use the newest</button>
          </div>
        )}

        {attach && (
          <div className="flex items-center gap-2 border border-border bg-white px-2 py-1.5">
            <img src={attach.url} alt="" className="w-8 h-8 object-cover border border-border" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-text-tertiary leading-tight">From {attach.label}</p>
              {/* The gesture is ambiguous on purpose — "bring that image over
                  here" can mean copy its look or work on it directly — so the
                  drop asks rather than guessing. */}
              <div className="flex gap-1 mt-0.5">
                {[['reference', 'as a reference'], ['base', 'edit this one instead']].map(([mode, t]) => (
                  <button key={mode} onClick={() => onChange({ attach: { ...attach, mode } })}
                    className={`text-[10px] px-1.5 py-0.5 border transition-colors ${
                      attach.mode === mode ? 'border-amber-500 bg-amber-50 text-amber-800 font-semibold' : 'border-border text-text-tertiary hover:border-amber-300'
                    }`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => onChange({ attach: null })}
              className="text-text-tertiary hover:text-text text-sm leading-none px-1">×</button>
          </div>
        )}

        <div className="flex gap-2 items-end">
          {/* Dragging the sibling lane's image over is the only other way to
              attach a reference — which leaves no way to show the AI a fresh
              photo or a screenshot of the look you want. */}
          {onAttach && (
            <button type="button" onClick={onAttach} disabled={!canAct}
              title="Attach a reference image or screenshot"
              className="shrink-0 inline-flex items-center justify-center w-9 h-9 border border-border hover:border-amber-400 hover:bg-amber-50 disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent">
              📎
            </button>
          )}
          <textarea
            ref={composerRef}
            value={text}
            rows={1}
            onFocus={onActivate}
            onChange={e => onChange({ text: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
            placeholder={canAct ? 'Tell the AI what to change…' : 'Waiting for an image…'}
            disabled={!canAct}
            className="flex-1 min-w-0 text-[13px] leading-relaxed bg-white border border-border px-3 py-2 resize-none overflow-y-auto overscroll-contain focus:outline-none focus:border-amber-400 disabled:bg-surface-subtle disabled:text-text-tertiary"
          />
          <Button square size="sm" onClick={onSend} disabled={!canAct || busy === 'edit' || !text.trim()}>
            {busy === 'edit' ? <Spinner size="sm" /> : 'Send'}
          </Button>
        </div>

        {/* ── Actions ──
            Two visual languages, on purpose. Anything that only rearranges our
            own layer is a plain outline button marked "Free" and can be pressed
            all day; anything that calls a model wears the amber accent and its
            price. The interface teaches which clicks spend money, so nobody has
            to police it in a meeting. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {!stageIsVideo && (
            <Button square size="sm" variant="outline" disabled={!canAct} onClick={() => onOpenEditor(base)}>✏️ Editor</Button>
          )}
          {stageIsVideo && onEditClip && stage?.status === 'ready' && (
            <Button square size="sm" variant="outline" disabled={preparingClip === stage.id}
              onClick={() => onEditClip(stage)}
              title="Add or change text, logos and colours on this clip — instant, and it never re-renders the footage">
              {preparingClip === stage.id
                ? <><Spinner size="sm" /> Opening…</>
                : `✏️ ${stage.overlay_state?.overlays?.length ? 'Edit text' : 'Add text'}`}
            </Button>
          )}
          {onAnimate && !stageIsVideo && (
            <Button square size="sm" disabled={!canAct} onClick={() => onAnimate(base)}
              title="Generate a clip from this still — this one costs a render">🎬 Animate</Button>
          )}
          <Button square size="sm" variant="secondary" disabled={!canAct || busy === 'finalize' || base?.is_final}
            onClick={() => onFinalize(base)}>
            {busy === 'finalize' ? <Spinner size="sm" /> : base?.is_final ? '✓ Saved' : '✅ Save'}
          </Button>
          {/* Downloads whatever is actually on screen, so watching a clip and
              pressing Download can't hand you the still instead. */}
          {stage?.status === 'ready' && (
            <Button square size="sm" variant="outline" disabled={pendingKey === `download:${stage.id}`}
              onClick={() => onDownload(stage)}
              title={stage.is_final ? 'Download (already in the Media Library)' : 'Download — also files it in the Media Library'}>
              {pendingKey === `download:${stage.id}` ? <Spinner size="sm" /> : stageIsVideo ? '⬇ Clip' : '⬇ Download'}
            </Button>
          )}
          {stageIsVideo && onReRender && (
            <Button square size="sm" onClick={() => onReRender(stage)}
              title="Same motion and settings, run against the lane's current still — generates new footage">
              🔄 Re-render{reRenderCost ? ` · −$${reRenderCost(stage).toFixed(2)}` : ''}
            </Button>
          )}
          {stageIsVideo && stage?.status === 'ready' && (
            <span className="ml-auto text-[10px] text-text-tertiary">
              Text, fonts and colours are free · only re-rendering costs
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// The collapsed form of the lane you aren't in: enough of the image to
// recognise it, and one click back to seeing both.
export function BranchPill({ branch, onClick }) {
  const base = PROVIDER_LABEL[branch.provider] || 'Other option'
  const label = branch.variantIndex ? `${base} ${branch.variantIndex}` : base
  const thumb = branch.latest?.image_url
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 border border-border bg-surface hover:border-amber-400 pl-1.5 pr-3 py-1.5 transition-colors">
      {thumb
        ? <img src={thumb} alt="" className="w-8 h-8 object-cover" />
        : <span className="w-8 h-8 bg-surface-subtle flex items-center justify-center">{branch.pending ? <Spinner size="sm" /> : '·'}</span>}
      <span className="text-left">
        <span className="block text-[11px] font-semibold text-text leading-tight">{label}</span>
        <span className="block text-[10px] text-text-tertiary leading-tight">show both</span>
      </span>
    </button>
  )
}
