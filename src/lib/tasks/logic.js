// ─── Tasks: the rules, without IO ──────────────────────────────────────────
// 2026-10-19, docs/TASKS-PLAN.md. Everything here is pure (rows in, answers
// out) so the deadlines, the reminder decisions and the morning digest are
// tested without a database. The screens (src/pages/tasks) and the server's
// reminder round (api/leads/_tasks.js) both read these.
//
// Times: deadlines are stored as timestamps; "today" and "this week" are
// Riyadh's (UTC+3, no daylight saving), because that is where the team is,
// whatever clock the server or a laptop runs on.

const HOUR = 3_600_000
const DAY = 24 * HOUR
const RIYADH = 3 * HOUR

export const STATUSES = ['todo', 'in_progress', 'waiting', 'done', 'cancelled']
export const OPEN = new Set(['todo', 'in_progress', 'waiting'])
export const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', waiting: 'Waiting', done: 'Done', cancelled: 'Dropped' }
export const PRIORITY_LABEL = { low: 'Low', normal: 'Normal', high: 'High' }

export const isOpen = t => OPEN.has(t?.status)
const ms = iso => { const v = Date.parse(iso || ''); return Number.isFinite(v) ? v : null }

/** Midnight in Riyadh at the start of the day containing `t` (ms), as UTC ms. */
const riyadhDayStart = t => Math.floor((t + RIYADH) / DAY) * DAY - RIYADH

// ── Where a task sits in "My tasks" ──

export const BUCKETS = ['overdue', 'today', 'week', 'later', 'none', 'done']
export const BUCKET_LABEL = { overdue: 'Overdue', today: 'Today', week: 'This week', later: 'Later', none: 'No deadline', done: 'Done' }

/** 'overdue' | 'today' | 'week' (next 7 days) | 'later' | 'none' | 'done'. */
export function bucketOf(task, now = new Date()) {
  if (!isOpen(task)) return 'done'
  const due = ms(task.due_at)
  if (due === null) return 'none'
  const n = now.getTime()
  if (due < n) return 'overdue'
  const todayEnd = riyadhDayStart(n) + DAY
  if (due < todayEnd) return 'today'
  if (due < todayEnd + 6 * DAY) return 'week'
  return 'later'
}

/** Tasks grouped by bucket, each group soonest first (no deadline: newest first). */
export function groupTasks(tasks = [], now = new Date()) {
  const out = Object.fromEntries(BUCKETS.map(b => [b, []]))
  for (const t of tasks) out[bucketOf(t, now)].push(t)
  const byDue = (a, b) => (ms(a.due_at) ?? Infinity) - (ms(b.due_at) ?? Infinity) || PRIO[b.priority] - PRIO[a.priority]
  for (const b of ['overdue', 'today', 'week', 'later']) out[b].sort(byDue)
  out.none.sort((a, b) => PRIO[b.priority] - PRIO[a.priority] || (ms(b.created_at) ?? 0) - (ms(a.created_at) ?? 0))
  out.done.sort((a, b) => (ms(b.completed_at) ?? 0) - (ms(a.completed_at) ?? 0))
  return out
}
const PRIO = { low: 0, normal: 1, high: 2 }

// ── The deadline, in words ──

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const riyadh = t => new Date(t + RIYADH) // read with getUTC*
const clock = d => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

/**
 * "Overdue by 2 days", "Today 15:00", "Tomorrow 09:00", "Thu 12:00",
 * "24 Oct". A deadline at 23:59 is "end of day" and shows no time.
 */
export function dueLabel(task, now = new Date()) {
  const due = ms(task?.due_at)
  if (due === null) return ''
  const n = now.getTime()
  const d = riyadh(due)
  const endOfDay = d.getUTCHours() === 23 && d.getUTCMinutes() === 59
  const at = endOfDay ? '' : ` ${clock(d)}`
  if (isOpen(task) && due < n) {
    const late = n - due
    if (late < HOUR) return 'Overdue'
    if (late < DAY) return `Overdue by ${Math.floor(late / HOUR)} h`
    const days = Math.floor(late / DAY)
    return `Overdue by ${days} day${days === 1 ? '' : 's'}`
  }
  const days = Math.round((riyadhDayStart(due) - riyadhDayStart(n)) / DAY)
  if (days === 0) return `Today${at}`
  if (days === 1) return `Tomorrow${at}`
  if (days > 1 && days < 7) return `${WEEKDAYS[d.getUTCDay()]}${at}`
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${at}`
}

/** A date input's value (YYYY-MM-DD) and a time (HH:MM) in Riyadh, to a stored timestamp. */
export function toDueAt(date, time = '') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null
  const [h, m] = /^\d{2}:\d{2}$/.test(time) ? time.split(':').map(Number) : [23, 59]
  const [y, mo, da] = date.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, da, h, m) - RIYADH).toISOString()
}

/** The other way: a stored timestamp to { date, time } in Riyadh ('' for end of day). */
export function fromDueAt(iso) {
  const t = ms(iso)
  if (t === null) return { date: '', time: '' }
  const d = riyadh(t)
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  const time = d.getUTCHours() === 23 && d.getUTCMinutes() === 59 ? '' : clock(d)
  return { date, time }
}

// ── Reminder choices on the form ──

export const REMINDER_CHOICES = [
  { key: '', label: 'Only the usual (a day before, and if late)' },
  { key: 'at_due', label: 'At the deadline' },
  { key: '1h', label: '1 hour before' },
  { key: '1d', label: '1 day before' },
]

/** remind_at for a choice and a deadline; null when there is no deadline or no extra reminder. */
export function remindAtFor(choice, dueAt) {
  const due = ms(dueAt)
  if (due === null || !choice) return null
  const back = { at_due: 0, '1h': HOUR, '1d': DAY }[choice]
  return back === undefined ? null : new Date(due - back).toISOString()
}

// ── The reminder round ──

/** How long before a deadline the person doing it is reminded. */
export const DUE_SOON_MS = DAY

/**
 * What the reminder round should send for one task now, given what it has
 * already sent for this deadline (task.reminded). Each item:
 *   { kind: 'remind' | 'due_soon' | 'overdue', to: [userId…], title, body }
 * Sent once each; the database clears task.reminded when the deadline or the
 * reminder time moves (tasks_stamp), which re-arms them.
 */
export function remindersFor(task, now = new Date(), names = {}) {
  if (!isOpen(task) || !task.assigned_to) return []
  const sent = task.reminded || {}
  const n = now.getTime()
  const due = ms(task.due_at)
  const remind = ms(task.remind_at)
  const out = []
  const when = due === null ? '' : ` (${dueLabel(task, now)})`
  if (remind !== null && remind <= n && !sent.remind) {
    out.push({ kind: 'remind', to: [task.assigned_to], title: `Reminder: ${task.title}${when}` })
  }
  // The person's own reminder, sent now or already, stands in for due-soon.
  const reminding = sent.remind || out.some(r => r.kind === 'remind')
  if (due !== null && due > n && due - n <= DUE_SOON_MS && !sent.due_soon && !reminding) {
    out.push({ kind: 'due_soon', to: [task.assigned_to], title: `Due soon: ${task.title}${when}` })
  }
  if (due !== null && due <= n && !sent.overdue) {
    const doer = names[task.assigned_to] || 'Someone'
    out.push({ kind: 'overdue', to: [task.assigned_to], title: `Overdue: ${task.title}${when}` })
    if (task.created_by && task.created_by !== task.assigned_to) {
      out.push({ kind: 'overdue', to: [task.created_by], title: `${doer}'s task is overdue: ${task.title}${when}` })
    }
  }
  return out
}

// ── The morning digest ──

/**
 * One person's morning: their open tasks that are overdue, due today and due
 * this week. null when there is nothing to say (no empty digests).
 */
export function digestFor(tasks = [], userId, now = new Date()) {
  const mine = tasks.filter(t => t.assigned_to === userId && isOpen(t))
  const g = groupTasks(mine, now)
  if (!g.overdue.length && !g.today.length && !g.week.length) return null
  const parts = [
    g.overdue.length && `${g.overdue.length} overdue`,
    g.today.length && `${g.today.length} due today`,
    g.week.length && `${g.week.length} this week`,
  ].filter(Boolean)
  const line = t => `• ${t.title} (${dueLabel(t, now)})`
  const lines = []
  if (g.overdue.length) lines.push('Overdue:', ...g.overdue.map(line), '')
  if (g.today.length) lines.push('Today:', ...g.today.map(line), '')
  if (g.week.length) lines.push('This week:', ...g.week.map(line))
  return {
    title: `Your tasks: ${parts.join(', ')}`,
    text: lines.join('\n').trim(),
    counts: { overdue: g.overdue.length, today: g.today.length, week: g.week.length },
  }
}

/** Is it digest time? Once a day, from 08:00 Riyadh; `last` is when it last went out. */
export function digestDue(now = new Date(), last = null) {
  const n = now.getTime()
  const start = riyadhDayStart(n)
  if (n < start + 8 * HOUR) return false
  const l = ms(last)
  return l === null || l < start + 8 * HOUR
}

// ── A team at a glance ──

/** One row per person: open, overdue, due this week, done in the last 7 days. */
export function teamSummary(tasks = [], people = [], now = new Date()) {
  const n = now.getTime()
  return people.map(p => {
    const mine = tasks.filter(t => t.assigned_to === p.user_id)
    const open = mine.filter(isOpen)
    return {
      userId: p.user_id, name: p.name, kind: p.kind,
      open: open.length,
      overdue: open.filter(t => bucketOf(t, now) === 'overdue').length,
      week: open.filter(t => ['today', 'week'].includes(bucketOf(t, now))).length,
      doneWeek: mine.filter(t => t.status === 'done' && (ms(t.completed_at) ?? 0) >= n - 7 * DAY).length,
    }
  }).sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name))
}

/** A meeting's progress: how many of its action items are done. */
export function meetingProgress(tasks = []) {
  const live = tasks.filter(t => t.status !== 'cancelled')
  return { done: live.filter(t => t.status === 'done').length, total: live.length }
}
