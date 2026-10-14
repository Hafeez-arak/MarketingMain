import { Button } from './index'

// ─── Pagination ────────────────────────────────────────────────────────────
// A compact pager for a list read a page at a time: "1–50 of 1,234", then
// Previous / Next. Silent when everything fits on one page. `page` counts
// from 0. `busy` (the next page is on its way) only disables the buttons;
// the rows on screen stay where they are.

export function Pagination({ page, pageSize, count, onPage, busy = false, noun = '', className = '' }) {
  if (count == null || count <= pageSize) return null
  const from = page * pageSize + 1
  const to = Math.min(count, (page + 1) * pageSize)
  const last = Math.ceil(count / pageSize) - 1
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2 border-t border-border ${className}`}>
      <p className="text-[11px] text-text-tertiary tabular-nums" aria-live="polite">
        {from.toLocaleString()}–{to.toLocaleString()} of {count.toLocaleString()}{noun ? ` ${noun}` : ''}
      </p>
      <div className="flex gap-1">
        <Button size="xs" variant="secondary" disabled={busy || page <= 0} onClick={() => onPage(page - 1)} aria-label="Previous page">
          ‹ Previous
        </Button>
        <Button size="xs" variant="secondary" disabled={busy || page >= last} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next ›
        </Button>
      </div>
    </div>
  )
}
