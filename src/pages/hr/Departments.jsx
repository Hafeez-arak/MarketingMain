import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, PageHeader, Skeleton, Spinner } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { nameOf } from '../../lib/hr/logic'
import { saveDepartment } from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, field, empName } from './useHrBase'
import { Dialog, ErrorText, Field, Pill, EmployeeSelect } from './parts'

// ─── HR → Departments (v2) ─────────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/HR.md. The company's departments, their heads
// and how many people each has. Manage adds, renames and archives; a
// department is never deleted (its people and history keep pointing at it).

export function HrDepartments() {
  const { t, lang, dir } = useT(HW)
  const { ws, me, can, employees, departments, error, reload } = useHrBase()
  const [editing, setEditing] = useState(null) // null | {} | department
  const [showArchived, setShowArchived] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [actionError, setActionError] = useState('')

  const count = id => (employees || []).filter(e => e.department_id === id && e.status === 'active').length
  const shown = departments.filter(d => showArchived || d.active).sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang))

  async function toggle(d) {
    setBusyId(d.id); setActionError('')
    const out = await saveDepartment(ws, me, d.id, { active: !d.active })
    setBusyId('')
    if (out.error) setActionError(out.error); else reload()
  }

  return (
    <div className="max-w-3xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={t.departmentsTitle} subtitle={t.departmentsSubtitle}>
        {can('manage') && <Button size="sm" onClick={() => setEditing({})}>{t.newDepartment}</Button>}
      </PageHeader>
      <ErrorText error={error || actionError} />
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> {t.showArchived}
      </label>
      {employees === null ? <Skeleton className="h-40" /> : (
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
                  {t.head}: {d.head_id ? empName(employees, d.head_id, lang) : t.noHead}
                </p>
              </div>
              <span className="text-xs text-text-secondary tabular-nums">{count(d.id)} {t.people}</span>
              {can('manage') && (
                <span className="flex gap-1.5">
                  <Button size="xs" variant="secondary" onClick={() => setEditing(d)}>{t.edit}</Button>
                  <Button size="xs" variant="ghost" disabled={busyId === d.id} onClick={() => toggle(d)}>
                    {busyId === d.id && <Spinner size="sm" />}{d.active ? t.archive : t.restore}
                  </Button>
                </span>
              )}
            </li>
          ))}
          {!shown.length && <li className="px-3 py-6 text-center text-xs text-text-tertiary">{t.nothingYet}</li>}
        </ul>
      )}
      {!can('manage') && <p className="text-[11px] text-text-tertiary">{t.viewOnly}</p>}

      {editing && (
        <Dialog title={editing.id ? t.edit : t.newDepartment.replace('+ ', '')} onClose={() => setEditing(null)}>
          <DepartmentForm initial={editing} employees={employees || []} onCancel={() => setEditing(null)}
            onSubmit={async f => {
              const out = await saveDepartment(ws, me, editing.id, f)
              if (!out.error) { setEditing(null); reload() }
              return out
            }} />
        </Dialog>
      )}
    </div>
  )
}

function DepartmentForm({ initial, employees, onSubmit, onCancel }) {
  const { t, dir } = useT(HW)
  const [f, setF] = useState({ name_ar: initial.name_ar || '', name_en: initial.name_en || '', head_id: initial.head_id || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  async function submit(e) {
    e.preventDefault()
    if (!f.name_en.trim() && !f.name_ar.trim()) { setError(t.nameNeeded); return }
    setBusy(true); setError('')
    const out = await onSubmit({ ...f, head_id: f.head_id || null })
    setBusy(false)
    if (out?.error) setError(out.error)
  }
  return (
    <form onSubmit={submit} className="space-y-3" dir={dir}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label={t.nameAr}><input value={f.name_ar} onChange={e => set('name_ar', e.target.value)} className={field} dir="rtl" lang="ar" /></Field>
        <Field label={t.nameEn}><input value={f.name_en} onChange={e => set('name_en', e.target.value)} className={field} dir="ltr" lang="en" /></Field>
      </div>
      <Field label={t.head}><EmployeeSelect employees={employees} value={f.head_id} onChange={v => set('head_id', v)} placeholder={t.noHead} /></Field>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{t.save}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  )
}
