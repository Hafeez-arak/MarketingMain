import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { fetchTask, createTask, updateTask, deleteTask } from '../../lib/tasks/client'
import { useTaskBoard } from './useTaskBoard'
import { teamSummary } from '../../lib/tasks/logic'
import { TaskList, TaskForm, TaskPanel, Dialog } from './parts'
import { Meetings } from './Meetings'

// ─── Tasks (v2) ────────────────────────────────────────────────────────────
// 2026-10-19, docs/TASKS-PLAN.md. Everyone's to-do list, the follow-ups they
// set for others, the team's at a glance, and meetings with their action
// items. Opening a task (?id=) shows its panel; the database decides who may
// see and change it and writes the history and the bell.

const TABS = [
  { key: 'mine', label: 'My tasks' },
  { key: 'assigned', label: 'I assigned' },
  { key: 'team', label: 'Team' },
  { key: 'meetings', label: 'Meetings' },
]

export function TasksPage() {
  const { isAccessAdmin, canSection } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'mine'
  const openId = params.get('id') || ''
  const view = tab === 'meetings' ? 'mine' : tab
  const board = useTaskBoard(view)
  const { ws, me, people, tasks, error, now } = board
  const [creating, setCreating] = useState(null) // null | {} initial values
  const [opened, setOpened] = useState(null)

  const setParam = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  // ?id= opens a task: from the list when it is there, else read on its own
  // (a link from the bell to a task in another view).
  useEffect(() => {
    if (!openId || !ws) return
    let cancelled = false
    const inList = (tasks || []).find(t => t.id === openId)
    if (inList) { queueMicrotask(() => { if (!cancelled) setOpened(inList) }); return () => { cancelled = true } }
    fetchTask(ws, openId).then(out => { if (!cancelled) setOpened(out.task || null) })
    return () => { cancelled = true }
  }, [openId, ws, tasks])
  const current = openId && opened?.id === openId ? opened : null

  const canEdit = t => t.created_by === me || isAccessAdmin || canSection('ceo', 'manage') || (t.section && canSection(t.section, 'manage'))
  const canDelete = t => t.created_by === me || isAccessAdmin

  async function create(fields) {
    const out = await createTask(ws, me, { ...creating, ...fields })
    if (out.error) return out
    setCreating(null)
    board.load()
    return out
  }

  const team = useMemo(() => (tab === 'team' && tasks ? teamSummary(tasks, people, now) : []), [tab, tasks, people, now])

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Tasks" subtitle="Your to-do list, the follow-ups you set for others, and what each meeting agreed. Reminders and deadlines come to the bell, and every morning a summary.">
        <Button size="sm" onClick={() => setCreating({})}>+ New task</Button>
      </PageHeader>

      <nav className="flex gap-1 border-b border-border overflow-x-auto [scrollbar-width:none]" aria-label="Tasks">
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setParam('tab', t.key === 'mine' ? '' : t.key)} aria-current={tab === t.key ? 'page' : undefined}
            className={`whitespace-nowrap px-3 py-2 text-xs border-b-2 -mb-px ${tab === t.key ? 'border-stone-900 text-text font-medium' : 'border-transparent text-text-secondary hover:text-text'}`}>
            {t.label}
          </button>
        ))}
      </nav>

      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}

      {tab === 'meetings' ? (
        <Meetings people={people} onOpenTask={t => { setOpened(t); setParam('id', t.id) }} />
      ) : tasks === null ? <Skeleton className="h-48" /> : tab === 'team' ? (
        <div className="space-y-4">
          <div className="bg-white border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                <th className="text-start font-medium px-3 py-2">Person</th>
                <th className="text-end font-medium px-3 py-2">Open</th>
                <th className="text-end font-medium px-3 py-2">Overdue</th>
                <th className="text-end font-medium px-3 py-2">Due this week</th>
                <th className="text-end font-medium px-3 py-2">Done (7 days)</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {team.filter(r => r.open || r.doneWeek).map(r => (
                  <tr key={r.userId}>
                    <td className="px-3 py-2 font-medium text-text">{r.name}{r.kind === 'sales' && <span className="text-[11px] text-text-tertiary font-normal"> · sales</span>}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.open}</td>
                    <td className={`px-3 py-2 text-end tabular-nums ${r.overdue ? 'text-red-600 font-semibold' : ''}`}>{r.overdue}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.week}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.doneWeek}</td>
                  </tr>
                ))}
                {!team.some(r => r.open || r.doneWeek) && <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-text-tertiary">No tasks you can see yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-text-tertiary">You see the tasks you set or were given, and all of a section's tasks where you manage it.</p>
          <TaskList tasks={tasks} people={people} now={now} showAssignee onOpen={t => setParam('id', t.id)} onToggle={board.toggle} busyId={board.busyId} hideDone />
        </div>
      ) : (
        <TaskList tasks={tasks} people={people} now={now} showAssignee={tab === 'assigned'} showSetter={tab === 'mine'}
          onOpen={t => setParam('id', t.id)} onToggle={board.toggle} busyId={board.busyId}
          empty={tab === 'mine' ? 'Nothing on your list. Tasks given to you, and ones you add, show up here.' : 'You have not set anyone a task yet.'} />
      )}

      {creating && (
        <Dialog title={creating.follow_up_of ? 'Add a follow-up' : 'New task'} onClose={() => setCreating(null)}>
          <TaskForm initial={creating} people={people} me={me} submitLabel={creating.follow_up_of ? 'Add follow-up' : 'Add task'} onSubmit={create} onCancel={() => setCreating(null)} />
        </Dialog>
      )}

      {current && (
        <TaskPanel task={current} people={people} me={me} now={now}
          canEdit={canEdit(current)} canDelete={canDelete(current)}
          onClose={() => { setParam('id', ''); setOpened(null) }}
          onUpdate={async patch => { const out = await updateTask(ws, me, current.id, patch); if (!out.error) { setOpened(out.task); board.replace(out.task) } return out }}
          onDelete={async t => { const out = await deleteTask(ws, t.id); if (out.error) board.setError(out.error); else { setParam('id', ''); board.load() } }}
          leadHref={t => `/sales/leads?view=pipeline&lead=${t.lead_id}`}
          onFollowUp={t => setCreating({ follow_up_of: t.id, title: `Follow up: ${t.title}`, assigned_to: t.assigned_to, lead_id: t.lead_id, account_id: t.account_id, meeting_id: t.meeting_id, section: t.section })} />
      )}
    </div>
  )
}
