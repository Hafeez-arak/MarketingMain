import { useEffect, useState } from 'react'
import { Button, Spinner } from '../../components/ui/index'
import {
  groupTasks, dueLabel, bucketOf, BUCKET_LABEL, STATUS_LABEL, PRIORITY_LABEL, REMINDER_CHOICES,
  toDueAt, fromDueAt, remindAtFor, isOpen,
} from '../../lib/tasks/logic'
import { fetchTaskEvents, addComment } from '../../lib/tasks/client'
import { timeAgo } from '../../lib/utils'

// ─── Tasks: the pieces every view shares ───────────────────────────────────
// 2026-10-19, docs/TASKS-PLAN.md. The list (grouped by deadline), the form
// (new task, follow-up, edit) and the side panel (details, status, comments,
// history). Used by the Tasks page, a meeting's page, Home and the sales
// team's app, so a task looks and works the same everywhere.

const nameOf = (people, id) => people.find(p => p.user_id === id)?.name || (id ? 'someone who left' : 'nobody')

const DUE_TONE = {
  overdue: 'text-red-600 font-medium',
  today: 'text-text font-medium',
  week: 'text-text-secondary',
  later: 'text-text-tertiary',
  none: 'text-text-tertiary',
  done: 'text-text-tertiary',
}

/** A round tick box: finishes (or reopens) a task in one click. */
function Tick({ task, onToggle, busy }) {
  const done = task.status === 'done'
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onToggle(task) }} disabled={busy}
      aria-label={done ? `Reopen: ${task.title}` : `Mark done: ${task.title}`} aria-pressed={done}
      className={`w-[18px] h-[18px] mt-0.5 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors
        ${done ? 'bg-green-600 border-green-600 text-white' : 'border-stone-300 hover:border-green-600 text-transparent hover:text-green-600'}`}>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
    </button>
  )
}

/**
 * Tasks grouped Overdue / Today / This week / Later / No deadline / Done.
 * `showAssignee` for lists of other people's tasks; `showSetter` for one's own.
 */
export function TaskList({ tasks, people = [], now, onOpen, onToggle, showAssignee = false, showSetter = false, empty = 'Nothing here.', hideDone = false, busyId = '' }) {
  const g = groupTasks(tasks, now)
  const order = ['overdue', 'today', 'week', 'later', 'none', ...(hideDone ? [] : ['done'])]
  if (!order.some(b => g[b].length)) return <p className="text-sm text-text-tertiary px-1 py-6">{empty}</p>
  return (
    <div className="space-y-4">
      {order.filter(b => g[b].length).map(b => (
        <section key={b}>
          <h3 className={`text-xs font-semibold mb-1.5 ${b === 'overdue' ? 'text-red-600' : 'text-text-secondary'}`}>
            {BUCKET_LABEL[b]} <span className="font-normal text-text-tertiary">{g[b].length}</span>
          </h3>
          <ul className="bg-white border border-border divide-y divide-border">
            {g[b].map(t => (
              <li key={t.id}>
                <div role="button" tabIndex={0} onClick={() => onOpen(t)}
                  onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(t) } }}
                  className="flex items-start gap-3 px-3 py-2.5 hover:bg-stone-50 cursor-pointer focus:outline-none focus-visible:bg-stone-50">
                  <Tick task={t} onToggle={onToggle} busy={busyId === t.id} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${t.status === 'done' ? 'text-text-tertiary line-through' : 'text-text'}`} dir="auto">
                      {t.priority === 'high' && isOpen(t) && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 me-1.5 align-middle" title="High priority" />}
                      {t.title}
                    </p>
                    <p className="text-[11px] text-text-tertiary mt-0.5 flex flex-wrap gap-x-2">
                      {t.due_at && <span className={DUE_TONE[bucketOf(t, now)]}>{dueLabel(t, now)}</span>}
                      {showAssignee && <span>→ {nameOf(people, t.assigned_to)}</span>}
                      {showSetter && t.created_by && t.created_by !== t.assigned_to && <span>from {nameOf(people, t.created_by)}</span>}
                      {t.status === 'in_progress' && <span>In progress</span>}
                      {t.status === 'waiting' && <span>Waiting</span>}
                      {t.meeting_id && <span>Meeting</span>}
                      {t.lead_id && <span>Lead follow-up</span>}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/**
 * The fields of a task. `initial` fills them (a follow-up, an edit); the
 * reminder is a choice relative to the deadline.
 */
export function TaskForm({ initial = {}, people = [], me, submitLabel = 'Add task', onSubmit, onCancel, compact = false }) {
  const start = fromDueAt(initial.due_at)
  const [f, setF] = useState({
    title: initial.title || '', details: initial.details || '',
    assigned_to: initial.assigned_to || me || '', date: start.date, time: start.time,
    reminder: '', priority: initial.priority || 'normal',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const field = 'w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-200'

  async function submit(e) {
    e.preventDefault()
    if (!f.title.trim()) { setError('Give the task a title.'); return }
    const due_at = toDueAt(f.date, f.time)
    setBusy(true); setError('')
    const out = await onSubmit({
      title: f.title.trim(), details: f.details, assigned_to: f.assigned_to || me, priority: f.priority,
      due_at, remind_at: remindAtFor(f.reminder, due_at),
    })
    setBusy(false)
    if (out?.error) setError(out.error)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input autoFocus value={f.title} onChange={e => set('title', e.target.value)} placeholder="What needs doing?" className={`${field} text-[15px] font-medium`} aria-label="Task" dir="auto" />
      {!compact && <textarea value={f.details} onChange={e => set('details', e.target.value)} rows={3} placeholder="Details (optional)" className={field} aria-label="Details" dir="auto" />}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="col-span-2 sm:col-span-1"><span className="text-[11px] text-text-secondary">Who</span>
          <select value={f.assigned_to} onChange={e => set('assigned_to', e.target.value)} className={field}>
            {people.map(p => <option key={p.user_id} value={p.user_id}>{p.user_id === me ? `${p.name} (me)` : p.name}</option>)}
          </select>
        </label>
        <label><span className="text-[11px] text-text-secondary">Deadline</span>
          <input type="date" value={f.date} onChange={e => set('date', e.target.value)} className={field} />
        </label>
        <label><span className="text-[11px] text-text-secondary">Time (optional)</span>
          <input type="time" value={f.time} onChange={e => set('time', e.target.value)} className={field} disabled={!f.date} />
        </label>
        <label className="col-span-2 sm:col-span-1"><span className="text-[11px] text-text-secondary">Priority</span>
          <select value={f.priority} onChange={e => set('priority', e.target.value)} className={field}>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      {f.date && (
        <label className="block"><span className="text-[11px] text-text-secondary">Reminder</span>
          <select value={f.reminder} onChange={e => set('reminder', e.target.value)} className={field}>
            {REMINDER_CHOICES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
      )}
      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? <Spinner size="sm" /> : null}{submitLabel}</Button>
        {onCancel && <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  )
}

const EVENT_WORDS = {
  created: 'set this task',
  assigned: 'gave it to',
  status: 'moved it',
  due: 'set the deadline to',
  edited: 'edited it',
}

/**
 * One task, opened: change its status, edit it, comment, see its history,
 * add a follow-up. Changes go through `onUpdate`, which returns the saved row.
 */
/** `leadHref(task)`: where "Open the lead" goes, which differs by app (sales or marketing shell). */
export function TaskPanel({ task, people = [], me, now, canEdit, canDelete, onUpdate, onDelete, onFollowUp, onClose, leadHref = null }) {
  const [editing, setEditing] = useState(false)
  const [events, setEvents] = useState(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const loadEvents = () => fetchTaskEvents(task.id).then(out => setEvents(out.events))
  useEffect(() => {
    let cancelled = false
    fetchTaskEvents(task.id).then(out => { if (!cancelled) setEvents(out.events) })
    return () => { cancelled = true }
  }, [task.id, task.updated_at])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function act(key, fn) {
    setBusy(key); setError('')
    const out = await fn()
    setBusy('')
    if (out?.error) setError(out.error)
    return out
  }

  async function send(e) {
    e.preventDefault()
    const out = await act('comment', () => addComment(task.workspace_id, me, task.id, comment))
    if (!out?.error) { setComment(''); loadEvents() }
  }

  const mineToMove = task.assigned_to === me || canEdit

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={task.title}>
      <div className="absolute inset-0 bg-black/20" onClick={onClose} aria-hidden="true" />
      <aside className="relative w-full max-w-lg h-full bg-white border-l border-border shadow-dropdown flex flex-col animate-fade-scale">
        <header className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-text-tertiary">
              From {nameOf(people, task.created_by)} → {nameOf(people, task.assigned_to)}
              {task.due_at && <> · <span className={DUE_TONE[bucketOf(task, now)]}>{dueLabel(task, now)}</span></>}
            </p>
            <h2 className={`text-base font-semibold mt-1 leading-snug ${task.status === 'done' ? 'line-through text-text-tertiary' : 'text-text'}`} dir="auto">{task.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-md flex items-center justify-center text-text-tertiary hover:bg-stone-100 hover:text-text">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-5">
          {mineToMove && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
              {['todo', 'in_progress', 'waiting', 'done'].map(s => (
                <button key={s} type="button" disabled={Boolean(busy)} aria-pressed={task.status === s}
                  onClick={() => act(`status:${s}`, () => onUpdate({ status: s }))}
                  className={`rounded-md border px-2.5 py-1 text-xs ${task.status === s ? (s === 'done' ? 'bg-green-600 border-green-600 text-white' : 'bg-stone-900 border-stone-900 text-white') : 'bg-white border-border text-text-secondary hover:bg-stone-50'}`}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
              {canEdit && task.status !== 'cancelled' && (
                <button type="button" onClick={() => act('status:cancelled', () => onUpdate({ status: 'cancelled' }))} disabled={Boolean(busy)}
                  className="rounded-md px-2.5 py-1 text-xs text-text-tertiary hover:text-red-600">Drop</button>
              )}
            </div>
          )}

          {editing ? (
            <TaskForm initial={task} people={people} me={me} submitLabel="Save"
              onCancel={() => setEditing(false)}
              onSubmit={async fields => { const out = await onUpdate(fields); if (!out?.error) setEditing(false); return out }} />
          ) : (
            <div className="space-y-2">
              {task.details ? <p className="text-sm text-text whitespace-pre-wrap leading-relaxed" dir="auto">{task.details}</p> : <p className="text-sm text-text-tertiary">No details.</p>}
              <p className="text-[11px] text-text-tertiary">Priority: {PRIORITY_LABEL[task.priority]}{task.remind_at ? ` · Reminder ${dueLabel({ ...task, due_at: task.remind_at, status: 'todo' }, now)}` : ''}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {canEdit && <Button size="xs" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
                <Button size="xs" variant="secondary" onClick={() => onFollowUp(task)}>Add a follow-up</Button>
                {task.lead_id && leadHref && <a href={leadHref(task)} className="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-[11px] text-text hover:bg-stone-50">Open the lead</a>}
                {canDelete && <Button size="xs" variant="ghost" onClick={() => { if (window.confirm('Delete this task?')) onDelete(task) }}>Delete</Button>}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}

          <section>
            <h3 className="text-xs font-semibold text-text-secondary mb-2">Comments and history</h3>
            {events === null ? <Spinner size="sm" /> : (
              <ol className="space-y-2.5">
                {events.map(ev => (
                  <li key={ev.id} className="text-xs">
                    {ev.kind === 'comment' ? (
                      <div className="bg-stone-50 border border-border px-3 py-2">
                        <p className="text-[11px] text-text-tertiary">{nameOf(people, ev.actor)} · {timeAgo(ev.created_at)}</p>
                        <p className="text-sm text-text mt-0.5 whitespace-pre-wrap" dir="auto">{ev.body}</p>
                      </div>
                    ) : (
                      <p className="text-text-tertiary">
                        <span className="text-text-secondary font-medium">{nameOf(people, ev.actor)}</span>{' '}
                        {EVENT_WORDS[ev.kind]}
                        {ev.kind === 'status' && ` to ${STATUS_LABEL[ev.to_status] || ev.to_status}`}
                        {(ev.kind === 'assigned' || ev.kind === 'due') && ` ${ev.body}`}
                        {' · '}{timeAgo(ev.created_at)}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <form onSubmit={send} className="mt-3 flex gap-2 items-end">
              <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Write a comment…" aria-label="Comment" dir="auto"
                className="flex-1 rounded-md border border-border bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-200" />
              <Button type="submit" size="sm" disabled={busy === 'comment' || !comment.trim()}>Send</Button>
            </form>
          </section>
        </div>
      </aside>
    </div>
  )
}

/** A centred dialog holding a form: New task, a follow-up. */
export function Dialog({ title, onClose, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-xl bg-white border border-border rounded-xl shadow-dropdown p-5 animate-fade-scale">
        <h2 className="text-sm font-semibold text-text mb-3">{title}</h2>
        {children}
      </div>
    </div>
  )
}
