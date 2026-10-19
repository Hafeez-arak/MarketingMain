import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

// ─── The number beside "Tasks" in the sales app's side bar (v2) ───────────
// My open tasks due by the end of today in Riyadh, overdue ones included:
// the same count the marketing app's rail shows (useNavBadges.js). Zero,
// quietly, on any error, which includes a database without the tasks table.
// Re-counted every two minutes, and at once when a task here changes.

const EVENT = 'arak:tasks-changed'

/** Tell the side bar a task was added, ticked or changed. */
export function tasksChanged() {
  window.dispatchEvent(new Event(EVENT))
}

/** End of today in Riyadh (UTC+3), as an ISO time. */
export function endOfRiyadhToday(now = Date.now()) {
  return new Date(Math.floor((now + 3 * 3_600_000) / 86_400_000) * 86_400_000 + 21 * 3_600_000).toISOString()
}

export function useDueTaskCount(ws, userId) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!ws || !userId) return undefined
    let cancelled = false
    async function count() {
      const { count: c, error } = await supabase.from('tasks').select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws).eq('assigned_to', userId)
        .in('status', ['todo', 'in_progress', 'waiting']).lte('due_at', endOfRiyadhToday())
      if (!cancelled) setN(error ? 0 : c || 0)
    }
    queueMicrotask(() => { if (!cancelled) void count() })
    const id = setInterval(() => { void count() }, 120_000)
    const onChange = () => { void count() }
    window.addEventListener(EVENT, onChange)
    return () => { cancelled = true; clearInterval(id); window.removeEventListener(EVENT, onChange) }
  }, [ws, userId])
  return ws && userId ? n : 0
}
