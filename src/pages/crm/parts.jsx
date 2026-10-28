import { Link } from 'react-router-dom'
import { useT } from '../../lib/i18n'
import { TAG_COLORS, bidChip, dueState, listName } from '../../lib/crm/logic'
import { RW } from './words'
import { leadHref } from './useCrmBase'

// ─── CRM: the pieces the pages share ───────────────────────────────────────
// 2026-10-28, dev/erp-pilot/CRM.md. Small display pieces (stars, tags,
// status, the bid chip, an activity's date), the filter chips and the pager,
// so the pages read and look alike.

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

/** His priority: none to three stars. */
export function Stars({ n }) {
  const { t: w } = useT(RW)
  if (!n) return null
  return <span className="text-amber-500 tracking-tight" title={w.priority} aria-label={`${w.priority}: ${n}`}>{'★'.repeat(n)}</span>
}

/** An item's tags as coloured chips. */
export function TagChips({ tags = [] }) {
  const { lang } = useT(RW)
  if (!tags.length) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map(t => (
        <span key={t.id} className="text-[11px] leading-4 px-1.5 py-px rounded border"
          style={{ color: TAG_COLORS[t.color] || TAG_COLORS[0], borderColor: `${TAG_COLORS[t.color] || TAG_COLORS[0]}55`, background: `${TAG_COLORS[t.color] || TAG_COLORS[0]}12` }}>
          <bdi>{listName(t, lang)}</bdi>
        </span>
      ))}
    </span>
  )
}

const STATUS_TONE = {
  open: 'bg-sky-50 text-sky-800 border-sky-200',
  won: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  lost: 'bg-red-50 text-red-700 border-red-200',
}
export function StatusBadge({ status }) {
  const { t: w } = useT(RW)
  return <span className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] leading-none ${STATUS_TONE[status] || ''}`}>{w.statuses[status] || status}</span>
}

const CHIP_TONE = { past: 'bg-red-50 text-red-700 border-red-200', soon: 'bg-amber-50 text-amber-800 border-amber-200', ok: 'bg-stone-50 text-text-secondary border-border' }
/** The bid's due date with the days left (open opportunities only). */
export function BidChip({ lead, today, label = true }) {
  const { t: w } = useT(RW)
  const chip = bidChip(lead, today)
  if (!chip) return null
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] leading-none ${CHIP_TONE[chip.tone]}`} title={w.f.bidDate}>
      {label && <span>{w.bid}</span>}
      <bdi dir="ltr">{String(lead.bid_due_date).slice(0, 10)}</bdi>
      <span>· {chip.days < 0 && label ? `${w.bidPast} ` : ''}{w.days(chip.days)}</span>
    </span>
  )
}

const DUE_TONE = { late: 'text-red-700 font-medium', today: 'text-amber-700 font-medium', planned: 'text-text-secondary', none: 'text-text-tertiary' }
/** An activity's date, red when late and amber when today. */
export function DueDate({ date, today, done = false }) {
  const state = done ? 'planned' : dueState(date, today)
  return <bdi dir="ltr" className={`tabular-nums ${DUE_TONE[state]}`}>{String(date || '').slice(0, 10)}</bdi>
}

/** His filter menu, as chips in labelled groups. `active`: the keys on. */
export function FilterChips({ filters, active, onToggle, groupLabel, label }) {
  const groups = []
  for (const f of filters) {
    let g = groups.find(x => x.key === f.group)
    if (!g) { g = { key: f.group, items: [] }; groups.push(g) }
    g.items.push(f)
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {groups.map(g => (
        <div key={g.key} className="inline-flex flex-wrap items-center gap-1" role="group" aria-label={groupLabel(g.key)}>
          <span className="text-[10px] uppercase tracking-wide text-text-tertiary me-0.5">{groupLabel(g.key)}</span>
          {g.items.map(f => (
            <button key={f.key} type="button" onClick={() => onToggle(f.key)} aria-pressed={active.includes(f.key)}
              className={`text-xs px-2 py-0.5 rounded-full border ${active.includes(f.key) ? 'border-stone-900 bg-stone-900 text-white' : 'border-border bg-white text-text hover:border-stone-400'}`}>
              {label(f.key)}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/** "1–30 of 74", then Previous / Next. Silent when everything fits on one page. */
export function Pager({ page, size, count, onPage }) {
  const { t: w } = useT(RW)
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

/** A link to an opportunity's page. */
export function LeadLink({ lead, children }) {
  return <Link to={leadHref(lead.id)} className="hover:underline">{children}</Link>
}

/** The page shown to someone without the CRM in this company. */
export function NoAccess() {
  const { t: w, dir } = useT(RW)
  return <p className="text-sm text-text-secondary py-8" dir={dir}>{w.noAccess}</p>
}

/** A row of figures (his KPI strip): [label, value, note, tone]. */
export function Figures({ items }) {
  if (!items?.length) return null
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {items.map(([label, value, note, tone]) => (
        <div key={label} className="bg-white border border-border px-3 py-2.5" data-print-keep>
          <p className="text-[11px] text-text-tertiary">{label}</p>
          <p className={`text-lg font-semibold tabular-nums ${tone === 'bad' ? 'text-red-700' : 'text-text'}`}><bdi>{value}</bdi></p>
          {note && <p className="text-[11px] text-text-tertiary">{note}</p>}
        </div>
      ))}
    </div>
  )
}
