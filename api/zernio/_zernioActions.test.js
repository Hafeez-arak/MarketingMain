import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { isAction } from './[action].js'

// ─── The route answers every action the browser calls ──────────────────────
//
// This exists because it did not, once. `followers` was written as a handler
// and left out of a hand-kept allowlist sitting 250 lines above it, so every
// call 404'd with "Unknown action: followers" while the code that answered it
// sat directly below, untouched and unreachable — a failure that no unit test
// of either half could see, because both halves were correct.
//
// The allowlist is derived from the handlers now, so the only way the two can
// disagree again is if the browser asks for something that was never written.
// That is what this reads the client for.

const client = fs.readFileSync(new URL('../../src/lib/zernioConnect.js', import.meta.url), 'utf8')
const CALLED = [...client.matchAll(/\bcall\(\s*'([a-z_]+)'/g)].map(m => m[1])

describe('the zernio route', () => {
  it('finds the actions the client actually calls (guards the regex itself)', () => {
    // If this file stops finding call sites the test below passes vacuously.
    expect(CALLED.length).toBeGreaterThanOrEqual(9)
    expect(CALLED).toContain('analytics')
    expect(CALLED).toContain('followers')
  })

  it('answers every one of them', () => {
    const missing = [...new Set(CALLED)].filter(name => !isAction(name))
    expect(missing).toEqual([])
  })

  it('still refuses anything else', () => {
    expect(isAction('nonsense')).toBe(false)
    expect(isAction('')).toBe(false)
    // Inherited members are not actions — `in` would have said otherwise.
    expect(isAction('constructor')).toBe(false)
    expect(isAction('toString')).toBe(false)
  })
})
