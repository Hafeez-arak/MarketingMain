import { describe, it, expect } from 'vitest'
import { averagePosition, searchSummary, seoRecommendations, pagePerformance } from './seoAdvice'

const q = (query, impressions, position, clicks = 0, page = '') => ({ query, impressions, position, clicks, ctr: 0, page })

describe('averagePosition', () => {
  it('weights by impressions so a two-impression outlier cannot drag the site down', () => {
    // A plain mean of 5 and 90 is 47.5, which would read as a site nobody can find.
    const rows = [q('a', 1000, 5), q('b', 2, 90)]
    expect(averagePosition(rows)).toBeCloseTo(5.17, 1)
  })

  it('is null rather than zero when nothing has impressions', () => {
    expect(averagePosition([])).toBe(null)
    expect(averagePosition([q('a', 0, 12)])).toBe(null)
  })
})

describe('searchSummary', () => {
  const brandTerms = ['arak']

  it('separates the brand from real demand', () => {
    const queries = [q('arak lighting', 200, 2, 40), q('facade lighting riyadh', 300, 14)]
    const s = searchSummary({ queries, brandTerms })
    expect(s.all.impressions).toBe(500)
    expect(s.brand.clicks).toBe(40)
    expect(s.nonBrand.impressions).toBe(300)
  })

  it('flips the sign on position so a rise is an improvement', () => {
    // Position 12 last window, 9 this one: the site got BETTER by three places.
    const s = searchSummary({
      queries: [q('x', 100, 9)],
      previous: [q('x', 100, 12)],
    })
    expect(s.positionDelta).toBeCloseTo(3, 5)
  })

  it('reports no deltas at all when there is no previous window', () => {
    const s = searchSummary({ queries: [q('x', 100, 9)] })
    expect(s.baseline).toBe(true)
    expect(s.impressionsDelta).toBe(null)
    expect(s.positionDelta).toBe(null)
  })

  it('marks a period thin when clicks are too few to narrate', () => {
    expect(searchSummary({ queries: [q('x', 400, 12, 3)] }).thin).toBe(true)
    expect(searchSummary({ queries: [q('x', 400, 12, 40)] }).thin).toBe(false)
  })
})

describe('seoRecommendations', () => {
  const brandTerms = ['arak']

  it('tells a rewrite from a missing page by where the query ranks', () => {
    const near = q('smart pole riyadh', 200, 8)
    const far = q('guest room management system', 200, 22)
    const recs = seoRecommendations({ queries: [near, far], brandTerms })
    expect(recs.find(r => r.query === 'smart pole riyadh').kind).toBe('rewrite')
    expect(recs.find(r => r.query === 'guest room management system').kind).toBe('new-page')
  })

  it('merges a homepage-catching query with its unclicked twin instead of listing it twice', () => {
    const query = 'guest room management system'
    const queries = [q(query, 400, 12)]
    const pages = [{ ...q(query, 400, 12), page: 'https://arak-sa.com/' }]
    const recs = seoRecommendations({ queries, pages, brandTerms })
    expect(recs.filter(r => r.query === query)).toHaveLength(1)
    expect(recs[0].kind).toBe('missing-page')
  })

  it('never recommends anything about the company\'s own name', () => {
    // A person searching a company by name and not clicking is not a content gap.
    const recs = seoRecommendations({ queries: [q('arak lighting', 500, 9)], brandTerms })
    expect(recs).toHaveLength(0)
  })

  it('does not call every query on the property "new" when there is no baseline', () => {
    // Position 2 keeps them out of the winnable band, so movement is all that
    // is left to report — and with no previous window there is none.
    const recs = seoRecommendations({ queries: [q('a', 500, 2), q('b', 400, 2)], brandTerms })
    expect(recs).toHaveLength(0)
  })

  it('reports genuine arrivals once a baseline exists', () => {
    const recs = seoRecommendations({
      queries: [q('a', 500, 2), q('new demand', 300, 2)],
      previous: [q('a', 500, 2)],
      brandTerms,
    })
    expect(recs.map(r => r.kind)).toEqual(['rising'])
    expect(recs[0].query).toBe('new demand')
  })

  it('ranks by priority first and audience size second', () => {
    const recs = seoRecommendations({
      queries: [
        q('small unwon', 40, 10),        // medium: under 3x the floor
        q('big unwon', 900, 10),          // high
        q('other big unwon', 500, 10),    // high
      ],
      brandTerms,
    })
    expect(recs.map(r => r.query)).toEqual(['big unwon', 'other big unwon', 'small unwon'])
  })

  it('honours the limit', () => {
    const queries = Array.from({ length: 20 }, (_, i) => q(`query ${i}`, 100 + i, 10))
    expect(seoRecommendations({ queries, brandTerms, limit: 3 })).toHaveLength(3)
  })
})

describe('pagePerformance', () => {
  it('rolls many queries up onto the page that took them', () => {
    const pages = [
      { ...q('a', 100, 10), page: 'https://arak-sa.com/services/facade' },
      { ...q('b', 300, 20), page: 'https://arak-sa.com/services/facade' },
      { ...q('c', 50, 5), page: 'https://arak-sa.com/about' },
    ]
    const [top, second] = pagePerformance(pages)
    expect(top.path).toBe('/services/facade')
    expect(top.impressions).toBe(400)
    expect(top.queries).toBe(2)
    // Impression-weighted: (100*10 + 300*20) / 400
    expect(top.position).toBeCloseTo(17.5, 5)
    expect(second.path).toBe('/about')
  })

  it('folds the Arabic tree onto the same page as the English one', () => {
    // /ar/services/facade and /services/facade are the same page in two
    // languages; counting them separately halves both.
    const pages = [
      { ...q('a', 100, 10), page: 'https://arak-sa.com/services/facade' },
      { ...q('b', 100, 10), page: 'https://arak-sa.com/ar/services/facade' },
    ]
    expect(pagePerformance(pages)).toHaveLength(1)
    expect(pagePerformance(pages)[0].impressions).toBe(200)
  })
})
