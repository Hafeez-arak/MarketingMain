import { useState } from 'react'
import { fontStack, groupedFonts, nearestWeight, weightLabel, weightsFor } from '../../fonts'
import { EFFECTS, ANCHORS } from '../../overlayModel'
import { DASH_STYLES, isPath, isShape } from '../model/document'
import { MOTIONS, MOTION_LABELS, DEFAULT_MOTION_SECONDS } from '../model/playback'
import { ToolbarButton, ToolbarDivider, ToolbarMenu, MenuItem, MenuSearch, NumberField, ColorField, SliderField } from '../controls'
import {
  IconAdjust, IconAlignCenter, IconAlignJustify, IconAlignLeft, IconAlignRight, IconBrush,
  IconCrop, IconFlipH, IconFlipV, IconLayers, IconRedo, IconRotateLeft, IconRotateRight, IconUndo,
} from '../icons'

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
      <ToolbarButton title="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo}><IconUndo /></ToolbarButton>
      <ToolbarButton title="Redo (⇧⌘Z)" onClick={onRedo} disabled={!canRedo}><IconRedo /></ToolbarButton>
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

      {/* Video mode, nothing selected. The parent reserves a fixed ~118px band
          so the canvas can't move when the selection changes what is in here
          (see index.jsx), and in this one combination there was nothing to put
          in it: the photo group is withheld because there is no photo to
          reframe, and the style controls need a selection. The result was a
          large empty white card that read as a panel that had failed to load.
          A hint costs nothing and is what the space is for — this is the first
          thing on screen after a clip opens. */}
      {!selection.length && !onStartCrop && (
        <span className="px-2 text-[12px] text-text-tertiary">
          Nothing selected — press <Key>T</Key> for text or pick a shape from Add, then time it on
          the strip below. <Key>Space</Key> plays, <Key>I</Key> and <Key>O</Key> trim the clip at the
          playhead.
        </span>
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
            <IconBrush /> {painting ? 'Pick a target' : 'Copy style'}
          </ToolbarButton>
        )}
        <ToolbarButton title="Position, align and layers" active={panel === 'position'} onClick={() => onOpenPanel('position')}>
          <IconLayers /> Position
        </ToolbarButton>
      </span>
    </div>
  )
}

// A keycap. Inline in the hint above rather than a <kbd> with app-wide styling,
// because this is the only place in the editor that spells a shortcut out in
// running text — everywhere else it lives in a tooltip.
function Key({ children }) {
  return (
    <kbd className="mx-0.5 border border-border bg-surface-subtle px-1 py-px font-sans text-[10px] font-semibold text-text-secondary">
      {children}
    </kbd>
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
      <ToolbarButton title="Crop the photo — non-destructive, re-editable at any time" active={tool === 'crop'} onClick={onStartCrop}>
        <IconCrop /> Crop
      </ToolbarButton>
      <ToolbarButton title="Filters, auto-adjust, light and colour" active={panel === 'adjust'} onClick={() => onOpenPanel('adjust')}>
        <IconAdjust /> Adjust
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton title="Rotate 90° left" onClick={() => onRotate(false)}><IconRotateLeft /></ToolbarButton>
      <ToolbarButton title="Rotate 90° right" onClick={() => onRotate(true)}><IconRotateRight /></ToolbarButton>
      <ToolbarButton title="Flip the photo horizontally (layers stay put)" onClick={() => onFlip('horizontal')}><IconFlipH /></ToolbarButton>
      <ToolbarButton title="Flip the photo vertically (layers stay put)" onClick={() => onFlip('vertical')}><IconFlipV /></ToolbarButton>
    </>
  )
}

// ── Text ───────────────────────────────────────────────────────────────────
const ALIGNMENTS = [
  { value: 'left', Icon: IconAlignLeft, title: 'Align left (⇧⌘L)' },
  { value: 'center', Icon: IconAlignCenter, title: 'Align centre (⇧⌘C)' },
  { value: 'right', Icon: IconAlignRight, title: 'Align right (⇧⌘R)' },
  { value: 'justify', Icon: IconAlignJustify, title: 'Justify' },
]

// ── The font picker ────────────────────────────────────────────────────────
// This was a flat list of seven names. At forty-five it needs to be a real
// picker, and the three things that make it one are all here:
//
//  · **Search.** Forty-five rows is three screens of scrolling in a 230px
//    popover, and people arrive knowing the name they want.
//  · **Groups.** The list is ordered by what a face is FOR, and Arabic sits
//    first — this is a studio for a Saudi brand, and putting the faces that
//    cannot set an Arabic headline where the eye lands first would be
//    backwards. An RTL box filters to the Arabic-capable faces, so its Serif
//    and Handwriting groups vanish rather than sitting there empty.
//  · **The name set in its own face**, which is the entire reason this is a
//    portalled popover and not a native <select>.
//
// Picking a family also SNAPS THE WEIGHT (see nearestWeight in fonts.js).
// Bebas Neue has one weight and Amiri has two; carrying a layer's 900 across
// to either leaves the toolbar saying "Black" while the canvas draws Regular.
function FontMenu({ layer, onPick }) {
  const [query, setQuery] = useState('')
  const groups = groupedFonts(layer.dir || 'ltr', query)

  return (
    <ToolbarMenu label={layer.family} title="Font" width={278} closeOnClick={false}>
      {({ close }) => (
        <>
          <MenuSearch value={query} onChange={setQuery} placeholder="Search fonts…" />
          {!groups.length && (
            <p className="px-2 py-3 text-center text-[11px] text-text-tertiary">
              No font matches “{query}”.
              {layer.dir === 'rtl' && <span className="block pt-1">This box is right-to-left, so only Arabic faces are listed.</span>}
            </p>
          )}
          {groups.map(g => (
            <div key={g.id} className="pb-1">
              <p className="px-2 pb-0.5 pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">
                {g.label}
              </p>
              {g.fonts.map(f => (
                <button key={f.value} type="button"
                  onClick={() => { onPick(f.value); close() }}
                  className={`block w-full px-2.5 py-1.5 text-left transition-colors ${
                    f.value === layer.family ? 'bg-amber-100 text-amber-900' : 'text-text hover:bg-amber-50'
                  }`}>
                  {/* The name in its own face at a size you can actually judge
                      — a 12px preview of Playfair against Lora is no preview
                      at all. The note stays in the UI font so the two can't be
                      confused for each other. */}
                  <span className="block truncate text-[15px] leading-tight"
                    style={{ fontFamily: fontStack(f.value) }}>
                    {f.label}
                  </span>
                  <span className="block truncate pt-0.5 text-[10px] leading-none text-text-tertiary">
                    {f.note}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </>
      )}
    </ToolbarMenu>
  )
}

function TextControls({ layer, H, onPatch, onBeginChange, palette }) {
  const sizePx = Math.round(layer.size * H)
  const weights = weightsFor(layer.family)
  const effect = layer.effect || 'none'
  const anchor = layer.anchor || 'top'
  // ⌘B and the B button jump between the lightest and the heaviest weight this
  // FACE has, rather than a hard-coded 400/700. On Bebas Neue, which has one
  // weight, that correctly makes bold a no-op instead of a lie.
  const boldWeight = weights[weights.length - 1]
  const isBold = weights.length > 1 && layer.weight >= boldWeight

  function set(patch) { onBeginChange(); onPatch(patch) }

  return (
    <>
      <FontMenu layer={layer}
        onPick={family => set({ family, weight: nearestWeight(family, layer.weight) })} />
      <ToolbarMenu label={weightLabel(layer.family, layer.weight)}
        title={weights.length > 1 ? 'Font weight' : `${layer.family} has only one weight`}
        width={160} disabled={weights.length < 2}>
        {weights.map(w => (
          <MenuItem key={w} active={w === layer.weight} onClick={() => set({ weight: w })}>
            <span style={{ fontFamily: fontStack(layer.family), fontWeight: w }}>
              {weightLabel(layer.family, w)}
            </span>
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
            for. Keeping one source of truth means they can't disagree — which
            now includes agreeing about what weights the face HAS, so the jump
            is to this family's heaviest rather than to a 700 that may not
            exist. Disabled on a single-weight face, because a bold button that
            visibly does nothing is the thing this whole change is about. */}
        <ToolbarButton title={weights.length > 1 ? 'Bold (⌘B)' : `${layer.family} has only one weight`}
          disabled={weights.length < 2} active={isBold}
          onClick={() => set({ weight: isBold ? weights[0] : boldWeight })}>
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
        {ALIGNMENTS.map(({ value, Icon, title }) => (
          <ToolbarButton key={value} title={title} active={layer.align === value}
            onClick={() => set({ align: value })}><Icon /></ToolbarButton>
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
