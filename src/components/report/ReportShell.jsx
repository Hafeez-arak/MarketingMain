import { useNavigate } from 'react-router-dom'
import { usePrint } from '../../lib/reports/print'

// ─── The two printable reports share this ──────────────────────────────────
// A report is a document, not a screen. Everything here exists to make the
// thing on screen and the thing on paper the same object: A4-ish width, hard
// rules instead of cards, no hover state, no colour that is only decoration.
//
// The "download" half — window.print() and the filename it opens with — is in
// lib/reports/print.js, along with the reasoning for why this is the browser's
// print dialog and not a PDF library. (Short version: Arabic captions.)

/**
 * The sheet. Constrained to roughly A4's printable width so a table that fits
 * on screen fits on paper — the failure this prevents is a report that looks
 * right in the browser and loses its last column in the PDF.
 */
// ── `unicode-bidi: plaintext`, and it is not cosmetic ──
//
// This document carries Arabic company names, Arabic event names and Arabic
// quotes inside otherwise-English sentences. Laid out in a strongly left-to-
// right context, an Arabic run has its words reordered — the 15 Sep PDF
// rendered شركة إنارة للإضاءة as إنارة شركة لإلضاءة, which is not a font
// problem and not a typo: it is the paragraph direction being imposed on text
// that has its own. `plaintext` tells the browser to take each paragraph's
// direction from its first strong character, which is what makes a mixed-
// script document readable, in print as much as on screen.
//
// Set once, on the document, rather than per-name: every future section
// inherits it, and the one that forgets is the one a Saudi reader opens.
export function ReportDoc({ children }) {
  return (
    <div
      // ── The sheet needs its own margin ──
      // `bg-white` draws a page; without padding the text sits hard against
      // the edge of it, which reads as a layout fault rather than a document —
      // most obviously where a full-width table runs to both edges at once.
      //
      // `data-print-gutter` strips it on paper, where @page's 14mm/13mm is
      // already the margin and this would stack on top of it. Same attribute
      // AppLayout uses on the screen gutter, for the same reason.
      data-print-gutter
      className="mx-auto w-full max-w-[860px] bg-white text-text px-5 py-6 sm:px-10 sm:py-8 print:max-w-none"
      style={{ unicodeBidi: 'plaintext' }}
    >
      {children}
    </div>
  )
}

/** The on-screen-only strip above the document: back, and the PDF button. */
export function ReportToolbar({ backTo, backLabel = 'Back', right, children }) {
  const navigate = useNavigate()
  const print = usePrint()
  return (
    <div data-print-hide className="mb-4 flex items-center justify-between gap-3">
      <button
        onClick={() => navigate(backTo)}
        className="text-xs text-text-secondary hover:text-text inline-flex items-center gap-1.5"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        {backLabel}
      </button>
      <div className="flex items-center gap-2">
        {children}
        {right}
        <button
          onClick={print}
          className="border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-subtle inline-flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
            <path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          Download PDF
        </button>
      </div>
    </div>
  )
}

/** The masthead: what this is, who it is about, and what window it covers. */
export function ReportMasthead({ kind, brand, line, meta = [] }) {
  return (
    <header data-print-keep className="border-b-2 border-text pb-3 mb-5">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">{kind}</p>
        <p className="text-[10px] text-text-tertiary tabular-nums">{meta.filter(Boolean).join('  ·  ')}</p>
      </div>
      <h1 className="mt-1.5 text-2xl font-semibold leading-tight text-text">{brand}</h1>
      {line && <p className="mt-1 text-sm text-text-secondary leading-relaxed">{line}</p>}
    </header>
  )
}

/** A titled block. `note` is the one line that says how to read what follows. */
export function ReportSection({ title, note, children, keep = false, breakBefore = false }) {
  return (
    <section
      className="mb-5"
      {...(keep ? { 'data-print-keep': '' } : {})}
      {...(breakBefore ? { 'data-print-break': '' } : {})}
    >
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-tertiary border-b border-border pb-1 mb-2.5">
        {title}
      </h2>
      {note && <p className="text-[11px] text-text-tertiary leading-relaxed mb-2.5">{note}</p>}
      {children}
    </section>
  )
}

/**
 * The numbers band. Deliberately dumb: whatever is handed to it, in order.
 *
 * `value` is a string already — every caller has a formatter that knows what
 * "no measurement" means for its own metric, and a component that turns null
 * into 0 on their behalf would undo that work in one line.
 */
export function StatBand({ stats = [] }) {
  if (!stats.length) return null
  return (
    <div data-print-keep className="grid grid-cols-4 gap-px bg-border border border-border mb-5">
      {stats.map(s => (
        <div key={s.label} className="bg-white px-3 py-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">{s.label}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums leading-none text-text">{s.value}</p>
          {s.hint && <p className="mt-1 text-[10px] text-text-tertiary leading-snug">{s.hint}</p>}
        </div>
      ))}
    </div>
  )
}

/** A plain document table. Wide content scrolls on screen and wraps on paper. */
export function ReportTable({ head = [], children }) {
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-text">
            {head.map((h, i) => (
              <th
                key={h.label || i}
                className={`py-1.5 font-semibold text-[10px] uppercase tracking-wider text-text-tertiary ${
                  h.align === 'right' ? 'text-right' : 'text-left'
                } ${i === 0 ? '' : 'pl-3'}`}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function ReportRow({ children }) {
  return <tr data-print-keep className="border-b border-border align-top">{children}</tr>
}

export function Cell({ children, align = 'left', first = false, muted = false, className = '' }) {
  return (
    // `dir="auto"` per cell as well as plaintext on the document: a table cell
    // holding nothing but an Arabic name is its own paragraph, and it must
    // align and order itself right-to-left without dragging the table with it.
    <td
      dir="auto"
      className={`py-1.5 ${first ? '' : 'pl-3'} ${align === 'right' ? 'text-right tabular-nums' : ''} ${
        muted ? 'text-text-tertiary' : 'text-text'} ${className}`}
    >
      {children}
    </td>
  )
}

/**
 * The caveats block, and it is not optional furniture.
 *
 * Every number above it is a subtraction over stored rows, which makes it
 * certain and says nothing about whether it is representative. Sample sizes,
 * unsynced channels and missing credentials are what turn a confident figure
 * into a readable one, and a report that prints the figure while dropping
 * the caveat is the failure the agent's whole design is organised against.
 */
// ── ALWAYS RENDERED, EVEN EMPTY ──
//
// This section was the most trusted thing in the 15 Sep report — a reader who
// is told "this was an incomplete pass, not a clean null" can calibrate
// everything above it. Returning null when the list is empty made its presence
// a signal in itself: a run that admitted nothing looked identical to a run
// with nothing to admit, and the second is rare enough to be worth stating.
export function Caveats({ items = [] }) {
  const real = items.filter(Boolean)
  if (!real.length) {
    return (
      <ReportSection title="What this report cannot tell you" keep>
        <p className="text-[11px] text-text-secondary leading-relaxed">
          Every question this run asked was answered and every lens reported. That is unusual —
          read the sources before treating it as a complete picture of the market.
        </p>
      </ReportSection>
    )
  }
  return (
    <ReportSection title="What this report cannot tell you" keep>
      <ul className="space-y-1.5">
        {real.map((c, i) => (
          <li key={i} className="text-[11px] text-text-secondary leading-relaxed flex gap-2">
            <span className="text-text-tertiary shrink-0">—</span>
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </ReportSection>
  )
}

/** The footer line, on the last page only. */
export function ReportFooter({ children }) {
  return (
    <footer className="mt-6 pt-2.5 border-t border-border">
      <p className="text-[10px] text-text-tertiary leading-relaxed">{children}</p>
    </footer>
  )
}
