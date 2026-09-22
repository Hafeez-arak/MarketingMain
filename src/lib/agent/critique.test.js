import { describe, it, expect } from 'vitest'
import {
  evidenceFor, evidenceInstruction, normalizeCritique, describeDraft, isTestAccount,
  hashtagsOf, MIN_POSTS_FOR_PATTERN, TEST_ACCOUNT_FOLLOWERS,
} from './critique'

// ─── The rule this whole feature rests on ──────────────────────────────────
// A critique may say "the hook buries the number". It may NOT say "your
// audience responds to this" unless somebody has actually measured that
// audience. Every test below is that one rule from a different angle, because
// the failure is invisible: a confident sentence about a pattern reads exactly
// the same whether there were forty posts behind it or none.

const post = (over = {}) => ({ platform: 'instagram', engagement: 10, followers: 4200, ...over })
const many = (n, over = {}) => Array.from({ length: n }, () => post(over))

describe('isTestAccount', () => {
  it('catches the one-follower account this was written for', () => {
    expect(isTestAccount({ followers: 1 })).toBe(true)
    expect(isTestAccount({ followers: TEST_ACCOUNT_FOLLOWERS })).toBe(true)
  })

  it('leaves a real account alone', () => {
    expect(isTestAccount({ followers: 4200 })).toBe(false)
    expect(isTestAccount({ followers: TEST_ACCOUNT_FOLLOWERS + 1 })).toBe(false)
  })

  // Unknown is not zero. An account whose follower count we never read must
  // not be discarded as a test account — that would silently throw away real
  // history the moment a sync failed.
  it('treats an unknown follower count as real', () => {
    expect(isTestAccount({})).toBe(false)
    expect(isTestAccount({ followers: null })).toBe(false)
  })
})

describe('evidenceFor — which tier', () => {
  it('uses history once there is enough of it', () => {
    const e = evidenceFor(many(MIN_POSTS_FOR_PATTERN), 'instagram')
    expect(e.tier).toBe('history')
    expect(e.sampleSize).toBe(MIN_POSTS_FOR_PATTERN)
    expect(e.usable).toHaveLength(MIN_POSTS_FOR_PATTERN)
  })

  it('refuses to call a handful a pattern', () => {
    const e = evidenceFor(many(MIN_POSTS_FOR_PATTERN - 1), 'instagram')
    expect(e.tier).toBe('thin')
    expect(e.note).toMatch(/too few|judgement/i)
  })

  // The real situation on 2026-09-22: 15 measured posts, all on a
  // one-follower test account. Plenty of rows, no audience.
  it('discards a large test-account history entirely', () => {
    const e = evidenceFor(many(15, { followers: 1 }), 'instagram')
    expect(e.tier).toBe('test_only')
    expect(e.usable).toEqual([])
    expect(e.sampleSize).toBe(0)
    expect(e.note).toMatch(/test account/i)
  })

  it('says so plainly when nothing has been measured', () => {
    const e = evidenceFor([], 'instagram')
    expect(e.tier).toBe('none')
    expect(e.usable).toEqual([])
  })

  // A LinkedIn draft must not be judged against Instagram history. The two
  // platforms reward completely different posts.
  it('only counts posts from the platform being written for', () => {
    const mixed = [...many(20, { platform: 'linkedin' }), ...many(2, { platform: 'instagram' })]
    expect(evidenceFor(mixed, 'instagram').tier).toBe('thin')
    expect(evidenceFor(mixed, 'linkedin').tier).toBe('history')
  })

  it('names the platform in the note, so the reader knows the scope', () => {
    expect(evidenceFor([], 'linkedin').note).toContain('LinkedIn')
  })

  it('survives rubbish input', () => {
    expect(evidenceFor(null, 'instagram').tier).toBe('none')
    expect(evidenceFor([null, undefined], 'instagram').tier).toBe('none')
  })
})

describe('evidenceInstruction — the paragraph that stops the lie', () => {
  it('forbids every invented figure when there is no history', () => {
    for (const tier of [[], many(2), many(15, { followers: 1 })]) {
      const text = evidenceInstruction(evidenceFor(tier, 'instagram'))
      expect(text).toMatch(/never claim a pattern/i)
      expect(text).toMatch(/never estimate/i)
      expect(text).toMatch(/score/i)
    }
  })

  it('invites the model to cite real posts once they exist', () => {
    const text = evidenceInstruction(evidenceFor(many(12), 'instagram'))
    expect(text).toMatch(/12/)
    expect(text).not.toMatch(/never claim a pattern/i)
  })
})

describe('normalizeCritique', () => {
  it('fills everything the model left out', () => {
    expect(normalizeCritique({})).toEqual({ verdict: '', strengths: [], changes: [] })
    expect(normalizeCritique()).toEqual({ verdict: '', strengths: [], changes: [] })
  })

  it('keeps a change with no suggested replacement', () => {
    const c = normalizeCritique({ changes: [{ what: 'Shorten the opening line', why: 'It is cut off' }] })
    expect(c.changes).toHaveLength(1)
    expect(c.changes[0].suggestion).toBe('')
  })

  it('drops a change that says nothing', () => {
    const c = normalizeCritique({ changes: [{ why: 'because' }, { what: 'Do this' }] })
    expect(c.changes.map(x => x.what)).toEqual(['Do this'])
  })

  // Ranked, most valuable first — so a cap keeps the top of the list, never
  // the bottom.
  it('caps the list without reordering it', () => {
    const changes = Array.from({ length: 10 }, (_, i) => ({ what: `Change ${i}` }))
    const c = normalizeCritique({ changes })
    expect(c.changes).toHaveLength(6)
    expect(c.changes[0].what).toBe('Change 0')
  })

  it('there is no score anywhere in the shape', () => {
    const c = normalizeCritique({ verdict: 'x', score: 87, predicted_engagement: '4.2%' })
    expect(Object.keys(c)).toEqual(['verdict', 'strengths', 'changes'])
  })
})

describe('describeDraft', () => {
  it('states absences rather than omitting them', () => {
    const text = describeDraft({ platform: 'instagram', caption: 'Hello' })
    expect(text).toMatch(/HASHTAGS: none/)
    expect(text).toMatch(/ALT TEXT: none/)
    expect(text).toMatch(/FIRST COMMENT: none/)
    expect(text).toMatch(/PICTURES: none/)
  })

  it('gives the caption length against the platform limit', () => {
    const text = describeDraft({ platform: 'instagram', caption: 'abc' })
    expect(text).toMatch(/CAPTION LENGTH: 3 characters \(the platform allows 2200\)/)
  })

  it('counts pictures and video separately', () => {
    const text = describeDraft({
      platform: 'instagram',
      media: [{ type: 'image' }, { type: 'image' }, { type: 'video' }],
    })
    expect(text).toMatch(/PICTURES: 2, plus 1 video/)
  })

  it('says an empty caption is empty instead of trailing off', () => {
    expect(describeDraft({ platform: 'instagram' })).toMatch(/\(empty\)/)
  })
})

describe('hashtagsOf — two callers, two shapes', () => {
  it('reads the composer\'s single text field', () => {
    expect(hashtagsOf('#lighting #riyadh')).toEqual(['#lighting', '#riyadh'])
    expect(hashtagsOf('lighting, riyadh')).toEqual(['lighting', 'riyadh'])
  })

  it('reads a plan idea\'s list', () => {
    expect(hashtagsOf(['#lighting', ' #riyadh '])).toEqual(['#lighting', '#riyadh'])
  })

  it('is empty for nothing', () => {
    expect(hashtagsOf('')).toEqual([])
    expect(hashtagsOf(null)).toEqual([])
    expect(hashtagsOf([])).toEqual([])
  })

  // The failure this guards is silent: a string arriving where an array was
  // assumed used to produce [], and the critique judged a post that looked
  // like it had no hashtags at all.
  it('does not swallow a string', () => {
    expect(describeDraft({ platform: 'instagram', hashtags: '#a #b' })).toMatch(/HASHTAGS: #a #b/)
  })
})
