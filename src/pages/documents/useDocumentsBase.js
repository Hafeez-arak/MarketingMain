import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchTypes, fetchPeople, fetchEmployees, fetchSuppliers } from '../../lib/documents/client'

// The Documents pages load the same things first: the company's types, the
// people a document can be given to, and the employees and suppliers that
// name who a document is for.

export { field, fieldInline } from '../contacts/useContactsBook'

/** A document's page. */
export const docHref = id => `/documents/document?id=${id}`

const byId = rows => Object.fromEntries((rows || []).map(r => [r.id, r]))

export function useDocumentsBase() {
  const { activeWorkspaceId: ws } = useAuth()
  const [base, setBase] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!ws) return
    const [types, people, employees, suppliers] = await Promise.all([fetchTypes(ws), fetchPeople(ws), fetchEmployees(ws), fetchSuppliers(ws)])
    setBase({ types: types.rows, people: people.rows, employees: employees.rows, suppliers: suppliers.rows })
    setError(types.error || people.error || employees.error || suppliers.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])
  const maps = useMemo(() => ({
    typesById: byId(base?.types),
    peopleById: Object.fromEntries((base?.people || []).map(r => [r.user_id, r])),
    employeesById: byId(base?.employees),
    suppliersById: byId(base?.suppliers),
  }), [base])
  return { ws, base, ...maps, error, reload: load }
}

/** Who a document is for, in words: the employee's or supplier's name, or the company. */
export function linkName(doc, { employeesById, suppliersById }, lang, w) {
  if (doc.link_kind === 'employee') {
    const e = employeesById[doc.employee_id]
    return e ? (lang === 'ar' && e.name_ar ? e.name_ar : e.name_en) : ''
  }
  if (doc.link_kind === 'supplier') {
    const s = suppliersById[doc.supplier_id]
    return s ? (lang === 'ar' && s.name_ar ? s.name_ar : s.name) : ''
  }
  return doc.link_kind === 'company' ? w.links.company : ''
}
