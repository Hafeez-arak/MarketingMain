import { useT } from '../../lib/i18n'
import { errorKey, nameOf } from '../../lib/hr/logic'
import { HW } from './words'
import { field } from './useHrBase'

// ─── HR: the pieces every HR page shares ───────────────────────────────────
// 2026-10-28, dev/erp-pilot/HR.md. The small form and display pieces, so the
// pages read and look alike. What they load is in useHrBase.js.

export { Dialog } from '../tasks/parts'

/** A labelled form control. */
export function Field({ label, hint, className = '', children }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[11px] text-text-secondary">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-text-tertiary mt-0.5">{hint}</span>}
    </label>
  )
}

/** A row of tabs under the page header. */
export function Tabs({ tabs, value, onChange, label }) {
  return (
    <nav className="flex gap-1 border-b border-border overflow-x-auto [scrollbar-width:none]" aria-label={label}>
      {tabs.map(t => (
        <button key={t.key} type="button" onClick={() => onChange(t.key)} aria-current={value === t.key ? 'page' : undefined}
          className={`whitespace-nowrap px-3 py-2 text-xs border-b-2 -mb-px ${value === t.key ? 'border-stone-900 text-text font-medium' : 'border-transparent text-text-secondary hover:text-text'}`}>
          {t.label}
        </button>
      ))}
    </nav>
  )
}

const TONES = {
  green: 'bg-green-50 text-green-800 border-green-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  blue: 'bg-sky-50 text-sky-800 border-sky-200',
  grey: 'bg-stone-50 text-text-secondary border-border',
}
/** A small coloured label. */
export function Pill({ tone = 'grey', children, title }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] leading-none ${TONES[tone] || TONES.grey}`}>{children}</span>
}

/** A refusal from the database, in this language's words. */
export function ErrorText({ error }) {
  const { t } = useT(HW)
  if (!error) return null
  const key = errorKey(error)
  return <p className="text-xs text-red-600" dir="auto" role="alert">{(key && t.errors[key]) || error}</p>
}

/** The page shown to someone without HR in this company (the router lets admins and grants in; this is the fallback). */
export function NoAccess() {
  const { t, dir } = useT(HW)
  return <p className="text-sm text-text-secondary py-8" dir={dir}>{t.noAccess}</p>
}

/** Employee picker: active people by default, in this language's names. */
export function EmployeeSelect({ employees, value, onChange, includeEnded = false, placeholder, ...rest }) {
  const { lang } = useT(HW)
  const list = (employees || []).filter(e => includeEnded || e.status === 'active')
    .slice().sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang))
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={field} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {list.map(e => <option key={e.id} value={e.id}>{nameOf(e, lang)}{e.employee_no ? ` · ${e.employee_no}` : ''}</option>)}
    </select>
  )
}
