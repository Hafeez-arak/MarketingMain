import { useEffect, useRef, useState } from 'react'
import { Button, Spinner } from '../ui/index'
import { VersionCard } from './VersionCard'
import { PROVIDER_LABEL, labelFor } from './labels'

// ─── One candidate's own conversation ──────────────────────────────────────
// The ChatGPT image and the Gemini image are not two options to choose between
// once — they're two threads that stay alive side by side, each with its own
// chat box, so the same brief can be pushed in two directions and compared at
// every step instead of only at the first.
//
// The lane you type in becomes the big one; the other collapses to a pill you
// can click to get the split back. That's the whole navigation model.

const DRAG_MIME = 'application/x-arak-version'

export function BranchChat({
  branch,
  composer,                // { text, baseId, attach }
  focused,                 // this lane is the big one
  split,                   // both lanes visible
  busy,                    // '' | 'edit' | 'video' | 'finalize' — lane-level
  // The raw busy key, for actions scoped to ONE version rather than the lane
  // (download, retry). laneBusy() strips these to a bare label and only
  // matches on the branch root, so a per-version spinner can't read `busy`.
  pendingKey = '',
  onChange,                // (patch) => void
  onSend,
  onActivate,              // typing in a lane focuses it
  onAnimate,
  onReRender,              // optional: re-run a past render against the current base
  onOpenEditor,
  onFinalize,
  onDownload,              // downloads the file AND files it in the library if it isn't already
  onRetry,                 // re-run a failed version against the same prompt
}) {
  const [dragOver, setDragOver] = useState(false)
  const threadRef = useRef(null)

  // A chat shows you the newest turn, not the oldest. Without this, sending an
  // instruction in the big lane leaves the reply below the fold.
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [branch.versions.length])

  const { text = '', baseId = null, attach = null } = composer || {}
  const base = branch.versions.find(v => v.id === baseId) || branch.latest
  const isOlderBase = !!base && !!branch.latest && base.id !== branch.latest.id
  const baseLabel = PROVIDER_LABEL[branch.provider] || labelFor(branch.root) || 'Option'
  // buildBranches numbers lanes only when one model produced several
  // candidates this round, so a plain 1-vs-1 round stays "ChatGPT", not "ChatGPT 1".
  const label = branch.variantIndex ? `${baseLabel} ${branch.variantIndex}` : baseLabel
  const canAct = !!base && base.status === 'ready'

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

  return (
    <div className={`rounded-2xl border ${focused || !split ? 'border-border' : 'border-border'} bg-surface flex flex-col`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">{label}</p>
        {branch.pending && <span className="text-[10px] text-text-tertiary flex items-center gap-1.5"><Spinner size="sm" /> working…</span>}
      </div>

      {/* ── Thread ── */}
      <div ref={threadRef} className={`px-3 py-3 space-y-3 overflow-y-auto ${split ? 'max-h-[52vh]' : 'max-h-[56vh]'}`}>
        {branch.versions.map((v, i) => (
          <div key={v.id} className="space-y-1.5">
            {/* The opening prompt is the session's, shown once above both
                lanes — repeating it here would just be the same sentence twice
                on screen. Every later instruction belongs to this lane only. */}
            {i > 0 && v.user_prompt && (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-stone-800 text-white px-3 py-1.5">
                  <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{v.user_prompt}</p>
                </div>
              </div>
            )}
            {i > 0 && v.reference_url && (
              <div className="flex justify-end">
                <img src={v.reference_url} alt="" className="w-12 h-12 object-cover rounded-lg border border-border" />
              </div>
            )}
            {/* Capped rather than full-bleed: at full lane width a 4:5 image
                is taller than the viewport, which pushes the chat box the
                whole lane exists for off the bottom of the screen. */}
            <div className="max-w-[420px]">
            <VersionCard
              version={v}
              // Pointless on a lane with one image — it can only be "this
              // one", and the badge reads as a state you chose.
              isBase={branch.versions.length > 1 && !!base && v.id === base.id}
              showLabel={i === 0 || v.kind !== 'edit'}
              onClick={v.status === 'ready' ? () => onChange({ baseId: v.id }) : undefined}
              onDragStart={handleDragStart}
              onRetry={onRetry}
              retrying={pendingKey === `retry:${v.id}`}
              onEdit={onOpenEditor}
            />
            {/* Every render is keepable, not just the current one. A motion
                that didn't work on this still often works on the next, and a
                clip that's already been paid for shouldn't need re-generating
                to get a copy of it. */}
            {v.status === 'ready' && (v.video_url || v.image_url) && (
              <div className="flex items-center gap-2 mt-1 px-0.5">
                <button onClick={() => onDownload(v)} disabled={pendingKey === `download:${v.id}`}
                  title={v.is_final ? 'Download (already in the Media Library)' : 'Download — also files it in the Media Library'}
                  className="text-[10px] font-medium text-text-tertiary hover:text-amber-700 disabled:opacity-50">
                  {pendingKey === `download:${v.id}` ? 'Saving…' : '⬇ Download'}
                </button>
                {v.media_type === 'video' && onReRender && (
                  <button onClick={() => onReRender(v)}
                    className="text-[10px] font-medium text-text-tertiary hover:text-amber-700">
                    🔄 Re-render with the current image
                  </button>
                )}
              </div>
            )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Composer ── */}
      <div
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`mt-auto border-t p-3 space-y-2 rounded-b-2xl transition-colors ${
          dragOver ? 'border-amber-400 bg-amber-50' : 'border-border bg-surface-subtle/30'
        }`}
      >
        {isOlderBase && (
          <div className="flex items-center gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            <span>Continuing from an earlier version.</span>
            <button onClick={() => onChange({ baseId: null })} className="font-semibold underline">use the newest</button>
          </div>
        )}

        {attach && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-2 py-1.5">
            <img src={attach.url} alt="" className="w-8 h-8 rounded object-cover border border-border" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-text-tertiary leading-tight">From {attach.label}</p>
              {/* The gesture is ambiguous on purpose — "bring that image over
                  here" can mean copy its look or work on it directly — so the
                  drop asks rather than guessing. */}
              <div className="flex gap-1 mt-0.5">
                {[['reference', 'as a reference'], ['base', 'edit this one instead']].map(([mode, text]) => (
                  <button key={mode} onClick={() => onChange({ attach: { ...attach, mode } })}
                    className={`text-[10px] px-1.5 py-0.5 rounded-md border transition-colors ${
                      attach.mode === mode ? 'border-amber-500 bg-amber-50 text-amber-800 font-semibold' : 'border-border text-text-tertiary hover:border-amber-300'
                    }`}>
                    {text}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => onChange({ attach: null })}
              className="text-text-tertiary hover:text-text text-sm leading-none px-1">×</button>
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={text}
            onFocus={onActivate}
            onChange={e => onChange({ text: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
            placeholder={canAct ? 'Tell the AI what to change…' : 'Waiting for an image…'}
            disabled={!canAct}
            className="flex-1 min-w-0 text-[13px] bg-white border border-border rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400 disabled:bg-surface-subtle disabled:text-text-tertiary"
          />
          <Button size="sm" onClick={onSend} disabled={!canAct || busy === 'edit' || !text.trim()}>
            {busy === 'edit' ? <Spinner size="sm" /> : 'Send'}
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" disabled={!canAct} onClick={() => onOpenEditor(base)}>✏️ Open in editor</Button>
          <Button size="sm" variant="outline" disabled={!canAct} onClick={() => onAnimate(base)}>🎬 Animate</Button>
          <Button size="sm" variant="secondary" disabled={!canAct || busy === 'finalize' || base?.is_final}
            onClick={() => onFinalize(base)}>
            {busy === 'finalize' ? <Spinner size="sm" /> : base?.is_final ? '✓ Saved' : '✅ Save'}
          </Button>
          {canAct && (
            <Button size="sm" variant="outline" disabled={pendingKey === `download:${base.id}`}
              onClick={() => onDownload(base)}
              title={base.is_final ? 'Download (already in the Media Library)' : 'Download — also files it in the Media Library'}>
              {pendingKey === `download:${base.id}` ? <Spinner size="sm" /> : '⬇ Download'}
            </Button>
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
      className="flex items-center gap-2 rounded-xl border border-border bg-surface hover:border-amber-400 pl-1.5 pr-3 py-1.5 transition-colors">
      {thumb
        ? <img src={thumb} alt="" className="w-8 h-8 rounded-lg object-cover" />
        : <span className="w-8 h-8 rounded-lg bg-surface-subtle flex items-center justify-center">{branch.pending ? <Spinner size="sm" /> : '·'}</span>}
      <span className="text-left">
        <span className="block text-[11px] font-semibold text-text leading-tight">{label}</span>
        <span className="block text-[10px] text-text-tertiary leading-tight">show both</span>
      </span>
    </button>
  )
}
