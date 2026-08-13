# Studio video editor — research and what shipped

The companion to `EDITOR-CANVA-PARITY.md`, for the other half of the studio.
Same method: find out what the reference tools actually do, decide the scope
before writing anything, then record what was built and what was measured.

Research sources at the bottom. Canva's editor is behind a login, so — as with
the image work — their own help centre is what the behaviours below come from.

---

## 1. What "the video editor" was

`PhotoEditor` in `mode="video"`. Frame one of the clip on the canvas as a
still, Adjust and Crop hidden, and a strip underneath with one bar per layer
carrying `tIn` / `tOut` / `fade`.

Which meant **every decision about a video was made blind.** A marketer placed
an Arabic headline on a frozen frame, saved, waited for ffmpeg, and only then
found out the logo sat on top of a moving object. There was no playhead, no
sound, and no way to see the clip move at all.

The long-video path was blinder still, and still is: `ClipBoard.jsx` is a
**pre-render form** — shot prompts, lengths, continue-vs-cut, crossfade-vs-hard
-cut — so every assembly decision is made before a single frame exists. That is
Tier 3 below and is not built.

---

## 2. What the reference tools do

### Canva (the interaction source)

- **A timeline at the bottom of the editor** holding clips, audio and elements
  over time, with a **playhead** — a vertical line you drag to move through the
  video. Arrow keys jump; Shift+arrow moves faster.
- **Trim**: select a clip, hover its start or end edge until trim handles
  appear, drag to shorten or lengthen. **Split**: put the playhead where you
  want the cut and press **S**.
- **Element timing**: hover an element's edge for trim handles, drag the left
  one to change when it starts and the right one for when it ends, or drag the
  whole bar to move it without changing its length. Locked elements can't be
  retimed. *This is what our layer strip already was* — Canva's element timing
  with nothing around it.
- **Animation is a separate concept from timing.** Canva is explicit about it:
  timing is when the element is on screen, `Animate` is how it enters and
  leaves, with a speed preset and precise intro/outro durations.
- **Transitions** sit on the join between scenes with a duration dial
  (0.1–2.5s).
- **Audio**: multiple tracks, trim handles on each, a volume slider, `Balance
  all`, and fade-in/out sliders that also apply to video clips directly.

### CapCut (the "easy enough for a non-editor" floor)

The same grammar in fewer words: drag clip edges to trim, playhead plus Split
(⌘B), text layers dragged to length on the timeline, auto-captions. The signal
worth taking from it is that **the grammar is universal** — trim handles,
playhead, split — so anything invented in its place feels wrong to anyone who
has used either tool.

### Flow and LTX Studio (what Canva can't teach us)

- Flow's **Scenebuilder** is a timeline of *generated* clips: arrange, reorder
  by dragging, trim each clip's beginning and end with handles, preview the
  sequence, and **Extend** a clip by prompting for what happens next. They are
  also honest that generation constraints leak into the editor — an extended
  clip loses access to the other edit modes.
- **LTX Studio** generates shot by shot, and a shot that misses the brief is
  regenerated **without touching the rest of the storyboard**.

**The lesson from both: the shot list and the timeline are the same object.**
Ours are still two screens, and that is the whole of Tier 3.

### Where we deliberately diverge

Canva edits real footage and everything is cheap. Our footage comes out of paid
models, and the two classes of operation are priced a thousand times apart:

| Free — ffmpeg, seconds | Paid — a model render |
| --- | --- |
| text, fonts, colour, Arabic, logos, shapes | anything that changes what is *in* the shot |
| layer timing, fades, **motion** | re-rendering a shot ($0.28–$14.19) |
| trim, crop-to-aspect | extending a shot |

Canva has no such boundary and therefore no vocabulary for it. A straight
parity clone would put a $14 button next to a $0 one and make them look
identical. The Animate menu says "no re-render, no cost" in as many words for
exactly this reason.

---

## 3. Tier 0 — play the clip under the layers

The base is now a real `<video>` driven into the Konva image node, with the
layers obeying their own timing over it.

- **New:** `editor/useVideoPlayback.js` (the element, the transport, the frame
  pump) and `editor/model/playback.js` (what a layer looks like at time *t*).
  No React in the second one, like every other `model/` file.
- **The current time is not React state while the clip plays.** Sixty renders a
  second of a tree containing a wrapping toolbar, a side panel and every Konva
  node would be pure waste, and only the layers' opacity actually changes. So
  playback hands the time to subscribers directly and they mutate what they own
  — `EditorStage` sets node opacity and redraws the content layer, `Timeline`
  moves one CSS `left`. Time re-enters React on pause, seek and end, the three
  moments the rest of the UI has to agree with it. This is the same "a gesture
  is not derived state" rule the timeline's drags already followed.
- **Both paths call the same `layerAlphaAt`**, so the frame you scrub to and
  the frame you play past are identical, and both are what ffmpeg will build.
- **Only the content layer is redrawn.** The UI layer holds the Transformer,
  the guides and the marquee, none of which can change mid-playback — which is
  what the two-layer split from the image editor's Tier 0 was for.
- **The preview is centre-cropped exactly as the composite is.** The document
  is composed against a still while the clip comes back in whatever shape the
  model would accept (a 4:5 session renders 3:4 on Seedance, 9:16 on Veo), and
  the compose script reconciles the two by cropping the clip. `centreCropRect`
  reproduces that shell arithmetic, so the framing on screen is the framing
  that ships rather than a frame the render will never produce.
- **Nothing is selectable or draggable while the clip runs** — a drag against
  moving footage has no coherent meaning, and it also takes every node and the
  Transformer out of the hit test for the duration.
- **Selecting a layer that is not on screen yet moves the playhead to it.**
  Out-of-range layers are genuinely absent from the canvas, because that is
  what the render does with them; without this you could select a headline from
  the timeline, see nothing, and have no way to edit it.
- **The clip's real length wins over the requested one.** `duration` on the row
  is what we *asked* the model for, rounded to a string; a timeline drawn to
  the wrong length puts every cue in the wrong place.

### One asymmetry copied rather than tidied up

The compose graph only adds the alpha out-fade when a layer has a real `tOut`.
A layer running to the end of the clip therefore fades in and then simply stops
when the footage does. `layerAlphaAt` reproduces that exactly. Easing it out in
the preview would have looked better and been a lie.

---

## 4. Tier 1 — a real timeline

A transport, a time ruler with a draggable playhead, and a **footage row**.

- Space plays and pauses. Arrow keys step the playhead by a frame (Shift for a
  second) **when nothing is selected**, and nudge the selection when something
  is — the same split Canva uses.
- **`doc.trim` is `{ start, end }` in seconds of source time**, deliberately
  the same shape of idea as `crop`: a window onto media that is never itself
  cut. The strip shows the **whole** clip with the excluded parts dimmed rather
  than absent, exactly as crop mode shows the whole photo, because dragging the
  edge back out over them is the point.
- **Layer timings stay in source time.** A headline written to appear at 2s
  still means 2s of the original clip after someone trims the first second off
  the front. Re-basing the cues onto the trimmed window would silently move
  every one of them the moment a handle was dragged. The shift onto output time
  happens once, in the compose step, where the real duration is known.
- Playback is confined to the window; **seeking is not**, so you can drag the
  playhead into a dimmed region to see what you are cutting. Pressing play with
  the playhead outside the window starts from the in point.
- `-ss` goes **before** `-i` so the decoder seeks rather than decoding and
  discarding, and it applies to input 0 only — the overlay PNGs are `-loop 1`
  streams with no timeline of their own. The trimmed length is computed in the
  shell with `awk`, because busybox `sh` does integer arithmetic only and a
  clip is 8.04 seconds rather than 8.
- **A layer living entirely in the trimmed-away part is dropped, not shifted.**
  Without that its cues both clamp to zero and `between(t,0,0)` flashes it for
  a single frame at the start — a layer the marketer deliberately cut,
  reappearing.

**Split is deliberately not built.** On a single generated clip it would mean
cutting a hole in the middle, which turns one input into a concat of segments
and interacts with cue shifting in ways that want the sequence machinery. It
belongs with Tier 3, and Flow's Scenebuilder offers only trim per clip too.

---

## 5. Tier 2 — motion

Canva separates timing from animation; we had only timing, which is most of why
our overlays read as stamped on rather than designed.

What makes this cheap is a property of the compose graph rather than the
editor: each overlay is already a looped PNG fed through `overlay`, and
**ffmpeg's `overlay` takes expressions in `t` for x and y**. So a slide is a
longer string in a filter chain that already exists — no per-frame rendering,
no second pass, **no extra render cost**.

- Five motions — none, rise, drop, slide left, slide right — on both the in and
  the out, with one speed slider. Translations only: scale would need a
  time-varying `scale` filter, which ffmpeg has no equivalent of, and per-letter
  effects like a typewriter need glyph-by-glyph placement, which breaks Arabic
  shaping. Same reason curved text stayed out of the image editor.
- **The curve is written once as remaining travel** — `pow(1-p,3)`, ease-out
  cubic — in `model/playback.js` for the preview and in `motionExpr` for the
  filter graph. Two consumers, one shape, exactly as `drawBox` is for text.
- **Motion is part of `timingKey`.** ffmpeg applies an animation to the whole
  PNG, so two layers sharing a group share every pixel of movement; bundling a
  sliding headline with a static logo that happened to run for the same seconds
  would drag the logo across the frame. Layers that move differently are now
  different images — an extra overlay pass, and only for documents that ask.
- **Each PNG is rendered at rest.** The motion is described, not drawn; baking
  any of it into the image would double it.
- The out motion only applies when there is a real `tOut` — the same asymmetry
  as the fades, and for the same reason: ffmpeg has nothing to anchor it to.
- On the canvas the motion moves a **wrapper Group** per layer rather than the
  node's Konva `offset()`. Offset would have translated it, but it also
  relocates the rotation pivot, so a rotated caption would have swung into
  place instead of sliding.

---

## 6. Verified

Nothing here spent anything. No fal render was triggered at any point.

**The fixture** is a locally generated 1280×720 / 8s clip with audio (`ffmpeg`
inside the n8n container — regeneration command in `src/dev/editorHarness.jsx`)
mounted in `dev-editor.html` under a 1600×2000 document, i.e. **16:9 footage
under a 4:5 page**, which is the ordinary production case and the only way to
exercise the centre-crop.

**In the browser**, against the bilingual fixture (Arabic headline for the whole
clip, English subline 2→6s with 0.5s fades), counting the subline's own colour
across the whole canvas:

| | 0s | 2.05 | 2.25 | 2.45 | 2.6–5.4 | 5.6 | 5.9 | 6.05 | 7.5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pixels | 163 | 164 | 1005 | 1537 | 2033 | 1049 | 166 | 163 | 164 |

— flat at the baseline outside the cue, monotonic up through the fade-in, flat
in the middle, monotonic down through the fade-out. **1983 while *playing*
through 3.3s**, i.e. the frame pump renders what scrubbing does.

Also measured: space starts and stops playback and the readout advances in real
time; trim handles landing on 1.0s and 5.0s; play from a playhead parked at
0.2s **jumping to the in point** and stopping dead at 5.0s and staying there;
photo mode unchanged (Crop, Adjust, rotate and flip all present, no timeline,
no Animate).

**In Node**, 36 assertions on `layerAlphaAt` / `centreCropRect` — including the
deliberate no-out-fade asymmetry, and the crop matching the shell's own integer
arithmetic within a pixel across four aspect combinations — and 20 more
comparing the **ffmpeg motion expression, evaluated as JS, against the preview
curve** at 14 sample times. Agreement is within 0.5px everywhere.

**Through the real ffmpeg**, using the editor's own exported PNGs and the
script the workflow generator actually emits (only the `wget`s swapped for
local copies):

- Trim 0.96→5.04 on an 8s clip → **576×720** output (the exact centre-crop of
  16:9 to 4:5), 4.10s long, audio preserved, and the cue correctly shifted from
  source 2→6 to output 1.04→5.04. Frames at 0.2s (subline absent), 1.3s
  (mid fade-in) and 2.5s (full) are all as predicted, with **Arabic correctly
  shaped and joined** in the render.
- Rise-in / slide-left-out: at 2.05s the subline sits low and faint, at 2.60s
  it has arrived and is opaque, and at 5.85s it has travelled off the left edge.

**One thing that cost time and is worth knowing:** `getImageData` on the Konva
canvas returned a *stale* buffer in this browser for a while — a rectangle
painted onto the canvas survived redraws the compositor had visibly applied. It
came good later in the session with no change on our side. If a pixel probe
ever reports an impossibly constant number, paint a mark on the canvas and see
whether a redraw clears it before believing the app is broken.

---

## 7. Tier 3 — the reel, as footage

The first half of the sequence editor: a multi-clip session now opens with the
**rendered shots in order, playable, above the board that produced them.**

- `ReelTimeline.jsx` + `useReelPlayback.js`. Each rendered clip is a block
  sized by its **real** length, probed from the file rather than taken from
  what the model was asked for — those two disagree often enough (5s ordered,
  5.2s delivered) that a reel drawn from the request puts every seam slightly
  out.
- **Two `<video>` elements, alternating.** Switching `src` on one element tears
  the decoder down and refetches, so a seam would be a few hundred milliseconds
  of black — you would be judging the pacing of the loader. The next shot is
  loaded and parked on its in-point on the *other* element 1.5s ahead, and the
  seam is a swap of which one is in front.
- **`clip.trim` per shot, free.** Handles on each block, and `-ss`/`-t` added
  to the normalise pass the stitcher was already running — so shortening a shot
  costs nothing, where re-rendering it to be shorter costs $0.28–$14.19 and
  comes back a different take. That distinction is why trimming lives on this
  surface and "render this shot again" stays on the board.
- **The kept length replaces the file length everywhere downstream.** The
  segment runs, the xfade offset recurrence and the expected total are all
  about what ends up in the reel; leaving the full length in would put a
  crossfade past the end of a trimmed stream, which ffmpeg renders as a frozen
  frame or a black gap **without erroring**.
- Cost totals deliberately ignore trims: a rendered clip has already been paid
  for at the length it was rendered.

### The bug this pass produced and fixed

Which element is playing and which shot it is playing are **one fact**, and it
changes inside a frame callback. Held as two pieces of React state they get
read as a mismatched pair — and did: after one seam the visible element sat
frozen on a stale frame while the other played on invisibly. The pair now lives
in a single ref that the pump reads, with state kept only so the component can
bring the right element to the front, and the pump depends on `playing` alone
so a seam no longer tears it down and rebuilds it against a stale element.

### Verified

`/dev-editor.html?reel=1` mounts it on two fixture clips (8s + 6s). Playback
crosses the seam onto the second shot cleanly; dragging shot 1's tail in takes
it to **5.3s of 8.0s** and the reel total from 14.0s to 11.3s, with the trim
stored as exactly what is sent to the stitcher.

Through the real stitcher, with shot 1 trimmed to 1.0–5.0s of an 8s file and
shot 2 to 0–4.0s of a 6s file across a 0.6s crossfade: the emitted commands
carry `-ss 1.000 … -t 4.000` and `-t 4.000`, the crossfade offset is **3.400**
— the kept length minus the fade, where the file length would have put it at
7.4 and off the end of a 4-second stream — and the render came out at 7.421s
(4.0 + 4.0 − 0.6, plus an audio frame boundary) with a genuine blend of the two
sources at the seam.

**A note on measuring any of this:** the browser pane reports
`document.hidden === true` while being driven over CDP, which throttles
`requestAnimationFrame` to **0.7fps**. Playback then looks broken — a readout
frozen for seconds, a seam arriving late — and `getImageData` returns a stale
buffer for the same reason. Force a composite (take a screenshot) before
believing either.

---

## 8. Two layout bugs in the strip, found on first real use

**The playhead drifted right and left the panel entirely.** It was one element
carrying `left: n%` *plus* `marginLeft: GUTTER`. The percentage resolves
against the containing block — the whole strip, gutter included — and the
margin was then added on top, so the error grew with the time and at 100% it
landed a full gutter past the right-hand edge of the editor. It now lives in a
wrapper positioned to span exactly the track, so the percentage resolves
against the track and the line cannot leave it by construction. The dimming
overlay already did this correctly, which is why only the playhead misbehaved.

**Everything was 12px out.** `GUTTER` was `LABEL_W + 8` — the name column and
the flex gap — but the rows sit inside the strip's own `px-3`, so their tracks
actually start 12px further right. The ruler and the playhead were therefore
measuring a track 12px to the left of the bars, which read as the playhead
starting late. `GUTTER` is now `PAD_X + LABEL_W + 8`, and the constant names
the padding so the next person changing it sees what it has to include.

**The clip bar looked like a different kind of object.** It was a two-tone
plate (`bg-stone-200` under `bg-stone-400/70`) with 9px contrasting blocks for
handles, against layer rows built from a white ringed track, a solid bar and
thin dark grips — the two tones plus the blocks read as a glint across the bar.
The footage row now uses the same construction as every row under it, because
it is the same thing: a bar on a track with draggable ends. The handles moved
inside the bar to sit on its rounded ends, so the trim gesture now scales off
an explicit ref to the track rather than `parentElement` — the bar is only as
wide as the kept region, and scaling by that would have made the drag wildly
too fast on a heavily trimmed clip.

Verified by measurement rather than by eye: ruler, clip track and layer track
all span 450→965, and the playhead lands **0.00px** from where the clip bar's
own geometry puts it at 0s, 2s, 4s, 6s and 8s — with 8s exactly on the right
edge. Trim handles still land on 1.5s/6.0s, and dragging a layer bar still
moves it without resizing (2.0→6.0 becomes 3.0→7.0).

---

## 9. The finishing pass — what a timeline is expected to do

Everything above was about whether the editor could show the truth. This pass
was about whether it behaves like a tool someone has used before. The test
applied throughout: **a person who has used CapCut or Canva reaches for
something — is it there?** Six things weren't, and none of them cost a render.

- **Snapping, with a guide.** Dragging a bar onto the playhead, onto the ends
  of the clip, onto the shipping window, or flush against another layer's cue
  was previously impossible — you dragged near it and then typed the number
  into the In/Out fields, which is what those fields were there to *rescue*,
  not to be the way you work. Now every edge snaps within 8px and a line shows
  what it landed on. **⌥ suspends it**, because sometimes 2.03s really is what
  you meant and without an escape hatch the eight pixels either side of every
  cue become unreachable.
  Two details worth keeping: a MOVE tests both edges and applies the winning
  correction to *the pair*, since snapping one edge on its own would silently
  change the layer's length — the one thing that gesture promises not to do;
  and a layer never snaps to itself, or a bar could collapse onto its own
  start. Targets are captured once at pointerdown rather than rebuilt per
  frame — nothing this gesture moves is in the list.
- **Sound.** Every model we render with returns audio and there was no way to
  hear it or to silence it. There is now a speaker and a short volume slider,
  and dragging the volume up from zero unmutes — the two being independent
  facts is the classic way a volume control ends up doing nothing.
  The autoplay fallback also **stopped lying**: it used to set `v.muted = true`
  and say nothing, so a clip the browser had silenced looked exactly like one
  the user had. It now raises the flag the UI reads, and the strip says who did
  it.
  This is *preview* audio and the code says so. The control the strip
  deliberately still lacks is a mute for the model's own generated track: that
  is a property of the document, it survives a reload and it costs an ffmpeg
  flag. Behind one speaker, someone would silence a delivered reel by turning
  their own monitors down.
- **Loop.** An eight-second clip is watched twenty times while its captions are
  timed. Looping never pauses the element — a pause/play round trip per lap
  stalls visibly and can be refused outright by an autoplay policy the second
  time — so the trimmed case wraps inside the frame pump and the untrimmed case
  wraps on `ended`. Both read the flag through a ref, because `ended` is bound
  once per URL and would otherwise hold whatever the flag was when the clip
  loaded.
- **The fades became visible.** They were a number in a field and nothing else,
  on the one surface built to show how an overlay *reads*. Each bar now carries
  the wedge every NLE draws. The out wedge appears **only when there is a real
  `tOut`** — the same asymmetry §3 and §5 already describe, copied rather than
  tidied, because ffmpeg has nothing to anchor an out-fade to on a layer that
  runs to the end. Drawing a ramp here that neither `layerAlphaAt` nor the
  filter graph performs would have put the lie back at the top of the stack.
- **Home / End / I / O.** End goes to the end of what *ships*, not of the file —
  play already starts at the in point and stops at the out, and this is the one
  place that would have stopped being true. I and O set the trim at the
  playhead, which is both more precise than a drag and what anyone who has used
  an editor will try first.
- **The empty toolbar.** In video mode with nothing selected there was nothing
  to put in the ~118px band the canvas reserves (the photo group is withheld,
  the style controls need a selection), so the first thing you saw on opening a
  clip was a large blank white card that read as a panel which had failed to
  load. It now carries the shortcuts.

### Fonts — 7 to 45, and the weight bug it exposed

The library was five Arabic faces and two Latin. It is now ~45 across Arabic,
sans, serif, display, handwriting and mono, with Arabic first in the menu
because this is a studio for a Saudi brand and the faces that cannot set an
Arabic headline have no business where the eye lands first. A flat list of that
length in a 230px popover is not a picker, so the menu is **searchable and
grouped, with every name set in its own face** — which is the whole reason it
was a portalled popover rather than a `<select>` in the first place.

**Each face now carries the weights it actually has.** The menu used to offer
Regular / Semibold / Bold / Black for everything. Bebas Neue has one weight,
Amiri two, Cairo nine — and asking a canvas for a weight a face lacks doesn't
error, it picks the nearest or synthesises a smeared fake bold. The toolbar
then says "Black" while the canvas draws Regular. So the weight menu is built
from the family, ⌘B and the B button jump between that family's own lightest
and heaviest (and are disabled outright on a single-weight face rather than
appearing to work), and changing family **snaps the weight to the nearest one
that exists** — including on the automatic Latin→Cairo switch when someone
starts typing Arabic, which would otherwise have carried a weight Cairo happens
not to have.

**They no longer load app-wide.** The old five sat in an `@import` in
`index.css` on the correct reasoning that canvas silently falls back for a face
that hasn't finished loading. Forty-five faces is ~150KB of `@font-face` rules,
and every screen with no canvas on it — dashboard, calendar, settings — was
going to block its first paint on them. They now load when the editor opens,
and the guarantee is preserved rather than traded: `ensureFontsLoaded` awaits
the stylesheets' own load events before resolving a single pair, and the editor
already gates its canvas and its Save button on that promise. `document.fonts.
load` for a family with no rule yet does **not** wait and does not throw — it
resolves immediately with nothing — so kicking the stylesheets off without
awaiting them would have been the same bug wearing a promise.

### The chrome stopped being emoji

The toolbar, rail and shape grid were drawn with 🎚 🖌 ✚ ▣ ⌗ ⬚ ⟲ ⟳ ⇋ ⇅ ∅ ⛏.
Those are not icons, they are *text*: on macOS half resolve to full-colour
emoji, which in a flat monochrome UI look like stickers; on Windows and Linux
several have no glyph in the UI font and render as tofu; and none of them
follow their button's colour, so active and disabled states left them
unchanged. `editor/icons.jsx` replaces them with one 24×24 `currentColor`
grid — still inline SVG and still no package, which is the choice `Timeline.jsx`
had already made for its transport. The reel timeline's two duplicate transport
glyphs now come from there too.

### Verified

Nothing here spent anything; no fal render was triggered.

**Snapping, by arithmetic rather than by eye.** With the playhead parked at
62.5% and a bar at 25%→75%, dragging the out edge to a position corresponding
to 4.954s left the bar at **exactly `width: 37.5%`** — i.e. 25 + 37.5 = 62.5,
the playhead to the digit — with the guide showing at exactly `left: 62.5%` and
hidden again on release. The same drag with ⌥ held landed at **36.9266%**
(4.954s, unsnapped) and never showed the guide.

**Loop, sampled off the media element** at 250ms: `… 1.72, 1.97 → 0.06 … 1.81 →
0 … 1.40`, against a 2.0s out point — two full laps, never past the out point,
`paused` false throughout, and `muted: false, volume: 1`, i.e. the sound is
genuinely on rather than quietly forced off.

**Fonts.** All three stylesheets inject; every sampled family reports
`document.fonts.check` true after `load` and measures a distinct advance width
against the fallback (647.2 Latin / 472 Arabic): Bebas Neue 371.4, Anton 447.5,
Playfair 616, Pacifico 772.2, Space Mono 587.5; Reem Kufi 453.1, Almarai 460,
Alexandria 471. Setting a Bold layer to Anton snapped it to Regular and
disabled both weight controls, and Save still produced the right two timing
groups at 1600×2000.

Also measured: `O` at a 5.0s playhead set the trim and dimmed the rest of the
strip; `End` then went to **5.0s, not the file's 8.0s**; photo mode still has
Crop, Adjust, rotate and flip and no timeline.

**Two bugs this pass produced and fixed.** The font menu's search box opened
*unfocused*: the popover is `visibility: hidden` for the one layout pass it
takes to measure itself, and **a visibility:hidden element cannot take focus**,
so `focus()` on mount was a silent no-op and every keystroke went to the
trigger button instead. Confirmed by probing the panel's computed visibility at
the moment of the call, and fixed by focusing a frame later. And the volume
slider was first revealed on hover at `left-full`, which floated it straight
over the timecode — the one number the strip exists to show. Forty pixels of
permanent width is cheaper than that.

**A measuring note to add to the one in §7.** The browser pane reports
`document.hidden === true`, and rAF there is not merely throttled to 0.7fps —
it can be **suspended outright**, so the frame pump never ticks, the out point
is never enforced and playback looks broken while the element is in fact
playing perfectly. Read `currentTime` off the media element, or shim
`requestAnimationFrame` onto `setTimeout`, before believing anything about
transport behaviour. Separately: the pane's `key` action sends an **empty**
`key` for `space`, so a space-bar binding cannot be tested that way at all —
click the transport button instead.

---

## 10. Still out

- **Tier 3, the rest.** Re-ordering shots from the timeline (`moveClip` exists
  and the board exposes it, but not the strip); overlays spanning a seam; and
  re-render-one-shot as an explicitly priced action on a block. Two design
  problems it still has to solve: text on a reel is composed onto the *stitch
  output*, so re-stitching invalidates it — the pipeline has to be stitch →
  compose with the overlay re-applied from the document — and that document
  cannot live on a video row's `overlay_state`, because the video workflow
  replaces that column wholesale when it records a fal request id.
- **Crossfade seams preview as cuts.** The preview plays the sum of the kept
  lengths; a stitched crossfade is shorter by the overlap. The UI says so.
- **Tier 4 — audio, the part that ships.** §9 added *monitoring* — a speaker, a
  volume slider and an honest autoplay fallback — and that is all it added.
  None of it reaches the render. What is still out is everything that changes
  the delivered file, and Canva's shape is the one to copy: multiple tracks,
  trim handles per track, fades, and a mute for the model's own generated
  audio. That last one is the smallest and the most asked for, and it is the
  reason the preview mute is deliberately **not** wired to the document — see
  §9. Roughly the size of Tier 1 on its own.
- **Tier 5 — polish.** Safe-area guides for reel/story/feed, export presets.
- **The reel timeline has none of §9.** Snapping, loop, sound and the fade
  wedges all landed on the single-clip strip; `ReelTimeline.jsx` still has a
  bare transport and unsnapped block handles. It shares no code with
  `Timeline.jsx` — different objects, different playback hook — so this is a
  second pass rather than a prop.
- **A shortcut reference.** The editor now has around forty bindings and they
  live in tooltips and one line in the toolbar's empty state. That was
  survivable at ten.
- Split, for the reason in §4.

---

## Sources

- [Canva video timeline](https://www.canva.com/design-school/resources/video-timeline)
- [Edit element timing in your video](https://www.canva.com/help/element-timing-video/)
- [Trim videos and change scene duration](https://www.canva.com/help/trim-videos/)
- [Apply, change, or remove animations](https://www.canva.com/help/animate-designs/)
- [Use page transitions](https://www.canva.com/help/page-transitions/)
- [Edit and trim audio tracks](https://www.canva.com/help/trim-audio-and-adjust-volume/)
- [CapCut tutorial for beginners](https://www.capcut.com/resource/capcut-tutorial-for-beginners)
- [Edit videos & build scenes in Flow](https://support.google.com/flow/answer/16935718)
- [Top LTX Studio features](https://ltx.io/blog/top-ltx-studio-features)
