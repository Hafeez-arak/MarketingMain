import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchTasks, fetchTaskPeople, updateTask } from '../../lib/tasks/client'

// The Tasks page, Home and the sales team's app all list tasks the same
// way; this is the shared loading and ticking.

/** Everything a task view needs: the people, the rows, and the actions on them. */
export function useTaskBoard(view, extra = {}) {
  const { activeWorkspaceId: ws, user } = useAuth()
  const me = user?.id || ''
  const [people, setPeople] = useState([])
  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [now, setNow] = useState(() => new Date())
  const key = JSON.stringify(extra)

  const load = useCallback(async () => {
    if (!ws || !me) return
    const [p, t] = await Promise.all([fetchTaskPeople(ws), fetchTasks(ws, { view, me, ...JSON.parse(key) })])
    setPeople(p.people)
    setTasks(t.rows)
    setError(p.error || t.error || '')
    setNow(new Date())
  }, [ws, me, view, key])

  useEffect(() => { queueMicrotask(load) }, [load])

  const replace = row => setTasks(ts => (ts || []).map(t => (t.id === row.id ? row : t)))
  const toggle = async task => {
    setBusyId(task.id)
    const out = await updateTask(ws, me, task.id, { status: task.status === 'done' ? 'todo' : 'done' })
    setBusyId('')
    if (out.error) setError(out.error)
    else replace(out.task)
  }
  return { ws, me, people, tasks, error, setError, busyId, now, load, replace, toggle, setTasks }
}

