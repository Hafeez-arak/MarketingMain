import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchOrgs, fetchPeople } from '../../lib/contacts/client'

// The Contacts pages load the same way: the company's organisations and,
// when asked, its people. Also the form fields' one look.

export const field = 'w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-200 disabled:bg-stone-50'
/** The same look, as wide as its content (filters beside a search box). */
export const fieldInline = field.replace('w-full ', '')

/** The company's organisations and (when asked) people, loaded together. */
export function useContactsBook({ people: withPeople = false } = {}) {
  const { activeWorkspaceId: ws } = useAuth()
  const [orgs, setOrgs] = useState(null)
  const [people, setPeople] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!ws) return
    const [o, p] = await Promise.all([fetchOrgs(ws), withPeople ? fetchPeople(ws) : Promise.resolve({ rows: [] })])
    setOrgs(o.rows)
    setPeople(p.rows)
    setError(o.error || p.error || '')
  }, [ws, withPeople])
  useEffect(() => { queueMicrotask(load) }, [load])
  const orgsById = useMemo(() => Object.fromEntries((orgs || []).map(o => [o.id, o])), [orgs])
  return { ws, orgs, people, orgsById, error, setError, load }
}
