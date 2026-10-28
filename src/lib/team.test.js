import { describe, it, expect } from 'vitest'
import { accessOf, buildPeople, filterPeople, companyChips, sameSet } from './team'

const companies = [{ id: 'a', name: 'Arak Lighting' }, { id: 'g', name: 'Ghusn' }, { id: 'q', name: 'Aqeeq' }]
const rows = [
  { user_id: 'h', email: 'staff.admin@arak-sa.com', full_name: 'Omar', status: 'approved', role: 'admin', requested_at: '2026-08-01' },
  { user_id: 'j', email: 'staff.dev@arak-sa.com', full_name: '', status: 'approved', role: 'member', requested_at: '2026-08-02' },
  { user_id: 's', email: 'staff.sales@arak-sa.com', full_name: 'Faisal Ahmed', status: 'approved', role: 'sales', leads_approver: true, requested_at: '2026-09-01' },
  { user_id: 'p1', email: 'new@x.com', full_name: 'New One', status: 'pending', role: 'member', requested_at: '2026-10-20' },
  { user_id: 'p2', email: 'newer@x.com', full_name: 'Newer', status: 'pending', role: 'member', requested_at: '2026-10-24' },
  { user_id: 'r', email: 'gone@x.com', full_name: 'Gone', status: 'revoked', role: 'member', requested_at: '2026-07-01' },
]
const invites = [{ email: 'soon@arak-sa.com', role: 'sales_admin', workspace_ids: ['a', 'deleted-company'], invited_at: '2026-10-22' }]
const assignments = { j: ['a', 'g', 'q'], s: ['a'] }

describe('accessOf', () => {
  it('reads the four kinds', () => {
    expect(rows.map(accessOf)).toEqual(['admin', 'member', 'sales_admin', 'member', 'member', 'member'])
  })
})

describe('buildPeople', () => {
  const out = buildPeople({ rows, invites, assignments, companies, me: 'h' })
  it('splits requests, active, invited and removed', () => {
    expect(out.pending.map(p => p.id)).toEqual(['p2', 'p1']) // newest request first
    expect(out.active.map(p => p.id)).toEqual(['h', 's', 'j']) // the admin first, then by name
    expect(out.removed.map(p => p.id)).toEqual(['r'])
    expect(out.invited).toHaveLength(1)
  })
  it('names, marks you, and keeps only companies that exist', () => {
    expect(out.active.find(p => p.id === 'j').name).toBe('staff.dev')
    expect(out.active.find(p => p.id === 'h').isMe).toBe(true)
    expect(out.invited[0]).toMatchObject({ access: 'sales_admin', status: 'invited', companyIds: ['a'] })
  })
})

describe('filterPeople', () => {
  const { active } = buildPeople({ rows, assignments, companies })
  it('searches name, email and company', () => {
    expect(filterPeople(active, 'FAISAL').map(p => p.id)).toEqual(['s'])
    expect(filterPeople(active, 'ghusn', companies).map(p => p.id)).toEqual(['j'])
    expect(filterPeople(active, '  ').length).toBe(3)
  })
})

describe('companyChips', () => {
  const { active } = buildPeople({ rows, assignments, companies })
  it('shows two and counts the rest; an admin has all', () => {
    expect(companyChips(active.find(p => p.id === 'j'), companies)).toEqual({ all: false, shown: ['Arak Lighting', 'Ghusn'], more: 1 })
    expect(companyChips(active.find(p => p.id === 'h'), companies).all).toBe(true)
  })
})

describe('sameSet', () => {
  it('ignores order', () => {
    expect(sameSet(['a', 'g'], ['g', 'a'])).toBe(true)
    expect(sameSet(['a'], ['a', 'g'])).toBe(false)
  })
})
