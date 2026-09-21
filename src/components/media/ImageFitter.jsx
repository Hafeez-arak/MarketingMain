import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Spinner } from '../ui/index'
import { uploadToMediaLibrary } from '../../lib/mediaLibrary'
import { loadImage, renderFitted } from '../../lib/imageRender'
import { useAuth } from '../../store/auth'
import {
  aspectOf, parseRatio, nearestRatio,
  coverScale, containScale, centreOffset, clampOffset, outputSize,
} from '../../lib/cropGeometry'
import { aspectRatiosFor, aspectLabel } from '../../lib/postFormats'

// ─── Reframing a picture by hand, on purpose ────────────────────────────────
//
// Instagram already pads an out-of-range picture automatically at publish
// time (src/lib/imageFit.js) — nobody has to open this for a post to go out.
// This is the OPTIONAL other choice: when auto-padding would leave bars
// nobody wants, this lets someone crop to a shape they pick instead. Auto
// stays the default; this is the manual override, never the other way round.
//
// The gesture is the one everybody already knows from setting a profile
// picture: the frame stays still, the picture moves behind it, and whatever
// is inside the frame is what gets published. Drag to move, wheel or the
// slider to zoom, chips along the top to change what shape the frame is.
//
// ── WHY THIS IS ITS OWN COMPONENT AND NOT PART OF THE COMPOSER ──
//
// Because a picture is chosen in more than one place. The composer is the
// obvious one, but the monthly planner's Pictures step holds slides that
// never pass through the composer at all until they are queued — and a
// carousel that is wrong there is wrong for the rest of its life. One
// component, opened from both, so the fix is available wherever the picture
// is, and there is one piece of cropping arithmetic in this app rather than
// two that drift.
//
// The arithmetic itself lives in src/lib/cropGeometry.js and is tested
// there. This file is the frame, the pointer events and the canvas.
//
// ── WHAT IT WRITES ──
//
// A new media-library asset, tagged `adjusted`, never an overwrite. The
// original stays: re-shaping is a decision about one post, and the same
// banner may be right somewhere else. That also means an adjustment can be
// redone from the original rather than compounding — every save re-reads the
// source image, so cropping twice is never cropping a crop.

const MAX_FRAME = 420          // the frame's long edge on screen, in CSS px
const BACKGROUNDS = [
  { id: 'white', label: 'White', css: '#ffffff' },
  { id: 'black', label: 'Black', css: '#111111' },
  { id: 'sand',  label: 'Sand',  css: '#f5efe6' },
  { id: 'blur',  label: 'Blur',  css: null },   // the picture itself, enlarged
]

export function ImageFitter({
  open, onClose, media, platform = 'instagram', format = 'feed_image',
  onApply, index = null, total = 1, applyToAll = false, initialRatio = '',
}) {
  // From the store rather than props, the same way MediaPicker takes it. This
  // component is opened from the composer AND from the planner, and a pair of
  // credentials threaded down two unrelated trees is two chances to pass the
  // wrong workspace.
  const { activeWorkspaceId, accessToken } = useAuth()
  const [img, setImg]       = useState(null)     // the decoded HTMLImageElement
  const [loadError, setErr] = useState('')
  const [ratioLabel, setRatioLabel] = useState('')
  const [mode, setMode]     = useState('fill')   // fill = crop, fit = pad
  const [bg, setBg]         = useState('white')
  const [scale, setScale]   = useState(1)
  const [offset, setOffset] = useState({ offsetX: 0, offsetY: 0 })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveErr] = useState('')
  const [alsoAll, setAlsoAll]   = useState(applyToAll)

  const dragRef = useRef(null)
  const ratios  = useMemo(() => aspectRatiosFor(platform, format), [platform, format])
  const ratio   = parseRatio(ratioLabel) || parseRatio(ratios[0]) || 1

  // The frame on screen. Portrait shapes are bounded by height and landscape
  // ones by width, so a 9:16 frame and a 1.91:1 frame occupy roughly the same
  // area instead of one of them running off the dialog.
  const frame = useMemo(() => (ratio >= 1
    ? { frameW: MAX_FRAME, frameH: Math.round(MAX_FRAME / ratio) }
    : { frameW: Math.round(MAX_FRAME * ratio), frameH: MAX_FRAME }), [ratio])

  // ── Loading ──
  // crossOrigin is set BEFORE src, because a decoded image cannot be
  // retro-fitted with CORS: without it the canvas is tainted and toBlob throws
  // a SecurityError at the very last step, after the user has done the work.
  useEffect(() => {
    if (!open || !media?.url) return
    let cancelled = false
    // Deferred: setting state synchronously in an effect body is a cascading
    // render. Same deferral MediaPicker uses for its first load.
    queueMicrotask(() => { if (!cancelled) { setImg(null); setErr(''); setSaveErr('') } })
    loadImage(media.url)
      .then(el => { if (!cancelled) setImg(el) })
      .catch(err => { if (!cancelled) setErr(err.message) })
    return () => { cancelled = true }
  }, [open, media?.url])

  // The opening shape: the orientation already chosen in the composer, if the
  // current format still offers it; failing that, whichever offered shape the
  // picture is already closest to — the smallest change that makes it
  // publishable, rather than a default that re-crops a slide which was fine.
  useEffect(() => {
    if (!open || !ratios.length) return
    const current = aspectOf(media?.width, media?.height)
      ?? (img ? aspectOf(img.naturalWidth, img.naturalHeight) : null)
    queueMicrotask(() =>
      setRatioLabel(prev => (prev && ratios.includes(prev) ? prev
        : (initialRatio && ratios.includes(initialRatio)) ? initialRatio
        : nearestRatio(current, ratios))))
  }, [open, ratios, media?.width, media?.height, img, initialRatio])

  const dims = useMemo(
    () => (img ? { imgW: img.naturalWidth, imgH: img.naturalHeight } : null),
    [img],
  )

  // Re-seat the picture whenever the frame or the mode changes. `fill` starts
  // at the smallest covering scale (the whole frame filled, the least cropped)
  // and `fit` at the largest contained one (the whole picture visible).
  const reset = useCallback((nextMode = mode) => {
    if (!dims) return
    const base = nextMode === 'fill'
      ? coverScale({ ...dims, ...frame })
      : containScale({ ...dims, ...frame })
    setScale(base)
    setOffset(clampOffset({ ...dims, ...frame, scale: base, ...centreOffset({ ...dims, ...frame, scale: base }) }))
  }, [dims, frame, mode])

  // Re-seated when the picture arrives and whenever the frame changes shape,
  // deferred for the same reason as above.
  useEffect(() => { queueMicrotask(reset) }, [reset])

  const minScale = dims ? (mode === 'fill' ? coverScale({ ...dims, ...frame }) : containScale({ ...dims, ...frame }) * 0.2) : 1
  const maxScale = dims ? coverScale({ ...dims, ...frame }) * 6 : 1

  const setScaleAbout = (next) => {
    if (!dims) return
    const s = Math.min(maxScale, Math.max(minScale, next))
    // Zoom around the frame's centre, not the image's origin — otherwise the
    // picture appears to run away towards the top-left as it grows.
    const cx = frame.frameW / 2; const cy = frame.frameH / 2
    const k = s / scale
    const moved = {
      offsetX: cx - (cx - offset.offsetX) * k,
      offsetY: cy - (cy - offset.offsetY) * k,
    }
    setScale(s)
    setOffset(clampOffset({ ...dims, ...frame, scale: s, ...moved }))
  }

  const onPointerDown = (e) => {
    if (!dims) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, ...offset }
  }
  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d || !dims) return
    setOffset(clampOffset({
      ...dims, ...frame, scale,
      offsetX: d.offsetX + (e.clientX - d.x),
      offsetY: d.offsetY + (e.clientY - d.y),
    }))
  }
  const endDrag = () => { dragRef.current = null }

  // ── Saving ──
  // The canvas is the preview restated at output resolution: same scale, same
  // offsets, multiplied by one factor. There is no second cropping rule here,
  // which is what guarantees that what was inside the frame is what lands in
  // the file.
  async function save() {
    if (!dims || !img) return
    setSaving(true); setSaveErr('')
    try {
      const chosen = BACKGROUNDS.find(b => b.id === bg)
      const { blob, width, height } = await renderFitted(img, {
        ratio, mode, frameW: frame.frameW, scale, ...offset,
        background: chosen?.css || 'blur',
      })

      const base = (media?.name || 'image').replace(/\.[a-z0-9]+$/i, '')
      const file = new File([blob], `${base}-${ratioLabel.replace(':', 'x')}.jpg`, { type: 'image/jpeg' })
      const res = await uploadToMediaLibrary(activeWorkspaceId, accessToken, file, {
        source: 'adjusted', tags: ['adjusted', platform, ratioLabel],
      })
      if (res.error) throw new Error(res.error)

      onApply({
        ...media,
        url: res.asset?.url,
        name: file.name,
        mimeType: 'image/jpeg',
        bytes: blob.size,
        // Straight from the render rather than re-measured. These are the
        // numbers the validator reads, and they are known exactly here.
        width,
        height,
      }, { ratio: ratioLabel, mode, applyToAll: alsoAll })
      onClose()
    } catch (err) {
      setSaveErr(err.message || 'That could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const bgChosen = BACKGROUNDS.find(b => b.id === bg)

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
      style={{ background: 'rgba(28,35,33,0.55)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white border border-border shadow-dropdown w-full max-w-3xl max-h-[92vh] flex flex-col">

        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-border shrink-0">
          <h2 className="font-semibold text-text text-sm">
            Adjust {total > 1 && index != null ? `slide ${index + 1} of ${total}` : 'image'}
          </h2>
          <button onClick={onClose} aria-label="Close"
            className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-text">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5">

          <div className="flex flex-col lg:flex-row gap-6">
            {/* ── The frame ── */}
            <div className="shrink-0 mx-auto">
              <div
                className="relative overflow-hidden border border-border select-none touch-none"
                style={{
                  width: frame.frameW, height: frame.frameH, cursor: img ? 'grab' : 'default',
                  background: mode === 'fit' ? (bgChosen?.css || '#e9e5df') : '#f3f1ee',
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onWheel={e => { if (img) setScaleAbout(scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08)) }}>

                {!img && !loadError && (
                  <div className="absolute inset-0 flex items-center justify-center"><Spinner /></div>
                )}
                {loadError && (
                  <p className="absolute inset-0 flex items-center justify-center text-sm text-red-600 p-4 text-center">
                    {loadError}
                  </p>
                )}
                {img && (
                  <img src={img.src} alt="" draggable={false}
                    className="absolute origin-top-left max-w-none pointer-events-none"
                    style={{
                      left: 0, top: 0,
                      width: img.naturalWidth * scale, height: img.naturalHeight * scale,
                      transform: `translate(${offset.offsetX}px, ${offset.offsetY}px)`,
                    }} />
                )}

                {/* Thirds, at the strength that helps you line a horizon up
                    without competing with the picture for attention. */}
                <div className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, rgba(255,255,255,.35) 1px, transparent 1px),' +
                      'linear-gradient(to bottom, rgba(255,255,255,.35) 1px, transparent 1px)',
                    backgroundSize: '33.333% 33.333%',
                  }} />
              </div>
              <p className="text-xs text-text-tertiary mt-2 text-center">
                Drag to move · scroll to zoom
              </p>
            </div>

            {/* ── The controls ── */}
            <div className="flex-1 min-w-0 space-y-5">
              <div>
                <p className="text-xs font-semibold text-text-secondary mb-1.5">Shape</p>
                <div className="flex flex-wrap gap-1">
                  {ratios.map(r => (
                    <button key={r} type="button" onClick={() => setRatioLabel(r)}
                      className={`px-2.5 py-1 text-xs font-semibold border -ml-px first:ml-0 transition-colors ${
                        ratioLabel === r
                          ? 'bg-amber-700 text-white border-amber-700 relative z-10'
                          : 'bg-white text-text-secondary border-border hover:bg-surface-subtle'}`}>
                      {r} <span className="font-normal opacity-70">{aspectLabel(r)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-text-secondary mb-1.5">Inside the frame</p>
                <div className="flex gap-1">
                  {[['fill', 'Fill', 'Crop to the edges'], ['fit', 'Fit', 'Show all, add a background']].map(([id, label, hint]) => (
                    <button key={id} type="button" onClick={() => { setMode(id); reset(id) }}
                      title={hint}
                      className={`px-2.5 py-1 text-xs font-semibold border -ml-px first:ml-0 transition-colors ${
                        mode === id
                          ? 'bg-amber-700 text-white border-amber-700 relative z-10'
                          : 'bg-white text-text-secondary border-border hover:bg-surface-subtle'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-text-tertiary mt-1">
                  {mode === 'fill'
                    ? 'Anything outside the frame is cut off.'
                    : 'The whole picture is kept and the frame is padded around it.'}
                </p>
              </div>

              {mode === 'fit' && (
                <div>
                  <p className="text-xs font-semibold text-text-secondary mb-1.5">Padding</p>
                  <div className="flex gap-1 flex-wrap">
                    {BACKGROUNDS.map(b => (
                      <button key={b.id} type="button" onClick={() => setBg(b.id)}
                        className={`px-2.5 py-1 text-xs font-semibold border -ml-px first:ml-0 transition-colors ${
                          bg === b.id
                            ? 'bg-amber-700 text-white border-amber-700 relative z-10'
                            : 'bg-white text-text-secondary border-border hover:bg-surface-subtle'}`}>
                        {b.label}
                      </button>
                    ))}
                  </div>
                  {bg === 'blur' && (
                    <p className="text-xs text-text-tertiary mt-1">
                      Shown flat here; the saved image has the blurred picture behind it.
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Zoom</label>
                <input type="range" min={0} max={1000} value={
                    maxScale > minScale ? Math.round(((scale - minScale) / (maxScale - minScale)) * 1000) : 0
                  }
                  onChange={e => setScaleAbout(minScale + (Number(e.target.value) / 1000) * (maxScale - minScale))}
                  disabled={!img}
                  className="w-full accent-amber-600" />
                <button type="button" onClick={() => reset()} disabled={!img}
                  className="text-xs text-text-tertiary hover:text-text mt-0.5 disabled:opacity-40">
                  Reset
                </button>
              </div>

              {total > 1 && (
                <label className="flex items-start gap-2 text-sm text-text-secondary">
                  <input type="checkbox" checked={alsoAll} onChange={e => setAlsoAll(e.target.checked)}
                    className="mt-0.5 accent-amber-600" />
                  <span>
                    Put every other slide in this shape too
                    <span className="block text-xs text-text-tertiary">
                      Instagram crops a carousel to the first slide&rsquo;s shape, so mixing them loses edges.
                    </span>
                  </span>
                </label>
              )}

              {img && (
                <p className="text-xs text-text-tertiary">
                  {img.naturalWidth} × {img.naturalHeight} → {outputSize(ratio).width} × {outputSize(ratio).height}px
                </p>
              )}
            </div>
          </div>

          {saveError && <p className="text-sm text-red-600 mt-4">{saveError}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={!img || saving}>
            {saving ? 'Saving…' : 'Use this'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
