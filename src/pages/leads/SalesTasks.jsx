import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Button, Skeleton } from '../../components/ui/index'
import { SubTabs } from '../email/parts'
import { fetchTask, createTask, updateTask, deleteTask } from '../../lib/tasks/client'
import { useTaskBoard } from '../tasks/useTaskBoard'
import { TaskList, TaskForm, TaskPanel, Dialog } from '../tasks/parts'
import SalesShell from './SalesShell'
import { tasksChanged } from './useDueTaskCount'
import { useT } from '../../lib/i18n'
import { TW } from '../tasks/words'

// ─── The sales team's Tasks page (v2, 2026-10-19) ─────────────────────────
// docs/TASKS-PLAN.md: the same My tasks and I assigned the marketing app has
// on /tasks, inside the sales app. It lives at /leads?view=tasks because the
// sales app's routes are /leads and /research only (App.jsx); ?task=<id>
// opens one task, which is where the bell's task links land.
//
// A salesperson changes what they set, moves the status of what they were
// given, and comments on either. The database decides (20261102_tasks.sql);
// the buttons only follow it.


export default function SalesTasks() {
  const { t: w } = useT(TW)
  const TABS = [{ key: 'mine', label: w.tabs.mine }, { key: 'assigned', label: w.tabs.assigned }]
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'assigned' ? 'assigned' : 'mine'
  const openId = params.get('task') || ''
  const board = useTaskBoard(tab)
  const { ws, me, people, tasks, error, now } = board
  const [creating, setCreating] = useState(null) // null | {} initial values
  const [opened, setOpened] = useState(null)

  const setParam = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  // ?task= opens a task: from the list when it is there, else read on its own
  // (a bell link to one in the other tab, or one already done).
  useEffect(() => {
    if (!openId || !ws) return undefined
    let cancelled = false
    const inList = (tasks || []).find((t) => t.id === openId)
    if (inList) { queueMicrotask(() => { if (!cancelled) setOpened(inList) }); return () => { cancelled = true } }
    fetchTask(ws, openId).then((out) => { if (!cancelled) setOpened(out.task || null) })
    return () => { cancelled = true }
  }, [openId, ws, tasks])
  const current = openId && opened?.id === openId ? opened : null

  const canEdit = (t) => t.created_by === me
  const canDelete = (t) => t.created_by === me

  async function create(fields) {
    const out = await createTask(ws, me, { section: 'sales', ...creating, ...fields })
    if (out.error) return out
    setCreating(null)
    board.load()
    tasksChanged()
    return out
  }

  async function toggle(t) {
    await board.toggle(t)
    tasksChanged()
  }

  return (
    <SalesShell>
      <div className="max-w-4xl space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-text tracking-tight">{w.title}</h1>
            <p className="text-xs text-text-secondary mt-0.5">
              {w.salesSubtitle}
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating({})} disabled={!ws}>{w.newTask}</Button>
        </div>

        <SubTabs items={TABS} value={tab} onChange={(k) => setParam('tab', k === 'mine' ? '' : k)} />

        {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}

        {tasks === null ? <Skeleton className="h-48 w-full" /> : (
          <TaskList tasks={tasks} people={people} now={now} showAssignee={tab === 'assigned'} showSetter={tab === 'mine'}
            onOpen={(t) => setParam('task', t.id)} onToggle={toggle} busyId={board.busyId}
            empty={tab === 'mine' ? w.emptyMine : w.emptyAssigned} />
        )}

        {creating && (
          <Dialog title={creating.follow_up_of ? w.addFollowUp : w.newTask.replace('+ ', '')} onClose={() => setCreating(null)}>
            <TaskForm initial={creating} people={people} me={me} submitLabel={creating.follow_up_of ? w.addFollowUpBtn : w.addTask} onSubmit={create} onCancel={() => setCreating(null)} />
          </Dialog>
        )}

        {current && (
          <TaskPanel task={current} people={people} me={me} now={now}
            leadHref={t => `/leads?lead=${t.lead_id}`}
            canEdit={canEdit(current)} canDelete={canDelete(current)}
            onClose={() => { setParam('task', ''); setOpened(null) }}
            onUpdate={async (patch) => {
              const out = await updateTask(ws, me, current.id, patch)
              if (!out.error) { setOpened(out.task); board.replace(out.task); tasksChanged() }
              return out
            }}
            onDelete={async (t) => {
              const out = await deleteTask(ws, t.id)
              if (out.error) board.setError(out.error)
              else { setParam('task', ''); board.load(); tasksChanged() }
            }}
            onFollowUp={(t) => setCreating({ follow_up_of: t.id, title: `${w.followUpPrefix}${t.title}`, assigned_to: t.assigned_to, lead_id: t.lead_id, account_id: t.account_id, meeting_id: t.meeting_id, section: t.section })} />
        )}
      </div>
    </SalesShell>
  )
}

/**
 * For App.jsx's sales routes: a task link ('/tasks?id=X', from the bell or
 * the morning email) lands on this page with that task open.
 */
export function SalesTasksRedirect() {
  const [params] = useSearchParams()
  const id = params.get('id')
  return <Navigate to={`/leads?view=tasks${id ? `&task=${encodeURIComponent(id)}` : ''}`} replace />
}
