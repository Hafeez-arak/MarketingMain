import { describe, it, expect } from 'vitest'
import {
  propertyId, searchWindows, normalizeRows, queryBody, parseLines, pathOf, lineOf, lineTotals,
  isBrandQuery, splitBrand, appearingNotWinning, homepageCatching, impressionMovers, attachPages,
  periodSummary, searchFindings, searchConfig, DATA_LAG_DAYS, WINDOW_DAYS, MIN_IMPRESSIONS,
} from './searchConsole.js'

const row = (o = {}) => ({ query: '', page: '', clicks: 0, impressions: 0, ctr: 0, position: 0, ...o })

describe('propertyId', () => {
  it('addresses a bare hostname as a domain property, which is not a URL', () => {
    expect(propertyId('arak-sa.com')).toBe('sc-domain:arak-sa.com')
  })

  it('drops www, because the domain property covers it and sc-domain:www is a different property', () => {
    expect(propertyId('www.arak-sa.com')).toBe('sc-domain:arak-sa.com')
  })

  it('leaves a full URL alone — that is a URL-prefix property and is addressed by URL', () => {
    expect(propertyId('https://arak-sa.com/')).toBe('https://arak-sa.com/')
  })

  it('passes an already-formed sc-domain id through untouched', () => {
    expect(propertyId('sc-domain:arak-sa.com')).toBe('sc-domain:arak-sa.com')
  })
})

describe('searchWindows', () => {
  const w = searchWindows(new Date('2026-09-16T00:00:00Z'))

  it('ends three days back, so incomplete days are not read as a decline every week', () => {
    expect(w.current.end).toBe('2026-09-13')
    expect(DATA_LAG_DAYS).toBe(3)
  })

  it('compares 28 days against the 28 before them', () => {
    expect(w.days).toBe(WINDOW_DAYS)
    expect(w.current.start).toBe('2026-08-17')
    expect(w.previous.end).toBe('2026-08-16')
    expect(w.previous.start).toBe('2026-07-20')
  })

  it('leaves no gap and no overlap between the two windows', () => {
    const dayAfterPrev = new Date(`${w.previous.end}T00:00:00Z`)
    dayAfterPrev.setUTCDate(dayAfterPrev.getUTCDate() + 1)
    expect(dayAfterPrev.toISOString().slice(0, 10)).toBe(w.current.start)
  })

  // ── A window somebody typed is used as typed ──
  // The three-day lag exists so a ROLLING window does not read as a permanent
  // decline. Shifting a window the reader picked would answer a different
  // question from the one they asked, so it is not shifted; the freshness
  // caveat belongs on screen there instead.
  describe('a fixed window', () => {
    const f = searchWindows(new Date('2026-09-16T00:00:00Z'), {
      from: '2026-03-01', to: '2026-03-14',
    })

    it('is not moved by the data lag', () => {
      expect(f.current).toEqual({ start: '2026-03-01', end: '2026-03-14' })
    })

    it('counts its own length rather than the preset', () => {
      expect(f.days).toBe(14)
    })

    it('compares against the same number of days immediately before', () => {
      expect(f.previous).toEqual({ start: '2026-02-15', end: '2026-02-28' })
    })

    it('still leaves no gap between the two windows', () => {
      const after = new Date(`${f.previous.end}T00:00:00Z`)
      after.setUTCDate(after.getUTCDate() + 1)
      expect(after.toISOString().slice(0, 10)).toBe(f.current.start)
    })

    it('needs both ends before it counts as fixed', () => {
      const half = searchWindows(new Date('2026-09-16T00:00:00Z'), { from: '2026-03-01' })
      expect(half.current.end).toBe('2026-09-13')
      expect(half.days).toBe(WINDOW_DAYS)
    })
  })
})

describe('queryBody', () => {
  it('caps rowLimit at the API ceiling rather than sending a number it will refuse', () => {
    expect(queryBody({ start: 'a', end: 'b', rowLimit: 999_999 }).rowLimit).toBe(25_000)
  })
})

describe('normalizeRows', () => {
  it('maps the positional keys array back onto the dimensions that were asked for', () => {
    const rows = normalizeRows(
      [{ keys: ['knx riyadh', 'https://arak-sa.com/services/lighting-controls'], clicks: 2, impressions: 40, position: 7.5 }],
      ['query', 'page'])
    expect(rows[0].query).toBe('knx riyadh')
    expect(rows[0].page).toBe('https://arak-sa.com/services/lighting-controls')
    expect(rows[0].impressions).toBe(40)
  })
})

describe('business lines', () => {
  const lines = parseLines([
    'controls | Controls & automation | /services/lighting-controls, /services/home-automation, knx, grms',
    'lighting | Lighting | /services/indoor-lighting, /services/facade-lighting, luminaire',
  ].join('\n'))

  it('reads a line per row, splitting paths from query words', () => {
    expect(lines).toHaveLength(2)
    expect(lines[0].key).toBe('controls')
    expect(lines[0].label).toBe('Controls & automation')
    expect(lines[0].paths).toContain('/services/lighting-controls')
    expect(lines[0].words).toContain('knx')
  })

  it('strips the language prefix so an Arabic URL classifies like its English twin', () => {
    expect(pathOf('https://arak-sa.com/ar/services/lighting-controls')).toBe('/services/lighting-controls')
  })

  it('lets the landing page decide, because a URL is a fact and a keyword is an opinion', () => {
    // The query says "lighting"; the page says controls. The page wins.
    expect(lineOf(row({ query: 'lighting luminaire', page: 'https://arak-sa.com/services/lighting-controls' }), lines))
      .toBe('controls')
  })

  it('falls back to query words when the landing page is the homepage', () => {
    expect(lineOf(row({ query: 'knx installer riyadh', page: 'https://arak-sa.com/' }), lines)).toBe('controls')
  })

  it('returns no line rather than guessing one — a finding filed under the wrong business is worse than none', () => {
    expect(lineOf(row({ query: 'office chairs', page: 'https://arak-sa.com/' }), lines)).toBe('')
  })

  it('assigns nothing at all when the brand has configured no lines', () => {
    expect(lineOf(row({ query: 'knx', page: 'https://arak-sa.com/services/lighting-controls' }), [])).toBe('')
  })

  it('rolls impressions up per line and keeps the unclassified remainder visible', () => {
    const totals = lineTotals([
      row({ query: 'knx', page: 'https://arak-sa.com/services/lighting-controls', impressions: 100 }),
      row({ query: 'luminaire', page: 'https://arak-sa.com/services/indoor-lighting', impressions: 40 }),
      row({ query: 'something else', page: 'https://arak-sa.com/', impressions: 5 }),
    ], lines)
    expect(totals.map(t => t.key)).toEqual(['controls', 'lighting', ''])
    expect(totals[2].label).toBe('Unclassified')
  })

  it('keeps the unclassified remainder last however large it is', () => {
    // Brand queries land here and are usually the biggest single bucket, so
    // sorting purely by size puts "Unclassified" at the head of the list —
    // which reads as a finding rather than as the leftovers.
    const totals = lineTotals([
      row({ query: 'the brand name', page: 'https://arak-sa.com/', impressions: 5000 }),
      row({ query: 'knx', page: 'https://arak-sa.com/services/lighting-controls', impressions: 10 }),
    ], lines)
    expect(totals[totals.length - 1].key).toBe('')
  })
})

describe('brand queries', () => {
  const terms = ['arak', 'أراك']

  it('counts a query containing the brand name as brand, in either script', () => {
    expect(isBrandQuery('arak lighting riyadh', terms)).toBe(true)
    expect(isBrandQuery('أراك للإضاءة', terms)).toBe(true)
    expect(isBrandQuery('knx installer', terms)).toBe(false)
  })

  it('splits them, so a site whose traffic is all brand cannot look like category demand', () => {
    const { brand, nonBrand } = splitBrand([
      row({ query: 'arak lighting', clicks: 40 }),
      row({ query: 'facade lighting saudi', clicks: 2 }),
    ], terms)
    expect(brand).toHaveLength(1)
    expect(nonBrand[0].query).toBe('facade lighting saudi')
  })
})

describe('appearingNotWinning', () => {
  it('finds queries where the ranking exists and the click does not', () => {
    const found = appearingNotWinning([row({ query: 'grms saudi', impressions: 400, clicks: 0, position: 14 })])
    expect(found).toHaveLength(1)
  })

  it('ignores anything already getting clicks — there is nothing to fix', () => {
    expect(appearingNotWinning([row({ query: 'x', impressions: 400, clicks: 3, position: 14 })])).toHaveLength(0)
  })

  it('ignores position 1-3, where no clicks usually means the query wanted something else', () => {
    expect(appearingNotWinning([row({ query: 'x', impressions: 400, clicks: 0, position: 2 })])).toHaveLength(0)
  })

  it('ignores page three and beyond, where "improve the title" is advice that cannot work', () => {
    expect(appearingNotWinning([row({ query: 'x', impressions: 400, clicks: 0, position: 31 })])).toHaveLength(0)
  })

  it('ignores a handful of impressions — that is a rounding error, not an audience', () => {
    expect(appearingNotWinning([row({ query: 'x', impressions: 4, clicks: 0, position: 8 })])).toHaveLength(0)
  })
})

describe('homepageCatching', () => {
  const terms = ['arak']

  it('reports a specific query landing on the homepage as a missing page', () => {
    const found = homepageCatching(
      [row({ query: 'guest room management system', page: 'https://arak-sa.com/', impressions: 90 })], terms)
    expect(found).toHaveLength(1)
  })

  it('does not report the brand name — the homepage SHOULD win that', () => {
    expect(homepageCatching([row({ query: 'arak lighting', page: 'https://arak-sa.com/', impressions: 900 })], terms))
      .toHaveLength(0)
  })

  it('does not report a single word, which is too broad to deserve its own page', () => {
    expect(homepageCatching([row({ query: 'lighting', page: 'https://arak-sa.com/', impressions: 900 })], terms))
      .toHaveLength(0)
  })

  it('ignores queries that already land on a real page', () => {
    expect(homepageCatching(
      [row({ query: 'knx control saudi', page: 'https://arak-sa.com/services/lighting-controls', impressions: 900 })], terms))
      .toHaveLength(0)
  })
})

describe('impressionMovers', () => {
  it('never computes a percentage against zero — an arrival is reported as an arrival', () => {
    // A previous period that exists but did not contain this query.
    const [m] = impressionMovers(
      [row({ query: 'new thing', impressions: 80 })],
      [row({ query: 'something else', impressions: 40 })])
    expect(m.state).toBe('new')
    expect(m.delta).toBeUndefined()
  })

  it('treats a missing previous period as a baseline, not as 172 arrivals', () => {
    // The first live run compared 172 queries against an empty property and
    // called every one of them new. That is a baseline; nothing has moved.
    expect(impressionMovers([row({ query: 'a', impressions: 900 })], [])).toEqual([])
  })

  it('reports a query that stopped appearing, using what it had rather than what it has', () => {
    const [m] = impressionMovers([], [row({ query: 'gone thing', impressions: 80 })])
    expect(m.state).toBe('gone')
    expect(m.was).toBe(80)
  })

  it('refuses to read movement when both sides are tiny', () => {
    // 2 -> 5 is a 150% rise and means nothing.
    expect(impressionMovers([row({ query: 'x', impressions: 5 })], [row({ query: 'x', impressions: 2 })]))
      .toHaveLength(0)
  })

  it('reports a real move once the larger side clears the floor', () => {
    const [m] = impressionMovers(
      [row({ query: 'x', impressions: 200 })], [row({ query: 'x', impressions: 100 })])
    expect(m.state).toBe('rising')
    expect(m.delta).toBe(100)
  })
})

describe('searchFindings', () => {
  const terms = ['arak']

  it('treats an empty period as a real answer, not as a failure', () => {
    const [f] = searchFindings({ queries: [], site: 'sc-domain:arak-sa.com' })
    expect(f.headline).toContain('no queries')
    expect(f.detail).toContain('not a failure')
  })

  it('says outright that clicks are too thin to narrate when they are', () => {
    const [summary] = searchFindings({
      queries: [row({ query: 'facade lighting', impressions: 300, clicks: 3, position: 12 })],
      brandTerms: terms,
    })
    expect(summary.detail).toContain('too thin')
  })

  it('leads with demand that exists and is not being converted', () => {
    const found = searchFindings({
      queries: [row({ query: 'guest room management system saudi', impressions: 400, clicks: 0, position: 14 })],
      brandTerms: terms,
    })
    expect(found.some(f => f.headline.includes('position 14.0') && f.headline.includes('no clicks'))).toBe(true)
  })

  it('carries confidence 1 and no sources — its provenance is a measurement, not a page someone read', () => {
    const found = searchFindings({
      queries: [row({ query: 'x', impressions: 400, clicks: 0, position: 8 })],
      brandTerms: terms,
    })
    expect(found.every(f => f.confidence === 1)).toBe(true)
    expect(found.every(f => !f.sources)).toBe(true)
  })

  it('reports the non-brand half separately, so brand traffic cannot pose as category demand', () => {
    const s = periodSummary([
      row({ query: 'arak lighting', clicks: 40, impressions: 500 }),
      row({ query: 'facade lighting riyadh', clicks: 1, impressions: 200 }),
    ], terms, [])
    expect(s.brand.clicks).toBe(40)
    expect(s.nonBrand.clicks).toBe(1)
    expect(s.nonBrand.impressions).toBe(200)
  })
})

describe('the floor', () => {
  it('is documented as a constant rather than scattered through the checks', () => {
    expect(MIN_IMPRESSIONS).toBe(30)
  })
})

describe('searchConfig', () => {
  const profile = {
    customFields: {
      website: 'arak-sa.com',
      brand_terms: 'أراك, arak lighting solutions',
      business_lines: 'controls | Controls | /services/lighting-controls, knx',
    },
  }

  it('reads the site, the lines and the brand terms from customFields, the existing extension point', () => {
    const cfg = searchConfig(profile, { brandName: 'Arak Lighting' })
    expect(cfg.site).toBe('arak-sa.com')
    expect(cfg.lines[0].key).toBe('controls')
    expect(cfg.brandTerms).toContain('arak lighting')
    expect(cfg.brandTerms).toContain('أراك')
  })

  it('adds the first word of the brand name, which is how people actually search for a company', () => {
    expect(searchConfig(profile, { brandName: 'Arak Lighting' }).brandTerms).toContain('arak')
  })

  it('will not treat a short leading word as a brand term', () => {
    const cfg = searchConfig({ customFields: {} }, { brandName: 'The Lighting Company' })
    expect(cfg.brandTerms).not.toContain('the')
  })

  it('returns nothing configured rather than guessing a site from the brand name', () => {
    const cfg = searchConfig({ customFields: {} }, { brandName: 'Arak Lighting' })
    expect(cfg.site).toBe('')
    expect(cfg.lines).toEqual([])
  })
})

describe('attachPages', () => {
  it('gives a query row the page that took most of its impressions', () => {
    const [r] = attachPages(
      [row({ query: 'knx riyadh', impressions: 300 })],
      [row({ query: 'knx riyadh', page: 'https://arak-sa.com/', impressions: 40 }),
       row({ query: 'knx riyadh', page: 'https://arak-sa.com/services/lighting-controls', impressions: 260 })])
    expect(r.page).toBe('https://arak-sa.com/services/lighting-controls')
  })

  it('leaves a row that already has a page alone', () => {
    const [r] = attachPages([row({ query: 'x', page: '/kept' })], [row({ query: 'x', page: '/other', impressions: 9 })])
    expect(r.page).toBe('/kept')
  })

  it('lets a finding classify on where a query WENT rather than on the words it contained', () => {
    const lines = parseLines('controls | Controls | /services/lighting-controls, knx')
    // The query says nothing about controls; the page it resolves to does.
    const [r] = attachPages(
      [row({ query: 'building automation riyadh', impressions: 300 })],
      [row({ query: 'building automation riyadh', page: 'https://arak-sa.com/services/lighting-controls', impressions: 300 })])
    expect(lineOf(r, lines)).toBe('controls')
  })
})

describe('bidi isolation', () => {
  it('isolates a query so an adjacent number cannot be absorbed into an RTL run', () => {
    const [f] = searchFindings({
      queries: [{ query: 'شركة إنارة واجهات الرياض', page: '', impressions: 233, clicks: 0, ctr: 0, position: 12.1 }],
      brandTerms: ['arak'],
    }).filter(x => x.headline.includes('We appear'))
    // FIRST STRONG ISOLATE ... POP DIRECTIONAL ISOLATE around the query, so
    // "233 times" stays outside the quotes when it is rendered.
    expect(f.headline).toContain('⁨شركة إنارة واجهات الرياض⁩')
    expect(f.headline.indexOf('⁩')).toBeLessThan(f.headline.indexOf('233'))
  })

  it('isolates Latin queries too, rather than only the ones that look like they need it', () => {
    const [f] = searchFindings({
      queries: [{ query: 'knx riyadh', page: '', impressions: 233, clicks: 0, ctr: 0, position: 12.1 }],
      brandTerms: ['arak'],
    }).filter(x => x.headline.includes('We appear'))
    expect(f.headline).toContain('⁨knx riyadh⁩')
  })
})

describe('tuned against the first real run, 2026-09-16', () => {
  const terms = ['arak', 'اراك']

  it('does not tell marketing to rewrite a title for the company’s own name', () => {
    // The single finding the first live run produced, and it was noise.
    const rows = [row({ query: 'اراك', impressions: 33, clicks: 0, position: 9.1 })]
    expect(appearingNotWinning(rows)).toHaveLength(1)                      // without the filter
    expect(appearingNotWinning(rows, { brandTerms: terms })).toHaveLength(0) // with it
  })

  it('reaches the queries a new site actually ranks for, at 21-30', () => {
    // Both of arak-sa.com's real non-brand queries, which the old band dropped.
    const rows = [
      row({ query: 'lighting consultant riyadh', impressions: 151, clicks: 0, position: 20.3 }),
      row({ query: 'lighting design saudi arabia', impressions: 77, clicks: 0, position: 23.2 }),
    ]
    expect(appearingNotWinning(rows, { brandTerms: terms })).toHaveLength(2)
  })

  it('still refuses position 31+, where no honest advice follows', () => {
    const rows = [row({ query: 'smart street light pole', impressions: 200, clicks: 0, position: 49.4 })]
    expect(appearingNotWinning(rows, { brandTerms: terms })).toHaveLength(0)
  })

  it('changes the advice at the point where a title rewrite stops working', () => {
    const near = searchFindings({
      queries: [row({ query: 'x', impressions: 200, clicks: 0, position: 8 })], brandTerms: terms,
      previous: [row({ query: 'other', impressions: 50 })],
    }).find(f => f.headline.includes('We appear'))
    const far = searchFindings({
      queries: [row({ query: 'y', impressions: 200, clicks: 0, position: 23.2 })], brandTerms: terms,
      previous: [row({ query: 'other', impressions: 50 })],
    }).find(f => f.headline.includes('We appear'))

    expect(near.suggested_action).toContain('Rewrite the title')
    expect(far.suggested_action).toContain('not a title problem')
    expect(far.suggested_action).toContain('needs a page of its own')
  })

  it('says outright that a first period has nothing to compare against', () => {
    const [summary] = searchFindings({
      queries: [row({ query: 'x', impressions: 200, clicks: 1, position: 9 })],
      previous: [], brandTerms: terms,
    })
    expect(summary.detail).toContain('FIRST measured period')
    expect(summary.evidence.baseline).toBe(true)
  })

  it('does not claim a baseline once a previous period exists', () => {
    const [summary] = searchFindings({
      queries: [row({ query: 'x', impressions: 200, clicks: 1, position: 9 })],
      previous: [row({ query: 'x', impressions: 100 })], brandTerms: terms,
    })
    expect(summary.detail).not.toContain('FIRST measured period')
    expect(summary.evidence.baseline).toBe(false)
  })
})

describe('a query that is both unclicked and homeless', () => {
  const q = { query: 'lighting consultant riyadh', clicks: 0, ctr: 0, impressions: 151, position: 20.3 }

  it('is reported once, not twice in adjacent bullets', () => {
    const found = searchFindings({
      queries: [{ ...q, page: '' }],
      pages: [{ ...q, page: 'https://arak-sa.com/' }],
      previous: [{ query: 'other', page: '', clicks: 0, ctr: 0, impressions: 50, position: 9 }],
      brandTerms: ['arak'],
    }).filter(f => f.headline.includes('lighting consultant riyadh'))
    expect(found).toHaveLength(1)
  })

  it('says both halves in the one headline, because together they are the stronger claim', () => {
    const [f] = searchFindings({
      queries: [{ ...q, page: '' }],
      pages: [{ ...q, page: 'https://arak-sa.com/' }],
      previous: [{ query: 'other', page: '', clicks: 0, ctr: 0, impressions: 50, position: 9 }],
      brandTerms: ['arak'],
    }).filter(f => f.headline.includes('lighting consultant riyadh'))
    expect(f.headline).toContain('position 20.3')
    expect(f.headline).toContain('lands on the homepage')
  })

  it('still reports a homeless query the position band declined to flag', () => {
    // Position 45 is past the band, so appearingNotWinning correctly says
    // nothing — no title or page fix wins a click from there. But "the
    // homepage is ranking because we have no page for this" is still true and
    // still worth writing down, so the two are complementary rather than
    // duplicates.
    const far = { query: 'guest room management system', clicks: 0, ctr: 0, impressions: 90, position: 45 }
    const found = searchFindings({
      queries: [{ ...far, page: '' }],
      pages: [{ ...far, page: 'https://arak-sa.com/' }],
      previous: [], brandTerms: ['arak'],
    }).filter(f => f.headline.includes('guest room management'))
    expect(found).toHaveLength(1)
    expect(found[0].headline).toContain('lands on the homepage')
  })

  it('does not add a "new this period" bullet under a query it just explained', () => {
    const q = { query: 'lighting consultant riyadh', clicks: 0, ctr: 0, impressions: 151, position: 20.3 }
    const found = searchFindings({
      queries: [{ ...q, page: '' }],
      pages: [{ ...q, page: 'https://arak-sa.com/' }],
      previous: [{ query: 'other', page: '', clicks: 0, ctr: 0, impressions: 50, position: 9 }],
      brandTerms: ['arak'],
    })
    expect(found.filter(f => f.evidence?.state === 'new')).toHaveLength(0)
  })
})
