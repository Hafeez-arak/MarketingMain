import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchItems, fetchFields } from '../../lib/catalog/client'

// The Catalog pages load the same way: the company's items and its
// specification fields. Also the form fields' one look (the Contacts one).

export { field, fieldInline } from '../contacts/useContactsBook'

export function useCatalog() {
  const { activeWorkspaceId: ws } = useAuth()
  const [items, setItems] = useState(null)
  const [fields, setFields] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!ws) return
    const [i, f] = await Promise.all([fetchItems(ws), fetchFields(ws)])
    setItems(i.rows)
    setFields(f.rows)
    setError(i.error || f.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])
  return { ws, items, fields, error, setError, load }
}
