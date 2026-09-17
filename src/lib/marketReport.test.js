import { describe, it, expect } from 'vitest'
import runs from '../dev/runsFixture.json'
import {
  teamsOf, topThree, salesRows, competitorMoves, socialActivity, upcomingEvents, eventsView, marketNotes,
  marketingRecommendations, openItems,
  newCompetitors, sourceList, sectionVisible, dayLabel, resolveRefs,
  searchDemand,
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

  it('keeps the computed calendar dates out of the expo table and in their own band', () => {
    const view = eventsView({ report: OLD, now: NOW })
    expect(view.dates.some(r => r.kind === 'calendar' && /National Day/.test(r.name))).toBe(true)
    // A public holiday is not something anyone exhibits at. Listing it among
    // the expos made an empty events table look full — the 15 Sep failure.
    expect(upcomingEvents({ report: OLD, now: NOW }).some(r => r.kind === 'calendar')).toBe(false)
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

describe('events in three bands', () => {
  const now = new Date('2026-09-15T08:00:00Z')
  const store = [
    { id: 'a', name: 'Buyers Property Expo 2026', start_date: '2026-10-20', end_date: '2026-10-23', exhibitor_deadline: '2026-09-30' },
    { id: 'b', name: 'Tech Conference 2027', start_date: '2027-02-08', end_date: '2027-02-11', exhibitor_deadline: '2026-11-15' },
    { id: 'c', name: 'Tech Conference 2026', start_date: '2026-02-09', end_date: '2026-02-12', takeaway: 'Technolight showed KNX' },
    { id: 'd', name: 'Old Show 2025', start_date: '2025-03-01', end_date: '2025-03-03' },
    { id: 'e', name: 'Industry Week', start_date: null },
  ]

  it('puts imminent, later-this-year and recently-ended events in their own bands', () => {
    const v = eventsView({ events: store, now })
    expect(v.soon.map(e => e.id)).toEqual(['a'])
    expect(v.later.map(e => e.id)).toEqual(['b', 'e'])
    expect(v.recent.map(e => e.id)).toEqual(['c'])
    expect(v.recent[0].takeaway).toBe('Technolight showed KNX')
  })

  it('an event the run found but the store lacks still shows, and an ended one carries what came of it', () => {
    const report = { findings: [
      { lens: 'events', headline: 'Expo X 2026 ended', detail: 'Three developers launched towers', sources: [{ url: 'https://x.com' }], event: { name: 'Expo X 2026', start_date: '2026-05-01', end_date: '2026-05-03' } },
      { lens: 'events', headline: 'Tech Conference 2027 dates', sources: [{ url: 'https://t.com' }], event: { name: 'Tech Conference 2027', start_date: '2027-02-08' } },
    ] }
    const v = eventsView({ report, events: store, now })
    expect(v.recent.map(e => e.name)).toContain('Expo X 2026')
    expect(v.recent.find(e => e.name === 'Expo X 2026').takeaway).toBe('Three developers launched towers')
    expect(v.later.filter(e => /Tech Conference 2027/.test(e.name))).toHaveLength(1)
  })
})

// ─── What the 15 Sep report got wrong ──────────────────────────────────────
// Each of these is a line from the review of that report, turned into a test.

describe('the lead table holds leads, not competitor intelligence', () => {
  const report = {
    findings: [
      // The three rows that made "Sales: act now" unusable: competitor
      // findings, typed PROJECT · MEDIUM, duplicated two pages down under
      // Competitor moves.
      { ref: 'F1', lens: 'rivals', headline: 'Datacore sells GRMS to hotels', competitor: 'Datacore', for_whom: 'sales', relevance: 'medium', sources: [{ url: 'https://datacore.sa' }] },
      { ref: 'F2', lens: 'openings', headline: 'Mondrian Riyadh is in design', for_whom: 'sales', relevance: 'high', lead: { name: 'Mondrian Riyadh', stage: 'Detailed design' }, sources: [{ url: 'https://meed.com/m' }] },
      // A rival ON a project we want is still a lead — it carries a name.
      { ref: 'F3', lens: 'rivals', headline: 'Huda won the Diriyah package', competitor: 'Huda Lighting', for_whom: 'sales', relevance: 'high', lead: { name: 'Diriyah Gate package 4' }, sources: [{ url: 'https://meed.com/d' }] },
    ],
  }

  it('drops a competitor finding with nobody to call, and keeps one that names a project', () => {
    const names = salesRows({ report, now: NOW }).open.map(r => r.name)
    expect(names).not.toContain('Datacore sells GRMS to hotels')
    expect(names).toEqual(expect.arrayContaining(['Mondrian Riyadh', 'Diriyah Gate package 4']))
  })

  it('gives an undated lead a window from its stage, labelled as an estimate', () => {
    const row = salesRows({ report, now: NOW }).open.find(r => r.name === 'Mondrian Riyadh')
    expect(row.window.basis).toBe('stage')
    expect(row.window.label).toMatch(/design/)
  })

  it('says plainly when there is no window at all rather than printing a blank', () => {
    const { open } = salesRows({ report: {}, opportunities: [{ id: 'o1', name: 'Riyadh hotel', status: 'new' }], now: NOW })
    expect(open[0].window).toEqual({ label: expect.stringMatching(/no window established/), basis: 'unknown' })
  })

  it('a published deadline still wins, and says so', () => {
    const { open } = salesRows({ report: {}, opportunities: [{ id: 'o1', name: 'X', status: 'new', deadline: '2026-09-25', timing: 'open' }], now: NOW })
    expect(open[0].window).toEqual({ label: 'in 10 days', basis: 'deadline' })
  })
})

describe('significance and freshness are separate axes', () => {
  const report = {
    findings: [
      { ref: 'F1', lens: 'rivals', headline: 'Datacore standing page', competitor: 'Datacore', store: { state: 'seen' }, sources: [{ url: 'https://d.sa' }] },
      { ref: 'F2', lens: 'rivals', headline: 'Huda hired KNX', competitor: 'Huda Lighting', store: { state: 'new' }, sources: [{ url: 'https://b.com' }] },
    ],
    competitor_moves: [
      { competitor: 'Datacore', what_changed: 'Confirmation of current state', relevance: 'high', refs: ['F1'] },
      { competitor: 'Huda Lighting', what_changed: 'Hiring KNX', relevance: 'high', refs: ['F2'] },
    ],
  }

  it('a standing fact about a serious rival keeps its significance and loses its freshness', () => {
    const items = competitorMoves(report).items
    const datacore = items.find(m => m.competitor === 'Datacore')
    expect(datacore.relevance).toBe('high')
    expect(datacore.freshness).toBe('standing')
    // And what actually moved this week sorts above it.
    expect(items[0].competitor).toBe('Huda Lighting')
  })

  it('a move built only from earlier weeks\' signals is standing, not new', () => {
    const only = { signal_refs: [{ ref: 'S1', summary: 'x', source_url: 'https://x.com' }], competitor_moves: [{ competitor: 'A', relevance: 'medium', refs: ['S1'] }] }
    expect(competitorMoves(only).items[0].freshness).toBe('standing')
  })
})

describe('events carry their deadline status every week', () => {
  const now = new Date('2026-09-15T08:00:00Z')

  it('says whether the exhibitor deadline is open, closed or was never established', () => {
    const v = eventsView({ events: [
      { id: 'a', name: 'Saudi Build 2026', start_date: '2026-11-02', end_date: '2026-11-05', exhibitor_deadline: '2026-10-01' },
      { id: 'b', name: 'Saudi Elenex 2026', start_date: '2026-11-02', end_date: '2026-11-05' },
      { id: 'c', name: 'Late Expo 2026', start_date: '2026-10-20', exhibitor_deadline: '2026-09-10' },
    ], now })
    const by = Object.fromEntries(v.soon.map(e => [e.id, e.deadlineStatus]))
    expect(by.a).toBe('open, in 16 days')
    expect(by.b).toBe('not established')
    expect(by.c).toBe('closed 5 days ago')
  })
})

describe('recommendations are numbered as one list', () => {
  it('numbers the loose ideas after the gap-backed ones instead of leaving them unnumbered', () => {
    const plan = marketingRecommendations({
      gaps: [{ id: 'G1', gap: 'One' }, { id: 'G2', gap: 'Two' }],
      proposed_ideas: [
        { title: 'Answers G1', answers_ref: { kind: 'gap', id: 'G1' } },
        { title: 'National Day piece', answers_ref: null },
        { title: 'Another loose one', answers_ref: null },
      ],
    })
    expect(plan.blocks.map(b => b.n)).toEqual([1, 2])
    expect(plan.loose.map(l => l.n)).toEqual([3, 4])
    expect(plan.total).toBe(4)
    expect(plan.overCap).toBe(false)
  })
})

describe('open items carry forward across runs', () => {
  const runs = [
    { id: 'r3', started_at: '2026-09-15T06:00:00Z', report: { unanswered: ['The Instagram account is not connected, so our own engagement cannot be measured.', 'A one-off note about this week.'] } },
    { id: 'r2', started_at: '2026-09-08T06:00:00Z', report: { unanswered: ['The Instagram account is not connected, so our own engagement cannot be measured.', 'arak-sa.com/about-us returns 404, a pre-tender credibility risk.'] } },
    { id: 'r1', started_at: '2026-09-01T06:00:00Z', report: { unanswered: ['arak-sa.com/about-us returns 404, a pre-tender credibility risk.'] } },
  ]

  it('names what has been raised more than once, with the date it was first raised', () => {
    const items = openItems({ runs })
    const ig = items.find(i => /Instagram/.test(i.text))
    expect(ig).toMatchObject({ runs: 2, firstRaised: '2026-09-08', thisRun: true })
    // Raised twice and NOT repeated this run — still open until a person says
    // otherwise, which is exactly the item that used to vanish silently.
    const four04 = items.find(i => /about-us/.test(i.text))
    expect(four04).toMatchObject({ runs: 2, thisRun: false })
  })

  it('drops a one-off note from an older run rather than nagging forever', () => {
    expect(openItems({ runs }).some(i => /one-off/.test(i.text))).toBe(true)
    expect(openItems({ runs: runs.slice(1) }).some(i => /one-off/.test(i.text))).toBe(false)
  })
})

describe('what is not known is not asserted', () => {
  it('an old brief\'s competitor reads carry no freshness claim at all', () => {
    const { items } = competitorMoves(OLD)
    expect(items.every(m => m.freshness === '')).toBe(true)
  })

  it('a lead the lens established as closed says so rather than guessing from its name', () => {
    const { open } = salesRows({
      report: {},
      opportunities: [{ id: 'o1', name: 'Tuwaiq Palace retender', status: 'new', timing: 'closed' }],
      now: NOW,
    })
    expect(open[0].window).toEqual({ label: 'the published window has closed', basis: 'deadline' })
  })
})

describe('searchDemand', () => {
  const f = (o = {}) => ({ lens: 'search', relevance: 'medium', ...o })

  it('distinguishes a lens that never ran from one that ran and found nothing', () => {
    expect(searchDemand({ findings: [] }).present).toBe(false)
    const quiet = searchDemand({ findings: [f({ headline: 'no queries', evidence: { all: { clicks: 0, impressions: 0, queries: 0 } } })] })
    expect(quiet.present).toBe(true)
    expect(quiet.opportunities).toEqual([])
  })

  it('separates the queries we can win from the ones that merely moved', () => {
    const view = searchDemand({
      findings: [
        f({ headline: 'summary', evidence: { all: { clicks: 3 }, byLine: [{ key: 'controls', label: 'Controls', impressions: 400 }] } }),
        f({ headline: 'appear, no clicks', category: 'content', suggested_action: 'rewrite the title', evidence: { query: 'grms saudi' } }),
        f({ headline: 'rose', category: 'other', evidence: { state: 'rising', query: 'knx' } }),
      ],
    })
    expect(view.opportunities).toHaveLength(1)
    expect(view.opportunities[0].action).toBe('rewrite the title')
    expect(view.movers).toHaveLength(1)
    expect(view.byLine[0].label).toBe('Controls')
  })

  it('carries the business line through to the row, so the page can filter on it', () => {
    const view = searchDemand({
      findings: [f({ headline: 'x', category: 'content', line: 'controls', evidence: { query: 'knx' } })],
    })
    expect(view.opportunities[0].line).toBe('controls')
  })

  it('ignores findings from every other lens', () => {
    expect(searchDemand({ findings: [{ lens: 'rivals', headline: 'x' }] }).present).toBe(false)
  })
})

describe('socialActivity and the watchlist', () => {
  const sig = (competitor, o = {}) => ({ competitor, channel: 'linkedin', summary: 'posted', source_url: 'https://x', first_seen_at: '2026-09-14', last_seen_at: '2026-09-14', ...o })
  const NOW = new Date('2026-09-17T00:00:00Z')

  it('drops a competitor that is no longer watched', () => {
    const out = socialActivity({ signals: [sig('Datacore'), sig('Huda Lighting')], watching: ['Huda Lighting'], now: NOW })
    expect(out.theirs.map(t => t.competitor)).toEqual(['Huda Lighting'])
  })

  it('filters on nothing when no watchlist is passed, rather than blanking the section', () => {
    // An agenda load that failed must not read as "no competitors are active".
    const out = socialActivity({ signals: [sig('Datacore')], now: NOW })
    expect(out.theirs).toHaveLength(1)
  })

  it('treats an empty watchlist as no watchlist, for the same reason', () => {
    const out = socialActivity({ signals: [sig('Datacore')], watching: [], now: NOW })
    expect(out.theirs).toHaveLength(1)
  })
})
