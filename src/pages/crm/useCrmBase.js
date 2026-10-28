import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchList, fetchPeople, fetchClients } from '../../lib/crm/client'

// The CRM pages load the same things first: the company's stages, sources,
// loss reasons and tags, the people work can be given to, and the
// organisations a client can be picked from (Contacts, as the CRM sees it).

export { field, fieldInline } from '../contacts/useContactsBook'

/** An opportunity's page. */
export const leadHref = id => `/crm/lead?id=${id}`

const byId = rows => Object.fromEntries((rows || []).map(r => [r.id, r]))
const byUser = rows => Object.fromEntries((rows || []).map(r => [r.user_id, r]))

export function useCrmBase() {
  const { activeWorkspaceId: ws } = useAuth()
  const [base, setBase] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!ws) return
    const [stages, sources, reasons, tags, people, clients] = await Promise.all([
      fetchList(ws, 'stages'), fetchList(ws, 'sources'), fetchList(ws, 'reasons'), fetchList(ws, 'tags'), fetchPeople(ws), fetchClients(ws),
    ])
    setBase({ stages: stages.rows, sources: sources.rows, reasons: reasons.rows, tags: tags.rows, people: people.rows, clients: clients.rows })
    setError(stages.error || sources.error || reasons.error || tags.error || people.error || clients.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])
  const maps = useMemo(() => ({
    stagesById: byId(base?.stages), sourcesById: byId(base?.sources), reasonsById: byId(base?.reasons),
    tagsById: byId(base?.tags), peopleById: byUser(base?.people), clientsById: byId(base?.clients),
  }), [base])
  return { ws, base, ...maps, error, reload: load }
}
