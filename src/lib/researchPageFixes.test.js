import { describe, it, expect } from 'vitest'
import { computeMovements } from './agent/gather.js'
import { websiteFacts, normaliseWebsiteRead } from './agent/websiteRead.js'
import { runFaults, openItems } from './marketReport.js'
import { ownAccountConnected } from './researchBrief.js'
import { summarise } from './learnedSummary.js'

// The Research page fixes of 2026-10-13, each against the case that prompted it.

describe('our account changed under the same name', () => {
  const now = [{ competitor_name: 'Us', ig_handle: 'araklighting', data_source: 'instagram', followers: 851, posts_per_week: 1 }]

  it('does not compare the real account with the test account it replaced', () => {
    const prior = [{ competitor_name: 'Us', ig_handle: 'lightingaaa', followers: 2, posts_per_week: 0, captured_at: '2026-10-05' }]
    expect(computeMovements(now, prior).movements).toEqual([])
  })

  it('still compares a week with the week before on the same account', () => {
    const prior = [{ competitor_name: 'Us', ig_handle: 'araklighting', followers: 400, posts_per_week: 1, captured_at: '2026-10-05' }]
    expect(computeMovements(now, prior).movements.map(m => m.metric)).toContain('followers')
  })
})

describe('the website facts the agent reads', () => {
  const search = {
    ok: true,
    windows: { current: { start: '2026-09-13', end: '2026-10-10' } },
    types: { web: { clicks: 160, impressions: 3361, ctr: 0.0476, position: 13.1, previous: { clicks: 117, impressions: 2469, ctr: 0.047, position: 16.8 } } },
    queries: [
      { query: 'arak lighting', clicks: 40, impressions: 57, position: 1.1 },
      { query: 'lighting consultant riyadh', clicks: 0, impressions: 185, position: 12.6 },
    ],
    pages: [{ query: 'lighting consultant riyadh', page: 'https://arak-sa.com/', impressions: 185 }],
  }
  const ga4 = {
    ok: true,
    totals: { sessions: 458, totalUsers: 384, engagementRate: 0.419 },
    previousTotals: { sessions: 0 },
    keyEvents: [{ eventName: 'ads_conversion_Contact_Us_1', keyEvents: 36 }, { eventName: 'ads_conversion_Contact_Us_1', keyEvents: 4 }],
    collected: [{ date: '2026-09-27' }, { date: '2026-09-28' }],
  }
  const facts = websiteFacts({ search, ga4, brandTerms: ['arak'] })

  it('splits people who searched our name from people who did not', () => {
    expect(facts.google_search.searching_our_name.clicks).toBe(40)
    expect(facts.google_search.not_searching_our_name.impressions).toBe(185)
    expect(facts.google_search.top_other_queries[0]).toMatchObject({ query: 'lighting consultant riyadh', lands_on: '/' })
  })

  it('reads a pre-tracking period as no comparison, not as a fall to zero', () => {
    expect(facts.visits.previous).toBeNull()
    expect(facts.visits.tracking_started).toBe('2026-09-27')
    expect(facts.visits.enquiries).toEqual([{ event: 'ads_conversion_Contact_Us_1', count: 40 }])
  })

  it('has nothing to read when neither product answered', () => {
    expect(websiteFacts({ search: { ok: false }, ga4: { ok: false } })).toBeNull()
  })

  it('keeps only numbers that have a label and a value', () => {
    expect(normaliseWebsiteRead({ summary: ' s ', numbers: [{ label: 'Visits', value: '458' }, { label: '', value: '1' }], suggestions: ['a', ''] }))
      .toEqual({ summary: 's', numbers: [{ label: 'Visits', value: '458', meaning: '' }], suggestions: ['a'] })
  })
})

describe('a run\'s own faults are not open market questions', () => {
  const unanswered = [
    'The brief came back with no sections filled — 51 findings went in and the model returned nothing to act on (stop_reason: end_turn, 181 characters). This is a fault in the run, not a quiet week.',
    'sc-domain:arak-sa.com, 2026-09-13 to 2026-10-10.',
    'Is the reported 1 July 2026 Arabic-compliance-section requirement real?',
  ]

  it('says the fault once, for this run', () => {
    expect(runFaults({ unanswered })).toHaveLength(1)
  })

  it('carries only the real question forward as an open item', () => {
    const runs = [{ id: 'r1', started_at: '2026-10-13', report: { unanswered } }]
    expect(openItems({ runs }).map(i => i.text)).toEqual([unanswered[2]])
  })
})

describe('our own Instagram account', () => {
  const measured = { movements: [{ competitor: 'Us', metric: 'followers' }], unanswered: [] }

  it('counts as connected when the run measured us', () => {
    expect(ownAccountConnected(measured)).toBe(true)
    expect(ownAccountConnected({})).toBe(false)
  })

  it('no longer tells a connected brand to connect its account', () => {
    const gaps = summarise({ run: { report: measured } }).blocking
    expect(gaps.map(g => g.key)).not.toContain('own_account')
  })
})

describe('last week\'s faults are not handed to the next brief', () => {
  it('keeps only the questions a person could answer', async () => {
    const { realQuestions } = await import('./agent/runFaults.js')
    expect(realQuestions([
      "Last week's run fault is closed. The 2026-10-13 run returned an empty brief.",
      'The Search Console window note for sc-domain:arak-sa.com, 2026-09-13 to 2026-10-10, is closed.',
      'Which SASO standard numbers actually apply to our imported fixtures is not confirmed.',
    ])).toEqual(['Which SASO standard numbers actually apply to our imported fixtures is not confirmed.'])
  })
})
