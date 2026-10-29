import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
const { sectionRows } = await import('./sectionAccess.js')

const WS = 'ws-1'
const access = [
  { user_id: 'a', email: 'boss@example.com', full_name: 'Boss', status: 'approved', role: 'admin' },
  { user_id: 'm', email: 'maya@example.com', full_name: '', status: 'approved', role: 'member' },
  { user_id: 's', email: 'sam@example.com', full_name: 'Sam', status: 'approved', role: 'sales' },
  { user_id: 'p', email: 'pending@example.com', status: 'pending', role: 'member' },
  { user_id: 'o', email: 'other@example.com', status: 'approved', role: 'member' },
]
const assignments = { m: [WS], s: [WS], p: [WS], o: ['ws-2'] }
const grants = [
  { workspace_id: WS, user_id: 'm', section: 'sales', level: 'work' },
  { workspace_id: WS, user_id: 'm', section: 'marketing', level: 'manage' },
  { workspace_id: 'ws-2', user_id: 'm', section: 'ceo', level: 'view' },
]

describe('sectionRows', () => {
  it('lists the company\'s approved people with their grants, admin first', () => {
    const rows = sectionRows({ access, assignments, grants, workspaceId: WS })
    expect(rows.map(r => [r.userId, r.kind])).toEqual([['a', 'admin'], ['m', 'member'], ['s', 'sales']])
    // Technical and Finance are parked until Musa's ERP (lib/erp.js), so not listed.
    expect(rows[0].levels).toEqual({ ceo: 'manage', sales: 'manage', crm: 'manage', marketing: 'manage', insights: 'manage', hr: 'manage', contacts: 'manage', documents: 'manage' })
    expect(rows[1]).toMatchObject({ name: 'maya', levels: { ceo: null, sales: 'work', crm: null, marketing: 'manage', insights: null, hr: null, contacts: null, documents: null } })
  })
})
