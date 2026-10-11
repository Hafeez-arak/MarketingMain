import { describe, it, expect } from 'vitest'
import { spin, wordingCount, spinProblem, spinSeed, pickVersion, hash, versionResults } from './variation.js'

const T = '{Hi|Hello|Hey} {{first_name|there}}, {I noticed|I saw} that {{company}} {grew|{is|was} growing}.'

describe('spin', () => {
  it('picks one option per choice and leaves merge tags alone', () => {
    const out = spin(T, 'seed-1')
    expect(out).not.toMatch(/(?<!\{)\{(?!\{)[^{}]*\|/)
    expect(out).toContain('{{first_name|there}}')
    expect(out).toContain('{{company}}')
    expect(out).toMatch(/^(Hi|Hello|Hey) /)
    expect(out).toMatch(/(grew|is growing|was growing)\.$/)
  })

  it('is the same for the same seed and varies across seeds', () => {
    expect(spin(T, 'a')).toBe(spin(T, 'a'))
    const seen = new Set(Array.from({ length: 40 }, (_, i) => spin(T, `p${i}`)))
    expect(seen.size).toBeGreaterThan(5)
  })

  it('spreads options roughly evenly', () => {
    const n = { Hi: 0, Hello: 0, Hey: 0 }
    for (let i = 0; i < 900; i++) n[spin('{Hi|Hello|Hey}', `c${i}`)]++
    for (const v of Object.values(n)) expect(v).toBeGreaterThan(220)
  })

  it('lets a merge tag sit inside a choice', () => {
    const outs = new Set(Array.from({ length: 30 }, (_, i) => spin('{Hi {{first_name|there}}|Hello}', `x${i}`)))
    expect([...outs].sort()).toEqual(['Hello', 'Hi {{first_name|there}}'])
  })

  it('leaves text without choices untouched', () => {
    expect(spin('Plain {{first_name|there}} text, a | b.', 's')).toBe('Plain {{first_name|there}} text, a | b.')
    expect(spin('{single}', 's')).toBe('{single}')
  })
})

describe('wordingCount', () => {
  it('multiplies the options, nested ones included', () => {
    expect(wordingCount(T)).toBe(3 * 2 * 3)   // grew | is growing | was growing
    expect(wordingCount('no choices')).toBe(1)
  })
})

describe('spinProblem', () => {
  it('flags open choices, stray braces and one-option braces', () => {
    expect(spinProblem(T)).toBe('')
    expect(spinProblem('{{first_name}} only')).toBe('')
    expect(spinProblem('{Hi|Hello')).toMatch(/not closed/)
    expect(spinProblem('Hi } there')).toMatch(/not closed/)
    expect(spinProblem('{single} word')).toMatch(/only one option/)
  })
})

describe('seeds and versions', () => {
  it('builds a seed from campaign, step and contact', () => {
    expect(spinSeed('c1', 2, { id: 'k' })).toBe('c1:2:k')
    expect(spinSeed(null, 0, { email: 'a@b.co' })).toBe('new:0:a@b.co')
  })

  it('splits prospects between versions and keeps each one fixed', () => {
    expect(pickVersion('c', 'x', 1)).toBe(0)
    const n = [0, 0, 0]
    for (let i = 0; i < 600; i++) n[pickVersion('camp', `contact-${i}`, 3)]++
    for (const v of n) expect(v).toBeGreaterThan(150)
    expect(pickVersion('camp', 'contact-7', 3)).toBe(pickVersion('camp', 'contact-7', 3))
  })

  it('tallies each version, counting a follow-up reply for the first email\'s version', () => {
    const sends = [
      { contact_id: 'a', step: 0, variant: 0, sent_at: 't' },
      { contact_id: 'a', step: 1, variant: 0, sent_at: 't', replied_at: 't' },
      { contact_id: 'b', step: 0, variant: 1, sent_at: 't', replied_at: 't', subscribed_at: 't' },
      { contact_id: 'c', step: 0, variant: 1, sent_at: 't', bounced_at: 't' },
      { contact_id: 'd', step: 0, variant: 1 },
    ]
    const [a, b] = versionResults(sends, 2)
    expect(a).toMatchObject({ letter: 'A', prospects: 1, sent: 1, replied: 1, subscribed: 0 })
    expect(b).toMatchObject({ letter: 'B', prospects: 3, sent: 2, replied: 1, subscribed: 1, bounced: 1 })
  })

  it('splits two versions evenly for real uuids, not by the parity of their letters', () => {
    const hex = i => (i * 2654435761 >>> 0).toString(16).padStart(8, '0')
    let b = 0
    for (let i = 0; i < 400; i++) b += pickVersion('4a2f0c1e-0000-4000-8000-000000000001', `${hex(i)}-1111-4222-8333-${hex(i + 7)}abcd`, 2)
    expect(b).toBeGreaterThan(160)
    expect(b).toBeLessThan(240)
  })

  it('hash is stable', () => {
    expect(hash('abc')).toBe(hash('abc'))
    expect(hash('abc')).not.toBe(hash('abd'))
  })
})
