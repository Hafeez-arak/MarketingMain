import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, PageHeader, Skeleton, Spinner } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { nameOf } from '../../lib/hr/logic'
import { saveDepartment, saveJob } from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, field, empName } from './useHrBase'
import { Dialog, ErrorText, Field, Pill, EmployeeSelect } from './parts'

// ─── HR → Departments and job positions (v2) ───────────────────────────────
// 2026-10-28, parity pass 2026-10-29. His departments page: the company's
// departments (with the one they sit under and their head) and the job
// positions (with their department and description), each with how many
// people. Manage adds, renames and archives; nothing is deleted (its people
// and history keep pointing at it).

export function HrDepartments() {
  const { t, lang, dir } = useT(HW)
  const { ws, me, can, employees, departments, jobs, error, reload } = useHrBase()
  const [editing, setEditing] = useState(null) // null | {} | department
  const [editingJob, setEditingJob] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [actionError, setActionError] = useState('')

  const count = (key, id) => (employees || []).filter(e => e[key] === id && e.status === 'active').length
  const byName = (a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang)
  const shown = departments.filter(d => showArchived || d.active).sort(byName)
  const shownJobs = jobs.filter(j => showArchived || j.active).sort(byName)
  const deptName = id => nameOf(departments.find(d => d.id === id), lang)

  async function toggle(save, row) {
    setBusyId(row.id); setActionError('')
    const out = await save(ws, me, row.id, { active: !row.active })
    setBusyId('')
    if (out.error) setActionError(out.error); else reload()
  }

  return (
    <div className="max-w-4xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={t.departmentsTitle} subtitle={t.departmentsSubtitle}>
        {can('manage') && <Button size="sm" onClick={() => setEditing({})}>{t.newDepartment}</Button>}
        {can('manage') && <Button size="sm" variant="secondary" onClick={() => setEditingJob({})}>{t.newJob}</Button>}
      </PageHeader>
      <ErrorText error={error || actionError} />
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> {t.showArchived}
      </label>

      {employees === null ? <Skeleton className="h-40" /> : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">{t.departmentsTitle}</h2>
            <ul className="bg-white border border-border divide-y divide-border">
              {shown.map(d => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text">
                      <Link to={`/hr?dept=${d.id}`} className="hover:underline">{nameOf(d, lang)}</Link>
                      {!d.active && <span className="ms-2"><Pill>{t.archived}</Pill></span>}
                    </p>
                    <p className="text-[11px] text-text-tertiary">
                      {nameOf(d, lang === 'ar' ? 'en' : 'ar') !== nameOf(d, lang) && <span dir="auto">{nameOf(d, lang === 'ar' ? 'en' : 'ar')} · </span>}
                      {t.sitsUnder}: {d.parent_id ? deptName(d.parent_id) : t.noParent} · {t.head}: {d.head_id ? empName(employees, d.head_id, lang) : t.noHead}
                    </p>
                  </div>
                  <span className="text-xs text-text-secondary tabular-nums">{count('department_id', d.id)} {t.people}</span>
                  {can('manage') && (
                    <span className="flex gap-1.5">
                      <Button size="xs" variant="secondary" onClick={() => setEditing(d)}>{t.edit}</Button>
                      <Button size="xs" variant="ghost" disabled={busyId === d.id} onClick={() => toggle(saveDepartment, d)}>
                        {busyId === d.id && <Spinner size="sm" />}{d.active ? t.archive : t.restore}
                      </Button>
                    </span>
                  )}
                </li>
              ))}
              {!shown.length && <li className="px-3 py-6 text-center text-xs text-text-tertiary">{t.nothingYet}</li>}
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">{t.jobsTitle}</h2>
            <ul className="bg-white border border-border divide-y divide-border">
              {shownJobs.map(j => (
                <li key={j.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text" dir="auto">
                      {nameOf(j, lang)}
                      {!j.active && <span className="ms-2"><Pill>{t.archived}</Pill></span>}
                    </p>
                    <p className="text-[11px] text-text-tertiary" dir="auto">
                      {nameOf(j, lang === 'ar' ? 'en' : 'ar') !== nameOf(j, lang) && <span>{nameOf(j, lang === 'ar' ? 'en' : 'ar')} · </span>}
                      {j.department_id ? `${t.inDepartment} ${deptName(j.department_id)}` : t.anyDepartment}{j.description ? ` · ${j.description}` : ''}
                    </p>
                  </div>
                  <span className="text-xs text-text-secondary tabular-nums">{t.peopleHere(count('job_id', j.id))}</span>
                  {can('manage') && (
                    <span className="flex gap-1.5">
                      <Button size="xs" variant="secondary" onClick={() => setEditingJob(j)}>{t.edit}</Button>
                      <Button size="xs" variant="ghost" disabled={busyId === j.id} onClick={() => toggle(saveJob, j)}>
                        {busyId === j.id && <Spinner size="sm" />}{j.active ? t.archive : t.restore}
                      </Button>
                    </span>
                  )}
                </li>
              ))}
              {!shownJobs.length && <li className="px-3 py-6 text-center text-xs text-text-tertiary">{t.noJobs}</li>}
            </ul>
          </section>
        </>
      )}
      {!can('manage') && <p className="text-[11px] text-text-tertiary">{t.viewOnly}</p>}

      {editing && (
        <Dialog title={editing.id ? t.edit : t.newDepartment.replace('+ ', '')} onClose={() => setEditing(null)}>
          <DepartmentForm initial={editing} employees={employees || []} departments={departments} onCancel={() => setEditing(null)}
            onSubmit={async f => {
              const out = await saveDepartment(ws, me, editing.id, f)
              if (!out.error) { setEditing(null); reload() }
              return out
            }} />
        </Dialog>
      )}
      {editingJob && (
        <Dialog title={editingJob.id ? t.edit : t.newJob.replace('+ ', '')} onClose={() => setEditingJob(null)}>
          <JobForm initial={editingJob} departments={departments} onCancel={() => setEditingJob(null)}
            onSubmit={async f => {
              const out = await saveJob(ws, me, editingJob.id, f)
              if (!out.error) { setEditingJob(null); reload() }
              return out
            }} />
        </Dialog>
      )}
    </div>
  )
}

/** The two names and the buttons both small forms share. */
function useForm(onSubmit, build) {
  const { t } = useT(HW)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e, f) {
    e.preventDefault()
    if (!f.name_en.trim() && !f.name_ar.trim()) { setError(t.nameNeeded); return }
    setBusy(true); setError('')
    const out = await onSubmit(build(f))
    setBusy(false)
    if (out?.error) setError(out.error)
  }
  return { busy, error, submit }
}

function DepartmentForm({ initial, employees, departments, onSubmit, onCancel }) {
  const { t, lang, dir } = useT(HW)
  const [f, setF] = useState({ name_ar: initial.name_ar || '', name_en: initial.name_en || '', head_id: initial.head_id || '', parent_id: initial.parent_id || '' })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const form = useForm(onSubmit, x => ({ ...x, head_id: x.head_id || null, parent_id: x.parent_id || null }))
  const parents = departments.filter(d => d.id !== initial.id && (d.active || d.id === f.parent_id)).sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang))
  return (
    <form onSubmit={e => form.submit(e, f)} className="space-y-3" dir={dir}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label={t.nameAr}><input value={f.name_ar} onChange={e => set('name_ar', e.target.value)} className={field} dir="rtl" lang="ar" /></Field>
        <Field label={t.nameEn}><input value={f.name_en} onChange={e => set('name_en', e.target.value)} className={field} dir="ltr" lang="en" /></Field>
      </div>
      <Field label={t.sitsUnder}>
        <select value={f.parent_id} onChange={e => set('parent_id', e.target.value)} className={field}>
          <option value="">{t.noParent}</option>
          {parents.map(d => <option key={d.id} value={d.id}>{nameOf(d, lang)}</option>)}
        </select>
      </Field>
      <Field label={t.head}><EmployeeSelect employees={employees} value={f.head_id} onChange={v => set('head_id', v)} placeholder={t.noHead} /></Field>
      <ErrorText error={form.error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={form.busy}>{form.busy && <Spinner size="sm" />}{t.save}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  )
}

function JobForm({ initial, departments, onSubmit, onCancel }) {
  const { t, lang, dir } = useT(HW)
  const [f, setF] = useState({ name_ar: initial.name_ar || '', name_en: initial.name_en || '', department_id: initial.department_id || '', description: initial.description || '' })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const form = useForm(onSubmit, x => ({ ...x, department_id: x.department_id || null }))
  const depts = departments.filter(d => d.active || d.id === f.department_id).sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang))
  return (
    <form onSubmit={e => form.submit(e, f)} className="space-y-3" dir={dir}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label={t.nameAr}><input value={f.name_ar} onChange={e => set('name_ar', e.target.value)} className={field} dir="rtl" lang="ar" /></Field>
        <Field label={t.nameEn}><input value={f.name_en} onChange={e => set('name_en', e.target.value)} className={field} dir="ltr" lang="en" /></Field>
      </div>
      <Field label={t.jobDepartment}>
        <select value={f.department_id} onChange={e => set('department_id', e.target.value)} className={field}>
          <option value="">{t.anyDepartment}</option>
          {depts.map(d => <option key={d.id} value={d.id}>{nameOf(d, lang)}</option>)}
        </select>
      </Field>
      <Field label={t.description}><input value={f.description} onChange={e => set('description', e.target.value)} className={field} dir="auto" /></Field>
      <ErrorText error={form.error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={form.busy}>{form.busy && <Spinner size="sm" />}{t.save}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  )
}
