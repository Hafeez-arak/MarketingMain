// ─── Overlay-editor typefaces ──────────────────────────────────────────────
// Every face here must also be in the @import block at the top of
// src/index.css — canvas silently substitutes a default font for anything not
// yet loaded, so a face that's listed but not fetched produces an export that
// doesn't match what the marketer saw on screen. The two lists are checked
// against each other by `FAMILIES` at the bottom of this file; if you add a
// row here and forget the CSS, that's the thing to grep for.
//
// Each row carries:
//   value/label  the CSS family name, and what the menu calls it
//   group        which section of the font menu it sits in
//   arabic       true if the face actually carries Arabic glyphs
//   weights      THE WEIGHTS THE FACE ACTUALLY HAS, ascending
//   note         one line on what it's for, shown under the name in the menu
//
// ── Why `weights` is per-family ────────────────────────────────────────────
// The weight menu used to offer Regular/Semibold/Bold/Black for everything.
// Most of these faces have no 900 and half have no 600, and asking a canvas
// for a weight a face doesn't have doesn't error — it picks the nearest, or
// synthesises a smeared fake bold. Either way the toolbar then says "Black"
// while the canvas draws Regular, which is the same preview/export drift the
// whole text pipeline exists to avoid. So the menu is built from this list,
// and switching family snaps the layer to the nearest weight that exists (see
// `nearestWeight`).
//
// ── Why `arabic` ───────────────────────────────────────────────────────────
// The editor hides the Latin-only faces while a box is set to RTL, because
// picking Playfair for Arabic text doesn't error — it renders tofu boxes or
// falls back silently, which is exactly the kind of thing that survives review
// and ships broken.
//
// When Arak sends their licensed brand fonts, add them here with a matching
// @font-face rule; nothing else in the editor needs to change.

export const FONT_GROUPS = [
  { id: 'arabic', label: 'Arabic & bilingual' },
  { id: 'sans', label: 'Sans serif' },
  { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display & headline' },
  { id: 'script', label: 'Handwriting' },
  { id: 'mono', label: 'Monospace' },
]

// Ascending, and complete: these are the weight sets in the @import.
const W = {
  full: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  w200_800: [200, 300, 400, 500, 600, 700, 800],
  w300_900: [300, 400, 500, 600, 700, 800, 900],
  w300_800: [300, 400, 500, 600, 700, 800],
  w400_900: [400, 500, 600, 700, 800, 900],
  w400_800: [400, 500, 600, 700, 800],
  w400_700: [400, 500, 600, 700],
  w200_700: [200, 300, 400, 500, 600, 700],
  w100_700: [100, 200, 300, 400, 500, 600, 700],
  regularBold: [400, 700],
  one: [400],
}

export const STUDIO_FONTS = [
  // ── Arabic & bilingual ───────────────────────────────────────────────────
  // First, and deliberately: this is a studio for a Saudi brand, and the
  // Arabic headline is the thing most documents are built around. A Latin-only
  // list at the top would put the faces that can't do the job where the eye
  // lands first.
  { value: 'Cairo',                group: 'arabic', arabic: true, weights: W.w200_800.concat(900, 1000), label: 'Cairo',                note: 'Modern geometric — safe default' },
  { value: 'Tajawal',              group: 'arabic', arabic: true, weights: [200, 300, 400, 500, 700, 800, 900], label: 'Tajawal',        note: 'Clean and friendly' },
  { value: 'Almarai',              group: 'arabic', arabic: true, weights: [300, 400, 700, 800],  label: 'Almarai',              note: 'Neutral Gulf sans — very legible small' },
  { value: 'IBM Plex Sans Arabic', group: 'arabic', arabic: true, weights: W.w100_700,            label: 'IBM Plex Sans Arabic', note: 'Technical, corporate' },
  { value: 'Readex Pro',           group: 'arabic', arabic: true, weights: W.w200_700,            label: 'Readex Pro',           note: 'Wide, open — good for captions' },
  { value: 'Rubik',                group: 'arabic', arabic: true, weights: W.w300_900,            label: 'Rubik',                note: 'Rounded corners, contemporary' },
  { value: 'Alexandria',           group: 'arabic', arabic: true, weights: W.full,                label: 'Alexandria',           note: 'Neo-grotesque, wide weight range' },
  { value: 'Changa',               group: 'arabic', arabic: true, weights: W.w200_800,            label: 'Changa',               note: 'Condensed — fits long headlines' },
  { value: 'El Messiri',           group: 'arabic', arabic: true, weights: W.w400_700,            label: 'El Messiri',           note: 'Warm, slightly calligraphic' },
  { value: 'Noto Kufi Arabic',     group: 'arabic', arabic: true, weights: W.full,                label: 'Noto Kufi Arabic',     note: 'Kufi — bold, architectural' },
  { value: 'Reem Kufi',            group: 'arabic', arabic: true, weights: W.w400_700,            label: 'Reem Kufi',            note: 'Kufi with softer joins' },
  { value: 'Noto Naskh Arabic',    group: 'arabic', arabic: true, weights: W.w400_700,            label: 'Noto Naskh Arabic',    note: 'Naskh — the body-copy standard' },
  { value: 'Amiri',                group: 'arabic', arabic: true, weights: W.regularBold,         label: 'Amiri',                note: 'Classical Naskh serif' },
  { value: 'Scheherazade New',     group: 'arabic', arabic: true, weights: W.w400_700,            label: 'Scheherazade New',     note: 'Traditional Naskh, generous height' },
  { value: 'Aref Ruqaa',           group: 'arabic', arabic: true, weights: W.regularBold,         label: 'Aref Ruqaa',           note: 'Ruqaa — formal, ceremonial' },
  { value: 'Marhey',               group: 'arabic', arabic: true, weights: [300, 400, 500, 600, 700], label: 'Marhey',           note: 'Playful, high-energy' },
  { value: 'Baloo Bhaijaan 2',     group: 'arabic', arabic: true, weights: W.w400_800,            label: 'Baloo Bhaijaan 2',     note: 'Chunky and rounded' },
  { value: 'Lalezar',              group: 'arabic', arabic: true, weights: W.one,                 label: 'Lalezar',              note: 'Poster weight — one size fits headlines' },

  // ── Sans serif ───────────────────────────────────────────────────────────
  { value: 'DM Sans',              group: 'sans', arabic: false, weights: [300, 400, 500, 600, 700], label: 'DM Sans',           note: "The app's own sans" },
  { value: 'Inter',                group: 'sans', arabic: false, weights: W.full,                 label: 'Inter',                note: 'The default UI sans — neutral' },
  { value: 'Roboto',               group: 'sans', arabic: false, weights: W.full,                 label: 'Roboto',               note: 'Android/Google standard' },
  { value: 'Open Sans',            group: 'sans', arabic: false, weights: W.w300_800,             label: 'Open Sans',            note: 'Humanist, very safe' },
  { value: 'Lato',                 group: 'sans', arabic: false, weights: [100, 300, 400, 700, 900], label: 'Lato',              note: 'Warm, semi-rounded' },
  { value: 'Montserrat',           group: 'sans', arabic: false, weights: W.full,                 label: 'Montserrat',           note: 'Geometric — the poster default' },
  { value: 'Poppins',              group: 'sans', arabic: false, weights: W.full,                 label: 'Poppins',              note: 'Circular geometric, friendly' },
  { value: 'Raleway',              group: 'sans', arabic: false, weights: W.full,                 label: 'Raleway',              note: 'Elegant, tall lowercase' },
  { value: 'Nunito',               group: 'sans', arabic: false, weights: [200, 300, 400, 500, 600, 700, 800, 900, 1000], label: 'Nunito', note: 'Rounded terminals, soft' },
  { value: 'Work Sans',            group: 'sans', arabic: false, weights: W.full,                 label: 'Work Sans',            note: 'Grotesque, good at large sizes' },

  // ── Serif ────────────────────────────────────────────────────────────────
  { value: 'Playfair Display',     group: 'serif', arabic: false, weights: W.w400_900,            label: 'Playfair Display',     note: 'High-contrast luxury serif' },
  { value: 'Cormorant Garamond',   group: 'serif', arabic: false, weights: [300, 400, 500, 600, 700], label: 'Cormorant Garamond', note: 'Delicate Garamond — luxury' },
  { value: 'EB Garamond',          group: 'serif', arabic: false, weights: W.w400_800,            label: 'EB Garamond',          note: 'Classic old-style, readable' },
  { value: 'Lora',                 group: 'serif', arabic: false, weights: W.w400_700,            label: 'Lora',                 note: 'Contemporary, brushed curves' },
  { value: 'Merriweather',         group: 'serif', arabic: false, weights: W.w300_900,            label: 'Merriweather',         note: 'Sturdy — built for body copy' },
  { value: 'Libre Baskerville',    group: 'serif', arabic: false, weights: W.regularBold,         label: 'Libre Baskerville',    note: 'Transitional, editorial' },
  { value: 'Roboto Slab',          group: 'serif', arabic: false, weights: W.full,                label: 'Roboto Slab',          note: 'Slab serif, solid' },
  { value: 'Bitter',               group: 'serif', arabic: false, weights: W.full,                label: 'Bitter',               note: 'Contrasty slab, screen-first' },

  // ── Display & headline ───────────────────────────────────────────────────
  { value: 'Oswald',               group: 'display', arabic: false, weights: W.w200_700,          label: 'Oswald',               note: 'Condensed — the headline workhorse' },
  { value: 'Bebas Neue',           group: 'display', arabic: false, weights: W.one,               label: 'Bebas Neue',           note: 'All-caps condensed, poster' },
  { value: 'Anton',                group: 'display', arabic: false, weights: W.one,               label: 'Anton',                note: 'Heavy condensed, maximum impact' },
  { value: 'Archivo Black',        group: 'display', arabic: false, weights: W.one,               label: 'Archivo Black',        note: 'Wide and very heavy' },

  // ── Handwriting ──────────────────────────────────────────────────────────
  { value: 'Pacifico',             group: 'script', arabic: false, weights: W.one,                label: 'Pacifico',             note: 'Retro brush script' },
  { value: 'Dancing Script',       group: 'script', arabic: false, weights: W.w400_700,           label: 'Dancing Script',       note: 'Bouncy casual script' },
  { value: 'Caveat',               group: 'script', arabic: false, weights: W.w400_700,           label: 'Caveat',               note: 'Handwritten marker' },

  // ── Monospace ────────────────────────────────────────────────────────────
  { value: 'Roboto Mono',          group: 'mono', arabic: false, weights: W.w100_700,             label: 'Roboto Mono',          note: 'Even-width — specs, prices, codes' },
  { value: 'Space Mono',           group: 'mono', arabic: false, weights: W.regularBold,          label: 'Space Mono',           note: 'Quirky mono, technical brands' },
]

const BY_VALUE = new Map(STUDIO_FONTS.map(f => [f.value, f]))

export function fontMeta(family) {
  return BY_VALUE.get(family) || null
}

// The list a box is allowed to pick from. RTL boxes see the Arabic-capable
// faces only — see the header.
export function fontsFor(dir) {
  return dir === 'rtl' ? STUDIO_FONTS.filter(f => f.arabic) : STUDIO_FONTS
}

// Grouped for the menu, in FONT_GROUPS order, with empty groups dropped —
// an RTL box has no Serif or Handwriting section, and an empty heading reads
// as a broken menu rather than as a filtered one.
export function groupedFonts(dir, query = '') {
  const q = query.trim().toLowerCase()
  const pool = fontsFor(dir).filter(f => (
    !q || f.label.toLowerCase().includes(q) || f.note.toLowerCase().includes(q) || f.group.includes(q)
  ))
  return FONT_GROUPS
    .map(g => ({ ...g, fonts: pool.filter(f => f.group === g.id) }))
    .filter(g => g.fonts.length)
}

// ── Weights ────────────────────────────────────────────────────────────────
// The four names a person reaches for. Anything a face doesn't have is simply
// not offered, so the label in the toolbar and the pixels on the canvas cannot
// disagree (see the header).
export const WEIGHT_LABELS = {
  100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium',
  600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black', 1000: 'Ultra',
}

// Deliberately not every weight a variable face exposes: a menu of nine rows
// where seven look identical at caption size is worse than four that don't.
// These are the four the rest of the editor already speaks in (⌘B jumps
// between 400 and 700), narrowed to what the family actually carries.
const PREFERRED = [400, 500, 600, 700, 900]

export function weightsFor(family) {
  const have = fontMeta(family)?.weights
  if (!have?.length) return [400, 700]
  const offered = PREFERRED.filter(w => have.includes(w))
  // A single-weight face like Bebas Neue still needs one row, or the menu is
  // empty and the control looks broken.
  return offered.length ? offered : [have[Math.floor(have.length / 2)]]
}

// What a layer's weight becomes when its family changes under it. Ties go
// heavier — dropping from Bold to Regular is a much more visible change than
// climbing to a slightly heavier bold, and a headline that quietly un-bolds
// itself on a font swap is the bug this exists to prevent.
export function nearestWeight(family, want) {
  const options = weightsFor(family)
  const target = Number(want) || 400
  return options.reduce((best, w) => (
    Math.abs(w - target) < Math.abs(best - target) ? w : best
  ), options[options.length - 1])
}

export function weightLabel(family, weight) {
  return WEIGHT_LABELS[weight] || String(weight)
}

// The CSS stack a face is drawn with — its own name plus a generic that at
// least keeps the shape while it loads, and keeps the menu preview honest if
// the network drops the file entirely.
const GENERIC = { serif: 'serif', script: 'cursive', mono: 'monospace' }

export function fontStack(family) {
  const generic = GENERIC[fontMeta(family)?.group] || 'sans-serif'
  return `"${family}", ${generic}`
}

// ─── Getting the faces into the page ───────────────────────────────────────
// These used to sit in an @import at the top of src/index.css, which meant
// every screen in the app blocked its first paint on ~150KB of @font-face
// rules for a canvas none of them have. They load when the editor opens
// instead.
//
// Split three ways because that is how the menu is split, and because a single
// URL carrying 45 families is long enough to be awkward to edit by hand.
// Google's CSS2 API wants the families in each request sorted alphabetically
// and rejects a weight a face doesn't have — both are easy to break silently,
// so if you add a row above, curl the URL before believing it.
//
// `display=swap` is deliberate. A blocked face means the layer draws in a
// fallback for a moment, which the editor covers with its own spinner anyway;
// a blocked *paint* means the whole editor is a white rectangle.
const STUDIO_FONT_CSS = [
  'https://fonts.googleapis.com/css2?family=Alexandria:wght@100..900&family=Almarai:wght@300;400;700;800&family=Amiri:wght@400;700&family=Aref+Ruqaa:wght@400;700&family=Baloo+Bhaijaan+2:wght@400..800&family=Cairo:wght@200..1000&family=Changa:wght@200..800&family=El+Messiri:wght@400..700&family=IBM+Plex+Sans+Arabic:wght@100;200;300;400;500;600;700&family=Lalezar&family=Marhey:wght@300..700&family=Noto+Kufi+Arabic:wght@100..900&family=Noto+Naskh+Arabic:wght@400..700&family=Readex+Pro:wght@200..700&family=Reem+Kufi:wght@400..700&family=Rubik:wght@300..900&family=Scheherazade+New:wght@400;500;600;700&family=Tajawal:wght@200;300;400;500;700;800;900&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=Lato:wght@100;300;400;700;900&family=Montserrat:wght@100..900&family=Nunito:wght@200..1000&family=Open+Sans:wght@300..800&family=Poppins:wght@100;200;300;400;500;600;700;800;900&family=Raleway:wght@100..900&family=Roboto:wght@100..900&family=Work+Sans:wght@100..900&display=swap',
  'https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@100..900&family=Caveat:wght@400..700&family=Cormorant+Garamond:wght@300;400;500;600;700&family=Dancing+Script:wght@400..700&family=EB+Garamond:wght@400..800&family=Libre+Baskerville:wght@400;700&family=Lora:wght@400..700&family=Merriweather:wght@300..900&family=Oswald:wght@200..700&family=Pacifico&family=Playfair+Display:wght@400..900&family=Roboto+Mono:wght@100..700&family=Roboto+Slab:wght@100..900&family=Space+Mono:wght@400;700&display=swap',
]

// Memoised on the promise, not on a boolean: two editors mounting in the same
// tick must both wait for the same load rather than the second one deciding
// the work is "already started" and racing ahead of it.
let cssPromise = null

export function loadStudioFontCss() {
  if (cssPromise) return cssPromise
  if (typeof document === 'undefined') return Promise.resolve()
  cssPromise = Promise.all(STUDIO_FONT_CSS.map(href => new Promise(resolve => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    // Resolve on error too. A dropped request means the faces fall back, which
    // is what happens today when the network is bad; hanging here would mean a
    // permanently disabled Save button, which is worse than a wrong font.
    link.addEventListener('load', resolve, { once: true })
    link.addEventListener('error', resolve, { once: true })
    document.head.appendChild(link)
  })))
  return cssPromise
}

// Canvas draws with whatever is loaded AT THE MOMENT fillText runs — it does
// not wait, and it does not warn. Without this the first export after opening
// the editor comes out in a fallback face (most visibly: Arabic renders
// unshaped or as boxes). Resolve every (weight, family) pair actually in use
// before drawing anything.
//
// The stylesheets come first and are awaited, not merely kicked off:
// `document.fonts.load` for a family with no @font-face rule yet does not
// throw and does not wait — it resolves immediately with nothing, and the
// editor would carry on and rasterise in a fallback believing it had waited.
export async function ensureFontsLoaded(boxes) {
  await loadStudioFontCss()
  if (!document.fonts) return
  const pairs = new Set(boxes.map(b => `${b.weight} 64px "${b.family}"`))
  await Promise.all([...pairs].map(spec => document.fonts.load(spec).catch(() => {})))
  await document.fonts.ready
}

// Every family name in this file, for the CSS cross-check described in the
// header. Exported rather than inlined so a test — or a person at a console —
// can compare it against what document.fonts actually knows about.
export const FAMILIES = STUDIO_FONTS.map(f => f.value)
