import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { filterEmployees, groupEmployees, expiringDocs, nameOf, riyadhToday } from '../../lib/hr/logic'
import { saveEmployee, savePrivate, fetchDocuments, fetchRunningContracts } from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, fieldInline, empName, fmtDate } from './useHrBase'
import { Dialog, ErrorText, Pill } from './parts'
import { EmployeeForm } from './EmployeeForm'

// ─── HR → Employees (v2) ───────────────────────────────────────────────────
// 2026-10-28, parity pass 2026-10-29. The directory, as his: search (name,
// number, trade, job, phone), department, status, kind (direct or indirect
// labour, papers expiring, no running contract), grouping by department, job
// position or manager, cards or a list. HR managers see the papers that need
// renewing at the top and add people. Everyone in HR sees the "no running
// contract" badge (it says nothing about the contract itself). The search and
// filters live in the address so a link keeps them.

export function HrEmployees() {
  const { t, lang, dir } = useT(HW)
  const base = useHrBase()
  const { ws, me, can, employees, departments, jobs, error } = base
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const dept = params.get('dept') || ''
  const kind = params.get('kind') || ''
  const group = params.get('g') || ''
  const view = params.get('v') === 'list' ? 'list' : 'cards'
  const status = params.has('status') ? (params.get('status') === 'all' ? '' : params.get('status')) : 'active'
  const [creating, setCreating] = useState(false)
  const [docs, setDocs] = useState(null)
  const [running, setRunning] = useState(null)
  const today = riyadhToday()
  const manage = can('manage')
  const setParam = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v === null || v === '') n.delete(k); else n.set(k, v); return n }, { replace: true })

  useEffect(() => {
    if (!ws) return
    let cancelled = false
    fetchRunningContracts(ws).then(out => { if (!cancelled && !out.error) setRunning(new Set(out.rows)) })
    if (manage) fetchDocuments(ws).then(out => { if (!cancelled) setDocs(out.rows) })
    return () => { cancelled = true }
  }, [ws, manage])

  const alerts = useMemo(() => (docs && employees ? expiringDocs(docs, employees, today) : []), [docs, employees, today])
  const expiringIds = useMemo(() => new Set(alerts.map(d => d.employee_id)), [alerts])
  const shown = useMemo(() => filterEmployees(employees || [], { q, department: dept, status, kind, expiringIds, runningIds: running })
    .sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang)), [employees, q, dept, status, kind, expiringIds, running, lang])
  const groups = useMemo(() => groupEmployees(shown, group), [shown, group])
  const deptName = id => nameOf(departments.find(d => d.id === id), lang)
  const titleOf = key => {
    if (group === 'department') return key ? nameOf(departments.find(d => d.id === key), lang) : t.noDepartment
    if (group === 'job') return key ? nameOf(jobs.find(j => j.id === key), lang) : t.noJob
    if (group === 'manager') return key ? empName(employees, key, lang) : t.noManagerGroup
    return ''
  }
  const noContract = e => e.status === 'active' && running != null && !running.has(e.id)

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={t.employeesTitle} subtitle={t.employeesSubtitle}>
        {manage && <Button size="sm" onClick={() => setCreating(true)}>{t.newEmployee}</Button>}
      </PageHeader>

      {manage && alerts.length > 0 && (
        <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm" role="status">
          <p className="font-medium text-amber-900">{t.paperAlerts}</p>
          <ul className="mt-1 space-y-0.5 text-amber-900">
            {alerts.slice(0, 8).map(d => (
              <li key={d.id} className="text-xs">
                <Link to={`/hr/employee?id=${d.employee_id}`} className="hover:underline" dir="auto">{empName(employees, d.employee_id, lang)}</Link> · {t.docTypes[d.doc_type]}:{' '}
                {d.expiry_date < today ? t.expiredOn(fmtDate(d.expiry_date, lang)) : t.expiresOn(fmtDate(d.expiry_date, lang))}
              </li>
            ))}
          </ul>
          {alerts.length > 8 && <button type="button" className="mt-1 text-xs underline text-amber-900" onClick={() => setParam('kind', 'docs')}>{t.seeAll} ({alerts.length})</button>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <input type="search" value={q} onChange={e => setParam('q', e.target.value)} placeholder={t.searchPlaceholder} aria-label={t.search}
          className={`${fieldInline} w-full max-w-xs`} dir="auto" />
        <select value={dept} onChange={e => setParam('dept', e.target.value)} className={fieldInline} aria-label={t.department}>
          <option value="">{t.allDepartments}</option>
          {departments.map(d => <option key={d.id} value={d.id}>{nameOf(d, lang)}</option>)}
          <option value="none">{t.noDepartment}</option>
        </select>
        <select value={status} onChange={e => setParam('status', e.target.value === 'active' ? '' : (e.target.value || 'all'))} className={fieldInline} aria-label={t.status}>
          {['active', 'ended', ''].map(s => <option key={s} value={s}>{t.statuses[s]}</option>)}
        </select>
        <select value={kind} onChange={e => setParam('kind', e.target.value)} className={fieldInline} aria-label={t.kinds['']}>
          {Object.entries(t.kinds).filter(([k]) => manage || k !== 'docs').map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={group} onChange={e => setParam('g', e.target.value)} className={fieldInline} aria-label={t.groupBy['']}>
          {Object.entries(t.groupBy).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <div className="flex" role="group" aria-label={t.views.cards}>
          {['cards', 'list'].map(v => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setParam('v', v === 'cards' ? '' : v)}
              className={`border px-2.5 py-1 text-xs first:rounded-s-md last:rounded-e-md ${view === v ? 'bg-stone-900 border-stone-900 text-white' : 'bg-white border-border text-text-secondary hover:bg-stone-50'}`}>{t.views[v]}</button>
          ))}
        </div>
        {employees && <span className="text-[11px] text-text-tertiary">{t.countOf(shown.length, employees.length)}</span>}
      </div>

      <ErrorText error={error} />

      {employees === null ? <Skeleton className="h-64" /> : !employees.length ? (
        <p className="text-sm text-text-tertiary py-6">{t.noEmployees}</p>
      ) : !shown.length ? (
        <p className="text-sm text-text-tertiary py-6">{t.noMatch}</p>
      ) : view === 'cards' ? (
        <div className="space-y-4">
          {groups.map(g => (
            <section key={g.key || 'all'}>
              {group && <h2 className="text-xs font-semibold text-text-secondary mb-2">{titleOf(g.key)} <span className="font-normal text-text-tertiary">({g.rows.length})</span></h2>}
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {g.rows.map(e => (
                  <li key={e.id}>
                    <Link to={`/hr/employee?id=${e.id}`} className="flex gap-3 bg-white border border-border p-3 hover:bg-stone-50">
                      <span className="shrink-0 size-10 rounded-full bg-stone-200 text-stone-700 flex items-center justify-center text-sm font-semibold" aria-hidden="true">{(nameOf(e, lang) || '?').trim().charAt(0)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-text truncate" dir="auto">{nameOf(e, lang)}</span>
                        <span className="block text-[11px] text-text-tertiary" dir="ltr">{e.employee_no}</span>
                        <span className="block text-xs text-text-secondary truncate" dir="auto">{e.job_title || e.trade || '—'}</span>
                        <span className="block text-xs text-text-tertiary truncate">{deptName(e.department_id)}</span>
                        <span className="flex flex-wrap gap-1 mt-1">
                          {e.status === 'ended' && <Pill>{t.statuses.ended}</Pill>}
                          {noContract(e) && <Pill tone="amber">{t.badgeNoContract}</Pill>}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
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
            {groups.map(g => (
              <tbody key={g.key || 'all'} className="divide-y divide-border">
                {group && <tr className="bg-stone-50"><td colSpan={5} className="px-3 py-1.5 text-xs font-semibold text-text-secondary">{titleOf(g.key)} <span className="font-normal text-text-tertiary">({g.rows.length})</span></td></tr>}
                {g.rows.map(e => (
                  <tr key={e.id} className="hover:bg-stone-50">
                    <td className="px-3 py-2">
                      <Link to={`/hr/employee?id=${e.id}`} className="font-medium text-text hover:underline" dir="auto">{nameOf(e, lang)}</Link>
                      <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-tertiary">
                        {e.employee_no && <bdi dir="ltr">{e.employee_no}</bdi>}
                        {e.status === 'ended' && <Pill>{t.statuses.ended}</Pill>}
                        {noContract(e) && <Pill tone="amber">{t.badgeNoContract}</Pill>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-secondary" dir="auto">{e.job_title || e.trade}</td>
                    <td className="px-3 py-2 text-text-secondary">{deptName(e.department_id) || '—'}</td>
                    <td className="px-3 py-2 text-text-secondary hidden md:table-cell">{empName(employees, e.manager_id, lang, '—')}</td>
                    <td className="px-3 py-2 text-text-secondary hidden md:table-cell tabular-nums" dir="ltr">{e.work_phone || ''}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {creating && (
        <Dialog title={t.newEmployee.replace('+ ', '')} onClose={() => setCreating(false)}>
          <EmployeeForm employees={employees || []} departments={departments} jobs={jobs} submitLabel={t.add} onCancel={() => setCreating(false)}
            onSubmit={async ({ employee, personal }) => {
              const out = await saveEmployee(ws, me, null, employee)
              if (out.error) return out
              const priv = await savePrivate(ws, out.row.id, personal)
              if (priv.error) return priv
              setCreating(false)
              navigate(`/hr/employee?id=${out.row.id}`)
              return out
            }} />
        </Dialog>
      )}
    </div>
  )
}
