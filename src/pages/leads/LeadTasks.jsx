import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button } from '../../components/ui/index'
import { fetchTasks, fetchTaskPeople, createTask, updateTask } from '../../lib/tasks/client'
import { bucketOf, dueLabel, isOpen } from '../../lib/tasks/logic'
import { TaskForm, Dialog } from '../tasks/parts'
import { tasksChanged } from './useDueTaskCount'
import { useT } from '../../lib/i18n'
import { LW } from './words'

// ─── An opened lead's follow-up tasks (v2, 2026-10-19) ────────────────────
// docs/TASKS-PLAN.md: "any lead can get a follow-up task that links back to
// it". One line under the lead's owner and stage: its open tasks with their
// deadlines and who has them, a tick to finish one, and "Add follow-up task",
// which sets one already tied to this lead, for whoever has the lead.
// Shared by the Inbox (Board.jsx) and the Pipeline, in both apps. The
// database decides who may see and tick a task (20261102_tasks.sql); a
// salesperson sees the ones they set or were given.
//
// Where the database has no tasks table (production before v2) the line is
// not shown at all.

const nameOf = (people, id, t) => people.find((p) => p.user_id === id)?.name || (id ? t.someoneLeftLc : t.nobody)

const DUE_TONE = { overdue: 'text-red-600 font-semibold', today: 'text-text font-semibold' }

const noTable = (msg) => /schema cache|does not exist/i.test(String(msg || ''))

export default function LeadTasks({ lead, workspaceId, me }) {
  const { isSales } = useAuth()
  const { t: w, lang } = useT(LW)
  const [people, setPeople] = useState([])
  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(async () => {
    if (!workspaceId || !lead.id) return
    const [p, t] = await Promise.all([fetchTaskPeople(workspaceId), fetchTasks(workspaceId, { view: 'lead', leadId: lead.id })])
    setPeople(p.people)
    setTasks(t.rows)
    setError(t.error || p.error || '')
    setNow(new Date())
  }, [workspaceId, lead.id])

  useEffect(() => { queueMicrotask(load) }, [load])

  if (noTable(error)) return null

  async function tick(t) {
    setBusyId(t.id)
    const out = await updateTask(workspaceId, me, t.id, { status: 'done' })
    setBusyId('')
    if (out.error) { setError(out.error); return }
    tasksChanged()
    load()
  }

  async function add(fields) {
    const out = await createTask(workspaceId, me, { lead_id: lead.id, section: 'sales', ...fields })
    if (out.error) return out
    setAdding(false)
    tasksChanged()
    load()
    return out
  }

  const open = (tasks || []).filter(isOpen)
  const done = (tasks || []).filter((t) => t.status === 'done').length
  const href = (t) => (isSales ? `/leads?view=tasks&task=${t.id}` : `/tasks?id=${t.id}`)

  return (
    <div className="px-4 pt-2 md:ps-[8.25rem] text-[11px] text-text-secondary space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{w.followTasks}</span>
        {tasks !== null && !open.length && <span className="text-text-tertiary">{w.noneOpen(done)}</span>}
        {open.length > 0 && done > 0 && <span className="text-text-tertiary">{w.doneN(done)}</span>}
        <Button size="xs" variant="secondary" onClick={() => setAdding(true)} disabled={!workspaceId}>{w.addFollowTask}</Button>
      </div>
      {open.length > 0 && (
        <ul className="space-y-1" aria-label={w.openTasksAria}>
          {open.map((t) => {
            const b = bucketOf(t, now)
            return (
              <li key={t.id} className="flex items-start gap-2">
                <button type="button" onClick={() => tick(t)} disabled={busyId === t.id} aria-label={w.markDone(t.title)}
                  className="w-3.5 h-3.5 mt-px rounded-full border border-stone-300 hover:border-green-600 flex-shrink-0 disabled:opacity-50" />
                <span className="min-w-0">
                  <Link to={href(t)} className="text-text hover:underline" dir="auto">{t.title}</Link>
                  {t.due_at && <span className={DUE_TONE[b] || 'text-text-tertiary'}> · {dueLabel(t, now, lang)}</span>}
                  <span className="text-text-tertiary"> · {t.assigned_to === me ? w.youLc : nameOf(people, t.assigned_to, w)}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {error && <p className="text-red-600" dir="auto">{error}</p>}
      {adding && (
        <Dialog title={w.addFollowTitle} onClose={() => setAdding(false)}>
          <p className="text-xs text-text-secondary -mt-1 mb-3" dir="auto">{w.forLead(lead.company || lead.name || lead.email || w.thisSender)}</p>
          <TaskForm
            initial={{ title: `${w.followUpPrefix}${lead.company || lead.name || lead.email || w.thisLead}`, assigned_to: lead.assigned_to || me }}
            people={people} me={me} submitLabel={w.addFollow} onSubmit={add} onCancel={() => setAdding(false)} />
        </Dialog>
      )}
    </div>
  )
}
