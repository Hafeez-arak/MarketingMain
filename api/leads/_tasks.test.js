import { describe, it, expect } from 'vitest'
import { runTaskReminders } from './_tasks.js'

// The reminder round against a fake PostgREST: which notifications it writes,
// that it records them on the task, and that the digest goes out once.

const NOW = new Date('2026-10-19T07:00:00Z') // 10:00 Riyadh
const W = 'ws-1'

function world(tasks) {
  const state = { tasks: tasks.map(t => ({ workspace_id: W, status: 'todo', reminded: {}, ...t })), notes: [], digests: [], mails: [] }
  const db = async (path, { method = 'GET', body } = {}) => {
    const table = path.split('?')[0]
    if (table === 'tasks' && method === 'GET') return state.tasks.map(t => ({ ...t }))
    if (table === 'tasks' && method === 'PATCH') {
      const id = /id=eq\.([^&]+)/.exec(path)[1]
      Object.assign(state.tasks.find(t => t.id === id), body)
      return null
    }
    if (table === 'user_access') return [{ user_id: 'omar', email: 'omar@example.com', full_name: 'Omar' }, { user_id: 'sami', email: 'sami@example.com', full_name: 'Sami' }]
    if (table === 'notifications') { state.notes.push(...[].concat(body)); return null }
    if (table === 'task_digests' && method === 'GET') return state.digests
    if (table === 'task_digests') { state.digests = state.digests.filter(d => d.user_id !== body.user_id).concat(body); return null }
    return []
  }
  return { state, deps: { db, now: () => NOW, sendAlert: async (m) => { state.mails.push(m); return { ok: true } } } }
}

describe('runTaskReminders', () => {
  it('sends overdue to the doer and the setter, records it, and sends nothing twice', async () => {
    const { state, deps } = world([{ id: 't1', title: 'Send the quote', assigned_to: 'omar', created_by: 'sami', due_at: '2026-10-19T05:00:00Z' }])
    const out = await runTaskReminders(deps, { digest: false })
    expect(out.sent).toBe(2)
    expect(state.notes.map(n => [n.user_id, n.kind])).toEqual([['omar', 'task_overdue'], ['sami', 'task_overdue']])
    expect(state.notes[1].title).toMatch(/^Omar's task is overdue: Send the quote/)
    expect(state.tasks[0].reminded.overdue).toBe(NOW.toISOString())
    expect((await runTaskReminders(deps, { digest: false })).sent).toBe(0)
  })

  it('the morning digest goes out once a day, in the bell and by email', async () => {
    const { state, deps } = world([
      { id: 't1', title: 'Call back Desert Rose', assigned_to: 'omar', due_at: '2026-10-19T12:00:00Z', reminded: { due_soon: 'x' } },
    ])
    const out = await runTaskReminders(deps)
    expect(out.digests.sent).toBe(1)
    const digest = state.notes.find(n => n.kind === 'task_digest')
    expect(digest).toMatchObject({ user_id: 'omar', title: 'Your tasks: 1 due today', link: '/tasks' })
    expect(state.mails[0].to).toEqual(['omar@example.com'])
    expect((await runTaskReminders(deps)).digests.sent).toBe(0)
  })

  it('is quiet where the tables do not exist (production before v2)', async () => {
    const deps = { now: () => NOW, db: async () => { throw new Error('Supabase 404: {"code":"PGRST205"}') } }
    expect(await runTaskReminders(deps)).toEqual({ off: true })
  })
})
