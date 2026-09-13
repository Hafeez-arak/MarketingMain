import { describe, it, expect } from 'vitest'
import {
  priorFindingsFrom, matchPrior, applyNovelty, weeksRunning, noveltyLabel,
  repetitionNote, isComputedLens,
} from './novelty.js'

// Real headlines from the live Arak runs, so the thresholds are exercised
// against the text they were measured on rather than against inventions.
const NATIONAL_DAY = 'Saudi National Day is 11 days away and the preparation window is already open.'
const SASO = 'A new mandatory SASO deadline (1 December 2026) for low-voltage electrical/lighting product certification is now on the compliance calendar for anyone specifying or importing lighting in KSA.'
const SBC = "The Saudi Building Code's energy sections (SBC 601/602), overseen jointly by the Saudi Energy Efficiency Center and the National Committee for the Saudi Building Code, already mandate lighting-system energy performance."
const HUDA = 'Huda Lighting is opening a new 737 sqm Riyadh showroom curating 21 international brands.'

const f = (headline, lens = 'category', extra = {}) => ({ headline, lens, novelty: 'new', ...extra })

describe('priorFindingsFrom', () => {
  it('flattens runs into dated findings', () => {
    const out = priorFindingsFrom([
      { started_at: '2026-09-10T12:00:00Z', report: { findings: [{ headline: HUDA, lens: 'rivals' }] } },
      { started_at: '2026-09-12T14:00:00Z', report: { findings: [{ headline: SASO, lens: 'demand' }] } },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].at).toBe('2026-09-10')
    expect(out[0].lens).toBe('rivals')
  })

  it('ignores runs with no findings rather than erroring', () => {
    expect(priorFindingsFrom([{ report: {} }, {}, null])).toEqual([])
    expect(priorFindingsFrom()).toEqual([])
  })

  it('drops a blank headline', () => {
    expect(priorFindingsFrom([{ report: { findings: [{ headline: '   ' }] } }])).toEqual([])
  })
})

describe('matchPrior', () => {
  it('catches a genuine repeat', () => {
    // The real case: the same National Day headline in two runs. Scored 1.00
    // against the live data.
    const hit = matchPrior(f(NATIONAL_DAY, 'calendar'), [{ headline: NATIONAL_DAY, at: '2026-09-12', lens: 'calendar' }])
    expect(hit).toBeTruthy()
    expect(hit.score).toBeGreaterThanOrEqual(0.9)
  })

  it('does not match two genuinely different findings', () => {
    // Measured at 0.03–0.11 across every real cross-run pair.
    expect(matchPrior(f(SASO), [{ headline: HUDA, at: '2026-09-10' }])).toBeNull()
    expect(matchPrior(f(SBC), [{ headline: SASO, at: '2026-09-10' }])).toBeNull()
  })

  it('is null for an empty headline rather than matching everything', () => {
    expect(matchPrior(f(''), [{ headline: SASO, at: 'x' }])).toBeNull()
  })

  it('survives an empty history', () => {
    expect(matchPrior(f(SASO), [])).toBeNull()
    expect(matchPrior(f(SASO))).toBeNull()
  })
})

describe('applyNovelty', () => {
  const prior = [{ headline: NATIONAL_DAY, at: '2026-09-12', lens: 'calendar' }]

  it("overrules the model's guess when it is wrong", () => {
    // THE BUG THIS EXISTS FOR. The model called these "continuing" while
    // having never seen a prior brief; all four were new.
    const out = applyNovelty([f(SBC, 'category', { novelty: 'continuing' })], prior)
    expect(out[0].novelty).toBe('new')
    expect(out[0].novelty_by).toBe('computed')
  })

  it('marks a real repeat continuing, with the date it started', () => {
    const out = applyNovelty([f(NATIONAL_DAY, 'demand', { novelty: 'new' })], prior)
    expect(out[0].novelty).toBe('continuing')
    expect(out[0].first_seen).toBe('2026-09-12')
  })

  it('never infers "changed" from a text match', () => {
    // 'changed' is the badge that makes a finding lead the brief. Two similar
    // sentences do not tell us a number moved.
    const out = applyNovelty([f(NATIONAL_DAY, 'demand')], prior)
    expect(out[0].novelty).not.toBe('changed')
  })

  it('leaves the computed lenses alone', () => {
    // ourselves sets 'changed' from a subtraction over two stored windows;
    // calendar sets 'continuing' from a date it calculated. Both are already
    // right and must not be second-guessed by a text match.
    const out = applyNovelty([
      { headline: 'Our TikTok engagement went up 40%.', lens: 'ourselves', novelty: 'changed' },
      { headline: NATIONAL_DAY, lens: 'calendar', novelty: 'continuing' },
    ], prior)
    expect(out[0].novelty).toBe('changed')
    expect(out[1].novelty).toBe('continuing')
    expect(out.every(o => o.novelty_by === 'computed')).toBe(true)
  })

  it('survives nonsense', () => {
    expect(() => applyNovelty(null, null)).not.toThrow()
    expect(applyNovelty(null, null)).toEqual([])
  })
})

describe('weeksRunning', () => {
  const now = new Date('2026-10-03T00:00:00Z')

  it('is null for something new, so nothing renders "0 weeks"', () => {
    expect(weeksRunning({ novelty: 'new' }, now)).toBeNull()
    expect(weeksRunning({ first_seen: '2026-09-30' }, now)).toBeNull()
  })

  it('counts whole weeks once there are any', () => {
    expect(weeksRunning({ first_seen: '2026-09-12' }, now)).toBe(3)
  })

  it('is null for an unparseable date rather than NaN', () => {
    expect(weeksRunning({ first_seen: 'not a date' }, now)).toBeNull()
  })
})

describe('noveltyLabel', () => {
  const now = new Date('2026-10-03T00:00:00Z')

  it('says how long something has been running', () => {
    expect(noveltyLabel({ novelty: 'continuing', first_seen: '2026-09-12' }, now)).toBe('continuing · 3w')
  })

  it('stays plain when it is too soon to count weeks', () => {
    expect(noveltyLabel({ novelty: 'continuing', first_seen: '2026-10-01' }, now)).toBe('continuing')
  })

  it('passes other states through', () => {
    expect(noveltyLabel({ novelty: 'new' }, now)).toBe('new')
    expect(noveltyLabel({ novelty: 'changed' }, now)).toBe('changed')
  })
})

describe('repetitionNote', () => {
  it('says nothing when everything is new', () => {
    expect(repetitionNote([f(SASO), f(SBC)])).toBe('')
  })

  it('counts partial repetition', () => {
    const out = repetitionNote([f(SASO), { ...f(SBC), novelty: 'continuing' }])
    expect(out).toContain('1 of 2')
  })

  it('calls out a run that found nothing new at all', () => {
    // Worth knowing: either the market is still, or the standing questions
    // need changing. Invisible per-finding.
    const all = [{ ...f(SASO), novelty: 'continuing' }, { ...f(SBC), novelty: 'continuing' }]
    expect(repetitionNote(all)).toContain('Every researched finding')
  })

  it('ignores the computed lenses in the ratio', () => {
    // The calendar says "continuing" every single week by construction, and
    // letting it into this count would report permanent stagnation.
    expect(repetitionNote([
      { headline: NATIONAL_DAY, lens: 'calendar', novelty: 'continuing' },
      f(SASO),
    ])).toBe('')
  })
})

describe('isComputedLens', () => {
  it('knows which lenses measure rather than guess', () => {
    expect(isComputedLens('calendar')).toBe(true)
    expect(isComputedLens('ourselves')).toBe(true)
    expect(isComputedLens('demand')).toBe(false)
    expect(isComputedLens('')).toBe(false)
  })
})
