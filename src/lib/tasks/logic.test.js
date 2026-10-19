import { describe, it, expect } from 'vitest'
import {
  bucketOf, groupTasks, dueLabel, toDueAt, fromDueAt, remindAtFor, remindersFor, digestFor, digestDue,
  teamSummary, meetingProgress,
} from './logic.js'

// 10:00 Riyadh on Mon 19 Oct 2026 (07:00 UTC).
const NOW = new Date('2026-10-19T07:00:00Z')
const at = (riyadhIso) => new Date(new Date(`${riyadhIso}Z`).getTime() - 3 * 3_600_000).toISOString()
const task = (o = {}) => ({ id: Math.random().toString(36).slice(2), title: 'Send the quote', status: 'todo', priority: 'normal', assigned_to: 'u-omar', created_by: 'u-sami', ...o })

describe('deadlines in Riyadh', () => {
  it('buckets by Riyadh day', () => {
    expect(bucketOf(task({ due_at: at('2026-10-19T09:00') }), NOW)).toBe('overdue')
    expect(bucketOf(task({ due_at: at('2026-10-19T23:59') }), NOW)).toBe('today')
    expect(bucketOf(task({ due_at: at('2026-10-20T00:30') }), NOW)).toBe('week')
    expect(bucketOf(task({ due_at: at('2026-10-25T23:59') }), NOW)).toBe('week')
    expect(bucketOf(task({ due_at: at('2026-10-26T09:00') }), NOW)).toBe('later')
    expect(bucketOf(task({}), NOW)).toBe('none')
    expect(bucketOf(task({ status: 'done', due_at: at('2026-10-10T09:00') }), NOW)).toBe('done')
  })

  it('says the deadline in words', () => {
    expect(dueLabel(task({ due_at: at('2026-10-19T15:00') }), NOW)).toBe('Today 15:00')
    expect(dueLabel(task({ due_at: at('2026-10-20T09:00') }), NOW)).toBe('Tomorrow 09:00')
    expect(dueLabel(task({ due_at: at('2026-10-22T23:59') }), NOW)).toBe('Thu')
    expect(dueLabel(task({ due_at: at('2026-11-02T12:00') }), NOW)).toBe('2 Nov 12:00')
    expect(dueLabel(task({ due_at: at('2026-10-19T07:00') }), NOW)).toBe('Overdue by 3 h')
    expect(dueLabel(task({ due_at: at('2026-10-16T09:00') }), NOW)).toBe('Overdue by 3 days')
  })

  it('converts the form\'s date and time both ways, end of day when no time', () => {
    expect(toDueAt('2026-10-22', '14:30')).toBe('2026-10-22T11:30:00.000Z')
    expect(toDueAt('2026-10-22')).toBe('2026-10-22T20:59:00.000Z')
    expect(toDueAt('22/10/2026')).toBeNull()
    expect(fromDueAt('2026-10-22T11:30:00.000Z')).toEqual({ date: '2026-10-22', time: '14:30' })
    expect(fromDueAt('2026-10-22T20:59:00.000Z')).toEqual({ date: '2026-10-22', time: '' })
  })

  it('groups soonest first, high priority first within a time', () => {
    const g = groupTasks([
      task({ id: 'b', due_at: at('2026-10-19T18:00') }),
      task({ id: 'a', due_at: at('2026-10-19T12:00') }),
      task({ id: 'n1', priority: 'low' }), task({ id: 'n2', priority: 'high' }),
    ], NOW)
    expect(g.today.map(t => t.id)).toEqual(['a', 'b'])
    expect(g.none.map(t => t.id)).toEqual(['n2', 'n1'])
  })
})

describe('reminders', () => {
  it('reminder choices count back from the deadline', () => {
    const due = at('2026-10-22T14:00')
    expect(remindAtFor('1h', due)).toBe(at('2026-10-22T13:00'))
    expect(remindAtFor('1d', due)).toBe(at('2026-10-21T14:00'))
    expect(remindAtFor('at_due', due)).toBe(due)
    expect(remindAtFor('', due)).toBeNull()
    expect(remindAtFor('1h', null)).toBeNull()
  })

  it('due soon within a day, once', () => {
    const t = task({ due_at: at('2026-10-20T09:00') })
    expect(remindersFor(t, NOW).map(r => r.kind)).toEqual(['due_soon'])
    expect(remindersFor({ ...t, reminded: { due_soon: NOW.toISOString() } }, NOW)).toEqual([])
    expect(remindersFor(task({ due_at: at('2026-10-21T09:00') }), NOW)).toEqual([])
  })

  it('overdue tells the person doing it and the person who set it, once', () => {
    const t = task({ due_at: at('2026-10-19T09:00') })
    const r = remindersFor(t, NOW, { 'u-omar': 'Omar' })
    expect(r.map(x => [x.kind, x.to[0]])).toEqual([['overdue', 'u-omar'], ['overdue', 'u-sami']])
    expect(r[1].title).toMatch(/^Omar's task is overdue/)
    expect(remindersFor({ ...t, reminded: { overdue: 'x' } }, NOW)).toEqual([])
    expect(remindersFor({ ...t, created_by: 'u-omar' }, NOW)).toHaveLength(1)
  })

  it('an explicit reminder fires at its time and stands in for due-soon', () => {
    const t = task({ due_at: at('2026-10-19T18:00'), remind_at: at('2026-10-19T09:30') })
    expect(remindersFor(t, NOW).map(r => r.kind)).toEqual(['remind'])
    expect(remindersFor({ ...t, reminded: { remind: 'x' } }, NOW)).toEqual([])
    expect(remindersFor(task({ due_at: at('2026-10-19T18:00'), remind_at: at('2026-10-19T17:00') }), NOW).map(r => r.kind)).toEqual(['due_soon'])
  })

  it('nothing for finished or unassigned tasks', () => {
    expect(remindersFor(task({ status: 'done', due_at: at('2026-10-18T09:00') }), NOW)).toEqual([])
    expect(remindersFor(task({ assigned_to: null, due_at: at('2026-10-18T09:00') }), NOW)).toEqual([])
  })
})

describe('the morning digest', () => {
  it('only the person\'s open tasks, and nothing when there is nothing to say', () => {
    const tasks = [
      task({ due_at: at('2026-10-18T09:00'), title: 'Late one' }),
      task({ due_at: at('2026-10-19T16:00'), title: 'Today one' }),
      task({ due_at: at('2026-10-23T16:00'), title: 'Week one' }),
      task({ due_at: at('2026-10-19T16:00'), assigned_to: 'u-lina' }),
      task({ due_at: at('2026-10-19T16:00'), status: 'done' }),
    ]
    const d = digestFor(tasks, 'u-omar', NOW)
    expect(d.title).toBe('Your tasks: 1 overdue, 1 due today, 1 this week')
    expect(d.text).toContain('• Late one (Overdue by 1 day)')
    expect(digestFor(tasks, 'u-nobody', NOW)).toBeNull()
  })

  it('goes out once a day from 08:00 Riyadh', () => {
    expect(digestDue(new Date('2026-10-19T04:30:00Z'), null)).toBe(false) // 07:30
    expect(digestDue(NOW, null)).toBe(true)
    expect(digestDue(NOW, '2026-10-19T05:10:00Z')).toBe(false) // sent 08:10 today
    expect(digestDue(NOW, '2026-10-18T05:10:00Z')).toBe(true)
  })
})

describe('team and meetings', () => {
  it('summarises per person, the most overdue first', () => {
    const rows = teamSummary([
      task({ due_at: at('2026-10-18T09:00') }),
      task({ assigned_to: 'u-lina', due_at: at('2026-10-20T09:00') }),
      task({ assigned_to: 'u-lina', status: 'done', completed_at: at('2026-10-18T09:00') }),
    ], [{ user_id: 'u-lina', name: 'Lina' }, { user_id: 'u-omar', name: 'Omar' }], NOW)
    expect(rows[0]).toMatchObject({ name: 'Omar', open: 1, overdue: 1 })
    expect(rows[1]).toMatchObject({ name: 'Lina', open: 1, week: 1, doneWeek: 1 })
  })

  it('counts a meeting\'s action items, ignoring dropped ones', () => {
    expect(meetingProgress([task({ status: 'done' }), task(), task({ status: 'cancelled' })])).toEqual({ done: 1, total: 2 })
  })
})
