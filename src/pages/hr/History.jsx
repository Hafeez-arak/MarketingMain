import { useEffect, useState } from 'react'
import { Spinner } from '../../components/ui/index'
import { useT, fmtDay } from '../../lib/i18n'
import { describeChange, nameOf } from '../../lib/hr/logic'
import { fetchAudit, fetchPeople } from '../../lib/hr/client'
import { HW } from './words'
import { ErrorText } from './parts'

// ─── HR: the history of a person or a contract (Manage) ────────────────────
// 2026-10-29, parity pass. Every change the database kept (hr_audit): what,
// who, when, and the fields that changed. Ids are shown as names where we
// know them (employees, departments, positions); the rest as stored.

export function History({ ws, employeeId = '', rowId = '', employees = [], departments = [], jobs = [], refreshKey = 0 }) {
  const { t, lang } = useT(HW)
  const [rows, setRows] = useState(null)
  const [people, setPeople] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ws) return
    let cancelled = false
    Promise.all([fetchAudit(ws, { employeeId, rowId }), fetchPeople(ws)]).then(([a, p]) => {
      if (cancelled) return
      setRows(a.rows); setPeople(p.rows); setError(a.error || '')
    })
    return () => { cancelled = true }
  }, [ws, employeeId, rowId, refreshKey])

  const who = id => people.find(p => p.user_id === id)?.name || t.someone
  const show = (field, v) => {
    if (v === null || v === undefined || v === '') return '—'
    if (field === 'manager_id' || field === 'head_id') return nameOf(employees.find(e => e.id === v), lang) || '—'
    if (field === 'department_id' || field === 'parent_id') return nameOf(departments.find(d => d.id === v), lang) || '—'
    if (field === 'job_id') return nameOf(jobs.find(j => j.id === v), lang) || '—'
    if (field === 'user_id') return t.yes
    if (field === 'status') return t.contractStatuses[v] || t.statuses[v] || String(v)
    if (field === 'employment_type') return t.employmentTypes[v] || String(v)
    if (field === 'contract_type') return t.contractTypes[v] || String(v)
    if (field === 'doc_type') return t.docTypes[v] || String(v)
    if (field === 'id_type') return t.idTypes[v] || String(v)
    if (field === 'gender') return t.genders[v] || String(v)
    if (typeof v === 'boolean') return v ? t.yes : t.no
    return String(v)
  }

  if (rows === null) return <Spinner size="sm" />
  return (
    <div className="space-y-2">
      <ErrorText error={error} />
      {!rows.length ? <p className="text-xs text-text-tertiary">{t.noHistory}</p> : (
        <ul className="divide-y divide-border border border-border">
          {rows.map(r => {
            const changes = describeChange(r)
            if (r.action === 'update' && !changes.length) return null
            return (
              <li key={r.id} className="px-3 py-2 text-xs">
                <p className="text-text">
                  <span className="font-medium">{t.historyActions[r.action]}</span> · {t.historyTables[r.table_name] || r.table_name}
                  <span className="text-text-tertiary"> · {t.changedBy(who(r.changed_by), fmtDay(r.changed_at, lang))}</span>
                </p>
                {changes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-text-secondary">
                    {changes.slice(0, 12).map(c => (
                      <li key={c.field} dir="auto">
                        {t.historyFields[c.field] || c.field}:{' '}
                        {r.action === 'update' ? <><span className="line-through text-text-tertiary">{show(c.field, c.from)}</span> → </> : null}
                        <span className="text-text">{show(c.field, c.to)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
