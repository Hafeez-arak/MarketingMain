import { useId, useState } from 'react'

// ─── A section of a card that folds away ───────────────────────────────────
//
// Closed by default. The Website card carries two long lists — the SEO
// recommendations and the page table — and open they push the post queue and
// everything under it off the screen entirely. The four numbers above them are
// one row tall and stay visible; the lists are reference material you go
// looking for, so they start shut.
//
// A <button> with aria-expanded and a real hidden attribute, not a div with an
// onClick and a height of zero: the heading has to be reachable by keyboard
// and announced as a control, and content hidden with CSS alone is still read
// aloud and still focusable.

export function Collapsible({ title, subtitle, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left
          hover:bg-surface-subtle transition-colors focus:outline-none focus-visible:bg-surface-subtle">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-text leading-tight">{title}</span>
          {subtitle && <span className="block text-xs text-text-tertiary mt-0.5">{subtitle}</span>}
        </span>
        <span className="flex items-center gap-2 flex-shrink-0">
          {count !== undefined && count !== null && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 bg-surface-subtle border border-border
              text-text-secondary tabular-nums leading-[1.4]">{count}</span>
          )}
          <svg className={`w-4 h-4 text-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      <div id={id} hidden={!open}>{children}</div>
    </div>
  )
}
