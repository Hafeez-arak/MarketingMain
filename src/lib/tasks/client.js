import { supabase } from '../supabaseClient'
import { getLang } from '../i18n'

// ─── Tasks: the browser's reads and writes ─────────────────────────────────
// 2026-10-19, docs/TASKS-PLAN.md. Straight to the database with the person's
// own login: its rules (20261102_tasks.sql) decide who sees and changes
// what, and its triggers write the history and the bell. Every query names
// its company: RLS is membership, not isolation.

const TASK_COLS = 'id,workspace_id,title,details,assigned_to,created_by,due_at,remind_at,priority,status,section,meeting_id,lead_id,account_id,follow_up_of,completed_at,created_at,updated_at'

const fail = error => ({ error: error?.message || (getLang() === 'ar' ? 'لم ينجح ذلك. حاول مجددًا.' : 'It did not work. Try again.') })

/**
 * Tasks for one view:
 *   mine      given to me (open, and done in the last 14 days)
 *   assigned  that I set for someone else
 *   team      everything I may see (managers and the admin see their sections')
 *   meeting   one meeting's action items
 *   lead      one lead's follow-ups
 */
export async function fetchTasks(ws, { view = 'mine', me = '', meetingId = '', leadId = '' } = {}) {
  if (!ws) return { rows: [] }
  let q = supabase.from('tasks').select(TASK_COLS).eq('workspace_id', ws)
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  if (view === 'mine') q = q.eq('assigned_to', me).or(`status.in.(todo,in_progress,waiting),completed_at.gte.${since}`)
  else if (view === 'assigned') q = q.eq('created_by', me).neq('assigned_to', me).or(`status.in.(todo,in_progress,waiting),completed_at.gte.${since}`)
  else if (view === 'meeting') q = q.eq('meeting_id', meetingId)
  else if (view === 'lead') q = q.eq('lead_id', leadId)
  else q = q.or(`status.in.(todo,in_progress,waiting),completed_at.gte.${since}`)
  const { data, error } = await q.order('due_at', { ascending: true, nullsFirst: false }).limit(1000)
  return error ? { rows: [], ...fail(error) } : { rows: data || [] }
}

export async function fetchTask(ws, id) {
  const { data, error } = await supabase.from('tasks').select(TASK_COLS).eq('workspace_id', ws).eq('id', id).maybeSingle()
  return error ? fail(error) : { task: data }
}

/** Everyone a task can be given to here: [{ user_id, name, kind }]. */
export async function fetchTaskPeople(ws) {
  const { data, error } = await supabase.rpc('task_people', { ws })
  return error ? { people: [], ...fail(error) } : { people: data || [] }
}

/** A new task, set by me. Returns the saved row. */
export async function createTask(ws, me, fields) {
  const row = {
    workspace_id: ws, created_by: me, updated_by: me,
    title: String(fields.title || '').trim(),
    details: fields.details || '',
    assigned_to: fields.assigned_to || me,
    due_at: fields.due_at || null,
    remind_at: fields.remind_at || null,
    priority: fields.priority || 'normal',
    section: fields.section || null,
    meeting_id: fields.meeting_id || null,
    lead_id: fields.lead_id || null,
    account_id: fields.account_id || null,
    follow_up_of: fields.follow_up_of || null,
  }
  if (!row.title) return { error: 'Give the task a title.' }
  const { data, error } = await supabase.from('tasks').insert(row).select(TASK_COLS).single()
  return error ? fail(error) : { task: data }
}

/** Change a task. `updated_by` says who, for the history and the bell. */
export async function updateTask(ws, me, id, patch) {
  const { data, error } = await supabase.from('tasks').update({ ...patch, updated_by: me })
    .eq('workspace_id', ws).eq('id', id).select(TASK_COLS).maybeSingle()
  if (error) return fail(error)
  return data ? { task: data } : { error: 'That task could not be changed. It may not be yours to change.' }
}

export async function deleteTask(ws, id) {
  const { error } = await supabase.from('tasks').delete().eq('workspace_id', ws).eq('id', id)
  return error ? fail(error) : {}
}

/** History and comments, oldest first. */
export async function fetchTaskEvents(id) {
  const { data, error } = await supabase.from('task_events').select('id,actor,kind,body,from_status,to_status,created_at')
    .eq('task_id', id).order('created_at')
  return error ? { events: [], ...fail(error) } : { events: data || [] }
}

export async function addComment(ws, me, taskId, body) {
  const text = String(body || '').trim()
  if (!text) return { error: 'Write something first.' }
  const { error } = await supabase.from('task_events').insert({ task_id: taskId, workspace_id: ws, actor: me, kind: 'comment', body: text })
  return error ? fail(error) : {}
}

// ── Meetings ──

const MEETING_COLS = 'id,workspace_id,title,held_at,section,attendees,notes,created_by,created_at'

export async function fetchMeetings(ws) {
  const { data, error } = await supabase.from('meetings').select(MEETING_COLS).eq('workspace_id', ws).order('held_at', { ascending: false }).limit(200)
  return error ? { meetings: [], ...fail(error) } : { meetings: data || [] }
}

export async function fetchMeeting(ws, id) {
  const { data, error } = await supabase.from('meetings').select(MEETING_COLS).eq('workspace_id', ws).eq('id', id).maybeSingle()
  return error ? fail(error) : { meeting: data }
}

/**
 * A meeting and its action items in one go: the meeting first, then each
 * item as a task set by me. Items that fail are reported, not lost silently.
 */
export async function saveMeeting(ws, me, { title, held_at, section, attendees = [], notes = '' }, items = []) {
  const { data: meeting, error } = await supabase.from('meetings')
    .insert({ workspace_id: ws, created_by: me, title: String(title || '').trim(), held_at: held_at || new Date().toISOString(), section: section || null, attendees, notes })
    .select(MEETING_COLS).single()
  if (error) return fail(error)
  const failed = []
  for (const it of items.filter(i => String(i.title || '').trim())) {
    const out = await createTask(ws, me, { ...it, meeting_id: meeting.id, section: it.section || section || null })
    if (out.error) failed.push(`${it.title}: ${out.error}`)
  }
  return { meeting, failed }
}

export async function updateMeeting(ws, id, patch) {
  const { data, error } = await supabase.from('meetings').update(patch).eq('workspace_id', ws).eq('id', id).select(MEETING_COLS).maybeSingle()
  return error ? fail(error) : { meeting: data }
}
