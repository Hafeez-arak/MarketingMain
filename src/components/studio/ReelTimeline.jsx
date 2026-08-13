import { useEffect, useRef, useState } from 'react'
import { useReelPlayback } from './useReelPlayback'
import { clipRuntime, normalizeClipTrim } from '../../lib/creativeStoryboard'

// ─── The reel, before you pay to assemble it ───────────────────────────────
// The storyboard above this decides what to GENERATE. This decides what to
// SHIP, and it is the only surface in the studio that shows the shots in order
// as footage rather than as a list of prompts.
//
// Every edit here is free — trimming a shot, changing a seam, watching it back
// — because none of it touches a model. That is the line the whole video half
// of the studio is organised around, and it is why trimming lives here while
// "render this shot again" stays on the board.
//
// Blocks are sized by each clip's REAL length, read off the rendered file
// rather than taken from what we asked the model for. Those two disagree
// often enough (a model asked for 5s returning 5.2s) that a reel drawn from
// the request would put every seam in slightly the wrong place.

const MIN_BLOCK_PCT = 4
const EDGE_PX = 8

const fmt = s => `${Number(s || 0).toFixed(1)}s`

const IconPlay = () => (
  <svg viewBox="0 0 24 24" className="ml-[1px] h-3 w-3" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
)
const IconPause = () => (
  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
)

// The length of each rendered clip, probed once from its metadata. `preload`
// is 'metadata', so this costs headers rather than the whole file — the clips
// are a few MB each and there can be twelve of them.
function useClipDurations(rows) {
  const [durations, setDurations] = useState({})
  const urls = rows.map(r => r?.video_url || '').join('~')
  useEffect(() => {
    let alive = true
    const list = rows.map(r => r?.video_url).filter(Boolean)
    for (const url of list) {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.crossOrigin = 'anonymous'
      v.addEventListener('loadedmetadata', () => {
        if (!alive || !Number.isFinite(v.duration) || v.duration <= 0) return
        setDurations(d => (d[url] === v.duration ? d : { ...d, [url]: v.duration }))
        v.removeAttribute('src')
      }, { once: true })
      v.src = url
    }
    return () => { alive = false }
  }, [urls]) // eslint-disable-line react-hooks/exhaustive-deps
  return durations
}

export function ReelTimeline({ storyboard, clipRows, onPatchClip, disabled }) {
  const rows = clipRows || []
  const clips = storyboard?.clips || []
  const durations = useClipDurations(rows)

  // Only the shots that have actually rendered can be watched or trimmed.
  const ready = clips
    .map((clip, i) => ({ clip, i, row: rows[i] }))
    .filter(x => x.row?.status === 'ready' && x.row?.video_url)
    .map(x => ({ ...x, full: durations[x.row.video_url] || Number(x.clip.duration) || 0 }))

  const segments = ready.map(({ clip, row, full }) => {
    const t = normalizeClipTrim(clip.trim)
    const end = t.end === null ? full : Math.min(t.end, full)
    return { url: row.video_url, in: Math.min(t.start, Math.max(0, full - 0.1)), out: Math.max(0.1, end) }
  })

  const {
    attachA, attachB, activeIsA, playing, ready: reelReady, duration: reelDuration,
    index: nowPlaying, subscribe: reelSubscribe, seek, pause, toggle,
  } = useReelPlayback(segments)
  const headRef = useRef(null)
  const readoutRef = useRef(null)
  const trackRef = useRef(null)
  const cleanupRef = useRef(null)

  useEffect(() => {
    if (!reelSubscribe) return undefined
    return reelSubscribe(t => {
      const pct = reelDuration > 0 ? Math.min(100, Math.max(0, (t / reelDuration) * 100)) : 0
      if (headRef.current) headRef.current.style.left = `${pct}%`
      if (readoutRef.current) readoutRef.current.textContent = fmt(t)
    })
  }, [reelSubscribe, reelDuration])

  useEffect(() => () => { if (cleanupRef.current) cleanupRef.current() }, [])

  function startScrub(e) {
    e.preventDefault()
    const track = trackRef.current
    if (!track || !reelDuration) return
    const box = track.getBoundingClientRect()
    const at = x => seek(((Math.min(Math.max(x, box.left), box.right) - box.left) / box.width) * reelDuration)
    pause()
    at(e.clientX)
    const move = ev => at(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      cleanupRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    cleanupRef.current = up
  }

  // Trimming a block. The gesture is scaled by the BLOCK's own width, not the
  // reel's, so a two-second shot inside a minute-long reel is still draggable
  // at a sensible rate.
  function startTrim(e, entry, edge) {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    const runtime = clipRuntime(entry.clip, entry.full)
    const blockW = Math.max(1, e.currentTarget.parentElement.clientWidth)
    const perPx = runtime / blockW
    const t = normalizeClipTrim(entry.clip.trim)
    const startX = e.clientX

    function move(ev) {
      const delta = (ev.clientX - startX) * perPx
      const end = t.end === null ? entry.full : t.end
      let next
      if (edge === 'start') {
        next = { start: Math.min(Math.max(0, t.start + delta), end - 0.2), end: t.end }
      } else {
        const raw = Math.min(Math.max(end + delta, t.start + 0.2), entry.full)
        // Stored as null once it reaches the end, so the shot stays "all of
        // it" if that take is ever re-rendered at a different length.
        next = { start: t.start, end: raw >= entry.full - 0.05 ? null : raw }
      }
      onPatchClip(entry.i, { trim: next })
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      cleanupRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    cleanupRef.current = up
  }

  if (!ready.length) {
    return (
      <div className="border border-border bg-surface-subtle/40 px-3 py-4 text-center">
        <p className="text-[11px] text-text-tertiary">
          Render a shot and it appears here as footage you can watch, trim and re-order — all free.
        </p>
      </div>
    )
  }

  const trimmedAnywhere = ready.some(({ clip }) => {
    const t = normalizeClipTrim(clip.trim)
    return t.start > 0.01 || t.end !== null
  })
  const anyCrossfade = ready.some(({ clip, i }) => i > 0 && clip.transition === 'crossfade')

  return (
    <div className="border border-border bg-surface-subtle/40">
      {/* ── The picture ── */}
      {/* Two stacked elements: the one that is playing and the one already
          holding the next shot. See useReelPlayback for why. */}
      <div className="relative aspect-video w-full bg-black">
        <video ref={attachA} muted={false} playsInline
          className={`absolute inset-0 h-full w-full object-contain ${activeIsA ? '' : 'invisible'}`} />
        <video ref={attachB} muted={false} playsInline
          className={`absolute inset-0 h-full w-full object-contain ${activeIsA ? 'invisible' : ''}`} />
      </div>

      {/* ── Transport ── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-1.5">
        <button type="button" onClick={toggle} disabled={!reelReady}
          title={playing ? 'Pause' : 'Play the reel'}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-white transition-colors hover:bg-amber-600 disabled:opacity-40">
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <p className="font-mono text-[10px] tabular-nums text-text-tertiary">
          <span ref={readoutRef}>0.0s</span> / {fmt(reelDuration)}
        </p>
        <span className="text-[10px] text-text-tertiary">
          · shot {nowPlaying + 1} of {ready.length}
        </span>
        <span className="flex-1" />
        <span className="text-[10px] text-text-tertiary">
          {trimmedAnywhere ? 'Trimming is free — no shot is re-rendered. ' : 'Drag a block’s ends to trim it, free. '}
          {anyCrossfade && 'Crossfade seams preview as cuts.'}
        </span>
      </div>

      {/* ── The blocks ── */}
      <div className="relative px-3 pb-3">
        <div ref={trackRef} onPointerDown={startScrub}
          className="flex h-11 w-full cursor-ew-resize gap-[2px] overflow-hidden rounded">
          {ready.map((entry, n) => {
            const runtime = clipRuntime(entry.clip, entry.full)
            const pct = reelDuration > 0 ? (runtime / reelDuration) * 100 : 100 / ready.length
            const isNow = n === nowPlaying
            return (
              <div key={entry.clip.key}
                style={{ width: `${Math.max(MIN_BLOCK_PCT, pct)}%` }}
                title={`Shot ${entry.i + 1} · ${fmt(runtime)} of ${fmt(entry.full)}`}
                className={`relative min-w-0 overflow-hidden rounded transition-colors ${
                  isNow ? 'bg-amber-500' : 'bg-amber-300'
                }`}>
                <span className="pointer-events-none absolute inset-x-0 top-1 truncate px-2 text-[10px] font-semibold text-white">
                  {entry.i + 1}. {entry.clip.prompt?.trim().slice(0, 24) || 'Shot'}
                </span>
                <span className="pointer-events-none absolute inset-x-0 bottom-1 truncate px-2 text-[9px] text-white/85">
                  {fmt(runtime)}{runtime < entry.full - 0.05 ? ` of ${fmt(entry.full)}` : ''}
                </span>
                {/* Trim handles. Wider than the layer strip's cosmetic grips
                    because these ARE the hit target. */}
                <span onPointerDown={e => startTrim(e, entry, 'start')}
                  style={{ width: EDGE_PX }}
                  className="absolute inset-y-0 left-0 cursor-ew-resize bg-black/30 hover:bg-black/50" />
                <span onPointerDown={e => startTrim(e, entry, 'end')}
                  style={{ width: EDGE_PX }}
                  className="absolute inset-y-0 right-0 cursor-ew-resize bg-black/30 hover:bg-black/50" />
              </div>
            )
          })}
        </div>

        <div ref={headRef} className="pointer-events-none absolute top-0 z-10 w-px bg-amber-900"
          style={{ left: '0%', bottom: 12 }}>
          <span className="absolute -left-[3px] top-0 h-[7px] w-[7px] rounded-full bg-amber-900" />
        </div>
      </div>
    </div>
  )
}
