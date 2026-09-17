import { describe, it, expect } from 'vitest'
import {
  turnOutcome, exhaustedMessage, refusalMessage, MAX_CONTINUATIONS,
} from './turnOutcome'

describe('turnOutcome', () => {
  it('resumes a paused turn — the failure that emptied three lenses', () => {
    // A server-tool sampling loop that hits its iteration limit returns
    // pause_turn. Nothing read stop_reason, so it was billed and recorded as a
    // finished answer.
    expect(turnOutcome('pause_turn').resume).toBe(true)
  })

  it('stops resuming at the ceiling and calls the turn unfinished', () => {
    const at = turnOutcome('pause_turn', { continuations: MAX_CONTINUATIONS })
    expect(at.resume).toBe(false)
    expect(at.exhausted).toBe(true)
  })

  it('never reports exhausted while it is still willing to resume', () => {
    for (let n = 0; n < MAX_CONTINUATIONS; n += 1) {
      const o = turnOutcome('pause_turn', { continuations: n })
      expect(o.resume, `n=${n}`).toBe(true)
      expect(o.exhausted, `n=${n}`).toBe(false)
    }
  })

  it('treats a normal finish as finished', () => {
    const o = turnOutcome('end_turn')
    expect(o).toEqual({ resume: false, exhausted: false, refused: false, truncated: false })
  })

  it('flags a refusal, which arrives as a 200 with nothing usable', () => {
    expect(turnOutcome('refusal').refused).toBe(true)
    expect(turnOutcome('refusal').resume).toBe(false)
  })

  it('flags truncation without resuming — more turns will not un-cut the output', () => {
    const o = turnOutcome('max_tokens')
    expect(o.truncated).toBe(true)
    expect(o.resume).toBe(false)
  })

  it('never resumes on a missing or unknown stop_reason', () => {
    for (const s of [undefined, null, '', 'tool_use', 'stop_sequence']) {
      expect(turnOutcome(s).resume, String(s)).toBe(false)
      expect(turnOutcome(s).exhausted, String(s)).toBe(false)
    }
  })

  it('honours a caller-supplied ceiling', () => {
    expect(turnOutcome('pause_turn', { continuations: 1, max: 1 }).resume).toBe(false)
    expect(turnOutcome('pause_turn', { continuations: 1, max: 9 }).resume).toBe(true)
  })
})

describe('messages', () => {
  it('says unfinished, not empty — the distinction this project keeps losing', () => {
    expect(exhaustedMessage(4)).toMatch(/not the same as finding nothing/)
  })

  it('quotes a refusal category when the API gives one', () => {
    expect(refusalMessage({ category: 'cyber' })).toContain('(cyber)')
  })

  it('reads cleanly when there is no category', () => {
    for (const d of [null, undefined, {}, { category: null }]) {
      expect(refusalMessage(d)).toBe('The model declined this request.')
    }
  })
})
