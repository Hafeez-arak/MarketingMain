import { useState } from 'react'
import { Button, Spinner } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { nameOf, riyadhToday, EMPLOYMENT_TYPES, ID_TYPES } from '../../lib/hr/logic'
import { HW } from './words'
import { field } from './useHrBase'
import { Field, ErrorText, EmployeeSelect } from './parts'

// ─── HR: an employee's file, new or edited ─────────────────────────────────
// 2026-10-29, parity pass. His employee form: names in both languages (one
// is enough), job position, trade, department, manager, employment type,
// hire date, work email and phone, direct or indirect labour; and below, the
// personal file (nationality, identity, birth date, gender, personal mobile,
// emergency contact, address, notes), which only Manage sees and writes. The
// number is made by the system. Ending employment and linking a login are
// their own actions on the employee page. No pay fields, no IBAN.

export function EmployeeForm({ initial = {}, personal = {}, employees = [], departments = [], jobs = [], onSubmit, onCancel, submitLabel }) {
  const { t, lang, dir } = useT(HW)
  const [f, setF] = useState({
    name_en: initial.name_en || '', name_ar: initial.name_ar || '',
    job_id: initial.job_id || '', trade: initial.trade || '', department_id: initial.department_id || '', manager_id: initial.manager_id || '',
    employment_type: initial.employment_type || '', is_direct_labor: initial.is_direct_labor ?? true,
    hire_date: initial.hire_date || riyadhToday(), work_email: initial.work_email || '', work_phone: initial.work_phone || '',
  })
  const [p, setP] = useState({
    nationality: personal.nationality || '', id_type: personal.id_type || '', id_number: personal.id_number || '', birth_date: personal.birth_date || '',
    gender: personal.gender || '', mobile: personal.mobile || '', emergency_contact: personal.emergency_contact || '',
    emergency_phone: personal.emergency_phone || '', address: personal.address || '', notes: personal.notes || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const setPriv = (k, v) => setP(x => ({ ...x, [k]: v }))
  const depts = departments.filter(d => d.active || d.id === f.department_id)
  const positions = jobs.filter(j => j.active || j.id === f.job_id)
    .sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang))

  async function submit(e) {
    e.preventDefault()
    if (!f.name_en.trim() && !f.name_ar.trim()) { setError(t.nameNeeded); return }
    setBusy(true); setError('')
    const out = await onSubmit({
      employee: { ...f, job_id: f.job_id || null, department_id: f.department_id || null, manager_id: f.manager_id || null, employment_type: f.employment_type || null },
      personal: { ...p, id_type: p.id_type || null, id_number: p.id_number.trim() || null, birth_date: p.birth_date || null, gender: p.gender || null },
    })
    setBusy(false)
    if (out?.error) setError(out.error)
  }

  return (
    <form onSubmit={submit} className="space-y-4" dir={dir} lang={lang}>
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-text-secondary mb-1">{t.workData}</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label={t.nameAr}><input value={f.name_ar} onChange={e => set('name_ar', e.target.value)} className={field} dir="rtl" lang="ar" autoFocus={lang === 'ar'} /></Field>
          <Field label={t.nameEn}><input value={f.name_en} onChange={e => set('name_en', e.target.value)} className={field} dir="ltr" lang="en" autoFocus={lang !== 'ar'} /></Field>
          <Field label={t.jobPosition}>
            <select value={f.job_id} onChange={e => set('job_id', e.target.value)} className={field}>
              <option value="">{t.noPosition}</option>
              {positions.map(j => <option key={j.id} value={j.id}>{nameOf(j, lang)}</option>)}
            </select>
          </Field>
          <Field label={t.trade} hint={t.tradeHint}><input value={f.trade} onChange={e => set('trade', e.target.value)} className={field} dir="auto" /></Field>
          <Field label={t.department}>
            <select value={f.department_id} onChange={e => set('department_id', e.target.value)} className={field}>
              <option value="">{t.noDepartment}</option>
              {depts.map(d => <option key={d.id} value={d.id}>{nameOf(d, lang)}</option>)}
            </select>
          </Field>
          <Field label={t.manager}>
            <EmployeeSelect employees={employees.filter(e => e.id !== initial.id)} value={f.manager_id} onChange={v => set('manager_id', v)} placeholder={t.noManager} />
          </Field>
          <Field label={t.employmentType}>
            <select value={f.employment_type} onChange={e => set('employment_type', e.target.value)} className={field}>
              <option value="">{t.noType}</option>
              {EMPLOYMENT_TYPES.map(k => <option key={k} value={k}>{t.employmentTypes[k]}</option>)}
            </select>
          </Field>
          <Field label={t.hireDate}><input type="date" required value={f.hire_date} onChange={e => set('hire_date', e.target.value)} className={field} /></Field>
          <Field label={t.workEmail}><input type="email" value={f.work_email} onChange={e => set('work_email', e.target.value)} className={field} dir="ltr" /></Field>
          <Field label={t.workPhone}><input type="tel" value={f.work_phone} onChange={e => set('work_phone', e.target.value)} className={field} dir="ltr" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_direct_labor} onChange={e => set('is_direct_labor', e.target.checked)} />{t.directLabour}</label>
        {initial.employee_no && <p className="text-[11px] text-text-tertiary">{t.employeeNo}: <bdi dir="ltr" className="font-medium text-text-secondary">{initial.employee_no}</bdi> · {t.numberMade}</p>}
      </fieldset>

      <fieldset className="space-y-2 border-t border-border pt-3">
        <legend className="text-xs font-semibold text-text-secondary mb-1">{t.personalFile} <span className="font-normal text-text-tertiary">· {t.personalHint}</span></legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Field label={t.nationality}><input value={p.nationality} onChange={e => setPriv('nationality', e.target.value)} className={field} dir="auto" /></Field>
          <Field label={t.idType}>
            <select value={p.id_type} onChange={e => setPriv('id_type', e.target.value)} className={field}>
              <option value="">{t.noType}</option>
              {ID_TYPES.map(k => <option key={k} value={k}>{t.idTypes[k]}</option>)}
            </select>
          </Field>
          <Field label={t.idNumber}><input value={p.id_number} onChange={e => setPriv('id_number', e.target.value)} className={field} dir="ltr" /></Field>
          <Field label={t.birthDate}><input type="date" max={riyadhToday()} value={p.birth_date} onChange={e => setPriv('birth_date', e.target.value)} className={field} /></Field>
          <Field label={t.gender}>
            <select value={p.gender} onChange={e => setPriv('gender', e.target.value)} className={field}>
              <option value="">{t.noType}</option>
              <option value="m">{t.genders.m}</option>
              <option value="f">{t.genders.f}</option>
            </select>
          </Field>
          <Field label={t.mobile}><input type="tel" value={p.mobile} onChange={e => setPriv('mobile', e.target.value)} className={field} dir="ltr" /></Field>
          <Field label={t.emergencyContact}><input value={p.emergency_contact} onChange={e => setPriv('emergency_contact', e.target.value)} className={field} dir="auto" /></Field>
          <Field label={t.emergencyPhone}><input type="tel" value={p.emergency_phone} onChange={e => setPriv('emergency_phone', e.target.value)} className={field} dir="ltr" /></Field>
          <Field label={t.address}><input value={p.address} onChange={e => setPriv('address', e.target.value)} className={field} dir="auto" /></Field>
        </div>
        <Field label={t.notes}><textarea value={p.notes} onChange={e => setPriv('notes', e.target.value)} rows={2} className={field} dir="auto" /></Field>
      </fieldset>

      <ErrorText error={error} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{submitLabel || t.save}</Button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>}
      </div>
    </form>
  )
}
