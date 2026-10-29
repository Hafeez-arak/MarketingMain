import { useT } from '../../lib/i18n'
import { PW } from './words'

// ─── Pricing: the pieces the pages share ───────────────────────────────────
// 2026-12-01, dev/erp-pilot/PRICING.md. Small display pieces (status badges,
// the status bar, figures), so the pages read and look alike.

export { Dialog, Field } from '../crm/parts'

const TONE = {
  draft: 'bg-stone-100 text-stone-700 border-stone-300',
  submitted: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  approved: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
  requested: 'bg-sky-50 text-sky-800 border-sky-200',
  received: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  declined: 'bg-red-50 text-red-700 border-red-200',
}

export function StatusBadge({ status, quote = false }) {
  const { t: w } = useT(PW)
  const label = quote ? w.quoteStatuses[status] : w.statuses[status]
  return <span className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] leading-none ${TONE[status] || ''}`}>{label || status}</span>
}

/** The workflow as steps; the current one is dark, passed ones light. */
export function StatusBar({ path, current, bad = [] }) {
  const { t: w } = useT(PW)
  const at = path.indexOf(current)
  return (
    <nav className="flex flex-wrap" aria-label={w.filterStatus}>
      {path.map((s, i) => (
        <span key={s} aria-current={i === at ? 'step' : undefined}
          className={`text-xs px-3 py-1.5 border -ms-px first:ms-0 first:rounded-s-md last:rounded-e-md ${i === at
            ? (bad.includes(s) ? 'bg-red-700 text-white border-red-700' : 'bg-stone-900 text-white border-stone-900')
            : i < at ? 'bg-stone-100 text-text border-border' : 'bg-white text-text-secondary border-border'}`}>
          {w.statuses[s] || w.quoteStatuses[s] || s}
        </span>
      ))}
    </nav>
  )
}

/** A figure with its label; `note` says why it is unknown, `tone` marks it red. */
export function Kpi({ label, value, note, tone }) {
  return (
    <div className="border border-border bg-stone-50/60 px-3 py-2 rounded-md min-w-[8rem]">
      <p className="text-[11px] text-text-tertiary">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${tone === 'bad' ? 'text-red-700' : 'text-text'}`} dir="ltr" style={{ textAlign: 'start' }}>{value}</p>
      {note && <p className="text-[11px] text-text-tertiary">{note}</p>}
    </div>
  )
}

/** A label and its value, in the pages' two-column facts. */
export function Facts({ rows }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm content-start">
      {rows.filter(Boolean).map(([label, value, ltr]) => (
        <div key={label} className="contents">
          <dt className="text-text-tertiary text-xs pt-0.5">{label}</dt>
          <dd className="text-text break-words" dir={ltr ? 'ltr' : 'auto'} style={ltr ? { textAlign: 'start' } : undefined}>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A red or amber error line. */
export const Alert = ({ children, tone = 'bad' }) => children
  ? <p role="alert" dir="auto" className={`text-xs ${tone === 'bad' ? 'text-red-600' : 'text-text-secondary'}`}>{children}</p> : null

export const NoAccess = () => {
  const { t: w, dir } = useT(PW)
  return <p className="text-sm text-text-secondary" dir={dir}>{w.noAccess}</p>
}
