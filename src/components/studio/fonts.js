// ─── Overlay-editor typefaces ──────────────────────────────────────────────
// Every face here must also be in the @import at the top of src/index.css —
// canvas silently substitutes a default font for anything not yet loaded, so
// a face that's listed but not fetched produces an export that doesn't match
// what the marketer saw on screen.
//
// `arabic: true` marks faces that actually carry Arabic glyphs. The editor
// hides the Latin-only ones while a box is set to RTL, because picking
// Cormorant for Arabic text doesn't error — it just renders tofu boxes or
// falls back silently, which is exactly the kind of thing that survives
// review and ships broken.
//
// When Arak sends their licensed brand fonts, add them here with a matching
// @font-face rule; nothing else in the editor needs to change.
export const STUDIO_FONTS = [
  { value: 'Cairo',                label: 'Cairo',                arabic: true,  note: 'Modern, geometric — safe default' },
  { value: 'Tajawal',              label: 'Tajawal',              arabic: true,  note: 'Clean, friendly' },
  { value: 'IBM Plex Sans Arabic', label: 'IBM Plex Sans Arabic', arabic: true,  note: 'Technical, corporate' },
  { value: 'Noto Kufi Arabic',     label: 'Noto Kufi Arabic',     arabic: true,  note: 'Kufi — bold, architectural' },
  { value: 'Amiri',                label: 'Amiri',                arabic: true,  note: 'Classical Naskh serif' },
  { value: 'DM Sans',              label: 'DM Sans (Latin)',      arabic: false, note: "The app's own sans" },
  { value: 'Cormorant Garamond',   label: 'Cormorant (Latin)',    arabic: false, note: 'Luxury serif' },
]

export const WEIGHTS = [
  { value: 400, label: 'Regular' },
  { value: 600, label: 'Semibold' },
  { value: 700, label: 'Bold' },
  { value: 900, label: 'Black' },
]

export function fontsFor(dir) {
  return dir === 'rtl' ? STUDIO_FONTS.filter(f => f.arabic) : STUDIO_FONTS
}

// Canvas draws with whatever is loaded AT THE MOMENT fillText runs — it does
// not wait, and it does not warn. Without this the first export after opening
// the editor comes out in a fallback face (most visibly: Arabic renders
// unshaped or as boxes). Resolve every (weight, family) pair actually in use
// before drawing anything.
export async function ensureFontsLoaded(boxes) {
  if (!document.fonts) return
  const pairs = new Set(boxes.map(b => `${b.weight} 64px "${b.family}"`))
  await Promise.all([...pairs].map(spec => document.fonts.load(spec).catch(() => {})))
  await document.fonts.ready
}
