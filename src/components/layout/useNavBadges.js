import { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from '../../store/auth'
import { countWaiting } from '../../lib/requests'
import { fetchPendingCount } from '../../lib/access'
import { fetchScheduledPosts } from '../../lib/scheduledPosts'
import { needsQueueAttention } from '../../lib/postLock'
import { supabase } from '../../lib/supabaseClient'

// ─── The counts on navigation items ────────────────────────────────────────
// Moved out of v1's sidebar (2026-10-19) so the rail, the section sidebar
// and Home's tiles show the same numbers from one set of reads. The reasons
// for each are v1's, kept below.

/** Fired by Team & Access after a change to who may sign in. */
export const ACCESS_CHANGED = 'campai:access-changed'

export function useNavBadges() {
  const { user, activeWorkspaceId, accessToken, isAccessAdmin } = useAuth()

  // The only notification the access gate has: a count on the nav item.
  // Requests otherwise sit unseen until someone thinks to look, and a
  // teammate blocked on approval has no way to nudge from inside the app.
  // Admin-only: for everyone else there is nothing to act on.
  const [pendingAccess, setPendingAccess] = useState(0)
  useEffect(() => {
    if (!isAccessAdmin) return
    let cancelled = false
    const count = () => fetchPendingCount().then(n => { if (!cancelled) setPendingAccess(n) })
    void count()
    // Team & Access says when it approved, denied or restored someone, so the
    // count follows at once instead of at the next reload.
    window.addEventListener(ACCESS_CHANGED, count)
    return () => { cancelled = true; window.removeEventListener(ACCESS_CHANGED, count) }
  }, [isAccessAdmin])

  // Posts that need a person. An approved post whose booking failed is
  // invisible otherwise: it is not on the calendar (nothing is going to send
  // it) and nobody thinks to open the Post Queue to look for a failure they
  // were never told about. Counted with the Post Queue's own test
  // (needsQueueAttention), so the badge and its "Needs attention" tab agree.
  const [pendingPosts, setPendingPosts] = useState(0)
  useEffect(() => {
    if (!activeWorkspaceId || !accessToken) return
    let cancelled = false
    async function count() {
      const rows = await fetchScheduledPosts(activeWorkspaceId, accessToken, {
        publishStatus: ['not_published', 'failed'], limit: 500,
      })
      if (!cancelled) setPendingPosts(rows.filter(r => needsQueueAttention(r)).length)
    }
    queueMicrotask(() => { if (!cancelled) void count() })
    // On screen for hours at a time: a booking that fails at 3pm should not
    // wait for a reload to show up.
    const id = setInterval(() => { void count() }, 120_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [activeWorkspaceId, accessToken])

  // Requests waiting on this person: new ones for an admin (they build the
  // changes), open work assigned to them for anyone.
  const [waitingRequests, setWaitingRequests] = useState(0)
  useEffect(() => {
    if (!activeWorkspaceId || !user?.id) return
    let cancelled = false
    async function count() {
      const n = await countWaiting(activeWorkspaceId, user.id, isAccessAdmin)
      if (!cancelled) setWaitingRequests(n)
    }
    queueMicrotask(() => { if (!cancelled) void count() })
    const id = setInterval(() => { void count() }, 120_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [activeWorkspaceId, user?.id, isAccessAdmin])

  // v2: my open tasks that are due today or late (docs/TASKS-PLAN.md). Zero,
  // quietly, where the tasks table does not exist (production before v2).
  const [openTasks, setOpenTasks] = useState(0)
  useEffect(() => {
    if (!activeWorkspaceId || !user?.id) return
    let cancelled = false
    async function count() {
      const end = new Date(Math.floor((Date.now() + 3 * 3_600_000) / 86_400_000) * 86_400_000 + 21 * 3_600_000).toISOString()
      const { count: n, error } = await supabase.from('tasks').select('id', { count: 'exact', head: true })
        .eq('workspace_id', activeWorkspaceId).eq('assigned_to', user.id)
        .in('status', ['todo', 'in_progress', 'waiting']).lte('due_at', end)
      if (!cancelled) setOpenTasks(error ? 0 : n || 0)
    }
    queueMicrotask(() => { if (!cancelled) void count() })
    const id = setInterval(() => { void count() }, 120_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [activeWorkspaceId, user?.id])

  // v2: red projects this person can see (project_flags, set by the
  // Technical monitor after each Odoo round). The database shows a project
  // manager only their own. Zero where the table does not exist.
  const [redProjects, setRedProjects] = useState(0)
  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    async function count() {
      const { count: n, error } = await supabase.from('project_flags').select('odoo_project_id', { count: 'exact', head: true })
        .eq('workspace_id', activeWorkspaceId).eq('level', 'red')
      if (!cancelled) setRedProjects(error ? 0 : n || 0)
    }
    queueMicrotask(() => { if (!cancelled) void count() })
    const id = setInterval(() => { void count() }, 300_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [activeWorkspaceId])

  // Gated at read rather than by resetting the count when isAccessAdmin
  // flips: a stale number from a previous session can never leak into a
  // non-admin's view.
  return { pendingAccess: isAccessAdmin ? pendingAccess : 0, pendingPosts, waitingRequests, openTasks, redProjects }
}

/** A section's total: the sum of its pages' badges, for the dot on its rail icon and Home tile. */
export const sectionBadge = (section, badges) =>
  (section?.pages || []).reduce((n, pg) => n + (pg.badge ? badges[pg.badge] || 0 : 0), 0)

const NONE = { pendingAccess: 0, pendingPosts: 0, waitingRequests: 0, openTasks: 0, redProjects: 0 }

/** Read once in AppLayout and shared, so Home's tiles do not read the same counts again. */
export const NavBadgesContext = createContext(NONE)
export const useBadges = () => useContext(NavBadgesContext)
