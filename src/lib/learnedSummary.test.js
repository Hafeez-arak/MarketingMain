import { describe, it, expect } from 'vitest'
import { summarise, nextStep, learningLine, daysSinceRun, ageLabel, STALE_AFTER_DAYS } from './learnedSummary'

const NOW = new Date('2026-09-12T09:00:00Z')
const runWith = (report = {}, extra = {}) => ({
  id: 'r1', status: 'complete', started_at: '2026-09-12T08:00:00Z',
  finished_at: '2026-09-12T08:06:00Z', report, ...extra,
})
const dated = (headline, until) => ({ headline, perishable_until: until, confidence: 0.8, suggested_action: 'Do the thing.' })

describe('the next step is the whole point of a summary', () => {
  it('leads with a deadline, because a missed one is gone forever', () => {
    const s = nextStep({
      run: runWith({ findings: [dated('National Day', '2026-09-23')] }),
      proposedRules: 4,
      gaps: [{ what: 'x', fix: 'y', to: '/z' }],
      now: NOW,
    })
    expect(s.kind).toBe('deadline')
    expect(s.text).toMatch(/National Day/)
    expect(s.text).toMatch(/in 11 days/)
  })

  it('falls to unreviewed proposals, which do nothing until approved', () => {
    const s = nextStep({ run: runWith({ findings: [] }), proposedRules: 3, now: NOW })
    expect(s.kind).toBe('review')
    expect(s.text).toMatch(/3 proposed rules/)
    expect(s.text).toMatch(/steers nothing/)
  })

  it('says when the research itself has gone stale', () => {
    const old = runWith({ findings: [] }, { finished_at: '2026-08-20T08:00:00Z' })
    const s = nextStep({ run: old, proposedRules: 0, now: NOW })
    expect(s.kind).toBe('stale')
    expect(s.text).toMatch(/23 days ago/)
  })

  it('says plainly when no research has ever run', () => {
    const s = nextStep({ run: null, now: NOW })
    expect(s.kind).toBe('no_research')
    expect(s.action).toBe('Run research')
  })

  it('falls last to setup gaps, which cost accuracy rather than opportunity', () => {
    const s = nextStep({
      run: runWith({ findings: [] }),
      proposedRules: 0,
      gaps: [{ what: 'No market is set.', fix: 'Set geography.', to: '/brand-brain' }],
      now: NOW,
    })
    expect(s.kind).toBe('setup')
    expect(s.detail).toBe('Set geography.')
  })

  it('returns NOTHING when there is genuinely nothing to do', () => {
    // A page that always manufactures an urgent action teaches people to
    // ignore the urgent ones.
    expect(nextStep({ run: runWith({ findings: [] }), proposedRules: 0, gaps: [], now: NOW })).toBeNull()
  })
})

describe('the summary tells the truth about how little is known', () => {
  it('says so when nothing is steering generation', () => {
    // True for every workspace here today. Dressing it up is the fastest way
    // to lose a reader's trust.
    expect(learningLine(summarise({ now: NOW }))).toMatch(/Nothing is steering generation/)
  })

  it('shows where the active rules came from', () => {
    const s = summarise({
      memory: [
        { status: 'active', source: 'research' },
        { status: 'active', source: 'analytics' },
        { status: 'active', source: 'human' },
        { status: 'proposed', source: 'research' },
      ],
      now: NOW,
    })
    expect(s.learned).toMatchObject({ active: 3, proposed: 1, fromResearch: 1, fromAnalytics: 1, byHand: 1 })
  })

  it('gates the performance half on sample size rather than showing noise', () => {
    expect(summarise({ performance: { postsWithMetrics: 1 }, now: NOW }).ourWork.usable).toBe(false)
    expect(summarise({ performance: { postsWithMetrics: 9 }, now: NOW }).ourWork.usable).toBe(true)
  })

  it('counts a missing measurement as absent, not as zero posts', () => {
    // Number(null) is 0 and this codebase has been bitten by it five times.
    expect(summarise({ performance: { postsWithMetrics: null }, now: NOW }).ourWork.postsMeasured).toBe(0)
    expect(summarise({ now: NOW }).ourWork.usable).toBe(false)
  })

  it('separates lenses that ran from lenses that failed', () => {
    const s = summarise({
      run: runWith({ lenses: [{ ran: true }, { ran: true }, { ran: false }] }),
      now: NOW,
    })
    expect(s.market.lensesRan).toBe(2)
    expect(s.market.lensesFailed).toBe(1)
  })

  it('marks research stale past the threshold', () => {
    const old = runWith({}, { finished_at: '2026-08-01T00:00:00Z' })
    expect(summarise({ run: old, now: NOW }).market.stale).toBe(true)
    expect(summarise({ run: runWith(), now: NOW }).market.stale).toBe(false)
    expect(STALE_AFTER_DAYS).toBeGreaterThan(7)
  })

  it('survives a brand with no history of any kind', () => {
    const s = summarise({ now: NOW })
    expect(s.market.hasRun).toBe(false)
    expect(s.next.kind).toBe('no_research')
    expect(s.blocking).toEqual([])
  })
})

describe('run age', () => {
  it('counts from when the run finished', () => {
    expect(daysSinceRun(runWith({}, { finished_at: '2026-09-05T09:00:00Z' }), NOW)).toBe(7)
  })

  it('falls back to the start when a run never finished', () => {
    expect(daysSinceRun({ started_at: '2026-09-10T09:00:00Z' }, NOW)).toBe(2)
  })

  it('is null rather than zero when there is no run', () => {
    expect(daysSinceRun(null, NOW)).toBeNull()
    expect(daysSinceRun({ finished_at: 'nonsense' }, NOW)).toBeNull()
  })
})

describe('run age in words', () => {
  it('never says "0d ago", which reads like an unfinished placeholder', () => {
    expect(ageLabel(0)).toBe('today')
    expect(ageLabel(1)).toBe('yesterday')
    expect(ageLabel(6)).toBe('6 days ago')
  })

  it('says "never" rather than showing a null', () => {
    expect(ageLabel(null)).toBe('never')
    expect(ageLabel(undefined)).toBe('never')
  })
})
