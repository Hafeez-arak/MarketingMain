import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { filterEmployees, nameOf } from '../../lib/hr/logic'
import { saveEmployee } from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, field, empName } from './useHrBase'
import { Dialog, ErrorText, Pill } from './parts'
import { EmployeeForm } from './EmployeeForm'

// ─── HR → Employees (v2) ───────────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/HR.md. The directory: search, filter by
// department and status, open a person. Work and up add people. The search
// and filters live in the address (?q=&dept=&status=) so a link keeps them.

export function HrEmployees() {
  const { t, lang, dir } = useT(HW)
  const base = useHrBase()
  const { ws, me, can, employees, departments, error } = base
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const dept = params.get('dept') || ''
  const status = params.has('status') ? params.get('status') : 'active'
  const [creating, setCreating] = useState(false)
  const setParam = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v === null) n.delete(k); else n.set(k, v); return n }, { replace: true })

  const shown = useMemo(() => filterEmployees(employees || [], { q, department: dept, status })
    .sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang)), [employees, q, dept, status, lang])
  const deptName = id => nameOf(departments.find(d => d.id === id), lang)

  return (
    <div className="max-w-5xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={t.employeesTitle} subtitle={t.employeesSubtitle}>
        {can('work') && <Button size="sm" onClick={() => setCreating(true)}>{t.newEmployee}</Button>}
      </PageHeader>

      <div className="flex flex-wrap gap-2 items-center">
        <input type="search" value={q} onChange={e => setParam('q', e.target.value || null)} placeholder={t.searchPlaceholder} aria-label={t.search}
          className={`${field} max-w-xs`} dir="auto" />
        <select value={dept} onChange={e => setParam('dept', e.target.value || null)} className={`${field} w-auto`} aria-label={t.department}>
          <option value="">{t.allDepartments}</option>
          {departments.map(d => <option key={d.id} value={d.id}>{nameOf(d, lang)}</option>)}
          <option value="none">{t.noDepartment}</option>
        </select>
        <select value={status} onChange={e => setParam('status', e.target.value === 'active' ? null : e.target.value)} className={`${field} w-auto`} aria-label={t.status}>
          {['active', 'ended', ''].map(s => <option key={s} value={s}>{t.statuses[s]}</option>)}
        </select>
        {employees && <span className="text-[11px] text-text-tertiary">{t.countOf(shown.length, employees.length)}</span>}
      </div>

      <ErrorText error={error} />

      {employees === null ? <Skeleton className="h-64" /> : !employees.length ? (
        <p className="text-sm text-text-tertiary py-6">{t.noEmployees}</p>
      ) : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              <th className="text-start font-medium px-3 py-2">{t.name}</th>
              <th className="text-start font-medium px-3 py-2">{t.jobTitle}</th>
              <th className="text-start font-medium px-3 py-2">{t.department}</th>
              <th className="text-start font-medium px-3 py-2 hidden md:table-cell">{t.manager}</th>
              <th className="text-start font-medium px-3 py-2 hidden md:table-cell">{t.workPhone}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {shown.map(e => (
                <tr key={e.id} className="hover:bg-stone-50">
                  <td className="px-3 py-2">
                    <Link to={`/hr/employee?id=${e.id}`} className="font-medium text-text hover:underline" dir="auto">{nameOf(e, lang)}</Link>
                    <span className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                      {e.employee_no && <bdi dir="ltr">{e.employee_no}</bdi>}{e.status === 'ended' && <Pill>{t.statuses.ended}</Pill>}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-secondary" dir="auto">{e.job_title}</td>
                  <td className="px-3 py-2 text-text-secondary">{deptName(e.department_id) || '—'}</td>
                  <td className="px-3 py-2 text-text-secondary hidden md:table-cell">{empName(employees, e.manager_id, lang, '—')}</td>
                  <td className="px-3 py-2 text-text-secondary hidden md:table-cell tabular-nums" dir="ltr">{e.work_phone || ''}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-text-tertiary">{t.noMatch}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Dialog title={t.newEmployee.replace('+ ', '')} onClose={() => setCreating(false)}>
          <EmployeeForm employees={employees || []} departments={departments} submitLabel={t.add} onCancel={() => setCreating(false)}
            onSubmit={async fields => {
              const out = await saveEmployee(ws, me, null, fields)
              if (!out.error) { setCreating(false); navigate(`/hr/employee?id=${out.row.id}`) }
              return out
            }} />
        </Dialog>
      )}
    </div>
  )
}
