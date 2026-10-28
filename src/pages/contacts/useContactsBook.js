import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchOrgs, fetchPeople, fetchCategories } from '../../lib/contacts/client'

// The Contacts pages load the same way: the company's organisations and,
// when asked, its people; and the supplier categories. Also the form
// fields' one look.

export const field = 'w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-200 disabled:bg-stone-50'
/** The same look, as wide as its content (filters beside a search box). */
export const fieldInline = field.replace('w-full ', '')

/** A field's error code in words (codes from lib/contacts/logic.js validateOrg). */
export const errorWord = (w, code) => w.errors[code] || w.errors2[code] || code

/** A category's name in the reader's language: its English one in English when it has one. */
export const categoryName = (c, lang) => (c ? (lang === 'ar' ? c.name : c.name_en || c.name) : '')

/** The company's organisations and (when asked) people, loaded together. */
export function useContactsBook({ people: withPeople = false } = {}) {
  const { activeWorkspaceId: ws } = useAuth()
  const [orgs, setOrgs] = useState(null)
  const [people, setPeople] = useState(null)
  const [categories, setCategories] = useState([])
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!ws) return
    const [o, p, c] = await Promise.all([fetchOrgs(ws), withPeople ? fetchPeople(ws) : Promise.resolve({ rows: [] }), fetchCategories(ws)])
    setOrgs(o.rows)
    setPeople(p.rows)
    setCategories(c.rows)
    setError(o.error || p.error || c.error || '')
  }, [ws, withPeople])
  useEffect(() => { queueMicrotask(load) }, [load])
  const orgsById = useMemo(() => Object.fromEntries((orgs || []).map(o => [o.id, o])), [orgs])
  const categoriesById = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories])
  return { ws, orgs, people, orgsById, categories, categoriesById, error, setError, load }
}
