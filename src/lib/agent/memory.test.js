import { describe, it, expect } from 'vitest'
import {
  NOTE_KINDS, KIND_TTL_DAYS, KIND_WEIGHT, REPEAT_AT, DIGEST_TOKEN_BUDGET,
  fingerprint, tokensOf, similarity, isRepeat, partitionRepeats,
  makeNote, isExpired, notesFromRun,
  approxTokens, rankNotes, renderDigest, freshTail, digestIsStale,
} from './memory'

const NOW = new Date('2026-09-12T09:00:00Z')
const ago = days => new Date(NOW.getTime() - days * 86_400_000).toISOString()

// The real ideas from two consecutive live runs, which had no awareness of
// each other. Every similarity threshold in this module was chosen against
// these, so they are the fixture rather than invented examples.
const RUN1 = [
  'Inside our Riyadh partner floor: 20+ certified brands, one room',
  'The guest turns one dial and the room answers',
  'Same brief, different building: how a landmark spec differs from a catalogue order',
]
const RUN2 = [
  'Ritz Carlton Riyadh — what a luxury hospitality fit-out actually requires',
  'KNX and GRMS: what hotel operators are actually specifying',
]

describe('fingerprinting survives a rewrite', () => {
  it('ignores word order', () => {
    // The whole defence. A model told "do not repeat these" reaches for a
    // rephrasing, so order must not make two ideas different.
    expect(fingerprint('KNX and GRMS: what hotel operators specify'))
      .toBe(fingerprint('what hotel operators specify about GRMS and KNX'))
  })

  it('ignores plural and tense, which is what a rewrite actually changes', () => {
    expect(fingerprint('what the operator is specifying'))
      .toBe(fingerprint('what operators specify'))
  })

  it('ignores punctuation, case and em-dashes', () => {
    expect(fingerprint('Ritz Carlton Riyadh — a luxury fit-out'))
      .toBe(fingerprint('ritz carlton riyadh, a luxury fit out'))
  })

  it('ignores filler that appears in every marketing idea', () => {
    expect(fingerprint('Create a post showcasing the Riyadh showroom'))
      .toBe(fingerprint('Riyadh showroom'))
  })

  it('treats 20+ and 20 as the same claim', () => {
    expect(fingerprint('20+ certified brands')).toBe(fingerprint('20 certified brands'))
  })

  it('is empty for text with no significant content', () => {
    expect(fingerprint('the and of it')).toBe('')
    expect(fingerprint('')).toBe('')
  })
})

describe('similarity', () => {
  it('scores a rephrasing as near-identical', () => {
    const a = 'KNX and GRMS: what hotel operators are actually specifying'
    const b = 'What hotel operators specify when it comes to GRMS and KNX'
    expect(similarity(a, b)).toBeGreaterThanOrEqual(REPEAT_AT)
  })

  it('keeps genuinely different ideas apart', () => {
    // Both mention hospitality and Riyadh. They are not the same idea, and a
    // threshold that merged them would suppress real work.
    expect(similarity(RUN2[0], RUN2[1])).toBeLessThan(REPEAT_AT)
    expect(similarity(RUN1[0], RUN1[1])).toBeLessThan(REPEAT_AT)
  })

  it('scores two empty texts as 0, not 1', () => {
    // Returning 1 would make every blank note a duplicate of the first blank
    // note, silently swallowing all of them.
    expect(similarity('', '')).toBe(0)
    expect(similarity('the and of', 'a to it')).toBe(0)
  })

  it('is symmetric', () => {
    expect(similarity(RUN1[0], RUN2[0])).toBeCloseTo(similarity(RUN2[0], RUN1[0]), 10)
  })

  it('keeps a real margin either side of the threshold', () => {
    // The measurement that justifies REPEAT_AT, kept as a test so a change to
    // the stemmer or the stopword list cannot quietly narrow the gap. As
    // measured 2026-09-12: lowest true match 0.714, highest false match 0.167.
    const rewrites = [
      ['KNX and GRMS: what hotel operators are actually specifying',
       'What hotel operators specify when it comes to GRMS and KNX'],
      ['The guest turns one dial and the room answers',
       'One dial, and the whole guest room answers'],
      ['Inside our Riyadh partner floor: 20+ certified brands, one room',
       'Our Riyadh partner floor: 20 certified brands in one room'],
    ]
    const all = [...RUN1, ...RUN2]
    const different = []
    for (const a of all) for (const b of all) if (a < b) different.push(similarity(a, b))

    const lowestTrue = Math.min(...rewrites.map(([a, b]) => similarity(a, b)))
    const highestFalse = Math.max(...different)

    expect(lowestTrue).toBeGreaterThan(REPEAT_AT)
    expect(highestFalse).toBeLessThan(REPEAT_AT)
    expect(lowestTrue - highestFalse).toBeGreaterThan(0.35)
  })
})

describe('isRepeat — the enforcement, not the request', () => {
  const prior = RUN1.map(body => ({ body, fingerprint: fingerprint(body) }))

  it('catches an exact repeat', () => {
    expect(isRepeat(RUN1[1], prior)).toBeTruthy()
  })

  it('catches a reworded repeat', () => {
    expect(isRepeat('One dial, and the whole guest room answers', prior)).toBeTruthy()
  })

  it('lets a genuinely new idea through', () => {
    expect(isRepeat(RUN2[0], prior)).toBeNull()
    expect(isRepeat(RUN2[1], prior)).toBeNull()
  })

  it('returns null rather than throwing on empty input', () => {
    expect(isRepeat('', prior)).toBeNull()
    expect(isRepeat('something new entirely', [])).toBeNull()
  })

  it('falls back to computing a fingerprint the note did not carry', () => {
    expect(isRepeat(RUN1[0], [{ body: RUN1[0] }])).toBeTruthy()
  })
})

describe('partitionRepeats', () => {
  const prior = RUN1.map(body => ({ body, fingerprint: fingerprint(body) }))

  it('separates fresh ideas from ones already said', () => {
    const { fresh, repeats } = partitionRepeats([...RUN2, RUN1[0]], prior)
    expect(fresh).toHaveLength(2)
    expect(repeats).toHaveLength(1)
    expect(repeats[0].matched.body).toBe(RUN1[0])
  })

  it('RETURNS repeats rather than silently dropping them', () => {
    // "We suggested this three weeks ago and nothing happened" is more useful
    // to a person than the idea vanishing — which looks identical to the agent
    // never having had it.
    const { repeats } = partitionRepeats([RUN1[2]], prior)
    expect(repeats[0].body).toBe(RUN1[2])
    expect(repeats[0].matched).toBeTruthy()
  })

  it('catches two identical ideas inside ONE batch', () => {
    // Nothing prior — the collision has to come from the batch accumulating.
    const { fresh, repeats } = partitionRepeats(
      ['The guest turns one dial and the room answers', 'One dial and the guest room answers'],
      [],
    )
    expect(fresh).toHaveLength(1)
    expect(repeats).toHaveLength(1)
  })

  it('reads the object shapes a run actually produces', () => {
    const { fresh } = partitionRepeats([{ idea: 'A brand new thing about tenders' }], prior)
    expect(fresh).toHaveLength(1)
  })

  it('skips blank candidates instead of counting them', () => {
    expect(partitionRepeats(['', '   ', { idea: '' }], prior).fresh).toHaveLength(0)
  })
})

describe('notes and their lifetimes', () => {
  it('gives a correction no expiry at all', () => {
    // Standing law. A person who said "never use discount language" has not
    // withdrawn it because a month passed.
    expect(makeNote({ kind: 'correction', body: 'Never use green graphics', now: NOW }).expires_at).toBeNull()
    expect(KIND_TTL_DAYS.correction).toBeNull()
    expect(KIND_TTL_DAYS.constraint).toBeNull()
  })

  it('expires a run headline but not quickly', () => {
    const n = makeNote({ kind: 'run_headline', body: 'Nothing moved', now: NOW })
    expect(n.expires_at).toBeTruthy()
    expect(new Date(n.expires_at).getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('treats a null expiry as evergreen, NOT expired', () => {
    // Getting this backwards silently deletes every standing instruction the
    // first time memory is compacted.
    expect(isExpired({ expires_at: null }, NOW)).toBe(false)
    expect(isExpired({}, NOW)).toBe(false)
    expect(isExpired({ expires_at: ago(1) }, NOW)).toBe(true)
    expect(isExpired({ expires_at: new Date(NOW.getTime() + 86_400_000).toISOString() }, NOW)).toBe(false)
  })

  it('normalises whitespace and fingerprints the body', () => {
    const n = makeNote({ kind: 'fact', body: '  Huda   opened\na showroom  ', now: NOW })
    expect(n.body).toBe('Huda opened a showroom')
    expect(n.fingerprint).toBe(fingerprint('Huda opened a showroom'))
  })

  it('falls back to a valid kind rather than writing one the CHECK rejects', () => {
    // brand_memory has already cost this project four CHECK violations.
    expect(NOTE_KINDS).toContain(makeNote({ kind: 'nonsense', body: 'x' }).kind)
  })

  it('accepts an explicit expiry for a note with a real deadline', () => {
    expect(makeNote({ kind: 'fact', body: 'x', expiresAt: '2026-12-01' }).expires_at).toBe('2026-12-01')
  })
})

describe('what a run leaves behind', () => {
  const report = {
    headline: 'The board did not move, but Huda made a capital move',
    proposed_ideas: [{ idea: RUN2[0] }, { idea: RUN2[1] }],
    findings: [
      { headline: 'Saudi National Day is 11 days away', perishable_until: '2026-09-23' },
      { headline: 'Something evergreen with no date' },
    ],
  }

  it('records every proposed idea — the load-bearing part', () => {
    const ideas = notesFromRun(report, 'run-1', NOW).filter(n => n.kind === 'idea_proposed')
    expect(ideas).toHaveLength(2)
    expect(ideas[0].source_id).toBe('run-1')
  })

  it('records the headline so the agent can say what it concluded', () => {
    expect(notesFromRun(report, 'run-1', NOW).filter(n => n.kind === 'run_headline')).toHaveLength(1)
  })

  it('keeps a dated finding but not an undated one', () => {
    // Undated findings are already in research_runs.report and re-recording
    // them here is exactly the padding the token cap exists to prevent.
    const facts = notesFromRun(report, 'run-1', NOW).filter(n => n.kind === 'fact')
    expect(facts).toHaveLength(1)
    expect(facts[0].expires_at).toBe('2026-09-23')
  })

  it('survives an empty report', () => {
    expect(notesFromRun({}, null, NOW)).toEqual([])
    expect(notesFromRun(undefined, null, NOW)).toEqual([])
  })
})

describe('ranking decides what survives compaction', () => {
  it('puts a months-old constraint above a headline from yesterday', () => {
    // Breaking a standing instruction is a real failure; forgetting last
    // week's headline is not.
    const notes = [
      { kind: 'run_headline', body: 'Nothing moved', created_at: ago(1), seen_count: 1 },
      { kind: 'constraint', body: 'Never discount', created_at: ago(90), seen_count: 1 },
    ]
    expect(rankNotes(notes, NOW)[0].kind).toBe('constraint')
    expect(KIND_WEIGHT.constraint).toBeGreaterThan(KIND_WEIGHT.run_headline)
  })

  it('lifts something that keeps coming back over something newer', () => {
    const notes = [
      { kind: 'fact', body: 'Newer but mentioned once', created_at: ago(1), seen_count: 1 },
      { kind: 'fact', body: 'Older but keeps mattering', created_at: ago(30), seen_count: 5 },
    ]
    expect(rankNotes(notes, NOW)[0].body).toBe('Older but keeps mattering')
  })

  it('drops expired notes entirely', () => {
    expect(rankNotes([{ kind: 'fact', body: 'gone', created_at: ago(5), expires_at: ago(1) }], NOW))
      .toHaveLength(0)
  })

  it('does not treat seen_count null as zero', () => {
    // Number(null) is 0 and isFinite(0) is true — this codebase's recurring bug.
    expect(() => rankNotes([{ kind: 'fact', body: 'x', seen_count: null, created_at: ago(1) }], NOW)).not.toThrow()
    expect(rankNotes([{ kind: 'fact', body: 'x', seen_count: null, created_at: ago(1) }], NOW)).toHaveLength(1)
  })
})

describe('the digest fits, or it drops rather than truncates', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({
    kind: 'fact',
    body: `Established fact number ${i} with enough words to take up real space in the budget`,
    created_at: ago(i % 40),
    seen_count: 1,
  }))

  it('stays inside the token budget', () => {
    const out = renderDigest(many, { now: NOW })
    expect(out.approx_tokens).toBeLessThanOrEqual(DIGEST_TOKEN_BUDGET)
    expect(out.dropped).toBeGreaterThan(0)
  })

  it('never truncates mid-sentence', () => {
    // A half-rendered instruction reads as a complete one. A dropped note is
    // still in agent_notes; a mangled one is actively misleading.
    const out = renderDigest(many, { now: NOW })
    for (const line of out.text.split('\n').filter(l => l.startsWith('- '))) {
      expect(line.length).toBeGreaterThan(10)
    }
    expect(out.text.endsWith('…')).toBe(false)
  })

  it('keeps the standing instructions when it has to choose', () => {
    const out = renderDigest([
      ...many,
      { kind: 'correction', body: 'Never use generic green National Day graphics', created_at: ago(200), seen_count: 1 },
    ], { now: NOW })
    expect(out.text).toMatch(/Never use generic green/)
  })

  it('leads with what must not be repeated', () => {
    const out = renderDigest([
      { kind: 'run_headline', body: 'Nothing moved', created_at: ago(1) },
      { kind: 'idea_proposed', body: RUN2[1], created_at: ago(7) },
    ], { now: NOW })
    expect(out.text.indexOf('ALREADY PROPOSED')).toBeLessThan(out.text.indexOf('RECENT RUNS'))
  })

  it('renders human ages, not timestamps', () => {
    const out = renderDigest([{ kind: 'idea_proposed', body: RUN2[0], created_at: ago(21) }], { now: NOW })
    expect(out.text).toMatch(/3 weeks ago/)
    expect(out.text).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('is empty rather than a lonely header when there is nothing to say', () => {
    // An empty digest must add NO bytes to the cached prefix.
    expect(renderDigest([], { now: NOW }).text).toBe('')
    expect(renderDigest([{ kind: 'fact', body: 'x', expires_at: ago(1) }], { now: NOW }).text).toBe('')
  })

  it('terminates even when one note alone blows the budget', () => {
    const huge = [{ kind: 'fact', body: 'x'.repeat(40_000), created_at: ago(1) }]
    expect(() => renderDigest(huge, { now: NOW })).not.toThrow()
    expect(renderDigest(huge, { now: NOW }).text).toBe('')
  })

  it('approxTokens over-estimates rather than under', () => {
    expect(approxTokens('a'.repeat(400))).toBeGreaterThanOrEqual(100)
  })
})

describe('the volatile tail — freshness without breaking the cache', () => {
  const notes = [
    { kind: 'fact', body: 'Old, already folded in', created_at: ago(10) },
    { kind: 'correction', body: 'Said five minutes ago', created_at: ago(0) },
  ]

  it('carries only what the digest has not folded in yet', () => {
    const tail = freshTail(notes, ago(5), { now: NOW })
    expect(tail).toMatch(/Said five minutes ago/)
    expect(tail).not.toMatch(/already folded in/)
  })

  it('is EMPTY when nothing is new', () => {
    // The request bytes must not change on a quiet turn either, or every turn
    // is a cache miss for no reason.
    expect(freshTail(notes, new Date(NOW.getTime() + 1000).toISOString(), { now: NOW })).toBe('')
    expect(freshTail([], null, { now: NOW })).toBe('')
  })

  it('is bounded, so a burst of notes cannot become a second digest', () => {
    const burst = Array.from({ length: 50 }, (_, i) => ({ kind: 'fact', body: `note ${i}`, created_at: ago(0) }))
    expect(freshTail(burst, ago(1), { now: NOW }).split('\n').length).toBeLessThanOrEqual(10)
  })

  it('treats a missing build time as "nothing folded yet"', () => {
    expect(freshTail(notes, null, { now: NOW })).toMatch(/Old, already folded in/)
  })

  it('excludes expired notes from the tail too', () => {
    expect(freshTail([{ kind: 'fact', body: 'dead', created_at: ago(0), expires_at: ago(1) }], ago(5), { now: NOW }))
      .toBe('')
  })
})

describe('deciding when to pay for a rebuild', () => {
  it('rebuilds once enough has accumulated', () => {
    expect(digestIsStale({ builtThrough: ago(2), unfoldedCount: 5, now: NOW })).toBe(true)
  })

  it('does not rebuild for a single fresh note', () => {
    // A model call per note would cost more than the memory is worth.
    expect(digestIsStale({ builtThrough: ago(2), unfoldedCount: 1, now: NOW })).toBe(false)
  })

  it('DOES fold a lone note in once the digest goes stale with age', () => {
    // Someone who corrected the agent once should not have to correct it twice
    // more before it listens.
    expect(digestIsStale({ builtThrough: ago(20), unfoldedCount: 1, now: NOW })).toBe(true)
  })

  it('builds the first time anything exists at all', () => {
    expect(digestIsStale({ builtThrough: null, unfoldedCount: 1, now: NOW })).toBe(true)
    expect(digestIsStale({ builtThrough: null, unfoldedCount: 0, now: NOW })).toBe(false)
  })

  it('never rebuilds when nothing is unfolded, however old it is', () => {
    // Otherwise an idle workspace pays for a summariser call every week to
    // rewrite the same digest.
    expect(digestIsStale({ builtThrough: ago(1), unfoldedCount: 0, now: NOW })).toBe(false)
    expect(digestIsStale({ builtThrough: ago(400), unfoldedCount: 0, now: NOW })).toBe(false)
  })

  it('survives being handed nothing', () => {
    expect(digestIsStale()).toBe(false)
  })
})
