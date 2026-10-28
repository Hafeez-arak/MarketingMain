import { Link } from 'react-router-dom'
import { PageHeader } from '../../../components/ui/index'
import { useT } from '../../../lib/i18n'
import { fieldInline } from '../useHrBase'
import { Pill } from '../parts'
import { AW } from './words'
import { TABS } from './useAttendance'

// ─── HR attendance: the pieces every attendance page shares (v2) ──────────
// 2026-10-28, dev/erp-pilot/ATTENDANCE.md. His Attendance app has four tabs
// (Today, Records, Punch log, Late and early); the daily report, the monthly
// sheet, the punch review, the devices and "everyone on the device" open
// from Records and keep it lit.

/** The page header with the four tabs; `tab` lights one, `sub` names the sub-screen. */
export function AttHeader({ tab, sub = null, children }) {
  const { t } = useT(AW)
  return (
    <div className="space-y-3">
      <PageHeader title={sub ? t.tabs.records : t.title} subtitle={t.subtitles[sub || tab]}>{children}</PageHeader>
      <nav className="flex gap-1 border-b border-border overflow-x-auto [scrollbar-width:none]" aria-label={t.title}>
        {TABS.map(x => (
          <Link key={x.key} to={x.to} aria-current={tab === x.key ? 'page' : undefined}
            className={`whitespace-nowrap px-3 py-2 text-xs border-b-2 -mb-px ${tab === x.key ? 'border-stone-900 text-text font-medium' : 'border-transparent text-text-secondary hover:text-text'}`}>
            {t.tabs[x.key]}
          </Link>
        ))}
      </nav>
    </div>
  )
}

/** A row of filter chips. */
export function Chips({ filters, active, onToggle, counts = null }) {
  const { t } = useT(AW)
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.search}>
      {filters.map(f => (
        <button key={f.key} type="button" aria-pressed={active.has(f.key)} onClick={() => onToggle(f.key)}
          className={`rounded-full border px-2.5 py-1 text-[11px] ${active.has(f.key) ? 'bg-stone-900 border-stone-900 text-white' : 'bg-white border-border text-text-secondary hover:bg-stone-50'}`}>
          {f.label || t.filters[f.key] || f.key}{counts && counts[f.key] !== undefined ? <span className="ms-1 tabular-nums opacity-70">{counts[f.key]}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** Group-by select. */
export function GroupBy({ value, onChange, options }) {
  const { t } = useT(AW)
  return (
    <label className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary">
      {t.groupBy}
      <select value={value} onChange={e => onChange(e.target.value)} className={`${fieldInline} text-xs`}>
        <option value="">{t.noGroup}</option>
        {options.map(o => <option key={o} value={o}>{t.groups[o]}</option>)}
      </select>
    </label>
  )
}

const STATUS_TONE = { leave: 'blue', present: 'green', left: 'grey', single: 'amber', absent: 'red', not_yet: 'grey', off: 'grey', unknown: 'grey', not_employed: 'grey' }
const STATE_TONE = { applied: 'green', corrected: 'blue', manual: 'grey', open: 'green', single: 'amber', unlinked: 'amber', inactive: 'red', before_hire: 'red', on_leave: 'blue', conflict: 'red' }
const SOURCE_TONE = { device: 'green', corrected: 'blue', manual: 'grey' }
const EMAIL_TONE = { pending: 'amber', sent: 'green', failed: 'red', no_email: 'grey', past: 'grey', off: 'grey' }

export const StatusPill = ({ status }) => { const { t } = useT(AW); return <Pill tone={STATUS_TONE[status]}>{t.statuses[status]}</Pill> }
export const StatePill = ({ state }) => { const { t } = useT(AW); return <Pill tone={STATE_TONE[state]}>{t.punchStates[state] || state}</Pill> }
export const SourcePill = ({ source }) => { const { t } = useT(AW); return source ? <Pill tone={SOURCE_TONE[source]}>{t.sources[source]}</Pill> : <span className="text-text-tertiary">—</span> }
export const EmailPill = ({ status }) => { const { t } = useT(AW); return <Pill tone={EMAIL_TONE[status]}>{t.emailStatuses[status] || status}</Pill> }

/** A table head cell and body cell, in the HR pages' style. */
export const Th = ({ children, end = false }) => <th className={`${end ? 'text-end' : 'text-start'} font-medium px-3 py-2 whitespace-nowrap`}>{children}</th>
export const Td = ({ children, end = false, className = '', ...rest }) => <td className={`px-3 py-2 ${end ? 'text-end tabular-nums' : ''} ${className}`} {...rest}>{children}</td>

/** The message useFlash() holds, as a line. */
export function Flash({ msg }) {
  return msg ? <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded-md px-3 py-2" role="status" dir="auto">{msg}</p> : null
}
