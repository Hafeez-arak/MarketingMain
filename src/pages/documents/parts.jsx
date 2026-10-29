import { Link } from 'react-router-dom'
import { useT } from '../../lib/i18n'
import { daysBetween } from '../../lib/documents/logic'
import { DW } from './words'

// ─── Documents: the pieces the pages share ─────────────────────────────────
// 2026-10-29, dev/erp-pilot/DOCUMENTS.md. Small display pieces (the state
// badge, the days left, a field with its error, the pager) so the pages
// read and look alike.

export { Dialog } from '../contacts/parts'

/** A labelled form control, with its error (or a hint) under it. */
export function Field({ label, error, hint, className = '', children }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[11px] text-text-secondary">{label}</span>
      {children}
      {error ? <span className="block text-[11px] text-red-600 mt-0.5">{error}</span>
        : hint ? <span className="block text-[11px] text-text-tertiary mt-0.5">{hint}</span> : null}
    </label>
  )
}

const STATE_TONE = {
  valid: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  expiring: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  expired: 'bg-red-50 text-red-700 border-red-200',
  no_expiry: 'bg-stone-50 text-text-secondary border-border',
  draft: 'bg-sky-50 text-sky-800 border-sky-200',
  archived: 'bg-stone-100 text-stone-600 border-stone-300',
}
export function StateBadge({ state }) {
  const { t: w } = useT(DW)
  return <span className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] leading-none ${STATE_TONE[state] || ''}`}>{w.states[state] || state}</span>
}

export function ConfidentialChip() {
  const { t: w } = useT(DW)
  return <span className="inline-block rounded border border-stone-300 bg-stone-100 px-1.5 py-px text-[10px] leading-4 text-stone-700">{w.confidential}</span>
}

/** Days to the expiry: "12 days", "Today", "5 days ago", or "—" for a draft or archived document. */
export function DaysLeft({ doc, today, state }) {
  const { t: w } = useT(DW)
  if (!doc.expiry_date || state === 'draft' || state === 'archived') return <span className="text-text-tertiary">—</span>
  const n = daysBetween(today, doc.expiry_date)
  if (n < 0) return <span className="text-red-700">{w.agoDays(-n)}</span>
  if (n === 0) return <span className="text-yellow-700 font-medium">{w.leftToday}</span>
  return <span className={state === 'expiring' ? 'text-yellow-700 font-medium' : 'text-text-secondary'}>{w.leftDays(n)}</span>
}

export function DateText({ date }) {
  return date ? <bdi dir="ltr" className="tabular-nums">{String(date).slice(0, 10)}</bdi> : <span className="text-text-tertiary">—</span>
}

export function NoAccess() {
  const { t: w, dir, lang } = useT(DW)
  return <p className="text-sm text-text-tertiary p-6 max-w-xl" dir={dir} lang={lang}>{w.noAccess}</p>
}

/** "1–30 of 74", then Previous / Next. Silent when everything fits on one page. */
export function Pager({ page, size, count, onPage }) {
  const { t: w } = useT(DW)
  if (count <= size) return null
  const last = Math.ceil(count / size) - 1
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border">
      <p className="text-[11px] text-text-tertiary tabular-nums" aria-live="polite">{w.pager(page * size + 1, Math.min(count, (page + 1) * size), count)}</p>
      <div className="flex gap-1">
        <button type="button" className="text-xs px-2 py-1 border border-border rounded bg-white disabled:opacity-40" disabled={page <= 0} onClick={() => onPage(page - 1)}>{w.prev}</button>
        <button type="button" className="text-xs px-2 py-1 border border-border rounded bg-white disabled:opacity-40" disabled={page >= last} onClick={() => onPage(page + 1)}>{w.next}</button>
      </div>
    </div>
  )
}

/** The link in a row: to the document. */
export function DocLink({ doc, to }) {
  return <Link to={to} className="hover:underline"><bdi dir="ltr" className="text-text-tertiary text-xs">{doc.document_no}</bdi> <bdi>{doc.title}</bdi></Link>
}
