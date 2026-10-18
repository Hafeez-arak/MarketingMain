import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabaseClient', () => ({ supabase: {} }))
const { columnOf, filterRequests } = await import('./requests')
import { matchPerson, REQUEST_TOOLS, REQUESTS_PROMPT } from './agent/requestTools'
import { toolsFor, toolsExposingWorkspace } from './agent/tools'
import { volatileFragment } from './agent/prompt'

describe('the board', () => {
  it('declined sits with done; new and in progress have their own columns', () => {
    expect(['new', 'in_progress', 'done', 'declined'].map(columnOf)).toEqual(['new', 'in_progress', 'closed', 'closed'])
  })
  it('filters by asked-by-me and assigned-to-me', () => {
    const rows = [{ id: 1, created_by: 'a', assigned_to: 'b' }, { id: 2, created_by: 'b', assigned_to: 'a' }]
    expect(filterRequests(rows, 'mine', 'a').map(r => r.id)).toEqual([1])
    expect(filterRequests(rows, 'assigned', 'a').map(r => r.id)).toEqual([2])
    expect(filterRequests(rows, 'all', 'a')).toHaveLength(2)
  })
})

describe('matchPerson', () => {
  const people = [{ name: 'shadia' }, { name: 'hafeez' }, { name: 'Haitham Ali' }]
  it('matches exact, first name, @-prefixed and unique prefixes', () => {
    expect(matchPerson('Shadia', people).name).toBe('shadia')
    expect(matchPerson('@hafeez', people).name).toBe('hafeez')
    expect(matchPerson('Haitham', people).name).toBe('Haitham Ali')
    expect(matchPerson('sha', people).name).toBe('shadia')
  })
  it('refuses ambiguous or unknown names', () => {
    expect(matchPerson('ha', people)).toBeNull()
    expect(matchPerson('Ammar', people)).toBeNull()
    expect(matchPerson('', people)).toBeNull()
  })
})

describe('the request belt', () => {
  it('rides with the company belt on the chat only, and takes no workspace', () => {
    const names = list => list.map(t => t.name)
    expect(names(toolsFor({}))).not.toContain('file_request')
    expect(names(toolsFor({ company: true }))).toEqual(expect.arrayContaining(REQUEST_TOOLS.map(t => t.name)))
    expect(toolsExposingWorkspace(REQUEST_TOOLS)).toEqual([])
    expect(volatileFragment(REQUESTS_PROMPT)).toBeNull()
  })
})
