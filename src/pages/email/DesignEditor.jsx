import { useMemo, useRef, useState } from 'react'
import { Button, Input, Select, Textarea, Modal } from '../../components/ui/index'
import { useAuth } from '../../store/auth'
import { uploadBrandAsset } from '../../lib/brandAssets'
import { MERGE_TAGS } from '../../lib/email/render'
import {
  BLOCK_TYPES, FONTS, blockHtml, brandSwatches, makeBlock, normalizeDesign, renderDesign, safeColor, newId,
} from '../../lib/email/design'
import { EIcon } from './parts'

// ─── The drag-and-drop email editor ────────────────────────────────────────
// Modelled on Brevo's editor, which people already know: blocks on the left,
// the email in the middle, the selected block's settings on the right.
//
//   • drag a block from the left onto the email, or just click it to add it
//     under the selected block
//   • drag a block by its handle to move it; the arrows do the same without
//     a mouse
//   • click a block to edit it; click the empty page for the overall style
//
// The canvas draws each block with the SAME function that builds the sent
// email (blockHtml), so the canvas cannot drift from what arrives.

const DRAG_NEW = 'application/x-email-new'
const DRAG_MOVE = 'application/x-email-move'
const PALETTE = ['logo', 'heading', 'text', 'image', 'button', 'columns', 'divider', 'spacer', 'social']
const HISTORY = 40

const PALETTE_ICONS = {
  logo: <path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8l5.5-.8z" />,
  heading: <path d="M6 4v16M18 4v16M6 12h12" />,
  text: <path d="M4 6h16M4 12h16M4 18h10" />,
  image: <><rect x="3" y="4" width="18" height="16" /><circle cx="9" cy="10" r="2" /><path d="M21 17l-5-5-9 8" /></>,
  button: <><rect x="3" y="8" width="18" height="8" /><path d="M9 12h6" /></>,
  columns: <><rect x="3" y="5" width="8" height="14" /><path d="M14 8h7M14 12h7M14 16h5" /></>,
  divider: <path d="M3 12h18" />,
  spacer: <path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4" />,
  social: <><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 11l8-4M8 13l8 4" /></>,
}

function PaletteIcon({ type }) {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">{PALETTE_ICONS[type]}</svg>
}

export function DesignEditor({ design, onChange, language, kit, sample, sender, subject, preheader, onReplaceFromTemplate }) {
  const d = useMemo(() => normalizeDesign(design), [design])
  const [selectedId, setSelectedId] = useState(null)
  const [dropAt, setDropAt] = useState(null)        // index a drag would drop at
  const [view, setView] = useState('edit')          // edit | desktop | mobile
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])
  const rtl = language === 'ar'
  const selected = d.blocks.find(b => b.id === selectedId) || null
  const swatches = useMemo(() => brandSwatches(kit?.brandColors), [kit?.brandColors])

  function commit(next, { record = true } = {}) {
    if (record) {
      setPast(p => [...p.slice(-HISTORY + 1), d])
      setFuture([])
    }
    onChange(normalizeDesign(next))
  }
  const setBlocks = blocks => commit({ ...d, blocks })
  const setStyle = patch => commit({ ...d, style: { ...d.style, ...patch } })
  const updateBlock = (id, patch) => commit({ ...d, blocks: d.blocks.map(b => (b.id === id ? { ...b, ...patch } : b)) })

  function undo() {
    if (!past.length) return
    setFuture(f => [d, ...f])
    const prev = past[past.length - 1]
    setPast(p => p.slice(0, -1))
    onChange(prev)
  }
  function redo() {
    if (!future.length) return
    setPast(p => [...p, d])
    const next = future[0]
    setFuture(f => f.slice(1))
    onChange(next)
  }

  function prefill(type) {
    // New logo and image blocks start with the brand's own picture, which is
    // what someone reaches for nine times out of ten.
    if (type === 'logo' && kit?.logos?.[0]) return { src: kit.logos[0].public_url, alt: 'Logo' }
    if (type === 'button' && kit?.website) return { href: kit.website }
    return {}
  }

  function insertAt(index, type) {
    const block = makeBlock(type, prefill(type))
    const blocks = [...d.blocks]
    blocks.splice(index, 0, block)
    setBlocks(blocks)
    setSelectedId(block.id)
  }
  function addBelowSelected(type) {
    const i = selected ? d.blocks.findIndex(b => b.id === selected.id) + 1 : d.blocks.length
    insertAt(i, type)
  }
  function moveTo(id, index) {
    const from = d.blocks.findIndex(b => b.id === id)
    if (from < 0) return
    const blocks = [...d.blocks]
    const [b] = blocks.splice(from, 1)
    blocks.splice(index > from ? index - 1 : index, 0, b)
    setBlocks(blocks)
  }
  const nudge = (id, delta) => {
    const i = d.blocks.findIndex(b => b.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= d.blocks.length) return
    const blocks = [...d.blocks]
    ;[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
    setBlocks(blocks)
  }
  function duplicate(id) {
    const i = d.blocks.findIndex(b => b.id === id)
    const copy = { ...d.blocks[i], id: newId() }
    const blocks = [...d.blocks]
    blocks.splice(i + 1, 0, copy)
    setBlocks(blocks)
    setSelectedId(copy.id)
  }
  function remove(id) {
    setBlocks(d.blocks.filter(b => b.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  function onDrop(e, index) {
    e.preventDefault()
    setDropAt(null)
    const type = e.dataTransfer.getData(DRAG_NEW)
    const id = e.dataTransfer.getData(DRAG_MOVE)
    if (type && BLOCK_TYPES[type]) insertAt(index, type)
    else if (id) moveTo(id, index)
  }
  const allowDrop = index => e => {
    if (![...e.dataTransfer.types].some(t => t === DRAG_NEW || t === DRAG_MOVE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = [...e.dataTransfer.types].includes(DRAG_MOVE) ? 'move' : 'copy'
    if (dropAt !== index) setDropAt(index)
  }

  const preview = useMemo(() => (view === 'edit' ? null : renderDesign({
    design: d, subject, preheader, language, contact: sample, sender, unsubscribeUrl: '#unsubscribe',
  })), [view, d, subject, preheader, language, sample, sender])

  return (
    <div className="border border-border bg-white">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
        <div className="flex">
          {[['edit', 'Edit'], ['desktop', 'Desktop preview'], ['mobile', 'Phone preview']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setView(k)}
              className={`px-3 py-1.5 text-xs font-semibold border -ml-px first:ml-0 ${view === k ? 'bg-amber-700 text-white border-amber-700 relative z-10' : 'bg-white text-text-secondary border-border hover:bg-surface-subtle'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="xs" variant="ghost" onClick={undo} disabled={!past.length} title="Undo">Undo</Button>
        <Button size="xs" variant="ghost" onClick={redo} disabled={!future.length} title="Redo">Redo</Button>
        {onReplaceFromTemplate && <Button size="xs" variant="secondary" onClick={onReplaceFromTemplate}>Templates</Button>}
      </div>

      {view !== 'edit' ? (
        <div className="bg-surface-muted p-4 flex justify-center">
          <iframe title="Email preview" srcDoc={preview.html} sandbox=""
            className="bg-white border border-border" style={{ width: view === 'mobile' ? 375 : 680, height: 720, maxWidth: '100%' }} />
        </div>
      ) : (
        <div className="grid lg:grid-cols-[168px_minmax(0,1fr)_300px] min-h-[640px]">
          {/* ── Blocks ── */}
          <div className="border-b lg:border-b-0 lg:border-r border-border p-3">
            <p className="eyebrow mb-2">Blocks</p>
            <p className="text-[10px] text-text-tertiary mb-2 leading-snug">Drag onto the email, or click to add below the selected block.</p>
            <div className="grid grid-cols-3 lg:grid-cols-2 gap-1.5">
              {PALETTE.map(type => (
                <button key={type} type="button" draggable
                  onDragStart={e => { e.dataTransfer.setData(DRAG_NEW, type); e.dataTransfer.effectAllowed = 'copy' }}
                  onDragEnd={() => setDropAt(null)}
                  onClick={() => addBelowSelected(type)}
                  title={BLOCK_TYPES[type].hint}
                  className="flex flex-col items-center gap-1 px-1 py-2 border border-border bg-white text-text-secondary hover:border-amber-700 hover:text-amber-800 cursor-grab active:cursor-grabbing">
                  <PaletteIcon type={type} />
                  <span className="text-[10px] font-semibold leading-tight text-center">{BLOCK_TYPES[type].label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Canvas ── */}
          <div className="p-4 overflow-x-auto" style={{ background: d.style.background }} onClick={() => setSelectedId(null)}>
            <div className="mx-auto" style={{ maxWidth: 600, background: d.style.panel }} dir={rtl ? 'rtl' : 'ltr'}>
              {d.blocks.length === 0 && (
                <div onDragOver={allowDrop(0)} onDrop={e => onDrop(e, 0)} onDragLeave={() => setDropAt(null)}
                  className={`m-4 border-2 border-dashed py-16 text-center text-sm ${dropAt === 0 ? 'border-amber-700 bg-amber-50 text-amber-800' : 'border-stone-300 text-text-tertiary'}`}>
                  Drag a block here, or click one on the left.
                </div>
              )}
              {d.blocks.map((b, i) => (
                <div key={b.id}>
                  <DropLine active={dropAt === i} onDragOver={allowDrop(i)} onDrop={e => onDrop(e, i)} onDragLeave={() => setDropAt(null)} />
                  <CanvasBlock
                    block={b} style={d.style} contact={sample} rtl={rtl}
                    selected={b.id === selectedId}
                    onSelect={e => { e.stopPropagation(); setSelectedId(b.id) }}
                    onUp={() => nudge(b.id, -1)} onDown={() => nudge(b.id, 1)}
                    onDuplicate={() => duplicate(b.id)} onRemove={() => remove(b.id)}
                    first={i === 0} last={i === d.blocks.length - 1}
                  />
                </div>
              ))}
              {d.blocks.length > 0 && (
                <DropLine active={dropAt === d.blocks.length} tall onDragOver={allowDrop(d.blocks.length)} onDrop={e => onDrop(e, d.blocks.length)} onDragLeave={() => setDropAt(null)} />
              )}
              <div className="px-8 py-3 text-[11px] text-stone-400 border-t border-dashed border-stone-200" style={{ textAlign: rtl ? 'right' : 'left' }}>
                Footer, added automatically: why they receive this, your address, unsubscribe link.
              </div>
            </div>
          </div>

          {/* ── Settings ── */}
          <div className="border-t lg:border-t-0 lg:border-l border-border p-4 space-y-4 overflow-y-auto max-h-[760px] scrollbar-thin">
            {selected ? (
              <BlockSettings key={selected.id} block={selected} kit={kit} swatches={swatches} accent={d.style.accent}
                onChange={patch => updateBlock(selected.id, patch)}
                onDone={() => setSelectedId(null)} />
            ) : (
              <StyleSettings style={d.style} swatches={swatches} onChange={setStyle} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function DropLine({ active, tall = false, ...handlers }) {
  return (
    <div {...handlers} className={`${tall ? 'h-8' : 'h-2'} relative`}>
      {active && <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 h-1 bg-amber-700" />}
    </div>
  )
}

function CanvasBlock({ block, style, contact, rtl, selected, onSelect, onUp, onDown, onDuplicate, onRemove, first, last }) {
  const html = blockHtml(block, { style, contact, rtl })
  const empty = !html
  return (
    <div
      onClick={onSelect}
      draggable
      onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData(DRAG_MOVE, block.id); e.dataTransfer.effectAllowed = 'move' }}
      className={`group relative cursor-pointer outline outline-2 -outline-offset-2 ${selected ? 'outline-amber-700' : 'outline-transparent hover:outline-amber-300'}`}
    >
      {empty ? (
        <div className="mx-8 my-2 border border-dashed border-stone-300 bg-stone-50 py-6 text-center text-xs text-text-tertiary">
          {BLOCK_TYPES[block.type].label}: {block.type === 'button' ? 'add a link' : block.type === 'social' ? 'add at least one link' : 'choose a picture'}
        </div>
      ) : (
        // Built by our own renderer, which escapes every value a person typed:
        // the same HTML that is sent.
        <table role="presentation" width="100%" cellSpacing="0" cellPadding="0" style={{ pointerEvents: 'none' }}>
          <tbody dangerouslySetInnerHTML={{ __html: html }} />
        </table>
      )}
      <div className={`absolute top-1 ${rtl ? 'left-1' : 'right-1'} flex bg-white border border-border shadow-sm ${selected ? 'flex' : 'hidden group-hover:flex'}`}
        onClick={e => e.stopPropagation()}>
        <span className="px-1.5 py-1 text-[10px] font-semibold text-text-tertiary cursor-grab select-none" title="Drag to move">⋮⋮ {BLOCK_TYPES[block.type].label}</span>
        <IconBtn label="Move up" onClick={onUp} disabled={first}>↑</IconBtn>
        <IconBtn label="Move down" onClick={onDown} disabled={last}>↓</IconBtn>
        <IconBtn label="Duplicate" onClick={onDuplicate}>⧉</IconBtn>
        <IconBtn label="Delete" onClick={onRemove}><EIcon name="trash" /></IconBtn>
      </div>
    </div>
  )
}

function IconBtn({ label, onClick, disabled, children }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className="w-6 h-6 flex items-center justify-center text-xs text-text-secondary hover:bg-surface-subtle hover:text-text disabled:opacity-30 border-l border-border">
      {children}
    </button>
  )
}

// ─── Settings panels ───────────────────────────────────────────────────────

function Field({ label, children }) {
  return <div><p className="eyebrow mb-1.5">{label}</p>{children}</div>
}

function AlignPicker({ value, onChange }) {
  return (
    <div className="flex">
      {[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`flex-1 px-2 py-1.5 text-[11px] font-semibold border -ml-px first:ml-0 ${value === k ? 'bg-amber-700 text-white border-amber-700 relative z-10' : 'bg-white text-text-secondary border-border'}`}>
          {l}
        </button>
      ))}
    </div>
  )
}

function ColorPicker({ value, onChange, swatches = [], allowDefault = false, defaultLabel = 'Default' }) {
  const presets = [...new Set([...swatches, '#4c5e61', '#1a1a1a', '#8a7a5c', '#7a1f2b', '#2f6f4f', '#ffffff', '#f4f3f0'])].slice(0, 12)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {allowDefault && (
          <button type="button" onClick={() => onChange('')}
            className={`px-2 h-6 text-[10px] font-semibold border ${!value ? 'border-amber-700 text-amber-800' : 'border-border text-text-secondary'}`}>{defaultLabel}</button>
        )}
        {presets.map(c => (
          <button key={c} type="button" aria-label={c} title={swatches.includes(c) ? `${c} (brand)` : c} onClick={() => onChange(c)}
            className={`w-6 h-6 border ${value?.toLowerCase() === c ? 'ring-2 ring-amber-700 ring-offset-1' : 'border-stone-300'}`} style={{ background: c }} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input type="color" value={safeColor(value, '#4c5e61').length === 4 ? '#4c5e61' : safeColor(value, '#4c5e61')} onChange={e => onChange(e.target.value)}
          className="w-8 h-8 border border-border p-0 bg-white cursor-pointer" aria-label="Pick a colour" />
        <input value={value || ''} onChange={e => onChange(e.target.value)} placeholder="#4c5e61"
          className="flex-1 border border-border px-2 py-1.5 text-xs font-mono" />
      </div>
      {swatches.length > 0 && <p className="text-[10px] text-text-tertiary">The first swatches are your Brand Brain colours.</p>}
    </div>
  )
}

function StyleSettings({ style, swatches, onChange }) {
  return (
    <>
      <div>
        <p className="text-sm font-semibold text-text">Email style</p>
        <p className="text-[11px] text-text-tertiary mt-0.5">Click a block to edit it. These apply to the whole email.</p>
      </div>
      <Field label="Font">
        <Select value={style.font} onChange={e => onChange({ font: e.target.value })}>
          {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
        </Select>
      </Field>
      <Field label="Buttons and links"><ColorPicker value={style.accent} swatches={swatches} onChange={v => onChange({ accent: v })} /></Field>
      <Field label="Text"><ColorPicker value={style.text} swatches={swatches} onChange={v => onChange({ text: v })} /></Field>
      <Field label="Email background"><ColorPicker value={style.panel} swatches={swatches} onChange={v => onChange({ panel: v })} /></Field>
      <Field label="Page around the email"><ColorPicker value={style.background} swatches={swatches} onChange={v => onChange({ background: v })} /></Field>
      <p className="text-[10px] text-text-tertiary leading-relaxed">Inboxes only show a few safe fonts, so the list is short on purpose. Dark text on a light background reads best in every inbox, including dark mode.</p>
    </>
  )
}

function TextWithTools({ value, onChange, rows = 6, rtl }) {
  const ref = useRef(null)
  function wrap(fn) {
    const el = ref.current?.querySelector('textarea')
    const v = value || ''
    if (!el) { onChange(v + fn('')); return }
    const a = el.selectionStart ?? v.length
    const b = el.selectionEnd ?? v.length
    const ins = fn(v.slice(a, b))
    onChange(v.slice(0, a) + ins + v.slice(b))
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + ins.length })
  }
  return (
    <div ref={ref} className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        <Tool onClick={() => wrap(s => `**${s || 'bold'}**`)}>Bold</Tool>
        <Tool onClick={() => wrap(s => `[${s || 'link text'}](https://)`)}>Link</Tool>
        <Tool onClick={() => wrap(() => '\n- ')}>Bullet</Tool>
        <select className="text-[11px] border border-border bg-white px-1 py-0.5 text-text-secondary" value=""
          onChange={e => { const t = e.target.value; if (t) wrap(() => `{{${t}${t === 'first_name' ? '|there' : ''}}}`) }}>
          <option value="">Field…</option>
          {MERGE_TAGS.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
      </div>
      <Textarea rows={rows} value={value} onChange={e => onChange(e.target.value)} dir={rtl ? 'rtl' : 'ltr'} />
      <p className="text-[10px] text-text-tertiary">Blank line = new paragraph.</p>
    </div>
  )
}

function Tool({ onClick, children }) {
  return <button type="button" onClick={onClick} className="px-1.5 py-0.5 text-[11px] font-semibold border border-border bg-white text-text-secondary hover:bg-surface-subtle">{children}</button>
}

function BlockSettings({ block, kit, swatches, accent, onChange, onDone }) {
  const [picking, setPicking] = useState(false)
  const t = block.type
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text">{BLOCK_TYPES[t].label}</p>
        <Button size="xs" variant="ghost" onClick={onDone}>Done</Button>
      </div>

      {(t === 'logo' || t === 'image' || t === 'columns') && (
        <Field label="Picture">
          {block.src ? (
            <div className="space-y-1.5">
              <div className="border border-border bg-stone-500 p-2 flex justify-center"><img src={block.src} alt="" className="max-h-28 object-contain" /></div>
              <div className="flex gap-2">
                <Button size="xs" variant="secondary" onClick={() => setPicking(true)}>Change</Button>
                <Button size="xs" variant="ghost" onClick={() => onChange({ src: '' })}>Remove</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>Choose a picture</Button>
          )}
        </Field>
      )}
      {(t === 'image' || t === 'columns' || t === 'logo') && (
        <Input label="Description (alt text)" value={block.alt} onChange={e => onChange({ alt: e.target.value })}
          hint="Shown when pictures are blocked, and read aloud by screen readers." />
      )}
      {t === 'logo' && (
        <Field label={`Width: ${block.width}px`}>
          <input type="range" min={60} max={300} step={10} value={block.width} onChange={e => onChange({ width: Number(e.target.value) })} className="w-full" />
        </Field>
      )}
      {t === 'image' && (
        <Field label={`Width: ${block.width}%`}>
          <input type="range" min={30} max={100} step={5} value={block.width} onChange={e => onChange({ width: Number(e.target.value) })} className="w-full" />
        </Field>
      )}

      {t === 'heading' && (
        <>
          <Input label="Heading" value={block.text} onChange={e => onChange({ text: e.target.value })} />
          <Field label="Size">
            <Select value={block.size} onChange={e => onChange({ size: e.target.value })}>
              <option value="lg">Large</option>
              <option value="md">Medium</option>
            </Select>
          </Field>
        </>
      )}
      {t === 'text' && <Field label="Text"><TextWithTools value={block.text} onChange={v => onChange({ text: v })} rows={9} /></Field>}
      {t === 'columns' && (
        <>
          <Field label="Text beside the picture"><TextWithTools value={block.text} onChange={v => onChange({ text: v })} rows={5} /></Field>
          <Field label="Picture on the">
            <div className="flex">
              {[['left', 'Left'], ['right', 'Right']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => onChange({ imageSide: k })}
                  className={`flex-1 px-2 py-1.5 text-[11px] font-semibold border -ml-px first:ml-0 ${block.imageSide === k ? 'bg-amber-700 text-white border-amber-700 relative z-10' : 'bg-white text-text-secondary border-border'}`}>{l}</button>
              ))}
            </div>
          </Field>
        </>
      )}

      {t === 'button' && (
        <>
          <Input label="Button text" value={block.label} onChange={e => onChange({ label: e.target.value })} maxLength={40} />
          <Input label="Link" value={block.href} onChange={e => onChange({ href: e.target.value })} placeholder="https://" />
          <Field label="Colour"><ColorPicker value={block.color} swatches={swatches} allowDefault defaultLabel="Style colour" onChange={v => onChange({ color: v })} /></Field>
          <p className="text-[10px] text-text-tertiary">The style colour is {accent}. One button per email gets the most clicks.</p>
        </>
      )}
      {(t === 'logo' || t === 'image' || t === 'columns') && (
        <Input label="Link when clicked (optional)" value={block.href} onChange={e => onChange({ href: e.target.value })} placeholder="https://" />
      )}

      {['logo', 'heading', 'text', 'image', 'button'].includes(t) && (
        <Field label="Alignment"><AlignPicker value={block.align} onChange={v => onChange({ align: v })} /></Field>
      )}

      {t === 'divider' && <Field label="Line colour"><ColorPicker value={block.color} swatches={swatches} onChange={v => onChange({ color: v })} /></Field>}
      {t === 'spacer' && (
        <Field label={`Height: ${block.height}px`}>
          <input type="range" min={8} max={96} step={4} value={block.height} onChange={e => onChange({ height: Number(e.target.value) })} className="w-full" />
        </Field>
      )}
      {t === 'social' && (
        <Field label="Links">
          <div className="space-y-2">
            {(block.links || []).map((l, i) => (
              <div key={i} className="flex gap-1.5">
                <input className="w-24 border border-border px-2 py-1.5 text-xs" value={l.label} placeholder="Label"
                  onChange={e => onChange({ links: block.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <input className="flex-1 min-w-0 border border-border px-2 py-1.5 text-xs" value={l.href} placeholder="https://"
                  onChange={e => onChange({ links: block.links.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)) })} />
                <button type="button" aria-label="Remove link" className="px-1.5 text-text-tertiary hover:text-red-600"
                  onClick={() => onChange({ links: block.links.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            {(block.links || []).length < 6 && (
              <Button size="xs" variant="secondary" onClick={() => onChange({ links: [...(block.links || []), { label: '', href: 'https://' }] })}>+ Add link</Button>
            )}
            <p className="text-[10px] text-text-tertiary">Links still showing just https:// are left out of the email.</p>
          </div>
        </Field>
      )}

      {picking && (
        <ImagePicker kit={kit} logoFirst={t === 'logo'} onClose={() => setPicking(false)}
          onPick={(url, alt) => { onChange({ src: url, ...(block.alt ? {} : { alt: alt || '' }) }); setPicking(false) }} />
      )}
    </>
  )
}

// ─── Picture picker ────────────────────────────────────────────────────────
// Brand Brain first (logo, then photos), then upload, then a link. Uploads go
// to Brand Brain's public asset library, tagged "email", so they are reusable
// and an inbox can load them without signing in.

function ImagePicker({ kit, logoFirst, onClose, onPick }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [tab, setTab] = useState('brand')
  const [url, setUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [extra, setExtra] = useState([])
  const logos = kit?.logos || []
  const photos = [...extra, ...(kit?.photos || [])]
  const groups = logoFirst ? [['Your logo', logos], ['Brand Brain pictures', photos]] : [['Brand Brain pictures', photos], ['Your logo', logos]]

  async function upload(file) {
    if (!file) return
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) { setError('Use a PNG, JPG, GIF or WebP picture.'); return }
    if (file.size > 5 * 1024 * 1024) { setError('Keep email pictures under 5 MB (under 1 MB is better: big pictures load slowly on phones).'); return }
    setUploading(true); setError('')
    const r = await uploadBrandAsset(activeWorkspaceId, accessToken, file, 'other', 'email')
    setUploading(false)
    if (r.error) { setError(r.error); return }
    setExtra(x => [r.row, ...x])
    onPick(r.row.public_url, r.row.title)
  }

  return (
    <Modal open onClose={onClose} title="Choose a picture" width="max-w-3xl">
      <div className="p-5 space-y-4">
        <div className="flex">
          {[['brand', 'From Brand Brain'], ['upload', 'Upload'], ['link', 'Paste a link']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-xs font-semibold border -ml-px first:ml-0 ${tab === k ? 'bg-amber-700 text-white border-amber-700 relative z-10' : 'bg-white text-text-secondary border-border'}`}>{l}</button>
          ))}
        </div>
        {tab === 'brand' && (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto scrollbar-thin">
            {groups.map(([title, list]) => (
              <div key={title}>
                <p className="eyebrow mb-2">{title}</p>
                {list.length === 0 ? (
                  <p className="text-xs text-text-tertiary">None yet. Add pictures in Brand Brain → Assets, or upload one here.</p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {list.map(a => (
                      <button key={a.id} type="button" onClick={() => onPick(a.public_url, a.title)}
                        className="border border-border hover:border-amber-700 bg-stone-500 aspect-square flex items-center justify-center overflow-hidden">
                        <img src={a.public_url} alt={a.title || ''} className="max-w-full max-h-full object-contain" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {tab === 'upload' && (
          <div className="space-y-2">
            <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold border border-border bg-white hover:bg-surface-subtle cursor-pointer">
              {uploading ? 'Uploading…' : 'Choose a picture from your computer'}
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" disabled={uploading} onChange={e => upload(e.target.files?.[0])} />
            </label>
            <p className="text-[11px] text-text-tertiary">Saved to Brand Brain's picture library so it can be reused. JPG for photos, PNG for logos; under 1 MB is best.</p>
          </div>
        )}
        {tab === 'link' && (
          <div className="flex gap-2 items-end">
            <Input className="flex-1" label="Picture address" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/photo.jpg"
              hint="Must start with https:// and open without signing in." />
            <Button onClick={() => (/^https:\/\//i.test(url.trim()) ? onPick(url.trim(), '') : setError('The address must start with https://'))}>Use</Button>
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
