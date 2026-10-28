import { useState } from 'react'
import { Button, Spinner } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { riyadhToday } from '../../lib/hr/logic'
import { HW } from './words'
import { field } from './useHrBase'
import { Field, ErrorText, EmployeeSelect } from './parts'

// ─── HR: a contract, new or (while still a draft) edited ───────────────────
// 2026-10-29, parity pass. His fields without the pay: employee, type, start,
// end (required for a fixed term), weekly hours, notes. It is saved as a
// draft; its terms freeze when it starts (the database holds that), so there
// is no editing after that, only a new contract.

export function ContractForm({ initial = {}, employees = null, onSubmit, onCancel }) {
  const { t, dir } = useT(HW)
  const [f, setF] = useState({
    employeeId: initial.employee_id || '', contract_type: initial.contract_type || 'fixed', start_date: initial.start_date || riyadhToday(),
    end_date: initial.end_date || '', weekly_hours: initial.weekly_hours ?? '', notes: initial.notes || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (employees && !f.employeeId) { setError(t.pickEmployee2); return }
    setBusy(true); setError('')
    const out = await onSubmit({ ...f, weekly_hours: f.weekly_hours === '' ? null : Number(f.weekly_hours), end_date: f.end_date || null })
    setBusy(false)
    if (out?.error) setError(out.error)
  }

  return (
    <form onSubmit={submit} dir={dir} className="space-y-3">
      {employees && (
        <Field label={t.contractOf}>
          <EmployeeSelect employees={employees} value={f.employeeId} onChange={v => set('employeeId', v)} placeholder={t.pickEmployee2} required />
        </Field>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Field label={t.contractType}>
          <select value={f.contract_type} onChange={e => set('contract_type', e.target.value)} className={field}>
            {['fixed', 'open'].map(k => <option key={k} value={k}>{t.contractTypes[k]}</option>)}
          </select>
        </Field>
        <Field label={t.start}><input type="date" required value={f.start_date} onChange={e => set('start_date', e.target.value)} className={field} /></Field>
        <Field label={f.contract_type === 'fixed' ? t.end : `${t.end} ${t.optional}`}>
          <input type="date" required={f.contract_type === 'fixed'} min={f.start_date} value={f.end_date} onChange={e => set('end_date', e.target.value)} className={field} />
        </Field>
        <Field label={`${t.weeklyHours} ${t.optional}`} hint={t.weeklyHoursHint}>
          <input type="number" min="0.5" max="168" step="0.5" value={f.weekly_hours} onChange={e => set('weekly_hours', e.target.value)} className={field} dir="ltr" />
        </Field>
      </div>
      <Field label={t.notes}><input value={f.notes} onChange={e => set('notes', e.target.value)} className={field} dir="auto" /></Field>
      <p className="text-[11px] text-text-tertiary">{t.freezeHelp} {t.noPay}</p>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{t.save}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  )
}
