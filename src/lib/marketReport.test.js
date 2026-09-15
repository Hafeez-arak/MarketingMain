import { describe, it, expect } from 'vitest'
import runs from '../dev/runsFixture.json'
import {
  teamsOf, topThree, salesRows, competitorMoves, socialActivity, upcomingEvents, marketNotes,
  newCompetitors, sourceList, sectionVisible, dayLabel, resolveRefs,
} from './marketReport'

// The real 14 Sep 2026 Arak brief — written before any of the three-reader
// fields existed. Every selector must still make something useful of it.
const OLD = runs[0].report
const NOW = new Date('2026-09-15T08:00:00Z')

describe('an old brief renders in the new layout', () => {
  it('its leads reach sales instead of sitting among post ideas', () => {
    const { open, trackerAvailable } = salesRows({ report: OLD, now: NOW })
    expect(trackerAvailable).toBe(false)
    const names = open.map(r => r.name).join(' | ')
    expect(names).toMatch(/Tuwaiq Palace/)
    expect(names).toMatch(/Mondrian Riyadh/)
    expect(open.every(r => r.id === null)).toBe(true)
  })

  it('never offers our own posting numbers as a top item', () => {
    const { items, derived } = topThree(OLD, NOW)
    expect(derived).toBe(true)
    expect(items).toHaveLength(3)
    for (const i of items) expect(i.finding).not.toMatch(/^Our /)
  })

  it('assembles competitor moves from the per-rival reads it carries', () => {
    const { items, derived } = competitorMoves(OLD)
    expect(derived).toBe(true)
    expect(items.map(m => m.competitor)).toEqual(expect.arrayContaining(['Huda Lighting', 'Technolight']))
  })

  it('shows what rivals posted about, with no follower counts anywhere', () => {
    const { theirs, ours } = socialActivity({ report: OLD, now: NOW })
    const huda = theirs.find(t => t.competitor === 'Huda Lighting')
    expect(huda.items[0].text).toBeTruthy()
    expect(JSON.stringify(theirs)).not.toMatch(/followers/)
    expect(ours.map(p => p.platform)).toEqual(expect.arrayContaining(['instagram', 'linkedin']))
  })

  it('puts the computed calendar dates in the events table', () => {
    const rows = upcomingEvents({ report: OLD, now: NOW })
    expect(rows.some(r => r.kind === 'calendar' && /National Day/.test(r.name))).toBe(true)
  })

  it('keeps SASO and Mostadam in market & technical notes', () => {
    const notes = marketNotes(OLD, NOW).map(n => n.headline).join(' ')
    expect(notes).toMatch(/SASO/)
    expect(notes).toMatch(/Mostadam/)
  })

  it('lists every cited source once', () => {
    const list = sourceList(OLD)
    expect(list.length).toBeGreaterThan(3)
    expect(new Set(list.map(s => s.url)).size).toBe(list.length)
  })
})

describe('a new brief uses what the agent wrote', () => {
  const report = {
    findings: [
      { ref: 'F1', lens: 'rivals', headline: 'Huda posted a KNX engineer role in Jeddah', competitor: 'Huda Lighting', channel: 'jobs', relevance: 'medium', sources: [{ url: 'https://bayt.com/x' }] },
      { ref: 'F2', lens: 'openings', headline: 'Mondrian Riyadh names a contractor', for_whom: 'sales', relevance: 'high', lead: { name: 'Mondrian Riyadh', contractor: 'Nesma' }, sources: [{ url: 'https://meed.com/m' }], store: { state: 'changed', changes: ['contractor now Nesma'] } },
      { ref: 'F3', lens: 'category', headline: 'Background item', relevance: 'low', sources: [{ url: 'https://low.com' }] },
    ],
    signal_refs: [{ ref: 'S1', competitor: 'Huda Lighting', channel: 'linkedin', summary: 'Huda signed a new Italian brand', source_url: 'https://linkedin.com/posts/huda', date: '2026-09-01' }],
    top_three: [{ finding: 'Mondrian Riyadh now has a contractor', action: 'Call Nesma this week', team: 'sales', refs: ['F2'] }],
    competitor_moves: [{ competitor: 'Huda Lighting', what_changed: 'Hiring KNX in Jeddah', picture: 'Two pieces in a month point at a Jeddah smart-building push', effect_on_us: 'Brief sales on Jeddah hotels', relevance: 'high', refs: ['F1', 'S1', 'S9'] }],
    new_competitors: [{ name: 'Nouran Lighting', why: 'Full-service lighting in Riyadh' }],
  }

  it('resolves both this week\'s findings and stored signals, dropping dead refs', () => {
    const pieces = resolveRefs(['F1', 'S1', 'S9'], report)
    expect(pieces.map(p => p.kind)).toEqual(['finding', 'signal'])
  })

  it('a combined move carries every channel it was built from', () => {
    const [m] = competitorMoves(report).items
    expect(m.channels).toEqual(['jobs', 'linkedin'])
    expect(m.pieces).toHaveLength(2)
  })

  it('a changed lead says what changed', () => {
    const [row] = salesRows({ report, now: NOW }).open
    expect(row.changed).toBe('contractor now Nesma')
    expect(row.details).toContain('Contractor: Nesma')
  })

  it('prefers the tracker row and does not list the lead twice', () => {
    const opportunities = [{ id: 'o1', name: 'Mondrian Riyadh hotel', status: 'assigned', relevance: 'high', first_run_id: 'r0', last_run_id: 'r1', last_change: 'contractor now Nesma' }]
    const { open } = salesRows({ report, opportunities, runId: 'r1', now: NOW })
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ id: 'o1', status: 'assigned', changed: 'contractor now Nesma' })
  })

  it('a lead a person dropped leaves the open list', () => {
    const { open, closed } = salesRows({ report: {}, opportunities: [{ id: 'o1', name: 'X', status: 'dropped' }], now: NOW })
    expect(open).toHaveLength(0)
    expect(closed).toHaveLength(1)
  })

  it('low relevance is stored, never reported', () => {
    expect(sourceList(report).map(s => s.domain)).not.toContain('low.com')
    expect(marketNotes(report, NOW).map(n => n.headline)).not.toContain('Background item')
  })

  it('merges this run\'s new competitors with older undecided proposals', () => {
    const rows = newCompetitors({ report, agendaCompetitors: [
      { id: 'a1', subject: 'Datacore', status: 'proposed' },
      { id: 'a2', subject: 'Technolight', status: 'active' },
    ] })
    expect(rows.map(r => r.name)).toEqual(['Nouran Lighting', 'Datacore'])
  })
})

describe('the team filter', () => {
  it('a lead is sales, a certification with an angle is marketing and technical', () => {
    expect(teamsOf({ for_whom: 'sales', lead: { name: 'X' } })).toEqual(['sales'])
    expect(teamsOf({ for_whom: 'both' })).toEqual(['marketing', 'technical'])
    expect(teamsOf({ lens: 'openings', for_whom: 'marketing' })).toEqual(['marketing', 'sales'])
  })

  it('sales does not see social activity; technical does not see the lead table', () => {
    expect(sectionVisible('social', 'sales')).toBe(false)
    expect(sectionVisible('sales', 'technical')).toBe(false)
    expect(sectionVisible('sources', 'technical')).toBe(true)
    expect(sectionVisible('social', 'all')).toBe(true)
  })

  it('labels deadlines honestly', () => {
    expect(dayLabel(null, 'unconfirmed')).toBe('unconfirmed')
    expect(dayLabel(-3)).toBe('passed 3 days ago')
    expect(dayLabel(1)).toBe('in 1 day')
  })
})

describe('market notes do not repeat themselves', () => {
  it('drops the synthesis restatement of a finding already listed, and of a lead', () => {
    const notes = marketNotes(OLD, NOW).map(n => n.headline)
    // Seven market items in the 14 Sep brief, every one a restatement.
    expect(notes.filter(h => /^Riyadh's hotel pipeline/.test(h))).toHaveLength(0)
    expect(notes.filter(h => /Mostadam/.test(h))).toHaveLength(1)
  })
})
