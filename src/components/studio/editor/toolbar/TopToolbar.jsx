import { WEIGHTS, fontsFor } from '../../fonts'
import { EFFECTS, ANCHORS } from '../../overlayModel'
import { DASH_STYLES, isPath, isShape } from '../model/document'
import { MOTIONS, MOTION_LABELS, DEFAULT_MOTION_SECONDS } from '../model/playback'
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
  onRotate, onFlip, onStartCrop, onCopyStyle, painting, palette, isVideo = false,
}) {
  const H = doc.height
  const single = selection.length === 1 ? selection[0] : null
  const many = selection.length > 1

  return (
    // WRAPS rather than scrolls. It used to be `overflow-x-auto`, which on a
    // text selection put a dozen controls — alignment, spacing, effects,
    // anchor, direction, shadow, opacity — behind a horizontal scrollbar most
    // people never found, and made every dropdown inside it a clipped sliver
    // (see the Popover note in controls.jsx). A second row costs ~40px of
    // canvas height and costs nothing in reachability.
    // h-full + content-start: the parent reserves a fixed band so the canvas
    // below never moves when the selection changes what's in here (see the
    // band in index.jsx). Filling that band means the card is one consistent
    // panel rather than a short bar with dead space under it, and packing the
    // wrapped rows to the top stops one row floating in the middle.
    <div className="flex h-full flex-wrap content-start items-center gap-1 rounded-xl border border-border bg-white px-1.5 py-1.5">
      <ToolbarButton title="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo}>↶</ToolbarButton>
      <ToolbarButton title="Redo (⇧⌘Z)" onClick={onRedo} disabled={!canRedo}>↷</ToolbarButton>
      <ToolbarDivider />

      {/* Every one of these reframes or regrades the PHOTO. In video mode the
          photo is only frame one standing in for footage the editor never
          touches, so the whole group is withheld — the caller signals that by
          passing no handlers. Rendering them against undefined would give a row
          of buttons that throw on click. */}
      {!selection.length && onStartCrop && (
        <PhotoControls tool={tool} panel={panel} onOpenPanel={onOpenPanel}
          onRotate={onRotate} onFlip={onFlip} onStartCrop={onStartCrop} />
      )}

      {single?.type === 'text' && (
        <TextControls layer={single} H={H} onPatch={onPatch} onBeginChange={onBeginChange} palette={palette} />
      )}
      {isShape(single) && (
        <ShapeControls layer={single} H={H} onPatch={onPatch} onBeginChange={onBeginChange} palette={palette} />
      )}
      {isPath(single) && (
        <PathControls layer={single} H={H} onPatch={onPatch} onBeginChange={onBeginChange} palette={palette} />
      )}
      {single?.type === 'image' && (
        <ImageControls layer={single} H={H} onPatch={onPatch} onBeginChange={onBeginChange} />
      )}
      {many && <span className="px-2 text-[12px] text-text-secondary">{selection.length} selected</span>}

      {!!selection.length && (
        <>
          <ToolbarDivider />
          <OpacityControl selection={selection} onPatch={onPatch} onBeginChange={onBeginChange} />
          {isVideo && (
            <AnimateMenu selection={selection} onPatch={onPatch} onBeginChange={onBeginChange} />
          )}
        </>
      )}

      {/* Pinned right. `ml-auto` rather than a flex-1 spacer, because in a
          wrapping row a spacer would claim a whole line of its own. */}
      <span className="ml-auto flex items-center gap-1">
        {single && (
          <ToolbarButton active={painting} onClick={onCopyStyle}
            title={painting ? 'Now click the layer to paint this style onto (Esc to cancel)' : 'Copy this style, then click another layer to apply it'}>
            🖌 {painting ? 'Pick a target' : 'Copy style'}
          </ToolbarButton>
        )}
        <ToolbarButton title="Position, align and layers" active={panel === 'position'} onClick={() => onOpenPanel('position')}>Position</ToolbarButton>
      </span>
    </div>
  )
}

// ── Nothing selected: the photo itself is the subject ──────────────────────
function PhotoControls({ tool, panel, onOpenPanel, onRotate, onFlip, onStartCrop }) {
  // Rotate and flip used to be disabled the moment a single layer existed,
  // because turning the page under live text and shapes is real geometry. It
  // is, and it's in transform.js now: a rotation moves every layer's pivot and
  // adds 90° to its own rotation, and a flip mirrors the photo and the crop
  // window while deliberately leaving the layers alone — mirrored text would
  // be nonsense, not a feature.
  return (
    <>
      <ToolbarButton title="Crop the photo — non-destructive, re-editable at any time" active={tool === 'crop'} onClick={onStartCrop}>⬚ Crop</ToolbarButton>
      <ToolbarButton title="Filters, auto-adjust, light and colour" active={panel === 'adjust'} onClick={() => onOpenPanel('adjust')}>🎚 Adjust</ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton title="Rotate 90° left" onClick={() => onRotate(false)}>⟲</ToolbarButton>
      <ToolbarButton title="Rotate 90° right" onClick={() => onRotate(true)}>⟳</ToolbarButton>
      <ToolbarButton title="Flip the photo horizontally (layers stay put)" onClick={() => onFlip('horizontal')}>⇋</ToolbarButton>
      <ToolbarButton title="Flip the photo vertically (layers stay put)" onClick={() => onFlip('vertical')}>⇅</ToolbarButton>
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

function TextControls({ layer, H, onPatch, onBeginChange, palette }) {
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

      <ColorField value={layer.color} title="Text colour" palette={palette}
        onCommitStart={onBeginChange} onChange={color => onPatch({ color })} />

      <ToolbarDivider />
      {/* Grouped so a wrap breaks BETWEEN the style set and the alignment set
          rather than through the middle of either. */}
      <span className="flex items-center gap-0.5">
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
      </span>

      <ToolbarDivider />
      <span className="flex items-center gap-0.5">
        {ALIGNMENTS.map(a => (
          <ToolbarButton key={a.value} title={a.title} active={layer.align === a.value}
            onClick={() => set({ align: a.value })}>{a.icon}</ToolbarButton>
        ))}
      </span>

      <SpacingMenu layer={layer} onPatch={onPatch} onBeginChange={onBeginChange} />
      <EffectsMenu layer={layer} effect={effect} onPatch={onPatch} onBeginChange={onBeginChange} palette={palette} />

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

function EffectsMenu({ layer, effect, onPatch, onBeginChange, palette }) {
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
                <ColorField value={layer.effectColor || '#000000'} title="Effect colour" palette={palette}
                  onCommitStart={onBeginChange} onChange={effectColor => onPatch({ effectColor })} />
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-border px-1 pt-2">
          <span className="text-[11px] text-text-secondary">Highlight</span>
          <ColorField value={layer.bgColor} title="Highlight behind the text" allowNone palette={palette}
            onCommitStart={onBeginChange} onChange={bgColor => onPatch({ bgColor })} />
        </div>
      </div>
    </ToolbarMenu>
  )
}

// A border style is only meaningful once there IS a border, so the menu is
// disabled rather than hidden when the stroke is zero-width or transparent —
// hidden would make the toolbar jump as you drag the width up from 0.
function DashMenu({ layer, onPatch, onBeginChange, disabled }) {
  const current = DASH_STYLES.find(d => d.value === (layer.dashStyle || 'solid'))
  return (
    <ToolbarMenu label={current?.label || 'Solid'} title="Border style" width={150} disabled={disabled}>
      {DASH_STYLES.map(d => (
        <MenuItem key={d.value} active={(layer.dashStyle || 'solid') === d.value}
          onClick={() => { onBeginChange(); onPatch({ dashStyle: d.value }) }}>
          {d.label}
        </MenuItem>
      ))}
    </ToolbarMenu>
  )
}

// ── Rect / ellipse / polygon / star ────────────────────────────────────────
function ShapeControls({ layer, H, onPatch, onBeginChange, palette }) {
  const hasBorder = !!layer.stroke && (layer.strokeWidth || 0) > 0
  return (
    <>
      <ColorField value={layer.fill} title="Fill" allowNone palette={palette}
        onCommitStart={onBeginChange} onChange={fill => onPatch({ fill })} />
      <ColorField value={layer.stroke} title="Border colour" allowNone palette={palette}
        onCommitStart={onBeginChange} onChange={stroke => onPatch({ stroke })} />
      <NumberField label="B" value={Math.round((layer.strokeWidth || 0) * H)} min={0} max={Math.round(H / 4)} suffix="px" className="w-[92px]"
        onCommitStart={onBeginChange} onChange={px => onPatch({ strokeWidth: px / H })} />
      <DashMenu layer={layer} onPatch={onPatch} onBeginChange={onBeginChange} disabled={!hasBorder} />
      {layer.type === 'rect' && (
        <NumberField label="R" value={Math.round((layer.cornerRadius || 0) * H)} min={0} max={Math.round(H / 2)} suffix="px" className="w-[92px]"
          onCommitStart={onBeginChange} onChange={px => onPatch({ cornerRadius: px / H })} />
      )}
      {/* Sides and points are the shape's actual geometry, so they belong in
          the toolbar next to its colours rather than behind Position — a
          hexagon that can't become a pentagon isn't really a polygon tool. */}
      {layer.type === 'polygon' && (
        <NumberField label="◇" value={layer.sides || 3} min={3} max={20} className="w-[86px]"
          onCommitStart={onBeginChange} onChange={sides => onPatch({ sides: Math.round(sides) })} />
      )}
      {layer.type === 'star' && (
        <>
          <NumberField label="★" value={layer.points || 5} min={3} max={20} className="w-[86px]"
            onCommitStart={onBeginChange} onChange={points => onPatch({ points: Math.round(points) })} />
          <ToolbarMenu label={`Depth ${Math.round((layer.innerRatio ?? 0.45) * 100)}`} title="How deep the star's notches cut" width={210} closeOnClick={false}>
            <div className="p-2">
              <SliderField label="Point depth" min={5} max={95} step={1}
                value={Math.round((layer.innerRatio ?? 0.45) * 100)}
                onCommitStart={onBeginChange}
                onChange={v => onPatch({ innerRatio: v / 100 })} />
            </div>
          </ToolbarMenu>
        </>
      )}
    </>
  )
}

// ── Line / arrow ───────────────────────────────────────────────────────────
function PathControls({ layer, H, onPatch, onBeginChange, palette }) {
  const isArrow = layer.type === 'arrow'
  // An arrow saved before this existed has neither flag, so `undefined` has to
  // read as the shape it already had: a head on the end only.
  const startOn = !!layer.arrowStart
  const endOn = layer.arrowEnd !== false
  return (
    <>
      <ColorField value={layer.stroke} title="Colour" palette={palette}
        onCommitStart={onBeginChange} onChange={stroke => onPatch({ stroke })} />
      <NumberField label="W" value={Math.round((layer.strokeWidth || 0) * H)} min={1} max={Math.round(H / 4)} suffix="px" className="w-[92px]"
        onCommitStart={onBeginChange} onChange={px => onPatch({ strokeWidth: px / H })} />
      <DashMenu layer={layer} onPatch={onPatch} onBeginChange={onBeginChange} />
      {isArrow && (
        <span className="flex items-center gap-0.5">
          <ToolbarButton title="Head on the start" active={startOn}
            onClick={() => { onBeginChange(); onPatch({ arrowStart: !startOn }) }}>←</ToolbarButton>
          <ToolbarButton title="Head on the end" active={endOn}
            onClick={() => { onBeginChange(); onPatch({ arrowEnd: !endOn }) }}>→</ToolbarButton>
        </span>
      )}
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

// ── Animate ────────────────────────────────────────────────────────────────
// Canva's split, kept: element TIMING is when it is on screen and lives on the
// timeline; ANIMATION is how it arrives and leaves and lives here. The fade
// sliders stay on the timeline with the timing they belong to.
//
// Video mode only, because it is the only mode with a `t`.
function AnimateMenu({ selection, onPatch, onBeginChange }) {
  const anim = selection[0]?.anim || {}
  const inM = MOTIONS.includes(anim.in) ? anim.in : 'none'
  const outM = MOTIONS.includes(anim.out) ? anim.out : 'none'
  const secs = Math.max(0.05, Number(anim.duration) || DEFAULT_MOTION_SECONDS)
  const set = patch => { onBeginChange(); onPatch({ anim: { in: inM, out: outM, duration: secs, ...patch } }) }
  const label = inM === 'none' && outM === 'none' ? 'Animate' : `${MOTION_LABELS[inM]} / ${MOTION_LABELS[outM]}`

  const row = (title, key, value) => (
    <div className="px-1.5 py-1">
      <p className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{title}</p>
      <div className="grid grid-cols-2 gap-1">
        {MOTIONS.map(m => (
          <button key={m} type="button" onClick={() => set({ [key]: m })}
            className={`border px-1.5 py-1 text-left text-[11px] transition-colors ${
              value === m ? 'border-amber-500 bg-amber-50 font-semibold text-amber-800' : 'border-border text-text hover:border-amber-300'
            }`}>
            {MOTION_LABELS[m]}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <ToolbarMenu label={label} title="How this layer arrives and leaves" width={248} closeOnClick={false}>
      {row('In', 'in', inM)}
      {row('Out', 'out', outM)}
      <div className="px-1.5 pb-1.5 pt-1">
        <SliderField label="Speed" min={0.1} max={1.5} step={0.05} value={secs}
          format={v => `${v.toFixed(2)}s`}
          onCommitStart={onBeginChange} onChange={v => set({ duration: v })} />
        {/* Said plainly, because it is the difference between our editor and
            Canva's: this one is on the free side of the line. */}
        <p className="px-0.5 pt-1 text-[10px] leading-snug text-text-tertiary">
          Movement is added when the clip is composited — no re-render, no cost.
        </p>
      </div>
    </ToolbarMenu>
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
