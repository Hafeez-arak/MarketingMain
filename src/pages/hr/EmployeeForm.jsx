import { useState } from 'react'
import { Button, Spinner } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { nameOf, riyadhToday } from '../../lib/hr/logic'
import { HW } from './words'
import { field } from './useHrBase'
import { Field, ErrorText, EmployeeSelect } from './parts'

// ─── HR: an employee's profile, new or edited ──────────────────────────────
// 2026-10-28. Names in both languages (one is enough), job, department,
// manager, hire date, work email and phone. Ending employment and linking a
// login are their own actions on the employee page; there is no pay here.

export function EmployeeForm({ initial = {}, employees = [], departments = [], onSubmit, onCancel, submitLabel }) {
  const { t, lang, dir } = useT(HW)
  const [f, setF] = useState({
    name_en: initial.name_en || '', name_ar: initial.name_ar || '', employee_no: initial.employee_no || '',
    job_title: initial.job_title || '', department_id: initial.department_id || '', manager_id: initial.manager_id || '',
    hire_date: initial.hire_date || riyadhToday(), work_email: initial.work_email || '', work_phone: initial.work_phone || '',
    notes: initial.notes || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const depts = departments.filter(d => d.active || d.id === f.department_id)

  async function submit(e) {
    e.preventDefault()
    if (!f.name_en.trim() && !f.name_ar.trim()) { setError(t.nameNeeded); return }
    setBusy(true); setError('')
    const out = await onSubmit({ ...f, department_id: f.department_id || null, manager_id: f.manager_id || null })
    setBusy(false)
    if (out?.error) setError(out.error)
  }

  return (
    <form onSubmit={submit} className="space-y-3" dir={dir} lang={lang}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label={t.nameAr}><input value={f.name_ar} onChange={e => set('name_ar', e.target.value)} className={field} dir="rtl" lang="ar" autoFocus={lang === 'ar'} /></Field>
        <Field label={t.nameEn}><input value={f.name_en} onChange={e => set('name_en', e.target.value)} className={field} dir="ltr" lang="en" autoFocus={lang !== 'ar'} /></Field>
        <Field label={t.jobTitle}><input value={f.job_title} onChange={e => set('job_title', e.target.value)} className={field} dir="auto" /></Field>
        <Field label={`${t.employeeNo} ${t.optional}`}><input value={f.employee_no} onChange={e => set('employee_no', e.target.value)} className={field} dir="ltr" /></Field>
        <Field label={t.department}>
          <select value={f.department_id} onChange={e => set('department_id', e.target.value)} className={field}>
            <option value="">{t.noDepartment}</option>
            {depts.map(d => <option key={d.id} value={d.id}>{nameOf(d, lang)}</option>)}
          </select>
        </Field>
        <Field label={t.manager}>
          <EmployeeSelect employees={employees.filter(e => e.id !== initial.id)} value={f.manager_id} onChange={v => set('manager_id', v)} placeholder={t.noManager} />
        </Field>
        <Field label={t.hireDate}><input type="date" required value={f.hire_date} onChange={e => set('hire_date', e.target.value)} className={field} /></Field>
        <div />
        <Field label={t.workEmail}><input type="email" value={f.work_email} onChange={e => set('work_email', e.target.value)} className={field} dir="ltr" /></Field>
        <Field label={t.workPhone}><input type="tel" value={f.work_phone} onChange={e => set('work_phone', e.target.value)} className={field} dir="ltr" /></Field>
      </div>
      <Field label={t.notes}><textarea value={f.notes} onChange={e => set('notes', e.target.value)} rows={2} className={field} dir="auto" /></Field>
      <ErrorText error={error} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{submitLabel || t.save}</Button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>}
      </div>
    </form>
  )
}
