// ─── The editor's icon set ─────────────────────────────────────────────────
// Inline SVG, drawn here, no package. That is the same choice Timeline.jsx
// already made for its transport glyphs and the reason is unchanged: nothing
// else in src/ pulls an icon library in, and one would be a dependency and a
// bundle for what amounts to thirty paths.
//
// What this replaces is worse than a missing dependency. The toolbar, the left
// rail and the shape grid were drawn with emoji and dingbats — 🎚 🖌 ✚ ▣ ⌗ ⬚
// ⟲ ⟳ ⇋ ⇅ ∅ ⛏ — and those are not icons, they are *text*. On macOS half of
// them resolve to full-colour emoji, which in a flat monochrome UI look like
// stickers someone left on the toolbar; on Windows and Linux several of them
// have no glyph in the UI font at all and render as tofu. Neither follows the
// button's own colour, so an active or disabled state left them unchanged.
//
// Everything below is one 24×24 grid, `currentColor`, and a 2px stroke, so an
// icon inherits its button's colour and disabled opacity like any other text.
// The three transport glyphs are filled instead of stroked, because a play
// triangle drawn as an outline reads as a "next" chevron at 12px.

function Icon({ children, className = 'h-4 w-4', solid = false, strokeWidth = 2 }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-hidden="true"
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      strokeWidth={solid ? undefined : strokeWidth}
      strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

// ── History ────────────────────────────────────────────────────────────────
export const IconUndo = p => <Icon {...p}><path d="M3 8h11a6 6 0 010 12h-6" /><path d="M7 4L3 8l4 4" /></Icon>
export const IconRedo = p => <Icon {...p}><path d="M21 8H10a6 6 0 000 12h6" /><path d="M17 4l4 4-4 4" /></Icon>

// ── The photo itself ───────────────────────────────────────────────────────
export const IconCrop = p => <Icon {...p}><path d="M6 2v16h16" /><path d="M2 6h16v16" /></Icon>
export const IconAdjust = p => (
  <Icon {...p}>
    <path d="M5 21V14M5 10V3M12 21v-9M12 8V3M19 21v-5M19 12V3" />
    <path d="M2 14h6M9 8h6M16 16h6" />
  </Icon>
)
// A three-quarter circle with a chevron on the leading end. The arc is written
// as ONE relative arc off a point on the circle rather than as a stack of
// curves, so the two directions are exact mirrors of each other and the
// chevron's vertex is guaranteed to sit on the path: centre (12,12), r=8,
// start at the top (12,4), large-arc, and only the sweep flag differs.
//
// The first attempt at these packed an arc, an arrowhead and a corner tick
// into the same 24 units and turned to mush at the 16px they are actually
// drawn at — the right-hand one read as a stray diagonal stroke. Fewer, longer
// strokes is the whole trick at this size.
export const IconRotateLeft = p => (
  <Icon {...p}><path d="M12 4a8 8 0 1 0 8 8" /><path d="M14.6 1.6L12 4l2.6 2.4" /></Icon>
)
export const IconRotateRight = p => (
  <Icon {...p}><path d="M12 4a8 8 0 1 1-8 8" /><path d="M9.4 1.6L12 4 9.4 6.4" /></Icon>
)
// Two arrows leaving a dashed axis. The dash is what says "mirror" rather than
// "move"; without it these read as a pair of media-skip buttons.
export const IconFlipH = p => (
  <Icon {...p}>
    <path d="M12 2v20" strokeDasharray="3 3" />
    <path d="M9 6L3 12l6 6z" /><path d="M15 6l6 6-6 6z" />
  </Icon>
)
export const IconFlipV = p => (
  <Icon {...p}>
    <path d="M2 12h20" strokeDasharray="3 3" />
    <path d="M6 9l6-6 6 6z" /><path d="M6 15l6 6 6-6z" />
  </Icon>
)

// ── Panels and actions ─────────────────────────────────────────────────────
export const IconPlus = p => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
export const IconImage = p => (
  <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5-6 6-2-2-5 5" /></Icon>
)
export const IconLayers = p => (
  <Icon {...p}><path d="M12 2l9 5-9 5-9-5 9-5z" /><path d="M3 12l9 5 9-5" /><path d="M3 17l9 5 9-5" /></Icon>
)
export const IconBrush = p => (
  <Icon {...p}><path d="M9 15l-3 6 6-3" /><path d="M9 15L20 4a2.1 2.1 0 013 3L12 18l-3-3z" /></Icon>
)
export const IconUpload = p => <Icon {...p}><path d="M12 17V4" /><path d="M7 9l5-5 5 5" /><path d="M4 20h16" /></Icon>
export const IconEyedropper = p => (
  <Icon {...p}><path d="M14 4l6 6" /><path d="M17 3.5a2.1 2.1 0 013 3l-3.5 3.5-3-3L17 3.5z" /><path d="M13.5 8.5L4 18v2h2l9.5-9.5" /></Icon>
)
export const IconNone = p => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></Icon>
export const IconKeyboard = p => (
  <Icon {...p}><rect x="2" y="6" width="20" height="12" rx="1" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" /></Icon>
)

// ── Text alignment ─────────────────────────────────────────────────────────
export const IconAlignLeft = p => <Icon {...p}><path d="M3 6h18M3 11h11M3 16h15M3 21h9" /></Icon>
export const IconAlignCenter = p => <Icon {...p}><path d="M3 6h18M7 11h10M4 16h16M8 21h8" /></Icon>
export const IconAlignRight = p => <Icon {...p}><path d="M3 6h18M10 11h11M6 16h15M12 21h9" /></Icon>
export const IconAlignJustify = p => <Icon {...p}><path d="M3 6h18M3 11h18M3 16h18M3 21h18" /></Icon>

// ── Shapes, for the insert grid ────────────────────────────────────────────
// Bigger by default than the toolbar icons: these are the subject of their
// button rather than a label on it.
const shape = { className: 'h-5 w-5' }
export const IconRect = p => <Icon {...shape} {...p}><rect x="3" y="6" width="18" height="12" /></Icon>
export const IconEllipse = p => <Icon {...shape} {...p}><ellipse cx="12" cy="12" rx="9" ry="7" /></Icon>
export const IconTriangle = p => <Icon {...shape} {...p}><path d="M12 4l9 16H3l9-16z" /></Icon>
export const IconPolygon = p => <Icon {...shape} {...p}><path d="M7.5 3.5h9l4.5 8.5-4.5 8.5h-9L3 12l4.5-8.5z" /></Icon>
export const IconStar = p => <Icon {...shape} {...p}><path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.8l6.5-.9L12 3z" /></Icon>
export const IconLine = p => <Icon {...shape} {...p}><path d="M4 19L20 5" /></Icon>
export const IconArrow = p => <Icon {...shape} {...p}><path d="M4 12h15" /><path d="M14 7l5 5-5 5" /></Icon>

// ── Transport ──────────────────────────────────────────────────────────────
// Filled, for the reason in the header.
export const IconPlay = p => <Icon solid className="h-3 w-3" {...p}><path d="M8 5v14l11-7z" /></Icon>
export const IconPause = p => <Icon solid className="h-3 w-3" {...p}><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></Icon>
export const IconSkipStart = p => <Icon solid className="h-3 w-3" {...p}><path d="M7 5h2v14H7zM19 5v14l-9-7z" /></Icon>

export const IconLoop = p => (
  <Icon className="h-3.5 w-3.5" strokeWidth={2.4} {...p}>
    <path d="M4 9a4 4 0 014-4h9" /><path d="M14 2l3 3-3 3" />
    <path d="M20 15a4 4 0 01-4 4H7" /><path d="M10 22l-3-3 3-3" />
  </Icon>
)
export const IconVolume = p => (
  <Icon className="h-3.5 w-3.5" strokeWidth={2.2} {...p}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M17 8.5a5 5 0 010 7" /><path d="M20 6a9 9 0 010 12" />
  </Icon>
)
export const IconVolumeMuted = p => (
  <Icon className="h-3.5 w-3.5" strokeWidth={2.2} {...p}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M17 9.5l5 5M22 9.5l-5 5" />
  </Icon>
)
