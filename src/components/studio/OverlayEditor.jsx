import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Select, Spinner, Toggle } from '../ui/index'
import { WEIGHTS, fontsFor, ensureFontsLoaded } from './fonts'
import { autoDirectionPatch, layoutBox, newTextBox, renderOverlay } from './overlayModel'

// ─── Overlay text editor ───────────────────────────────────────────────────
// Puts REAL text on top of a generated image, rather than asking an image
// model to paint letters into the pixels. That distinction is the whole point:
//
//  · Arabic comes out right every time. The browser shapes and joins the
//    glyphs with a real font, instead of a diffusion model approximating
//    letterforms it routinely mirrors, splits or invents.
//  · The text stays editable forever. The box list is saved as data
//    (creative_versions.overlay_state), so reopening a version restores
//    movable, retypeable boxes — not a flattened picture. AI-painted text can
//    never be un-baked.
//  · The same layer can be composited over VIDEO later, which turns "change
//    the wording on the clip" into a re-composite instead of a re-render.
//
// Layout, wrapping and drawing all live in overlayModel.js — the preview here
// renders the exact lines the exporter will draw, so the two cannot drift.

export function OverlayEditor({ imageUrl, initialState, onSave, onCancel, saving = false }) {
  const [boxes, setBoxes] = useState(() =>
    Array.isArray(initialState?.boxes) && initialState.boxes.length
      ? initialState.boxes.map(b => ({ ...newTextBox(), ...b }))
      : [newTextBox()],
  )
  const [selectedId, setSelectedId] = useState(null)
  const [preview, setPreview] = useState({ w: 0, h: 0 })
  const [error, setError] = useState('')
  const [fontsReady, setFontsReady] = useState(false)

  const imgRef = useRef(null)
  const dragRef = useRef(null)

  const selected = boxes.find(b => b.id === selectedId) || null
  // Re-resolving on every family/weight change matters: a face that hasn't
  // loaded measures in a fallback, so the preview would wrap at the wrong
  // place and then visibly reflow the moment the real font arrives.
  const fontSignature = boxes.map(b => `${b.family}:${b.weight}`).join('|')

  useEffect(() => {
    let cancelled = false
    ensureFontsLoaded(boxes).then(() => {
      if (cancelled) return
      setFontsReady(true)
      setBoxes(b => [...b])   // re-measure now that the real metrics exist
    })
    return () => { cancelled = true }
  }, [fontSignature]) // eslint-disable-line react-hooks/exhaustive-deps

  // The stage is fluid, so the preview's pixel size is tracked rather than
  // assumed — it's the denominator for every fraction on screen.
  useLayoutEffect(() => {
    const el = imgRef.current
    if (!el) return
    const measure = () => setPreview({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [imageUrl])

  const update = useCallback((id, patch) => {
    setBoxes(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)))
  }, [])

  function updateText(id, text) {
    const box = boxes.find(b => b.id === id)
    update(id, box ? autoDirectionPatch(box, text) : { text })
  }

  // ── Dragging ──
  function onPointerDown(e, box) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelectedId(box.id)
    dragRef.current = { id: box.id, startX: e.clientX, startY: e.clientY, originX: box.x, originY: box.y }
  }
  function onPointerMove(e) {
    const d = dragRef.current
    if (!d || !preview.w) return
    const nextX = d.originX + (e.clientX - d.startX) / preview.w
    const nextY = d.originY + (e.clientY - d.startY) / preview.h
    // Clamped loosely rather than to [0,1]: text deliberately bled off an edge
    // is a real design choice, but a box dragged fully out of frame is always
    // a mistake and can never be grabbed again.
    update(d.id, { x: Math.min(0.98, Math.max(-0.5, nextX)), y: Math.min(0.98, Math.max(-0.5, nextY)) })
  }
  function endDrag() { dragRef.current = null }

  async function handleSave() {
    setError('')
    try {
      const { compositeBlob, textLayerBlob, width, height } = await renderOverlay(imageUrl, boxes)
      const result = await onSave({
        compositeBlob, textLayerBlob,
        state: { boxes, width, height },
      })
      if (result?.error) setError(result.error)
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  const availableFonts = useMemo(() => fontsFor(selected?.dir || 'ltr'), [selected?.dir])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      {/* ── Stage ── */}
      <div className="space-y-2">
        <div
          className="relative rounded-2xl overflow-hidden border border-border bg-stone-900/5 select-none"
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            crossOrigin="anonymous"
            className="w-full block"
            draggable={false}
            onClick={() => setSelectedId(null)}
          />

          {fontsReady && preview.w > 0 && boxes.map(box => {
            const { lines, fontPx, lineHeightPx, boxW, x, y } = layoutBox(box, preview.w, preview.h)
            const isSelected = box.id === selectedId
            return (
              <div
                key={box.id}
                onPointerDown={e => onPointerDown(e, box)}
                style={{
                  position: 'absolute', left: x, top: y, width: boxW,
                  fontFamily: `"${box.family}", sans-serif`,
                  fontWeight: box.weight,
                  fontSize: fontPx,
                  lineHeight: `${lineHeightPx}px`,
                  color: box.color,
                  textAlign: box.align,
                  direction: box.dir,
                  cursor: 'move',
                  textShadow: box.shadow ? `0 ${fontPx * 0.05}px ${fontPx * 0.18}px rgba(0,0,0,0.55)` : 'none',
                  outline: isSelected ? '2px dashed rgba(245,158,11,0.9)' : 'none',
                  outlineOffset: 4,
                }}
              >
                {/* One element per computed line — the same lines the export
                    draws — so CSS never gets a chance to wrap differently. */}
                {lines.map((line, i) => (
                  <div key={i} style={{ whiteSpace: 'pre' }}>{line || ' '}</div>
                ))}
              </div>
            )
          })}

          {!fontsReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60">
              <Spinner />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => {
            const box = newTextBox({ y: 0.08 + boxes.length * 0.12 })
            setBoxes(prev => [...prev, box])
            setSelectedId(box.id)
          }}>+ Add text</Button>
          <p className="text-[11px] text-text-tertiary">Drag any text to move it. Click the image to deselect.</p>
        </div>
      </div>

      {/* ── Inspector ── */}
      <div className="space-y-3">
        {!selected ? (
          <div className="rounded-2xl border border-border bg-surface-subtle/50 p-4">
            <p className="text-xs text-text-secondary leading-relaxed">
              Select a text box to style it, or add a new one.
            </p>
            <p className="text-[11px] text-text-tertiary mt-2 leading-relaxed">
              Text added here is real text, not part of the picture — Arabic always renders
              correctly, and you can come back and change the wording later.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-white p-4 space-y-3">
            <textarea
              value={selected.text}
              onChange={e => updateText(selected.id, e.target.value)}
              rows={3}
              dir={selected.dir}
              className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-amber-400"
              style={{ fontFamily: `"${selected.family}", sans-serif` }}
            />

            <div className="grid grid-cols-2 gap-2">
              <Select label="Font" value={selected.family} onChange={e => update(selected.id, { family: e.target.value })}>
                {availableFonts.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
              <Select label="Weight" value={selected.weight} onChange={e => update(selected.id, { weight: Number(e.target.value) })}>
                {WEIGHTS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
              </Select>
            </div>

            <div>
              <p className="text-xs font-medium text-text-secondary mb-1">Size</p>
              <input type="range" min={0.02} max={0.30} step={0.005} value={selected.size}
                onChange={e => update(selected.id, { size: Number(e.target.value) })} className="w-full accent-amber-600" />
            </div>

            <div>
              <p className="text-xs font-medium text-text-secondary mb-1">Text width</p>
              <input type="range" min={0.15} max={1} step={0.01} value={selected.w}
                onChange={e => update(selected.id, { w: Number(e.target.value) })} className="w-full accent-amber-600" />
            </div>

            <div>
              <p className="text-xs font-medium text-text-secondary mb-1">Line spacing</p>
              <input type="range" min={0.9} max={2} step={0.05} value={selected.lineHeight}
                onChange={e => update(selected.id, { lineHeight: Number(e.target.value) })} className="w-full accent-amber-600" />
            </div>

            <div className="grid grid-cols-2 gap-2 items-end">
              <div>
                <p className="text-xs font-medium text-text-secondary mb-1">Colour</p>
                <div className="flex items-center gap-2">
                  <input type="color" value={selected.color}
                    onChange={e => update(selected.id, { color: e.target.value })}
                    className="w-9 h-9 rounded-lg border border-border cursor-pointer bg-white" />
                  <div className="flex gap-1">
                    {['#ffffff', '#000000', '#d4af37', '#c8a24a'].map(c => (
                      <button key={c} onClick={() => update(selected.id, { color: c })}
                        style={{ background: c }}
                        className="w-6 h-6 rounded-md border border-border" title={c} />
                    ))}
                  </div>
                </div>
              </div>
              <Select label="Align" value={selected.align} onChange={e => update(selected.id, { align: e.target.value })}>
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
              </Select>
            </div>

            <Select label="Direction" value={selected.dir}
              onChange={e => update(selected.id, { dir: e.target.value, dirTouched: true })}>
              <option value="ltr">Left to right (English)</option>
              <option value="rtl">Right to left (Arabic)</option>
            </Select>

            <Toggle checked={selected.shadow} onChange={e => update(selected.id, { shadow: e.target.checked })}
              label="Drop shadow (helps over photos)" />

            <button
              onClick={() => { setBoxes(prev => prev.filter(b => b.id !== selected.id)); setSelectedId(null) }}
              className="text-[11px] font-semibold text-red-600 hover:text-red-700">
              Delete this text
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !fontsReady}>
            {saving ? <><Spinner size="sm" /> Saving…</> : 'Save text'}
          </Button>
        </div>
      </div>
    </div>
  )
}
