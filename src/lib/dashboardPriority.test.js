import { describe, it, expect } from 'vitest'
import {
  latestReport, dueLabel, deadlineRows, directionRows, publishRows,
  seoRows, queueRow, priorityRows,
} from './dashboardPriority'

const NOW = new Date('2026-09-17T12:00:00Z')
const inDays = n => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10)

const finding = (headline, over = {}) => ({
  ref: headline.slice(0, 8), headline, lens: 'demand', channel: 'web',
  relevance: 'high', confidence: 0.8, suggested_action: 'Do the thing.', ...over,
})

describe('latestReport', () => {
  it('skips a run that is still going and has no report yet', () => {
    // Pressing the button on the Research page must not blank the dashboard.
    const runs = [
      { id: 'r3', status: 'running', report: null, started_at: '2026-09-17T10:00:00Z' },
      { id: 'r2', status: 'done', report: { findings: [] }, finished_at: '2026-09-14T10:00:00Z' },
    ]
    expect(latestReport(runs).runId).toBe('r2')
    expect(latestReport(runs).runAt).toBe('2026-09-14T10:00:00Z')
  })

  it('skips an empty report object as well as a null one', () => {
    expect(latestReport([{ id: 'a', report: {} }, { id: 'b', report: { findings: [] } }]).runId).toBe('b')
  })

  it('is null when nothing has ever run', () => {
    expect(latestReport([])).toBe(null)
  })
})

describe('dueLabel', () => {
  it('reads like a person would say it', () => {
    expect(dueLabel(0)).toBe('today')
    expect(dueLabel(1)).toBe('tomorrow')
    expect(dueLabel(9)).toBe('in 9 days')
    expect(dueLabel(21)).toBe('in 3 weeks')
    expect(dueLabel(null)).toBe('')
  })
})

describe('deadlineRows', () => {
  it('keeps live dates, soonest first', () => {
    const report = { findings: [
      finding('Tender B closes', { perishable_until: inDays(10) }),
      finding('Tender A closes', { perishable_until: inDays(2) }),
    ] }
    expect(deadlineRows(report, NOW).map(r => r.title)).toEqual(['Tender A closes', 'Tender B closes'])
  })

  it('drops what has already expired', () => {
    // The report keeps expired findings so they can explain a miss; the
    // dashboard is for what can still be acted on.
    const report = { findings: [finding('Closed last week', { perishable_until: inDays(-3) })] }
    expect(deadlineRows(report, NOW)).toHaveLength(0)
  })

  it('ignores findings with no date at all', () => {
    expect(deadlineRows({ findings: [finding('No date on this')] }, NOW)).toHaveLength(0)
  })

  it('marks only the ones inside two weeks as urgent', () => {
    const report = { findings: [
      finding('Soon', { perishable_until: inDays(5) }),
      finding('Later', { perishable_until: inDays(25) }),
    ] }
    expect(deadlineRows(report, NOW).map(r => r.urgent)).toEqual([true, false])
  })
})

describe('directionRows', () => {
  it('uses what the agent wrote, with its so-what', () => {
    const report = { market_direction: [
      { movement: 'Hotels are specifying GRMS with lighting', basis: 'web', so_what: 'Our GRMS page does not exist.' },
    ] }
    const [row] = directionRows(report)
    expect(row.title).toBe('Hotels are specifying GRMS with lighting')
    expect(row.detail).toBe('Our GRMS page does not exist.')
    expect(row.meta).toBe('from what we read')
  })

  it('says so when it had to assemble the direction itself', () => {
    // A synthesis the agent wrote and a list stitched from competitor reads
    // are different claims, and a reader who cannot tell will over-trust.
    const report = { competitor_board: [{ name: 'Rival', read: 'posting facade work weekly' }] }
    expect(directionRows(report)[0].meta).toBe('assembled from competitor reads')
  })

  it('is empty when there is nothing to say', () => {
    expect(directionRows({})).toEqual([])
  })
})

describe('publishRows', () => {
  it('puts the idea under the gap it answers', () => {
    const report = {
      gaps: [{ id: 'G1', gap: 'Nothing published on energy management', suggested_response: 'Write one.' }],
      proposed_ideas: [
        { title: 'Energy management in 3 numbers', angle: 'A short technical brief', answers_ref: { kind: 'gap', id: 'G1' } },
      ],
    }
    const [row] = publishRows(report)
    expect(row.title).toBe('Nothing published on energy management')
    expect(row.detail).toBe('Ready to make: Energy management in 3 numbers')
    expect(row.meta).toBe('1 idea ready')
  })

  it('falls back to the gap\'s own response when no idea answers it', () => {
    const report = { gaps: [{ id: 'G1', gap: 'A gap', suggested_response: 'Do this instead.' }] }
    expect(publishRows(report)[0].detail).toBe('Do this instead.')
  })

  it('still lists ideas that answer nothing', () => {
    // Every idea in every report written before answers_ref existed lands
    // here; dropping them would empty this row type on an older report.
    const report = { proposed_ideas: [{ title: 'Old idea', angle: 'from before' }] }
    expect(publishRows(report).map(r => r.title)).toEqual(['Old idea'])
  })
})

describe('seoRows', () => {
  it('takes only what the rules called urgent', () => {
    const recs = [
      { id: 'a', priority: 'high', title: 'Big one', action: 'Fix it', impressions: 412 },
      { id: 'b', priority: 'medium', title: 'Smaller', action: 'Later' },
    ]
    expect(seoRows(recs).map(r => r.title)).toEqual(['Big one'])
    expect(seoRows(recs)[0].meta).toBe('412 impressions')
  })
})

describe('queueRow', () => {
  it('collapses many stuck posts into one trip to the queue', () => {
    const row = queueRow([
      { publish_status: 'failed' }, { publish_status: 'failed' }, { publish_status: 'not_published' },
    ])
    expect(row.title).toBe('2 failed to publish · 1 made but never booked')
    expect(row.urgent).toBe(true)
  })

  it('is not urgent when nothing actually failed', () => {
    expect(queueRow([{ publish_status: 'not_published' }]).urgent).toBe(false)
  })

  it('is null when the queue is clean', () => {
    expect(queueRow([])).toBe(null)
  })
})

describe('priorityRows', () => {
  const report = {
    findings: [finding('Tender closes', { perishable_until: inDays(4) })],
    market_direction: [{ movement: 'Market moving', basis: 'web', so_what: 'So do this.' }],
    gaps: [{ id: 'G1', gap: 'A content gap' }],
    proposed_ideas: [{ title: 'An idea', answers_ref: { kind: 'gap', id: 'G1' } }],
  }
  const recs = [{ id: 's1', priority: 'high', title: 'Website thing', action: 'Fix' }]
  const attention = [{ publish_status: 'failed' }]

  it('leads with the clock, then fixes, then direction, then what to publish', () => {
    const rows = priorityRows({ report, recommendations: recs, attention, now: NOW })
    expect(rows.map(r => r.kind)).toEqual(['deadline', 'fix', 'fix', 'direction', 'publish'])
  })

  it('puts what is BROKEN ahead of what is merely an opportunity', () => {
    // A failed post is broken; a Search Console recommendation is an
    // opportunity. Both are "fix", and the order between them is not arbitrary.
    const rows = priorityRows({ report, recommendations: recs, attention, now: NOW })
    expect(rows.filter(r => r.kind === 'fix').map(r => r.tag)).toEqual(['posts', 'website'])
  })

  it('never lets one busy kind push the others off the list', () => {
    // A real week: three live tenders, three urgent website items and a failed
    // post is seven rows before anything about what to PUBLISH gets a look in.
    // Without per-kind caps the content gaps fall off the bottom every time.
    const busy = {
      ...report,
      findings: [
        finding('Tender one', { perishable_until: inDays(1) }),
        finding('Tender two', { perishable_until: inDays(2) }),
        finding('Tender three', { perishable_until: inDays(3) }),
        finding('Tender four', { perishable_until: inDays(4) }),
      ],
    }
    const manyRecs = [1, 2, 3, 4].map(n => ({ id: `s${n}`, priority: 'high', title: `Site ${n}`, action: 'Fix' }))
    const kinds = new Set(priorityRows({
      report: busy, recommendations: manyRecs, attention, now: NOW,
    }).map(r => r.kind))
    expect([...kinds].sort()).toEqual(['deadline', 'direction', 'fix', 'publish'])
  })

  it('backfills from other kinds when one is empty, rather than going short', () => {
    // A quiet week with no deadlines should not mean a four-row list when
    // there are more gaps worth showing.
    const noDates = {
      ...report,
      findings: [],
      gaps: [
        { id: 'G1', gap: 'Gap one' }, { id: 'G2', gap: 'Gap two' },
        { id: 'G3', gap: 'Gap three' }, { id: 'G4', gap: 'Gap four' },
      ],
      proposed_ideas: [],
    }
    const rows = priorityRows({ report: noDates, recommendations: recs, attention, now: NOW })
    expect(rows.filter(r => r.kind === 'publish').length).toBeGreaterThan(2)
  })

  it('every row carries its kind, so one list still scans as four', () => {
    for (const row of priorityRows({ report, recommendations: recs, attention, now: NOW })) {
      expect(row.tag).toBeTruthy()
      expect(row.title).toBeTruthy()
    }
  })

  it('works with no research at all — the website and the queue still fill it', () => {
    const rows = priorityRows({ report: null, recommendations: recs, attention, now: NOW })
    expect(rows.map(r => r.kind)).toEqual(['fix', 'fix'])
  })

  it('is empty when there is genuinely nothing to do', () => {
    expect(priorityRows({ report: null, recommendations: [], attention: [], now: NOW })).toEqual([])
  })

  it('honours the limit', () => {
    expect(priorityRows({ report, recommendations: recs, attention, now: NOW, limit: 2 })).toHaveLength(2)
  })
})
