import { describe, it, expect, beforeEach } from 'vitest'
import { pickActiveWorkspace, rememberWorkspace, rememberedWorkspace } from './activeWorkspace'

const ARAK = { id: 'arak' }
const GHUSN = { id: 'ghusn' }
const AQEEQ = { id: 'aqeeq' }

describe('pickActiveWorkspace', () => {
  it('reopens the company chosen before the refresh, not the first in the list', () => {
    expect(pickActiveWorkspace(null, 'ghusn', [ARAK, GHUSN, AQEEQ])).toBe('ghusn')
  })

  it('keeps the company already open when the list is reloaded', () => {
    expect(pickActiveWorkspace('aqeeq', 'ghusn', [ARAK, GHUSN, AQEEQ])).toBe('aqeeq')
  })

  it('falls back to the first company once the saved one has been taken away', () => {
    expect(pickActiveWorkspace(null, 'ghusn', [ARAK, AQEEQ])).toBe('arak')
  })

  it('opens the first company when nothing was saved', () => {
    expect(pickActiveWorkspace(null, '', [ARAK, GHUSN])).toBe('arak')
  })

  it('opens nothing for a person with no companies', () => {
    expect(pickActiveWorkspace(null, 'ghusn', [])).toBe(null)
  })
})

describe('remembering the choice', () => {
  const store = new Map()
  beforeEach(() => {
    store.clear()
    globalThis.localStorage = {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    }
  })

  it('keeps one choice per user', () => {
    rememberWorkspace('u1', 'ghusn')
    rememberWorkspace('u2', 'aqeeq')
    expect(rememberedWorkspace('u1')).toBe('ghusn')
    expect(rememberedWorkspace('u2')).toBe('aqeeq')
  })

  it('reads as nothing saved when storage is unavailable', () => {
    globalThis.localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(() => rememberWorkspace('u1', 'ghusn')).not.toThrow()
    expect(rememberedWorkspace('u1')).toBe('')
  })
})
