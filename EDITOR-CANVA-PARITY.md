# Studio image editor — Canva parity analysis

What "Open in editor" gives us today, what Canva actually does, and what it would
take to close the gap. Written before any of the work so the scope is a decision,
not a discovery.

> **Status: Tiers 0–3 are built and verified.** §6 and §7 cover Tiers 0–2, §8
> the colour panel and a toolbar clipping fix, §9 the rest of Tier 3. Sections
> 1–2 below describe the editor as it was *before* any of that and are kept as
> the record of why it was done. Only Tier 4 (and 2.7, curved text) is open.

Source for every Canva behaviour below is Canva's own help centre (their editor
itself is behind a login, so the docs — which enumerate the toolbars, panels and
shortcuts precisely — are what we went off). Links at the bottom.

---

## 1. What we have now

`src/components/studio/PhotoEditor.jsx` (895 lines) + `photoEditorModel.js` (341),
opened from a modal in `src/pages/studio/index.jsx:1050`. Konva/react-konva.

**The good bones — none of this should be thrown away:**

| Thing | Where | Why it matters |
| --- | --- | --- |
| Fractional coordinate system (every value is 0–1 of the doc) | `overlayModel.js` header | A 480px preview and a 4096px export agree by construction. This is the single best decision in the file and every new feature must obey it. |
| One text layout/draw implementation shared by preview + export | `layoutBox` / `drawBox` | Arabic shaping can't drift between what you see and what you download. |
| Three export outputs (composite / transparent text / clean base) | `exportDocument` | Round-tripping edits without baking text into pixels. |
| Old `{boxes}` rows migrate to `{layers}` | `migrateDocument` | Nothing already saved breaks. |
| Shared Konva node builders for live + headless stage | `addShapeNode`, `renderDocument` | Preview and export can't visually diverge. |

**What's already Canva-shaped:** on-canvas transform handles, double-click-to-edit
text, a floating action pill above the selection, arrow-key nudge, ⌘D duplicate,
Delete, lock/hide, z-order, undo/redo.

---

## 2. What's actually wrong today

Three of these are correctness/perf bugs, not missing features. They're why it
doesn't *feel* like Canva even where the feature exists.

### 2.1 Adjustment sliders re-filter the full-resolution image every frame
`PhotoEditor.jsx:400` caches and filters the base Konva image whenever
`doc.adjust.*` changes, and the sliders write on every `onChange` (i.e. every
pointer move). On a 4096×4096 generation that's a ~67 MB canvas cached and run
through three filters per frame, synchronously, on the main thread. Dragging
brightness will visibly stutter. **Fix: filter a downscaled preview copy while
dragging; apply at native res only on export (which `renderDocument` already
does independently).**

### 2.2 Text is re-rasterised far more often than it's drawn
`buildTextBitmap` allocates a canvas and re-runs full layout + `fillText`. It's
called from `TextNode`'s memo, from `InlineTextEditor`'s memo, *and* from
`layerBoundsPx` — which `toolbarBox` (`PhotoEditor.jsx:393`) recomputes on every
`doc` change. So a single keystroke while editing text does three full
rasterisations at native resolution. **Fix: memoise bitmaps by layer signature in
one cache, and derive the toolbar box from the already-built bitmap.**

### 2.3 Everything lives on one Konva `Layer`
Base image, all content, transformer, and the crop overlay share a single layer,
so every transformer handle redraw repaints the full-resolution base image.
**Fix: content layer + UI layer (transformer/guides/crop), `listening={false}` and
`perfectDrawEnabled={false}` where they apply.** This is the standard Konva
performance split and costs almost nothing to adopt.

### 2.4 Structural gaps that block whole feature families
- **No zoom or pan.** The stage is locked to a fit-to-62vh scale. You cannot get
  close enough to place text precisely on a large image.
- **No image layers.** You can't add a second photo, a logo, or a brand asset.
  For a marketing tool this is a bigger hole than any of the polish items.
- **Single selection only.** No multi-select ⇒ no align, no distribute, no group.
- **Rotate/flip is gated to an empty document** (`canRotate`, `PhotoEditor.jsx:409`)
  because remapping layers through a rotation was skipped. Canva has no such
  restriction.
- **Right-side inspector instead of a contextual top toolbar.** Canva puts the
  selection's controls in a toolbar directly above the canvas; the side panel is
  for *inserting* things. Ours inverts that, which is why the toolbar row is a
  grab-bag of Text/Rect/Ellipse/Crop/Adjust/Rotate/Undo all at once.

---

## 3. How Canva does it (verified)

### 3.1 Editor anatomy
Canva names five surfaces: **menu bar**, **side panel** (browse & insert),
**canvas**, **editor toolbar** (context-specific for the selection), **status bar**
(zoom, pages). Selecting something swaps the *toolbar*, not a side panel. There's
also a **floating toolbar** on the element itself carrying Group / Ungroup / Lock /
Copy style / More actions.

### 3.2 Selection & movement
- Shift-click to add to selection; drag a marquee over elements to select many.
- ⌘G group / ⌘⇧G ungroup. Click a group, then click again into a child to edit it
  without breaking the group.
- Arrow = small nudge, Shift+Arrow = large nudge.
- ⌘+Arrow = resize small, Shift+⌘+Arrow = resize large.
- ⌥+`,` / ⌥+`.` rotate small; add Shift for large.
- Tab / Shift+Tab cycle elements; Shift+W/A/S/D jump to the nearest element in a
  direction.
- F8 toggles multi-select mode.

### 3.3 Position panel
One panel, two tabs — **Arrange** and **Layers**.
- Arrange: Forward / Backward / To front / To back; **Align to page** (shown when
  one element is selected) and **Align elements** (shown when 2+ are selected);
  Tidy up (⌥⇧T) to even out spacing.
- Advanced: numeric **X / Y** in pixels from the top-left of the canvas, numeric
  **Width / Height** with a ratio-lock toggle, and rotation.
- Layers tab: a real layer list you can reorder.

### 3.4 Text
- Toolbar: font, font weight, font size (typed value *or* ± buttons), colour,
  **B / I / U / S**, alignment (left/centre/right/**justify**), lists
  (bullet/numbered/checklist), `aA` case toggle.
- Advanced settings: **line spacing** and **letter spacing** sliders, subscript/
  superscript, kerning and ligatures toggles.
- **Effects**: shadow, lift, hollow, splice, echo, glitch, neon, background — plus
  **curve**.
- Text box width is dragged by **white pill handles on the left/right edges only**,
  and that re-wraps without changing font size. ⌥-drag resizes symmetrically.
  Corner handles change the font size. (We already got this split right.)
- Vertical anchor: ⌘⇧H top / ⌘⇧M middle / ⌘⇧B bottom.
- Shortcuts: ⌘B/I/U, ⇧⌘S strikethrough, ⇧⌘K uppercase, ⇧⌘L/C/R align,
  ⇧⌘`,`/`.` font size ∓, ⌥⌘↑/↓ line spacing, ⌥⌘`,`/`.` letter spacing,
  ⌥⌘C / ⌥⌘V copy & paste *text style*.

### 3.5 Images
- **Adjust**: brightness, contrast, saturation + more, with **Auto-adjust**, filter
  presets, **Reset adjustments**, and a *Select area* control (All / Click / Brush /
  Foreground / Background).
- **Crop**: freeform or a predefined aspect ratio; double-click an element to enter
  crop mode; the hidden parts are **not deleted** and the crop stays re-editable.
  Shift while dragging a crop handle stretches without keeping ratio.
- **Transparency** slider with a typed value, for any element including text.
- **Copy style** (paint-roller): copies colour, transparency and image filter
  between elements; for text it copies font/size/colour/alignment.
- Background remover, Magic Layers, etc. — AI features, out of scope for parity.

### 3.6 Canvas & view
- ⌘+/⌘− zoom, ⌘0 actual size, ⌥⌘0 zoom to fit, ⇧⌘0 zoom to fill.
- ⇧R rulers and guides; ⌥⌘; lock guides.
- ⌘/ toggles the side panel. `/` or ⌘E opens quick actions.
- Insert shortcuts: **T** text, **R** rectangle, **C** circle, **L** line.
- ⌘Z undo, ⌘⇧Z redo, ⌘A select all, ⌘S save.

---

## 4. Requirements for *our* editor

Ordered by what a marketer editing an Arak generation actually hits first. "Cost"
is rough implementation weight, not calendar time.

### Tier 0 — make what exists feel right (must-do, nothing new on screen)
| # | Requirement | Canva behaviour | Cost |
| --- | --- | --- | --- |
| 0.1 | Adjustment sliders must be smooth | Live preview while dragging | S — downscaled preview canvas |
| 0.2 | Typing in a text layer must not stutter | Instant | S — one bitmap cache |
| 0.3 | Transformer/handles must not repaint the photo | — | S — split Konva layers |
| 0.4 | ⌘Z / ⇧⌘Z, ⌘A, Esc-to-deselect | Same | S |
| 0.5 | History coalescing (a slider drag = one undo step) | Same | S |

### Tier 1 — the missing fundamentals
| # | Requirement | Canva behaviour | Cost |
| --- | --- | --- | --- |
| 1.1 | **Zoom & pan** — fit / fill / 100%, ⌘±, ⌘0/⌥⌘0, wheel-zoom, space-drag pan, zoom control in a status bar | §3.6 | M |
| 1.2 | **Image layers** — add a photo/logo from uploads or from another studio version, as a normal layer | Uploads panel | M — new layer type through the whole model + export |
| 1.3 | **Multi-select** — shift-click and marquee | §3.2 | M |
| 1.4 | **Align & distribute** — align to page (1 selected), align elements + tidy up (2+) | §3.3 | S once 1.3 lands |
| 1.5 | **Position panel** — numeric X/Y/W/H/rotation, ratio lock | §3.3 | S |
| 1.6 | **Smart guides & snapping** — page centre/edges, sibling edges/centres, 15° rotation snap, Shift-drag axis lock | Canva's live pink guides | M |
| 1.7 | **Contextual top toolbar** replacing the current mixed row; side panel becomes the *insert* surface | §3.1 | M — mostly re-layout |
| 1.8 | **Copy / paste / cut / alt-drag-duplicate** | ⌘C/V/X, ⌥-drag | S |
| 1.9 | **Right-click context menu** | Shift+F10 / right-click | S |

### Tier 2 — text parity (this is where Arak's value is, given Arabic)
| # | Requirement | Canva behaviour | Cost |
| --- | --- | --- | --- |
| 2.1 | Letter spacing + line spacing sliders | §3.4 | S — `layoutBox` change |
| 2.2 | Bold / italic / underline / strikethrough + shortcuts | §3.4 | S |
| 2.3 | Uppercase toggle, justify alignment | §3.4 | S |
| 2.4 | Vertical anchor (top/middle/bottom) | ⌘⇧H/M/B | S |
| 2.5 | Text opacity + text **background/highlight** colour | Effects → Background | S |
| 2.6 | Text effects: shadow (already), **outline/hollow**, **lift**, **echo**, **neon** | §3.4 | M — canvas draw passes |
| 2.7 | Curved text | Effects → Curve | L — per-glyph placement; conflicts with Arabic shaping, see risks |
| 2.8 | Numeric font-size field with ± buttons and ⇧⌘`,`/`.` | §3.4 | S |
| 2.9 | Copy style / format painter | §3.5 | S |

### Tier 3 — image & shape parity
| # | Requirement | Canva behaviour | Cost |
| --- | --- | --- | --- |
| 3.1 | Filter presets + Auto-adjust + Reset | §3.5 | S |
| 3.2 | More adjustments: highlights, shadows, warmth, tint, blur, vignette, sharpen | §3.5 | M — Konva has some; rest are custom |
| 3.3 | Non-destructive, re-editable crop + aspect-ratio presets | §3.5 | M — crop becomes state, not a canvas rewrite |
| 3.4 | Rotate/flip the photo **without** the empty-document gate | Canva has no gate | M — layer remap through rotation |
| 3.5 | More shapes (triangle, star, polygon), dashed strokes, both-end arrows | Elements panel | S |
| 3.6 | Transparency slider on every layer type incl. text | §3.5 | S |
| 3.7 | Eyedropper, document colours, recent colours, brand palette | Colour panel | M |

### Tier 4 — nice-to-have / probably not
Grouping (⌘G), rulers & guides, background remover (needs an API call — we already
have n8n workflows that could host it), gradients, frames/crop-to-shape, multi-page,
comments, templates, autosave-with-status.

---

## 5. Risks and calls to make

1. **Curved text vs Arabic.** Curving requires laying out glyph-by-glyph, which
   defeats the shaper — Arabic would break into disconnected letterforms. If we
   want 2.7 it has to be Latin-only, with the control hidden when `dir === 'rtl'`.
   Recommend deferring.
2. **Non-destructive crop (3.3)** changes the document contract: today crop rewrites
   `baseCanvas` and remaps every layer. Making it re-editable means storing crop as
   state and remapping at render time. Worth doing, but it touches `exportDocument`,
   `migrateDocument`, and the saved `overlay_state` shape — so it wants its own pass.
3. **Rotate without the gate (3.4)** is real geometry across five layer types. Doable,
   but it's the kind of thing that needs a test, and the repo has no test setup.
4. **File size.** `PhotoEditor.jsx` is already 895 lines. Tiers 1–2 roughly triple it.
   It should be split (`canvas/`, `panels/`, `tools/`, `model/`) as part of Tier 1
   rather than after.
5. **Effects (2.6) apply to the export path too** — every new draw pass has to go
   through `drawBox` so preview and export stay identical. That constraint is the
   whole reason the current architecture works; don't shortcut it in the live editor.

---

---

## 6. What shipped in the Tier 0 + Tier 1 pass

### File layout
`src/components/studio/PhotoEditor.jsx` and `photoEditorModel.js` are gone,
replaced by `src/components/studio/editor/`:

```
editor/
  index.jsx              orchestrator: state, history, keyboard, wiring
  useEditorHistory.js    undo/redo with gesture coalescing
  useZoomPan.js          zoom, pan, viewport measurement, doc↔screen
  controls.jsx           editor-density widgets (number, slider, colour, menus)
  StatusBar.jsx          zoom + document size
  model/                 no React in any of it
    document.js          layer factories, migrate, list ops
    geometry.js          layer bounds, rotated AABB, translate/move-to
    textBitmap.js        memoised text rasterising
    adjust.js            Konva filter ranges + downscaled preview canvas
    imageCache.js        URL → HTMLImageElement, shared by live + export
    transform.js         load, crop, rotate, flip, coordinate remap
    align.js             align / distribute / tidy up
    snapping.js          smart-guide targets, snap maths, rotation snap
    render.js            headless render + three-output export
  canvas/
    EditorStage.jsx      Stage, two Layers, drag/snap/marquee/crop
    LayerNodes.jsx       text / image / shape / path nodes
    Overlays.jsx         floating toolbar, inline text editor, context menu
  toolbar/TopToolbar.jsx contextual toolbar
  panels/SidePanel.jsx   rail + insert / images / adjust / crop
  panels/PositionPanel.jsx arrange, align, numeric fields, layers list
```

`overlayModel.js` and `fonts.js` stay where they are — they're the shared text
layout and typeface vocabulary, not editor-only code.

### Tier 0 — measured, not asserted
- **Adjustment sliders.** The live Stage now draws a copy of the photo capped at
  1600px on the long edge, and filtering is coalesced to one pass per animation
  frame. Measured in-page on a 3200×2560 document: one pointwise filter pass
  costs **~64 ms at native resolution vs ~11 ms at the preview size**, and 16
  slider events now cost 62 ms in total instead of one full pass each. The
  export path is untouched and still filters at native resolution.
- **Text rasterising** goes through one bounded LRU cache keyed on everything
  `drawBox` reads plus the document size and a font epoch, so a keystroke
  rasterises once instead of three times.
- **Two Konva Layers** (content + UI), `perfectDrawEnabled: false`, and
  `listening: false` on the photo, so handle movement no longer repaints it.
- **History** is one entry per gesture: `begin()` marks a gesture, the first
  `apply()` banks the pre-gesture state, later frames just replace the present.
  A slider drag or a resize is now a single undo.

### Tier 1 — all of it
Zoom & pan (fit/fill/100%, ⌘±, ⌘0, ⌥⌘0, wheel-pan, pinch-zoom at the cursor,
space-drag); image layers from upload or from earlier versions in the session;
multi-select by shift-click and marquee; align to page / align to each other /
tidy up; the Position panel with numeric X/Y/W/H/rotation and a ratio lock;
smart guides with edge and centre snapping plus 15° rotation snap and Shift
axis-lock; the contextual toolbar and insert rail; clipboard, ⌥-drag duplicate
and a right-click menu.

### Verified in the browser
Driven against a local harness (the editor mounted on a test image, since the
app itself is behind a sign-in): layer insert, drag with a visible snap to the
page centre committing to exactly x=280, align-to-page landing on exactly
y=256, tidy-up moving only the middle of three to the exact midpoint, ⌘Z/⇧⌘Z,
⌘A, ⌘C/⌘V, ⌘+/⌘0/⌥⌘0, multi-select showing "2 selected" and switching the panel
to "align to each other", image layers at their true aspect ratio, adjustments
touching only the photo, the context menu clamping inside the canvas, crop to a
1:1 preset producing 2560×2560 with every layer correctly remapped, inline text
editing with Arabic auto-switching the box to RTL and rendering shaped, and a
save producing all three PNGs at full resolution in 871 ms.

### Deliberately still out
- **Multi-layer resize** works through the shared Transformer (each node commits
  its own geometry), but **rotate/flip of the photo is still gated** to a
  document with no layers — that's item 3.4 and it's real geometry.
- **Crop is still destructive** (item 3.3).
- Everything in Tiers 2–4.

---

## 7. What shipped in the Tier 2 pass (text parity)

Everything here goes through `overlayModel.js`'s `layoutBox`/`drawBox` — the one
implementation the live editor and the export both call — so no effect, no
spacing change and no case transform can look different in the download than it
did on screen. That constraint drove most of the design decisions below.

| Item | Shipped as |
| --- | --- |
| 2.1 Letter + line spacing | A Spacing menu with both sliders. **Letter spacing is stored in em**, not pixels, so it stays proportional when the type is resized — a pixel tracking would come apart the moment someone drags a corner handle. |
| 2.2 B / I / U / S | Toolbar buttons + ⌘B/⌘I/⌘U/⇧⌘S. Bold moves between two real weights rather than setting a separate flag, so the B button and the weight menu can't disagree. |
| 2.3 Uppercase, justify | ⇧⌘K and a fourth alignment button. **Uppercase is applied before wrapping** — capitals are wider, and shouting the text after layout would overflow the box. Justify stretches word gaps on every line but the last of each paragraph. |
| 2.4 Vertical anchor | Top / Middle / Bottom, folded into `buildTextBitmap`'s `offsetY` so the Konva node, the layer bounds, the export and the inline editor all pick it up from the one place they already read the offset. |
| 2.5 Text opacity + highlight | Opacity landed in Tier 1; the highlight is a rounded plate drawn behind each line, sized to that line's real extent. |
| 2.6 Effects | Lift, Hollow, Splice, Echo, Neon — each a small set of extra canvas passes around the same `fillText`, with one intensity slider and a colour where it means something. The bitmap padding is computed per effect so a glow or an echo can't be clipped. |
| 2.8 Font-size shortcuts | ⇧⌘, / ⇧⌘. alongside the existing field and ± buttons. |
| 2.9 Copy style | A paint-roller button: pick up a style, then the next layer you select receives it. Carries appearance only, never geometry, and applies the intersection of what the source has and what the target type understands — so a heading onto a rectangle transfers the transparency and nothing nonsensical. |

**Not shipped, deliberately:** 2.7 curved text. Curving requires laying out
glyph by glyph, which defeats the Arabic shaper and would break every Arabic
headline in the product. It stays out until there's a Latin-only case that
justifies gating the control on `dir`.

### Verified in the browser
All five effects rendering distinctly on the same photo; the anchor moving a
block by exactly `blockH/2` and `blockH` and returning to the original position;
every shortcut toggling its own control; letter spacing and the gold highlight;
copy style transferring effect, highlight, tracking and size onto another layer
in one click and disarming afterwards; **Arabic justified text stretching lines
1–4 to both edges with the last line flush right and every letterform still
correctly joined**; and an export producing all three PNGs with the effects
baked in.

### One bug found and fixed during this pass
Closing the inline text editor by clicking away left `editingId` pointing at the
layer that had been edited. Since a text node is hidden while its editor covers
it, that layer stayed invisible on the canvas permanently. The id is now cleared
when the selection moves, and the canvas is passed the *effective* id rather
than the raw one.

---

## 8. Toolbar fix + the colour panel (Tier 3.7)

### 8.1 The bug: every dropdown was clipped to a 45px sliver

The contextual toolbar was `overflow-x-auto`. That is a scroll container, and
CSS clips an absolutely-positioned descendant to its nearest scrolling
ancestor — **in both axes**, because `overflow-x: auto` computes `overflow-y`
to `auto` too. Measured in the browser on a text selection: the bar's
`clientHeight` was 45px while its `scrollHeight` was 159px, and an open colour
popover's rect ran from y=67 to y=183 against a bar ending at y=85. So the
swatches, the effects grid and the spacing sliders were all *rendered* and all
*unreachable* — which is exactly what "I can't load the colours" looked like.

The same measurement showed the second half of the problem: `scrollWidth` 1337
against `clientWidth` 465. Everything from the alignment buttons rightwards —
spacing, effects, anchor, direction, shadow, opacity, copy style — sat behind a
horizontal scrollbar.

**Both fixed:**
- Every dropdown now goes through one `Popover` in `controls.jsx` that renders
  into `document.body` and positions itself `fixed` from the trigger's rect,
  flipping above the trigger when there's no room below (which the status bar's
  zoom menu needs) and capping its height to the space available. A capture-
  phase `scroll` listener re-places it, so it tracks any ancestor that moves.
- The toolbar **wraps** instead of scrolling. Nothing is ever off-screen; the
  cost is a second ~40px row when a text layer is selected.

Two things that fell out of the portal and had to be handled explicitly:
- **Nesting.** The Effects menu contains a colour picker. Once both are
  portalled they're DOM siblings, so the outer one could no longer tell "a
  click in my child" from "a click outside me". Each panel now publishes an
  `owns(target)` predicate to its parent through a React context (which follows
  the component tree, not the DOM), and the outside-click test asks the whole
  subtree. Escape closes the innermost menu only.
- **Escape.** The editor's global Escape clears the selection. A menu's Escape
  is now swallowed in the capture phase so closing a dropdown doesn't also
  throw away what you had selected. Verified: first Escape closes the panel and
  the selection survives; a second clears it.

### 8.2 The colour panel — item 3.7

`ColorField` was a flat grid of ten fixed swatches with document colours
prepended. It's now Canva's sourced-group model, because the useful colours are
never the generic ones. New module `model/palette.js`, no React in it:

| Group | Source |
| --- | --- |
| **In this design** | Every colour-bearing field on every layer — including highlight and effect colour, which the old version missed. |
| **From the photo** | Sampled from the base image. A 64px thumbnail (not the native 4096², which would block the frame that opens the menu — and the downscale is a free box blur that damps JPEG ringing), bucketed to 4 bits per channel, each bucket reported as the **average of its real pixels** rather than the bucket corner, then filtered to a minimum RGB distance of 48 so a sky or a sand gradient can't take all six slots. |
| **Brand** | Hex codes pulled out of Brand Brain's free-text `brandColors` field. Prose like "an off-white" is ignored rather than guessed at. |
| **Recently used** | Persisted to `localStorage`, 10 deep. In-memory would reset on reload and be empty exactly when it's wanted. |
| **Default** | The generic grid, last, minus anything an earlier group already showed. |

Plus a hex field that applies live as it parses (but only banks to "recently
used" on Enter or blur, so half-typed prefixes don't pollute the history), the
native screen **eyedropper** where the browser has one (Chromium only, so the
button is conditional), and the OS picker.

The panel state lives in a `ColorPanel` that mounts only while the popover is
open, so `useState(loadRecentColors)` re-reads the store every time it appears —
a colour another field wrote a moment ago is already there, with no effect and
no cascading render.

### 8.3 Also fixed
A React 19 warning firing on every render: `EditorStage` spread a props object
containing `key` into each layer node. `key` is a reconciler directive, not a
prop, and one arriving through a spread is not guaranteed to be read. Written
explicitly on all four node types now.

### Verified in the browser
Against `dev-editor.html` (a dev-only harness that mounts the editor on a
generated test photo, since the app is behind a sign-in): the toolbar showing
all fourteen text controls with none clipped; the colour panel opening
unclipped with all five groups populated — five distinct golds correctly pulled
out of the test gradient, three hexes correctly parsed out of brand prose, and
the default grid correctly dropping the four it already showed; a picked colour
applying, closing the panel and appearing under "Recently used" on reopen;
typing `2e7d32` live-applying and Enter committing it to the store; the nested
highlight picker opening as a second panel and closing on pick **without**
taking the Effects menu with it; Escape closing a menu while keeping the
selection; ⌘A / ⌘Z / ⇧⌘Z across four layers; and a save running the full export
with no error. Console clean on a fresh load.

### Still out
Tier 3 items 3.1–3.6 (filter presets and auto-adjust, the extra adjustments,
non-destructive crop, ungated rotate/flip, more shapes), and all of Tier 4.

---

## 9. Tier 3 — image and shape parity

All of it, plus three correctness bugs the work uncovered.

### 9.1 The bug this pass was really about (3.3 + a data bug)

Crop used to rewrite the base canvas and remap every layer. That made the
pixels outside the frame *gone* — you could not widen a crop from a minute ago,
let alone one from last week. Worse, the same shape of mistake was already
costing us something quieter: `cleanBlob`, the "clean plate" saved as the next
session's base image, had the **adjustments baked into it**, while
`overlay_state` *also* stored the slider values and replayed them on reopen.
Every adjustment was therefore applied twice. Set brightness +40, save, reopen:
the photo came back at +80 with the slider still reading +40.

Both are the same fix. Crop and adjustments are now **state, not pixels**:

- `doc.crop` is `{x, y, w, h}` as fractions of the base image — a window onto
  a photo that is never cut. `doc.width/height` are *derived* from the base and
  the crop rather than stored independently, because two sources of truth for
  the page size is exactly how a crop and a reopen end up disagreeing.
- The live Stage and the export both draw the base through that window (Konva's
  `crop` source rectangle), so the frame in the download is the frame on screen
  by construction.
- `cleanBlob` is now the **untouched original**. Nothing is baked in but
  rotate/flip, deliberately: those are lossless pixel moves rather than
  settings, and carrying an orientation through every coordinate conversion in
  the editor would buy nothing.
- Rows saved before this carry no version marker, and their stored base *does*
  have the adjustments burned in. `migrateDocument` drops the stored `adjust`
  for those rows — the adjustment is in the image and can't be taken back out,
  so reporting zero is both what the photo actually shows and the only honest
  thing the sliders can say. New saves carry `v: 2` and replay normally.

Crop mode now shows the **whole photo** with the frame on it and everything
outside dimmed rather than absent, which is the entire point — the Stage
switches to base-image pixels and parks the layers in a `Group` at the
committed crop's origin so they stay pinned to the part of the photo they were
placed on while the new frame moves around them.

### 9.2 Rotate and flip, ungated (3.4)

Previously disabled the moment a single layer existed. The note said remapping
a 90° turn across live text and shapes was "real geometry", which it is. What
makes it tractable is to transform each layer's **pivot** — the point Konva
actually rotates that node type around (top-left for rect/image/text, centre
for an ellipse) — and add 90° to the layer's own rotation. Done that way it's
exact for a layer that was *already* rotated, which a bounding-box approach is
not.

Flip is a different kind of operation and is treated as one: it mirrors the
photo and the crop window and deliberately leaves the layers alone. Mirrored
text is nonsense, not a feature.

### 9.3 Adjustments (3.1 + 3.2)

Three sliders became ten, in three groups: **Light** (brightness, contrast,
highlights, shadows), **Colour** (saturation, warmth, tint), **Detail**
(sharpen, blur, vignette). Brightness/contrast/saturation/blur are Konva's;
the other six are written in `adjust.js` as ImageData passes.

Above them, Canva's two one-click controls: **eight filter presets** (a preset
is nothing but a named set of the same slider values, so it's a starting point
you then tune rather than an opaque effect), and **Auto adjust**, which reads
the real histogram of *what's framed* — clipped 2nd/98th percentiles, expand to
fill the range, re-centre the midtone — rather than applying a fixed recipe.
Plus per-slider Reset and Reset all.

Two things that had to be right for the export to match the screen:

- **Blur** is the only filter whose parameter is in cache pixels rather than
  derived from the image, so it's stored as a fraction of document height and
  scaled by the cache ratio. **Sharpen**'s radius is tied to the image width
  for the same reason — a fixed 3×3 kernel would be strong on a 1600px preview
  and invisible on a 4096px export. **Vignette** normalises to the image's own
  half-diagonal and is resolution-independent by construction.
- **The downscaled preview was not actually saving any filter time.** Konva
  sizes a filter cache from the *node's* width/height, which is the document
  size no matter how small the source bitmap is — so without an explicit
  `cache({ pixelRatio })` the filters ran at full resolution regardless and the
  downscale only ever saved memory. That's now passed, which is what the
  Tier 0 note always intended.

`Konva.Factory` is not on the `konva` default export (only Util, Node, Stage,
Layer and friends are), so registering custom filter attrs the way Konva's own
filters do throws at import. The custom filters are **closures over their
values** instead — no prototype patching, no idempotency problem across the
live and headless paths, and a filter whose value is zero is simply left out of
the chain rather than invoked to do nothing.

### 9.4 Shapes (3.5)

Triangle, polygon (3–20 sides) and star (3–20 points, adjustable notch depth),
plus dashed and dotted borders on every shape and path, and arrowheads on
either or both ends.

Polygons and stars are a closed `Konva.Line` whose points are computed from the
layer's **box**, not Konva's `RegularPolygon`/`Star`, which only take a radius.
A box keeps them consistent with every other shape — same x/y/w/h, same
Transformer, same align and snap maths — and lets you squash a hexagon into a
wide badge, which a radius-based node cannot do. Dash patterns are multiples of
the stroke width, so they scale with the document exactly as the stroke does.

### 9.5 Two more bugs found while verifying

- **Sub-pixel drift in text through a rotation.** Four 90° turns moved a
  caption 2px off where it started. Root cause was `Math.ceil` in `textPadding`
  and `buildTextBitmap`: re-deriving a font size turns an exact 80 into
  80.00000000000001, and `Math.ceil(80.00000000000001 * 0.3)` is 25 where
  `Math.ceil(24)` is 24 — and that padding *is* the offset that positions the
  node. Now `ceilPx`, which tolerates the last bit or two of float noise, plus
  the rotation re-derives each fraction as (fraction × old dim) ÷ new dim
  rather than multiplying by a precomputed ratio. Measured drift after this:
  **exactly zero**, over four aspect ratios and both directions.
- **`rotation: 360`.** Turning the page four times left every layer on 360 —
  visually identical, but outside the ±180 range of the one field you can type
  a rotation into, and climbing with every further turn. Normalised to
  (-180, 180].

### Verified in the browser
Against `dev-editor.html`: a document with all eight layer types; every preset
landing on its exact values and Auto computing brightness/contrast from the
real histogram; a 1:1 crop taking 1600×2000 to 1600×1600 with a layer moving
from y=600 to exactly y=400, then "Reset to the full photo" returning it to
**exactly** 480/600/384/480 — a bit-exact round trip; crop mode showing the
whole photo with the hidden strips dimmed and the caption still pinned to the
photo; rotate with 8 layers present giving 2000×1600 and a layer at the
independently-derived AABB corner (920, 480) with rotation 90, and CW→CCW
returning to the original values exactly; flip leaving layers untouched; three
⌘Z presses reversing crop, rotate and flip together; and an export at 299ms
producing a cropped, adjusted composite with **Arabic still correctly shaped
and joined** under a neon effect, a transparent text layer, and a clean plate
that is the full untouched original. Console clean on a fresh load.

### Still out
Tier 4 only: grouping (⌘G), rulers and guides, background remover, gradients,
frames/crop-to-shape, multi-page, comments, templates, autosave-with-status.
Plus 2.7 curved text, which stays out for the Arabic reason in §5.

---

## Sources

- [Canva keyboard shortcuts](https://www.canva.com/help/keyboard-shortcuts/)
- [Group, layer, and align elements](https://www.canva.com/help/layer-group-align/)
- [Move elements in your design](https://www.canva.com/help/moving-elements/)
- [Resize and crop elements precisely](https://www.canva.com/help/resize-and-crop/)
- [Format text](https://www.canva.com/help/format-text/)
- [Resize text boxes and wrap text](https://www.canva.com/help/wrap-text/)
- [Adjust image and video settings](https://www.canva.com/help/image-settings/)
- [Adjust element transparency](https://www.canva.com/help/transparency/)
- [Lock and unlock pages or elements](https://www.canva.com/help/lock-and-unlock-elements/)
