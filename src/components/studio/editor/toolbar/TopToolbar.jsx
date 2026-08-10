import { WEIGHTS, fontsFor } from '../../fonts'
import { EFFECTS, ANCHORS } from '../../overlayModel'
import { ToolbarButton, ToolbarDivider, ToolbarMenu, MenuItem, NumberField, ColorField, SliderField } from '../controls'

// ─── The contextual toolbar above the canvas ───────────────────────────────
// Canva's model, adopted directly: the toolbar shows the controls for
// WHATEVER IS SELECTED, and the side panel is for inserting things. The old
// editor inverted that — a fixed row of "Text / Rect / Ellipse / Crop /
// Adjust / Rotate / Undo" mixed insert actions, photo actions and history in
// one strip, and every style control lived in a right-hand panel no matter
// what you'd clicked on.
//
// Sizes are shown in PIXELS here even though the model stores fractions
// (see document.js) — "72" is a font size a person can reason about, "0.075"
// is not. The conversion is one multiply by the document height, done at the
// edge of the UI so nothing downstream has to know about it.

export function TopToolbar({
  doc, selection, tool, panel,
  canUndo, canRedo, onUndo, onRedo,
  onPatch, onBeginChange, onOpenPanel,
  onRotate, onFlip, onStartCrop, canRotate, onCopyStyle, painting, documentColors,
}) {
  const H = doc.height
  const single = selection.length === 1 ? selection[0] : null
  const many = selection.length > 1

  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-border bg-white px-1.5 py-1.5">
      <ToolbarButton title="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo}>↶</ToolbarButton>
      <ToolbarButton title="Redo (⇧⌘Z)" onClick={onRedo} disabled={!canRedo}>↷</ToolbarButton>
      <ToolbarDivider />

      {!selection.length && (
        <PhotoControls tool={tool} panel={panel} onOpenPanel={onOpenPanel} canRotate={canRotate}
          onRotate={onRotate} onFlip={onFlip} onStartCrop={onStartCrop} />
      )}

      {single?.type === 'text' && (
        <TextControls layer={single} H={H} onPatch={onPatch} onBeginChange={onBeginChange} documentColors={documentColors} />
      )}
      {(single?.type === 'rect' || single?.type === 'ellipse') && (
        <ShapeControls layer={single} H={H} onPatch={onPatch} onBeginChange={onBeginChange} documentColors={documentColors} />
      )}
      {(single?.type === 'line' || single?.type === 'arrow') && (
        <PathControls layer={single} H={H} onPatch={onPatch} onBeginChange={onBeginChange} documentColors={documentColors} />
      )}
      {single?.type === 'image' && (
        <ImageControls layer={single} H={H} onPatch={onPatch} onBeginChange={onBeginChange} />
      )}
      {many && <span className="px-2 text-[12px] text-text-secondary">{selection.length} selected</span>}

      {!!selection.length && (
        <>
          <ToolbarDivider />
          <OpacityControl selection={selection} onPatch={onPatch} onBeginChange={onBeginChange} />
        </>
      )}

      <span className="flex-1" />
      {single && (
        <ToolbarButton active={painting} onClick={onCopyStyle}
          title={painting ? 'Now click the layer to paint this style onto (Esc to cancel)' : 'Copy this style, then click another layer to apply it'}>
          🖌 {painting ? 'Pick a target' : 'Copy style'}
        </ToolbarButton>
      )}
      <ToolbarButton title="Position, align and layers" active={panel === 'position'} onClick={() => onOpenPanel('position')}>Position</ToolbarButton>
    </div>
  )
}

// ── Nothing selected: the photo itself is the subject ──────────────────────
function PhotoControls({ tool, panel, onOpenPanel, canRotate, onRotate, onFlip, onStartCrop }) {
  // Rotate/flip transform the PHOTO, not the layers sitting on it, so they
  // stay gated to a document with nothing on it yet — remapping a 90° turn
  // across live text and shapes is real geometry (a text layer's stored
  // origin sits inside its shadow padding, and its rotation pivots on a
  // different corner than an ellipse's) and it is not in this pass. Crop,
  // unlike rotate, stays available throughout: it's a pure translate+scale
  // and every layer's fractional coordinates remap for it exactly.
  const why = canRotate ? '' : ' — only available before any layer is added'
  return (
    <>
      <ToolbarButton title="Crop the photo" active={tool === 'crop'} onClick={onStartCrop}>⬚ Crop</ToolbarButton>
      <ToolbarButton title="Brightness, contrast, saturation" active={panel === 'adjust'} onClick={() => onOpenPanel('adjust')}>🎚 Adjust</ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton title={`Rotate 90° left${why}`} disabled={!canRotate} onClick={() => onRotate(false)}>⟲</ToolbarButton>
      <ToolbarButton title={`Rotate 90° right${why}`} disabled={!canRotate} onClick={() => onRotate(true)}>⟳</ToolbarButton>
      <ToolbarButton title={`Flip horizontally${why}`} disabled={!canRotate} onClick={() => onFlip('horizontal')}>⇋</ToolbarButton>
      <ToolbarButton title={`Flip vertically${why}`} disabled={!canRotate} onClick={() => onFlip('vertical')}>⇅</ToolbarButton>
    </>
  )
}

// ── Text ───────────────────────────────────────────────────────────────────
const ALIGNMENTS = [
  { value: 'left', icon: '⇤', title: 'Align left (⇧⌘L)' },
  { value: 'center', icon: '↔', title: 'Align centre (⇧⌘C)' },
  { value: 'right', icon: '⇥', title: 'Align right (⇧⌘R)' },
  { value: 'justify', icon: '≡', title: 'Justify' },
]

function TextControls({ layer, H, onPatch, onBeginChange, documentColors }) {
  const fonts = fontsFor(layer.dir || 'ltr')
  const sizePx = Math.round(layer.size * H)
  const weightLabel = WEIGHTS.find(w => w.value === layer.weight)?.label || layer.weight
  const effect = layer.effect || 'none'
  const anchor = layer.anchor || 'top'

  function set(patch) { onBeginChange(); onPatch(patch) }

  return (
    <>
      <ToolbarMenu label={layer.family} title="Font" width={230}>
        {fonts.map(f => (
          <MenuItem key={f.value} active={f.value === layer.family}
            style={{ fontFamily: `"${f.value}", sans-serif` }}
            onClick={() => set({ family: f.value })}>
            {f.label}
          </MenuItem>
        ))}
      </ToolbarMenu>
      <ToolbarMenu label={weightLabel} title="Font weight" width={150}>
        {WEIGHTS.map(w => (
          <MenuItem key={w.value} active={w.value === layer.weight} onClick={() => set({ weight: w.value })}>
            {w.label}
          </MenuItem>
        ))}
      </ToolbarMenu>

      <span className="flex items-center gap-0.5">
        <ToolbarButton title="Decrease font size (⇧⌘,)" onClick={() => set({ size: Math.max(0.005, (sizePx - 2) / H) })}>−</ToolbarButton>
        <NumberField value={sizePx} min={4} max={Math.round(H)} step={1} className="w-[74px]"
          onCommitStart={onBeginChange} onChange={px => onPatch({ size: px / H })} />
        <ToolbarButton title="Increase font size (⇧⌘.)" onClick={() => set({ size: (sizePx + 2) / H })}>+</ToolbarButton>
      </span>

      <ColorField value={layer.color} title="Text colour" documentColors={documentColors}
        onCommitStart={onBeginChange} onChange={color => onPatch({ color })} />

      <ToolbarDivider />
      {/* Bold is a jump between two weights rather than a separate flag: the
          weight menu is the real control, and B is the shortcut people reach
          for. Keeping one source of truth means they can't disagree. */}
      <ToolbarButton title="Bold (⌘B)" active={layer.weight >= 700}
        onClick={() => set({ weight: layer.weight >= 700 ? 400 : 700 })}>
        <b>B</b>
      </ToolbarButton>
      <ToolbarButton title="Italic (⌘I)" active={!!layer.italic}
        onClick={() => set({ italic: !layer.italic })}><i>I</i></ToolbarButton>
      <ToolbarButton title="Underline (⌘U)" active={!!layer.underline}
        onClick={() => set({ underline: !layer.underline })}><u>U</u></ToolbarButton>
      <ToolbarButton title="Strikethrough (⇧⌘S)" active={!!layer.strike}
        onClick={() => set({ strike: !layer.strike })}><s>S</s></ToolbarButton>
      <ToolbarButton title="Uppercase (⇧⌘K)" active={!!layer.uppercase}
        onClick={() => set({ uppercase: !layer.uppercase })}>aA</ToolbarButton>

      <ToolbarDivider />
      {ALIGNMENTS.map(a => (
        <ToolbarButton key={a.value} title={a.title} active={layer.align === a.value}
          onClick={() => set({ align: a.value })}>{a.icon}</ToolbarButton>
      ))}

      <SpacingMenu layer={layer} onPatch={onPatch} onBeginChange={onBeginChange} />
      <EffectsMenu layer={layer} effect={effect} onPatch={onPatch} onBeginChange={onBeginChange} documentColors={documentColors} />

      <ToolbarMenu label={`Anchor: ${anchor}`} title="Which edge of the text block stays put as it re-wraps" width={210}>
        {ANCHORS.map(a => (
          <MenuItem key={a.value} active={anchor === a.value} onClick={() => set({ anchor: a.value })}>{a.label}</MenuItem>
        ))}
      </ToolbarMenu>

      <ToolbarMenu label={layer.dir === 'rtl' ? 'RTL' : 'LTR'} title="Text direction" width={190}>
        <MenuItem active={layer.dir === 'ltr'} onClick={() => set({ dir: 'ltr', dirTouched: true })}>Left to right (English)</MenuItem>
        <MenuItem active={layer.dir === 'rtl'} onClick={() => set({ dir: 'rtl', dirTouched: true })}>Right to left (Arabic)</MenuItem>
      </ToolbarMenu>
      <ToolbarButton title="Drop shadow — helps text stay legible over photography"
        active={!!layer.shadow} onClick={() => set({ shadow: !layer.shadow })}>Shadow</ToolbarButton>
    </>
  )
}

// Line and letter spacing together, since they're the two knobs you reach for
// in the same breath and neither deserves permanent toolbar width.
function SpacingMenu({ layer, onPatch, onBeginChange }) {
  return (
    <ToolbarMenu label="Spacing" title="Line and letter spacing" width={230} closeOnClick={false}>
      <div className="space-y-3 p-2">
        <SliderField label="Line spacing" min={0.7} max={2.5} step={0.05}
          value={layer.lineHeight} format={v => v.toFixed(2)}
          onCommitStart={onBeginChange} onChange={lineHeight => onPatch({ lineHeight })} />
        {/* Letter spacing is stored in em so it stays proportional when the
            type is resized — a fixed pixel tracking would come apart the
            moment someone drags a corner handle. */}
        <SliderField label="Letter spacing" min={-0.05} max={0.5} step={0.01}
          value={layer.tracking || 0} format={v => `${Math.round(v * 100)}`}
          onCommitStart={onBeginChange} onChange={tracking => onPatch({ tracking })} />
      </div>
    </ToolbarMenu>
  )
}

function EffectsMenu({ layer, effect, onPatch, onBeginChange, documentColors }) {
  const usesColor = EFFECTS.find(e => e.value === effect)?.usesColor
  const label = EFFECTS.find(e => e.value === effect)?.label || 'None'
  return (
    <ToolbarMenu label={`Effect: ${label}`} title="Text effects" width={240} closeOnClick={false}>
      <div className="space-y-2 p-1">
        <div className="grid grid-cols-3 gap-1">
          {EFFECTS.map(e => (
            <button key={e.value} type="button"
              onClick={() => { onBeginChange(); onPatch({ effect: e.value }) }}
              className={`rounded-lg border px-1 py-2 text-[11px] transition-colors ${
                effect === e.value ? 'border-amber-500 bg-amber-100 text-amber-900' : 'border-border text-text-secondary hover:border-amber-400 hover:bg-amber-50'
              }`}>
              {e.label}
            </button>
          ))}
        </div>
        {effect !== 'none' && (
          <div className="space-y-2 px-1 pt-1">
            <SliderField label="Intensity" min={0} max={100} step={1}
              value={layer.effectIntensity ?? 50}
              onCommitStart={onBeginChange} onChange={effectIntensity => onPatch({ effectIntensity })} />
            {usesColor && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-text-secondary">Effect colour</span>
                <ColorField value={layer.effectColor || '#000000'} title="Effect colour" documentColors={documentColors}
                  onCommitStart={onBeginChange} onChange={effectColor => onPatch({ effectColor })} />
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-border px-1 pt-2">
          <span className="text-[11px] text-text-secondary">Highlight</span>
          <ColorField value={layer.bgColor} title="Highlight behind the text" allowNone documentColors={documentColors}
            onCommitStart={onBeginChange} onChange={bgColor => onPatch({ bgColor })} />
        </div>
      </div>
    </ToolbarMenu>
  )
}

// ── Rect / ellipse ─────────────────────────────────────────────────────────
function ShapeControls({ layer, H, onPatch, onBeginChange, documentColors }) {
  return (
    <>
      <ColorField value={layer.fill} title="Fill" allowNone documentColors={documentColors}
        onCommitStart={onBeginChange} onChange={fill => onPatch({ fill })} />
      <ColorField value={layer.stroke} title="Border colour" allowNone documentColors={documentColors}
        onCommitStart={onBeginChange} onChange={stroke => onPatch({ stroke })} />
      <NumberField label="B" value={Math.round((layer.strokeWidth || 0) * H)} min={0} max={Math.round(H / 4)} suffix="px" className="w-[92px]"
        onCommitStart={onBeginChange} onChange={px => onPatch({ strokeWidth: px / H })} />
      {layer.type === 'rect' && (
        <NumberField label="R" value={Math.round((layer.cornerRadius || 0) * H)} min={0} max={Math.round(H / 2)} suffix="px" className="w-[92px]"
          onCommitStart={onBeginChange} onChange={px => onPatch({ cornerRadius: px / H })} />
      )}
    </>
  )
}

// ── Line / arrow ───────────────────────────────────────────────────────────
function PathControls({ layer, H, onPatch, onBeginChange, documentColors }) {
  return (
    <>
      <ColorField value={layer.stroke} title="Colour" documentColors={documentColors}
        onCommitStart={onBeginChange} onChange={stroke => onPatch({ stroke })} />
      <NumberField label="W" value={Math.round((layer.strokeWidth || 0) * H)} min={1} max={Math.round(H / 4)} suffix="px" className="w-[92px]"
        onCommitStart={onBeginChange} onChange={px => onPatch({ strokeWidth: px / H })} />
    </>
  )
}

// ── Image layer ────────────────────────────────────────────────────────────
function ImageControls({ layer, H, onPatch, onBeginChange }) {
  return (
    <NumberField label="R" value={Math.round((layer.cornerRadius || 0) * H)} min={0} max={Math.round(H / 2)} suffix="px" className="w-[92px]"
      onCommitStart={onBeginChange} onChange={px => onPatch({ cornerRadius: px / H })} />
  )
}

// ── Opacity, for every layer type including text ───────────────────────────
// Canva calls this Transparency and offers it on everything; the old editor
// had it on shapes only, so a text layer could never be faded back.
function OpacityControl({ selection, onPatch, onBeginChange }) {
  const value = Math.round((selection[0]?.opacity ?? 1) * 100)
  return (
    <span className="flex items-center gap-1.5 px-1" title="Transparency">
      <span className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">Opacity</span>
      <input type="range" min={5} max={100} step={1} value={value}
        onPointerDown={onBeginChange}
        onChange={e => onPatch({ opacity: Number(e.target.value) / 100 })}
        className="w-20 accent-amber-600" />
      <span className="w-7 text-[11px] tabular-nums text-text-tertiary">{value}%</span>
    </span>
  )
}
