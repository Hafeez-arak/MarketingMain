import { describe, it, expect } from 'vitest'
import {
  backupGate, BACKUP_CALLS_PER_LENS, WRAP_UP_MS, BACKUP_TOOLS,
  backupPrompt, claudeSearchesFor, prefersFirecrawl, RESERVE_SEARCHES,
} from './backupSearch.js'

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

describe('each search where it is better', () => {
  it('sends portals, tenders and competitor sites to Firecrawl first, news to Claude first', async () => {
    const { lensByKey } = await import('./lenses.js')
    for (const key of ['openings', 'demand', 'rivals']) expect(prefersFirecrawl(lensByKey(key))).toBe(true)
    for (const key of ['events', 'category', 'global', 'targets']) expect(prefersFirecrawl(lensByKey(key))).toBe(false)
    expect(backupPrompt(lensByKey('openings'))).toMatch(/start with search_web/)
    expect(backupPrompt(lensByKey('events'))).toMatch(/start with web_search/)
  })

  it('keeps Claude searches in reserve for when Firecrawl and Tavily are both out', () => {
    expect(claudeSearchesFor({ budget: { searches: 6 } })).toBe(6 + RESERVE_SEARCHES)
    // A lens that never searches does not start searching.
    expect(claudeSearchesFor({ budget: { searches: 0 } })).toBe(0)
  })
})
