import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../store/auth'
import { loadTechnical } from '../../lib/technical/client'

// The Technical pages' data hooks (kept apart from the components so fast
// refresh keeps working).

/** The section's data for the open company, reloadable. `data` is undefined while loading. */
export function useTechnical() {
  const { activeWorkspaceId: ws } = useAuth()
  const [state, setState] = useState({ data: undefined, error: null })
  const load = useCallback(() => {
    if (!ws) return
    loadTechnical(ws)
      .then(data => setState({ data, error: null }))
      .catch(err => setState({ data: null, error: String(err.message || err) }))
  }, [ws])
  useEffect(() => { load() }, [load])
  return { ...state, reload: load, ws }
}

/** May this person record on this project: Technical manage, or work on a project they manage in Odoo. */
export function useCanWork(data) {
  const { canSection } = useAuth()
  return project => canSection('technical', 'manage')
    || (canSection('technical', 'work') && project?.pmOdooId != null && project.pmOdooId === data?.myOdooUid)
}
