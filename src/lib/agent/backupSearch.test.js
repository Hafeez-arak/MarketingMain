import { describe, it, expect } from 'vitest'
import { backupGate, BACKUP_CALLS_PER_LENS, WRAP_UP_MS, BACKUP_TOOLS } from './backupSearch.js'

describe('backup search for a lens', () => {
  it('lets a lens keep searching with no deadline and calls to spare', () => {
    expect(backupGate({ used: 0, msLeft: null })).toBeNull()
    expect(backupGate({ used: BACKUP_CALLS_PER_LENS - 1, msLeft: WRAP_UP_MS + 1 })).toBeNull()
  })

  it('tells the lens to answer when its time is nearly up, so it still reports something', () => {
    expect(backupGate({ used: 0, msLeft: WRAP_UP_MS - 1 })).toMatch(/Write your answer now/)
  })

  it('stops a runaway loop at the guard', () => {
    expect(backupGate({ used: BACKUP_CALLS_PER_LENS, msLeft: null })).toMatch(/Write your answer now/)
  })

  it('sends only fields the API accepts', () => {
    for (const t of BACKUP_TOOLS) expect(Object.keys(t).sort()).toEqual(['description', 'input_schema', 'name'])
  })
})
