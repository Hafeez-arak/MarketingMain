// ─── Tasks: the reminder round ─────────────────────────────────────────────
// 2026-10-19, docs/TASKS-PLAN.md. The database writes the bell for what
// people do (assigning, finishing, commenting: 20261102_tasks.sql triggers).
// What depends on the clock is written here:
//
//   remind     the task's own reminder time has come
//   due_soon   the deadline is within a day
//   overdue    the deadline passed: the person doing it and the setter
//   digest     each person's morning (08:00 Riyadh): overdue, today, week,
//              in the bell and, where a company mailbox can send, by email
//
// Each timed reminder is sent once per deadline (tasks.reminded; the
// database clears it when the deadline moves). Run by the website Sheet's
// 5-minute call, the daily job, and the admin's "Run reminders now".
// The decisions are pure (src/lib/tasks/logic.js); this only reads and writes.
//
//   deps: db, now, sendAlert (optional)

import { remindersFor, digestFor, digestDue, isOpen } from '../../src/lib/tasks/logic.js'

const enc = encodeURIComponent
const DAY = 86_400_000

/** Missing tables (production before v2) read as "nothing to do". */
const isMissing = (err) => /does not exist|42P01|PGRST205|schema cache/i.test(String(err?.message || err))

export async function runTaskReminders(deps, { digest = true, workspaceId = null } = {}) {
  const now = deps.now()
  const soon = new Date(now.getTime() + DAY).toISOString()
  const ws = workspaceId ? `&workspace_id=eq.${workspaceId}` : ''
  let tasks
  try {
    // Open, assigned, and either due within a day (or past) or with a
    // reminder time that has come: the only ones a timed reminder can be for.
    tasks = await deps.db(`tasks?status=in.(todo,in_progress,waiting)&assigned_to=not.is.null${ws}` +
      `&or=(due_at.lte.${enc(soon)},remind_at.lte.${enc(now.toISOString())})` +
      '&select=id,workspace_id,title,status,assigned_to,created_by,due_at,remind_at,reminded,priority&limit=2000') || []
  } catch (err) {
    if (isMissing(err)) return { off: true }
    throw err
  }

  const people = await deps.db('user_access?select=user_id,email,full_name') || []
  const names = Object.fromEntries(people.map(p => [p.user_id, (p.full_name || '').trim() || String(p.email || '').split('@')[0]]))

  let sent = 0
  for (const t of tasks) {
    const items = remindersFor(t, now, names)
    if (!items.length) continue
    const rows = items.flatMap(i => i.to.map(u => ({
      user_id: u, workspace_id: t.workspace_id, kind: `task_${i.kind}`, title: i.title, body: '', link: `/tasks?id=${t.id}`,
    })))
    await deps.db('notifications', { method: 'POST', prefer: 'return=minimal', body: rows })
    const stamp = now.toISOString()
    const reminded = { ...(t.reminded || {}) }
    for (const i of items) reminded[i.kind] = stamp
    // Only `reminded` changes: the database keeps it unless the deadline moves.
    await deps.db(`tasks?id=eq.${t.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { reminded } })
    sent += rows.length
  }

  const digests = digest ? await runDigests(deps, { now, names, people, ws }) : { sent: 0 }
  return { checked: tasks.length, sent, digests }
}

/** The morning digest for everyone with open tasks, once a day from 08:00 Riyadh. */
async function runDigests(deps, { now, names, people, ws }) {
  if (!digestDue(now, null)) return { sent: 0, notYet: true }
  const open = (await deps.db(`tasks?status=in.(todo,in_progress,waiting)&assigned_to=not.is.null${ws}` +
    '&select=id,workspace_id,title,status,assigned_to,due_at,priority,created_at&limit=5000') || []).filter(isOpen)
  const last = await deps.db('task_digests?select=user_id,workspace_id,sent_at').catch(() => []) || []
  const lastOf = (u, w) => last.find(r => r.user_id === u && r.workspace_id === w)?.sent_at || null
  const emailOf = Object.fromEntries(people.map(p => [p.user_id, p.email]))

  const pairs = [...new Set(open.map(t => `${t.assigned_to}|${t.workspace_id}`))].map(k => k.split('|'))
  let sent = 0
  for (const [userId, workspaceId] of pairs) {
    if (!digestDue(now, lastOf(userId, workspaceId))) continue
    const d = digestFor(open.filter(t => t.workspace_id === workspaceId), userId, now)
    if (d) {
      await deps.db('notifications', {
        method: 'POST', prefer: 'return=minimal',
        body: { user_id: userId, workspace_id: workspaceId, kind: 'task_digest', title: d.title, body: d.text.slice(0, 1500), link: '/tasks' },
      })
      // By email too where the company has a mailbox that can send. A failed
      // email never stops the bell.
      if (deps.sendAlert && emailOf[userId]) {
        await deps.sendAlert({
          workspaceId, to: [emailOf[userId]], subject: d.title,
          text: `Good morning ${names[userId] || ''},\n\n${d.text}\n\nOpen your tasks: /tasks`,
        }).catch(() => null)
      }
      sent++
    }
    await deps.db('task_digests?on_conflict=user_id,workspace_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: { user_id: userId, workspace_id: workspaceId, sent_at: now.toISOString() },
    })
  }
  return { sent }
}
