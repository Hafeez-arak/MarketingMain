import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../store/auth'
import { atLeast } from '../../lib/modules'
import { fmtDay } from '../../lib/i18n'
import { fetchEmployees, fetchDepartments } from '../../lib/hr/client'
import { nameOf } from '../../lib/hr/logic'

// ─── HR: what every HR page loads, and small helpers ──────────────────────
// 2026-10-28, dev/erp-pilot/HR.md. The company's employees and departments
// (every page needs names), this person's HR level and linked employee.
// The shared components are in parts.jsx.

/** The company, me, my HR level, the employees and departments, and a reload. */
export function useHrBase() {
  const { activeWorkspaceId: ws, user, sectionLevel } = useAuth()
  const me = user?.id || ''
  const level = sectionLevel('hr')
  const [employees, setEmployees] = useState(null)
  const [departments, setDepartments] = useState([])
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    if (!ws) return
    const [e, d] = await Promise.all([fetchEmployees(ws), fetchDepartments(ws)])
    setEmployees(e.rows)
    setDepartments(d.rows)
    setError(e.error || d.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(reload) }, [reload])

  const list = employees || []
  const myEmployee = me ? list.find(e => e.user_id === me) || null : null
  /** Am I this employee's direct manager (through my linked login)? */
  const managerOf = id => {
    const e = list.find(x => x.id === id)
    return Boolean(me && e?.manager_id && list.find(m => m.id === e.manager_id)?.user_id === me)
  }
  return { ws, me, level, can: min => atLeast(level, min), employees, departments, myEmployee, managerOf, error, setError, reload }
}


export const field = 'w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-200 disabled:bg-stone-50 disabled:text-text-tertiary'

export const STATE_TONE = {
  present: 'green', late: 'amber', absent: 'red', leave: 'blue', none: 'grey',
  pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'grey',
  expired: 'red', soon: 'amber', ok: 'green',
  current: 'green', upcoming: 'blue', ended: 'grey', active: 'green',
}

/** "28 Oct 2026" / "28 أكتوبر 2026". */
export const fmtDate = (day, lang) => fmtDay(day, lang, { day: 'numeric', month: 'short', year: 'numeric' })

/** An employee's name by id, in this language. */
export function empName(employees, id, lang, fallback = '') {
  return nameOf((employees || []).find(e => e.id === id), lang) || fallback
}

