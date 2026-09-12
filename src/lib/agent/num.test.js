import { describe, it, expect } from 'vitest'
import { num, numOr } from './num'

describe('the coercion this codebase keeps getting wrong', () => {
  it('rejects the values Number() silently turns into zero', () => {
    // The whole reason this file exists. Every one of these is an ABSENCE,
    // and Number() reports all of them as the measurement zero.
    for (const absent of [null, undefined, '']) {
      expect(num(absent), String(absent)).toBeNull()
    }
  })

  it('rejects booleans, which Number() turns into 1 and 0', () => {
    // A `true` arriving where a count belongs is a bug upstream, not one.
    expect(num(true)).toBeNull()
    expect(num(false)).toBeNull()
  })

  it('rejects text that is not a number, and NaN itself', () => {
    expect(num('later')).toBeNull()
    expect(num(NaN)).toBeNull()
    expect(num(Infinity)).toBeNull()
  })

  it('keeps a real zero, which is the whole difficulty', () => {
    // Zero followers and no follower count are different facts, and the point
    // of this function is that it can tell them apart.
    expect(num(0)).toBe(0)
    expect(num('0')).toBe(0)
  })

  it('accepts ordinary numbers and numeric strings', () => {
    expect(num(41200)).toBe(41200)
    expect(num('2.44')).toBe(2.44)
    expect(num(-1)).toBe(-1)
  })

  it('numOr only defaults when there is genuinely nothing', () => {
    expect(numOr(null)).toBe(0)
    expect(numOr(null, 1)).toBe(1)
    expect(numOr(0, 99)).toBe(0)
    expect(numOr('0.5', 99)).toBe(0.5)
  })
})
