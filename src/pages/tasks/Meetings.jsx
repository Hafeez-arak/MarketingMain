import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Skeleton, Spinner } from '../../components/ui/index'
import { fetchMeetings, fetchMeeting, saveMeeting, fetchTasks, createTask, updateTask } from '../../lib/tasks/client'
import { meetingProgress, toDueAt } from '../../lib/tasks/logic'
import { TaskList, TaskForm, Dialog } from './parts'

// ─── Meetings: what was agreed, and who does it ────────────────────────────
// 2026-10-19, docs/TASKS-PLAN.md, step 1 of the flow: write the meeting
// down, type each action item as it is agreed (what, who, by when), and
// saving gives everyone their tasks. A meeting's page then shows where each
// item stands, ready for the next meeting.

const SECTIONS = [['', 'No section'], ['sales', 'Sales'], ['marketing', 'Marketing'], ['ceo', 'Management'], ['insights', 'Insights']]
const field = 'w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-200'
const today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)
const shortDate = iso => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export function Meetings({ people, onOpenTask }) {
  const { activeWorkspaceId: ws } = useAuth()
  const [params, setParams] = useSearchParams()
  const openId = params.get('meeting') || ''
  const [meetings, setMeetings] = useState(null)
  const [progress, setProgress] = useState({})
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!ws) return
    const [m, t] = await Promise.all([fetchMeetings(ws), fetchTasks(ws, { view: 'team' })])
    setMeetings(m.meetings)
    setError(m.error || '')
    const by = {}
    for (const task of t.rows) if (task.meeting_id) (by[task.meeting_id] ||= []).push(task)
    setProgress(Object.fromEntries(Object.entries(by).map(([k, v]) => [k, meetingProgress(v)])))
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])

  const open = id => setParams(p => { const n = new URLSearchParams(p); if (id) n.set('meeting', id); else n.delete('meeting'); return n }, { replace: true })

  if (openId) return <MeetingView id={openId} people={people} onBack={() => { open(''); load() }} onOpenTask={onOpenTask} />
  if (writing) return <NewMeeting people={people} onCancel={() => setWriting(false)} onSaved={m => { setWriting(false); load(); open(m.id) }} />

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-secondary">Write a meeting down and type its action items as they are agreed; saving gives everyone their tasks.</p>
        <Button size="sm" onClick={() => setWriting(true)}>+ New meeting</Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {meetings === null ? <Skeleton className="h-32" /> : meetings.length === 0 ? (
        <p className="text-sm text-text-tertiary py-6">No meetings yet.</p>
      ) : (
        <ul className="bg-white border border-border divide-y divide-border">
          {meetings.map(m => {
            const p = progress[m.id] || { done: 0, total: 0 }
            return (
              <li key={m.id}>
                <button type="button" onClick={() => open(m.id)} className="w-full text-start flex items-center gap-3 px-3 py-2.5 hover:bg-stone-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text truncate" dir="auto">{m.title}</p>
                    <p className="text-[11px] text-text-tertiary">{shortDate(m.held_at)} · {m.attendees.length} people</p>
                  </div>
                  <span className={`text-xs tabular-nums ${p.total && p.done === p.total ? 'text-green-700' : 'text-text-secondary'}`}>
                    {p.total ? `${p.done} of ${p.total} done` : 'No action items'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** The meeting form: details, who was there, notes, and the action items. */
function NewMeeting({ people, onCancel, onSaved }) {
  const { activeWorkspaceId: ws, user } = useAuth()
  const me = user?.id || ''
  const [m, setM] = useState({ title: '', date: today(), section: 'sales', attendees: [me], notes: '' })
  const blank = () => ({ title: '', assigned_to: '', date: '', time: '' })
  const [items, setItems] = useState([blank(), blank(), blank()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setM(x => ({ ...x, [k]: v }))
  const setItem = (i, k, v) => setItems(xs => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const toggleAttendee = id => set('attendees', m.attendees.includes(id) ? m.attendees.filter(a => a !== id) : [...m.attendees, id])

  async function save(e) {
    e.preventDefault()
    if (!m.title.trim()) { setError('Give the meeting a title.'); return }
    const missing = items.find(it => it.title.trim() && !it.assigned_to)
    if (missing) { setError(`Who does "${missing.title}"?`); return }
    setBusy(true); setError('')
    const out = await saveMeeting(ws, me,
      { title: m.title, held_at: toDueAt(m.date, '12:00'), section: m.section, attendees: m.attendees, notes: m.notes },
      items.map(it => ({ title: it.title, assigned_to: it.assigned_to, due_at: toDueAt(it.date, it.time) })))
    setBusy(false)
    if (out.error) { setError(out.error); return }
    if (out.failed?.length) { setError(`Saved, but some action items did not: ${out.failed.join('; ')}`); return }
    onSaved(out.meeting)
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="bg-white border border-border p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
          <label><span className="text-[11px] text-text-secondary">Meeting</span>
            <input autoFocus value={m.title} onChange={e => set('title', e.target.value)} placeholder="Weekly sales meeting" className={field} dir="auto" /></label>
          <label><span className="text-[11px] text-text-secondary">Date</span>
            <input type="date" value={m.date} onChange={e => set('date', e.target.value)} className={field} /></label>
          <label><span className="text-[11px] text-text-secondary">Section</span>
            <select value={m.section} onChange={e => set('section', e.target.value)} className={field}>
              {SECTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
        </div>
        <fieldset>
          <legend className="text-[11px] text-text-secondary mb-1">Who was there</legend>
          <div className="flex flex-wrap gap-1.5">
            {people.map(p => (
              <label key={p.user_id} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs cursor-pointer ${m.attendees.includes(p.user_id) ? 'bg-stone-900 border-stone-900 text-white' : 'bg-white border-border text-text-secondary'}`}>
                <input type="checkbox" className="sr-only" checked={m.attendees.includes(p.user_id)} onChange={() => toggleAttendee(p.user_id)} />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block"><span className="text-[11px] text-text-secondary">Notes</span>
          <textarea value={m.notes} onChange={e => set('notes', e.target.value)} rows={4} placeholder="What was discussed and decided" className={field} dir="auto" /></label>
      </div>

      <div className="bg-white border border-border p-4 space-y-2">
        <h3 className="text-sm font-semibold text-text">Action items</h3>
        <p className="text-[11px] text-text-tertiary">One per line: what, who, by when. Each becomes a task for that person, and they are told at once.</p>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_10rem_9rem_6rem_auto] gap-2 items-end">
            <input value={it.title} onChange={e => setItem(i, 'title', e.target.value)} placeholder={`Action item ${i + 1}`} className={`${field} col-span-2 sm:col-span-1`} aria-label={`Action item ${i + 1}`} dir="auto" />
            <select value={it.assigned_to} onChange={e => setItem(i, 'assigned_to', e.target.value)} className={field} aria-label="Who">
              <option value="">Who?</option>
              {people.map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
            </select>
            <input type="date" value={it.date} onChange={e => setItem(i, 'date', e.target.value)} className={field} aria-label="Deadline" />
            <input type="time" value={it.time} onChange={e => setItem(i, 'time', e.target.value)} className={field} aria-label="Time" disabled={!it.date} />
            <button type="button" onClick={() => setItems(xs => xs.filter((_, j) => j !== i))} className="text-xs text-text-tertiary hover:text-red-600 py-1.5" aria-label="Remove">✕</button>
          </div>
        ))}
        <Button type="button" size="xs" variant="secondary" onClick={() => setItems(xs => [...xs, blank()])}>+ Another item</Button>
      </div>

      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy}>{busy ? <Spinner size="sm" /> : null}Save meeting and assign</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

/** One meeting: its notes, who was there, and where each action item stands. */
function MeetingView({ id, people, onBack, onOpenTask }) {
  const { activeWorkspaceId: ws, user } = useAuth()
  const me = user?.id || ''
  const [meeting, setMeeting] = useState(undefined)
  const [tasks, setTasks] = useState(null)
  const [adding, setAdding] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(async () => {
    const [m, t] = await Promise.all([fetchMeeting(ws, id), fetchTasks(ws, { view: 'meeting', meetingId: id })])
    setMeeting(m.meeting || null)
    setTasks(t.rows)
    setNow(new Date())
  }, [ws, id])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (meeting === undefined) return <Skeleton className="h-48" />
  if (!meeting) return <p className="text-sm text-text-tertiary">That meeting is not there any more. <button type="button" className="underline" onClick={onBack}>Back</button></p>
  const p = meetingProgress(tasks || [])
  const name = uid => people.find(x => x.user_id === uid)?.name || 'someone'

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-xs text-text-secondary hover:text-text">← All meetings</button>
      <div className="bg-white border border-border p-4">
        <h2 className="text-base font-semibold text-text" dir="auto">{meeting.title}</h2>
        <p className="text-[11px] text-text-tertiary mt-1">{shortDate(meeting.held_at)} · {meeting.attendees.map(name).join(', ') || 'nobody listed'}</p>
        {meeting.notes && <p className="text-sm text-text mt-3 whitespace-pre-wrap leading-relaxed" dir="auto">{meeting.notes}</p>}
      </div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Action items <span className="font-normal text-text-tertiary">{p.done} of {p.total} done</span></h3>
        <Button size="xs" variant="secondary" onClick={() => setAdding(true)}>+ Add an item</Button>
      </div>
      {tasks === null ? <Skeleton className="h-24" /> : (
        <TaskList tasks={tasks} people={people} now={now} showAssignee onOpen={onOpenTask}
          onToggle={async t => { const out = await updateTask(ws, me, t.id, { status: t.status === 'done' ? 'todo' : 'done' }); if (!out.error) load() }}
          empty="No action items." />
      )}
      {adding && (
        <Dialog title="Add an action item" onClose={() => setAdding(false)}>
          <TaskForm people={people} me={me} compact submitLabel="Add"
            onCancel={() => setAdding(false)}
            onSubmit={async f => { const out = await createTask(ws, me, { ...f, meeting_id: id, section: meeting.section }); if (!out.error) { setAdding(false); load() } return out }} />
        </Dialog>
      )}
    </div>
  )
}
