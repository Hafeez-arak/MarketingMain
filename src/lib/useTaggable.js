import { useEffect, useState } from 'react'
import { fetchTaggable } from './requests'

/** The people who can be @-tagged in this company, for the chat box's picker. */
export function useTaggable(workspaceId) {
  const [people, setPeople] = useState([])
  useEffect(() => {
    if (!workspaceId) return undefined
    let cancelled = false
    fetchTaggable(workspaceId).then(rows => { if (!cancelled) setPeople(rows) })
    return () => { cancelled = true }
  }, [workspaceId])
  return people
}
