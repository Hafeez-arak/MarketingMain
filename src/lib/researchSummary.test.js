import { describe, it, expect } from 'vitest'
import {
  hasAnalysis, usableReport, keyPoints, runScale, scaleLine, summariseRuns,
} from './researchSummary'

// Shaped after Arak's real 17 Sep run: complete, 33 findings, a strong
// headline, and every single synthesis section empty because it spent $15.06
// of a $15.00 monthly cap before it could analyse anything.
const cappedRun = {
  id: 'run-capped', status: 'complete', started_at: '2026-09-17T07:52:09Z', finished_at: '2026-09-17T07:55:07Z',
  report: {
    headline: 'Two landmark Riyadh projects named their design teams this week.',
    stage_reached: 'synthesise',
    findings: Array.from({ length: 33 }, (_, i) => ({ ref: `F${i}` })),
    top_three: [], market_direction: [], competitor_moves: [], gaps: [], proposed_ideas: [],
    unanswered: ['The investigation did not complete, so this brief is the measured numbers only. This workspace has used its $15.00 agent budget for the month.'],
    competitor_board: [{ name: 'Huda' }],
  },
}

const goodRun = {
  id: 'run-good', status: 'complete', started_at: '2026-09-15T12:47:52Z', finished_at: '2026-09-15T12:55:14Z',
  report: {
    headline: 'The sales pipeline moved this week, not the board.',
    findings: Array.from({ length: 19 }, (_, i) => ({ ref: `F${i}` })),
    top_three: [
      { finding: 'Qiddiya stadium is in live tender preparation.', action: 'Confirm pre-qualification this week.', team: 'sales', refs: ['F1'] },
      { finding: 'We put extra output on Instagram, not the LinkedIn page.', action: 'Move two posts to LinkedIn.', team: 'marketing', refs: ['F2'] },
      { finding: 'A third thing.', action: 'Do it.', team: 'technical', refs: ['F3'] },
    ],
    market_direction: [{ movement: 'Rivals are buying showroom space.', basis: 'web', so_what: 'Specifier content is uncontested.' }],
    competitor_moves: [
      { competitor: 'Huda', what_changed: 'Swapped specifier language for showroom reels.', effect_on_us: 'Specifier ground is open.', relevance: 'high', refs: ['F4'] },
      { competitor: 'Technolight', what_changed: 'Hiring KNX engineers.', effect_on_us: 'They are entering controls.', relevance: 'medium', refs: ['F5'] },
    ],
    gaps: [{ id: 'G1', gap: 'Nothing published on energy management.', suggested_response: 'Write a technical brief.' }],
    proposed_ideas: [
      { title: 'Energy management in three numbers', angle: 'Brief', answers: 'G1' },
      { title: 'GRMS retrofit costs', angle: 'From the 240-key job', answers: '' },
    ],
    unanswered: ['Connect ARAK\'s own Instagram to the board.'],
    competitor_board: [{ name: 'Huda' }, { name: 'Technolight' }],
  },
}

describe('hasAnalysis', () => {
  it('is false for a run that gathered plenty and analysed nothing', () => {
    // Findings come from the gather stage, so a run that died before synthesis
    // still has them. They are the evidence, not the conclusion.
    expect(hasAnalysis(cappedRun.report)).toBe(false)
  })

  it('is true when any one section was written', () => {
    expect(hasAnalysis({ gaps: [{ id: 'G1', gap: 'x' }] })).toBe(true)
    expect(hasAnalysis({ market_direction: [{ movement: 'x' }] })).toBe(true)
  })

  it('does not count findings as analysis', () => {
    expect(hasAnalysis({ findings: [{ ref: 'F1' }] })).toBe(false)
  })
})

describe('usableReport', () => {
  it('steps over a crippled run to the last one that actually thought', () => {
    const { runId, runAt } = usableReport([cappedRun, goodRun])
    expect(runId).toBe('run-good')
    expect(runAt).toBe('2026-09-15T12:55:14Z')
  })

  it('reports what it stepped over, so the card can say so', () => {
    const { skipped } = usableReport([cappedRun, goodRun])
    expect(skipped).toHaveLength(1)
    expect(skipped[0].findings).toBe(33)
    expect(skipped[0].headline).toContain('Riyadh')
    expect(skipped[0].reason).toContain('$15.00')
  })

  it('ignores runs with no report at all rather than counting them as skipped', () => {
    // A run still in flight is not a failure worth reporting.
    const running = { id: 'r', status: 'running', report: null }
    expect(usableReport([running, goodRun]).skipped).toHaveLength(0)
  })

  it('returns nothing usable when every run is crippled', () => {
    const { report, skipped } = usableReport([cappedRun])
    expect(report).toBe(null)
    expect(skipped).toHaveLength(1)
  })
})

describe('keyPoints', () => {
  it('prefers top_three — the agent\'s own answer to this exact question', () => {
    const points = keyPoints(goodRun.report)
    expect(points).toHaveLength(2)
    expect(points[0].from).toBe('top_three')
    expect(points[0].note).toBe('Confirm pre-qualification this week.')
  })

  it('falls back to market direction when top_three is empty', () => {
    // Arak's 14 Sep run is exactly this: no top_three, three directions.
    const report = { ...goodRun.report, top_three: [] }
    expect(keyPoints(report)[0].from).toBe('market_direction')
  })

  it('falls back again to competitor moves, naming the rival', () => {
    const report = { ...goodRun.report, top_three: [], market_direction: [] }
    const [first] = keyPoints(report)
    expect(first.from).toBe('competitor_moves')
    expect(first.text).toBe('Huda: Swapped specifier language for showroom reels.')
  })

  it('falls back last to the gaps', () => {
    const report = { ...goodRun.report, top_three: [], market_direction: [], competitor_moves: [] }
    expect(keyPoints(report)[0].from).toBe('gaps')
  })

  it('is empty rather than invented when there is nothing', () => {
    expect(keyPoints({})).toEqual([])
  })
})

describe('scaleLine', () => {
  it('leaves out whatever is zero', () => {
    expect(scaleLine(runScale(goodRun.report))).toBe('19 findings · 2 rivals moved · 1 gap · 2 ideas ready')
  })

  it('is empty for a run that produced nothing countable', () => {
    expect(scaleLine(runScale({}))).toBe('')
  })

  it('gets the singulars right', () => {
    expect(scaleLine({ findings: 1, moves: 1, gaps: 1, ideas: 1 }))
      .toBe('1 finding · 1 rival moved · 1 gap · 1 idea ready')
  })
})

describe('summariseRuns', () => {
  it('summarises the good run and flags the crippled one above it', () => {
    const s = summariseRuns([cappedRun, goodRun])
    expect(s.ok).toBe(true)
    expect(s.headline).toBe('The sales pipeline moved this week, not the board.')
    expect(s.points).toHaveLength(2)
    expect(s.skipped[0].runAt).toBe('2026-09-17T07:55:07Z')
  })

  it('treats "nothing moved" as an answer, not an empty card', () => {
    // The synthesis prompt names this as a complete and correct headline.
    const quiet = {
      id: 'q', report: {
        headline: 'Nothing moved this week.',
        gaps: [{ id: 'G1', gap: 'Still no energy management page.' }],
        findings: [],
      },
    }
    const s = summariseRuns([quiet])
    expect(s.ok).toBe(true)
    expect(s.headline).toBe('Nothing moved this week.')
  })

  it('says nothing has ever run, distinct from a run that found nothing', () => {
    expect(summariseRuns([]).everRan).toBe(false)
    expect(summariseRuns([cappedRun]).everRan).toBe(true)
    expect(summariseRuns([cappedRun]).ok).toBe(false)
  })
})
