import { describe, it, expect } from 'vitest'
import { listPlaybook, savePlaybookCard, reviewPlaybookCard, deletePlaybookCard } from './_playbook.js'

// The playbook's library against a small in-memory PostgREST. Made-up cards only.
const WS = '11111111-1111-4111-8111-111111111111'
const OTHER = '99999999-9999-4999-8999-999999999999'
const ME = { id: '44444444-4444-4444-8444-444444444444' }

function fakeDb(rows) {
  let n = 0
  const match = (q) => (r) => [...new URLSearchParams(q)].every(([k, v]) => ['select', 'order', 'limit'].includes(k) || String(r[k]) === v.replace(/^eq\./, ''))
  return async (path, { method = 'GET', body } = {}) => {
    const [, q = ''] = path.split('?')
    const params = new URLSearchParams(q)
    if (method === 'GET') {
      let out = rows.filter(match(q))
      if (params.get('order') === 'position.desc') out = [...out].sort((a, b) => b.position - a.position)
      else out = [...out].sort((a, b) => a.position - b.position)
      return out.slice(0, Number(params.get('limit')) || undefined).map((r) => ({ ...r }))
    }
    if (method === 'POST') { const r = { id: `00000000-0000-4000-8000-00000000000${++n}`, ...body }; rows.push(r); return [{ ...r }] }
    if (method === 'PATCH') { const hit = rows.filter(match(q)); hit.forEach((r) => Object.assign(r, body)); return hit.map((r) => ({ ...r })) }
    if (method === 'DELETE') { const hit = rows.filter(match(q)); hit.forEach((r) => rows.splice(rows.indexOf(r), 1)); return hit }
    throw new Error(method)
  }
}

const deps = (rows) => ({ db: fakeDb(rows), now: () => new Date('2026-11-07T10:00:00Z') })

describe('the playbook library', () => {
  it('adds a card at the end as a draft, and lists only this company\'s, in order', async () => {
    const rows = [{ id: 'x', workspace_id: OTHER, position: 1, title: 'Not ours' }]
    const d = deps(rows)
    const a = await savePlaybookCard(d, { workspaceId: WS, user: ME, body: { title: 'First', category: 'discovery', owner_label: 'Admin' } })
    const b = await savePlaybookCard(d, { workspaceId: WS, user: ME, body: { title: 'Second', category: 'closing' } })
    expect(a.card).toMatchObject({ position: 1, status: 'draft', owner_label: 'Admin', updated_by: ME.id })
    expect(b.card.position).toBe(2)
    expect((await listPlaybook(d, WS)).map((c) => c.title)).toEqual(['First', 'Second'])
  })

  it('refuses a card without a title or category', async () => {
    expect((await savePlaybookCard(deps([]), { workspaceId: WS, user: ME, body: { category: 'objection' } })).status).toBe(400)
    expect((await savePlaybookCard(deps([]), { workspaceId: WS, user: ME, body: { title: 'X', category: 'x' } })).status).toBe(400)
  })

  it('reviewed: approved with who and when; edited again, back to draft', async () => {
    const rows = []
    const d = deps(rows)
    const { card } = await savePlaybookCard(d, { workspaceId: WS, user: ME, body: { title: 'Price', category: 'objection' } })
    const r = await reviewPlaybookCard(d, { workspaceId: WS, user: ME, id: card.id })
    expect(r.card).toMatchObject({ status: 'approved', reviewed_at: '2026-11-07T10:00:00.000Z', reviewed_by: ME.id })
    const e = await savePlaybookCard(d, { workspaceId: WS, user: ME, body: { id: card.id, title: 'Price, again', category: 'objection' } })
    expect(e.card).toMatchObject({ title: 'Price, again', status: 'draft' })
  })

  it('never touches another company\'s card', async () => {
    const rows = [{ id: '00000000-0000-4000-8000-0000000000aa', workspace_id: OTHER, position: 1, title: 'Theirs', category: 'discovery', status: 'approved' }]
    const d = deps(rows)
    expect((await reviewPlaybookCard(d, { workspaceId: WS, user: ME, id: rows[0].id, approved: false })).status).toBe(404)
    expect((await deletePlaybookCard(d, { workspaceId: WS, id: rows[0].id })).status).toBe(404)
    expect((await savePlaybookCard(d, { workspaceId: WS, user: ME, body: { id: rows[0].id, title: 'Mine now', category: 'discovery' } })).status).toBe(404)
    expect(rows[0]).toMatchObject({ title: 'Theirs', status: 'approved' })
  })

  it('removes a card', async () => {
    const rows = []
    const d = deps(rows)
    const { card } = await savePlaybookCard(d, { workspaceId: WS, user: ME, body: { title: 'Gone', category: 'closing' } })
    expect(await deletePlaybookCard(d, { workspaceId: WS, id: card.id })).toEqual({ deleted: card.id })
    expect(rows).toEqual([])
  })
})
