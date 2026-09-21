import { describe, it, expect } from 'vitest'
import {
  daysBetween, dailySeries, rollingAverage, searchTypes, pageRows, hostSplit,
  queryRows, positionBands, queryCoverage, countryName, countryRows, deviceRows,
  appearanceRows, sitemapHealth, websiteSummary, change, asPercent, POSITION_BANDS, prettyPath,
  imageSearch,
} from './websiteAnalytics.js'

// The windows the app actually asks for, and the shape the property actually
// returned on 2026-09-17: data began on 2026-08-25, so the previous window is
// genuinely empty. Every "baseline" test below is that real case, not a
// contrived one.
const WINDOWS = {
  days: 28,
  current: { start: '2026-08-21', end: '2026-09-17' },
  previous: { start: '2026-07-24', end: '2026-08-20' },
}

describe('daysBetween', () => {
  it('is inclusive at both ends', () => {
    expect(daysBetween('2026-09-01', '2026-09-03')).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
  })
  it('crosses a month boundary', () => {
    expect(daysBetween('2026-08-30', '2026-09-01')).toEqual(['2026-08-30', '2026-08-31', '2026-09-01'])
  })
  it('answers nothing for nonsense rather than looping', () => {
    expect(daysBetween('', '2026-09-01')).toEqual([])
    expect(daysBetween('2026-09-03', '2026-09-01')).toEqual([])
  })
})

describe('dailySeries', () => {
  const daily = [
    { date: '2026-08-26', clicks: 3, impressions: 17, ctr: 0.176, position: 3.1 },
    { date: '2026-09-17', clicks: 5, impressions: 147, ctr: 0.034, position: 14.08 },
  ]

  it('fills the days Search Console omitted', () => {
    const rows = dailySeries(daily, WINDOWS)
    // 2026-07-24 .. 2026-09-17 inclusive.
    expect(rows).toHaveLength(56)
    expect(rows[0].date).toBe('2026-07-24')
    expect(rows.at(-1).date).toBe('2026-09-17')
    expect(rows.filter(r => r.impressions > 0)).toHaveLength(2)
  })

  // Position 0 does not exist — rank 1 is the best there is — so a zeroed
  // empty day plots below the best possible value and drags the axis somewhere
  // no measurement could ever be.
  it('leaves position null on a day with no impressions, never zero', () => {
    const rows = dailySeries(daily, WINDOWS)
    const empty = rows.find(r => r.impressions === 0)
    expect(empty.position).toBeNull()
    expect(empty.clicks).toBe(0)
    expect(rows.find(r => r.date === '2026-09-17').position).toBeCloseTo(14.08)
  })

  it('marks which side of the window boundary each day is on', () => {
    const rows = dailySeries(daily, WINDOWS)
    expect(rows.find(r => r.date === '2026-08-20').current).toBe(false)
    expect(rows.find(r => r.date === '2026-08-21').current).toBe(true)
  })

  it('scales CTR to the percentage this app renders', () => {
    expect(dailySeries(daily, WINDOWS).find(r => r.date === '2026-08-26').ctr).toBeCloseTo(17.6)
  })

  it('answers nothing without windows rather than throwing', () => {
    expect(dailySeries(daily, {})).toEqual([])
    expect(dailySeries()).toEqual([])
  })
})

describe('rollingAverage', () => {
  it('averages over the trailing window, short at the start', () => {
    const rows = rollingAverage([{ impressions: 3 }, { impressions: 5 }, { impressions: 10 }], 'impressions', 2)
    expect(rows[0].impressionsAvg).toBe(3)
    expect(rows[1].impressionsAvg).toBe(4)
    expect(rows[2].impressionsAvg).toBe(7.5)
  })
})

describe('searchTypes', () => {
  // The real numbers, and the reason this panel exists: image search was a
  // fifth of the property's visibility and no screen in this app had ever
  // counted it.
  const types = {
    web: { clicks: 147, impressions: 3312, ctr: 0.0443, position: 16.3, previous: { impressions: 0 } },
    image: { clicks: 1, impressions: 892, ctr: 0.0011, position: 39.9, previous: { impressions: 0 } },
    video: { clicks: 0, impressions: 0, ctr: 0, position: 0, previous: { impressions: 0 } },
    news: { clicks: 0, impressions: 2, ctr: 0, position: 3, previous: { impressions: 0 } },
    discover: { clicks: 0, impressions: 0, ctr: 0, position: 0, previous: { impressions: 0 } },
  }

  it('drops surfaces with nothing on them in either window', () => {
    const rows = searchTypes(types)
    expect(rows.map(r => r.type)).toEqual(['web', 'image', 'news'])
  })

  it('shares out of every surface, not out of web alone', () => {
    const rows = searchTypes(types)
    expect(rows[0].share).toBeCloseTo(78.7, 1)
    expect(rows[1].share).toBeCloseTo(21.2, 1)
    expect(rows.reduce((n, r) => n + r.share, 0)).toBeCloseTo(100, 6)
  })

  it('keeps a surface that has dropped to zero but had something before', () => {
    const rows = searchTypes({ video: { impressions: 0, previous: { impressions: 40 } } })
    expect(rows.map(r => r.type)).toEqual(['video'])
    expect(rows[0].impressionsDelta).toBe(-40)
  })

  it('answers nothing for a property that reported nothing', () => {
    expect(searchTypes({})).toEqual([])
  })
})

describe('pageRows', () => {
  // A domain property reports every host separately, so this site's homepage
  // really does arrive as four rows. Listed raw, the top of the table is the
  // same page four times and the real second page is off the screen.
  const pageTotals = [
    { page: 'https://arak-sa.com/', clicks: 71, impressions: 1955, position: 16.7 },
    { page: 'https://arak-sa.com/ar', clicks: 34, impressions: 525, position: 13.0 },
    { page: 'http://www.arak-sa.com/', clicks: 16, impressions: 316, position: 5.7 },
    { page: 'https://www.arak-sa.com/', clicks: 11, impressions: 153, position: 16.9 },
    { page: 'https://arak-sa.com/services/smart-poles', clicks: 5, impressions: 255, position: 24.5 },
  ]

  it('folds host and language variants into one page', () => {
    const rows = pageRows(pageTotals, [])
    expect(rows[0].path).toBe('/')
    expect(rows[0].impressions).toBe(1955 + 525 + 316 + 153)
    expect(rows[0].clicks).toBe(71 + 34 + 16 + 11)
    expect(rows[0].variants).toBe(4)
  })

  it('leaves the real second page second, rather than a redirect of the first', () => {
    expect(pageRows(pageTotals, [])[1].path).toBe('/services/smart-poles')
  })

  it('weights the folded position by impressions rather than averaging ranks', () => {
    const rows = pageRows([
      { page: 'https://x.com/a', impressions: 100, position: 10 },
      { page: 'https://x.com/a', impressions: 1, position: 90 },
    ], [])
    expect(rows[0].position).toBeCloseTo((100 * 10 + 1 * 90) / 101)
  })

  it('has no delta at all when the previous window is empty', () => {
    expect(pageRows(pageTotals, [])[0].impressionsDelta).toBeNull()
  })

  it('compares against a previous window that holds something', () => {
    const rows = pageRows(pageTotals, [{ page: 'https://arak-sa.com/', impressions: 1000, position: 18 }])
    expect(rows[0].impressionsDelta).toBe(2949 - 1000)
  })
})

describe('hostSplit', () => {
  const pageTotals = [
    { page: 'https://arak-sa.com/', clicks: 71, impressions: 1955 },
    { page: 'https://www.arak-sa.com/', clicks: 11, impressions: 153 },
  ]

  it('says which host is the canonical one and which only redirects', () => {
    const rows = hostSplit(pageTotals, 'sc-domain:arak-sa.com')
    expect(rows[0]).toMatchObject({ host: 'arak-sa.com', canonical: true })
    expect(rows[1]).toMatchObject({ host: 'www.arak-sa.com', canonical: false })
  })

  it('skips rows whose page is not a URL rather than counting them as a host', () => {
    expect(hostSplit([...pageTotals, { page: '', impressions: 99 }], 'sc-domain:arak-sa.com')).toHaveLength(2)
  })
})

describe('queryRows', () => {
  const queries = [
    { query: 'arak', clicks: 7, impressions: 202, ctr: 0.0346, position: 6.05 },
    { query: 'lighting consultant riyadh', clicks: 0, impressions: 180, ctr: 0, position: 18.3 },
  ]
  const pages = [{ query: 'lighting consultant riyadh', page: 'https://arak-sa.com/', impressions: 180 }]

  it('marks brand queries without hiding them', () => {
    const rows = queryRows(queries, pages, ['arak'])
    expect(rows).toHaveLength(2)
    expect(rows.find(r => r.query === 'arak').brand).toBe(true)
    expect(rows.find(r => r.query === 'lighting consultant riyadh').brand).toBe(false)
  })

  it('gives a query the page it actually resolves to, folded', () => {
    expect(queryRows(queries, pages, []).find(r => r.query === 'lighting consultant riyadh').page).toBe('/')
  })

  it('sorts by impressions, because clicks are too thin to rank on', () => {
    expect(queryRows(queries, pages, []).map(r => r.impressions)).toEqual([202, 180])
  })
})

describe('positionBands', () => {
  it('puts each rank in exactly one band', () => {
    const rows = [
      { position: 1.2, impressions: 100, clicks: 10 },
      { position: 3.5, impressions: 10, clicks: 1 },
      { position: 3.6, impressions: 20, clicks: 0 },
      { position: 10.5, impressions: 30, clicks: 0 },
      { position: 22, impressions: 40, clicks: 0 },
      { position: 95, impressions: 50, clicks: 0 },
    ]
    const bands = positionBands(rows)
    const by = Object.fromEntries(bands.map(b => [b.key, b.impressions]))
    expect(by.top3).toBe(110)
    expect(by.page1).toBe(50)
    expect(by.page2).toBe(0)
    expect(by.page3).toBe(40)
    expect(by.beyond).toBe(50)
    expect(bands.reduce((n, b) => n + b.impressions, 0)).toBe(250)
  })

  it('ignores a row with no rank rather than filing it under the best band', () => {
    expect(positionBands([{ position: 0, impressions: 500 }]).every(b => b.impressions === 0)).toBe(true)
  })

  // JSON.stringify(Infinity) is null, which would make the last band silently
  // stop matching anything the day these cross a wire.
  it('has a JSON-safe ceiling on the last band', () => {
    expect(Number.isFinite(POSITION_BANDS.at(-1).to)).toBe(true)
    expect(JSON.parse(JSON.stringify(POSITION_BANDS)).at(-1).to).toBe(POSITION_BANDS.at(-1).to)
  })
})

describe('queryCoverage', () => {
  // The real gap: 202 named queries holding 1,310 impressions against a web
  // total of 3,312. Without this stated, the page shows a tile reading 3,312
  // over a table adding to 1,310 and invites the reader to distrust both.
  it('says how much of the total the query table can account for', () => {
    const c = queryCoverage([{ impressions: 1000 }, { impressions: 310 }], { web: { impressions: 3312 } })
    expect(c.named).toBe(1310)
    expect(c.anonymous).toBe(2002)
    expect(c.share).toBeCloseTo(39.6, 1)
  })

  it('never reports negative anonymous impressions when the totals disagree', () => {
    expect(queryCoverage([{ impressions: 50 }], { web: { impressions: 10 } }).anonymous).toBe(0)
  })

  it('does not divide by a total of zero', () => {
    expect(queryCoverage([], {}).share).toBe(0)
  })
})

describe('countryName', () => {
  it('turns Search Console alpha-3 into a name a reader knows', () => {
    expect(countryName('sau')).toBe('Saudi Arabia')
    expect(countryName('are')).toBe('United Arab Emirates')
    expect(countryName('gbr')).toBe('United Kingdom')
  })

  // A real row with real impressions in it, which must not be dropped or
  // quietly renamed to a country.
  it('names Google’s own "could not tell"', () => {
    expect(countryName('zzz')).toBe('Unknown')
    expect(countryName('')).toBe('Unknown')
  })

  it('falls back to the code rather than inventing a country', () => {
    expect(countryName('xkx')).toBe('XKX')
  })
})

describe('countryRows', () => {
  it('shares out of the whole world, then takes the top few', () => {
    const rows = countryRows([
      { country: 'sau', clicks: 105, impressions: 2030, ctr: 0.05, position: 16.3 },
      { country: 'usa', clicks: 7, impressions: 283, ctr: 0.02, position: 14.2 },
      { country: 'ind', clicks: 6, impressions: 102, ctr: 0.06, position: 23.5 },
    ], { limit: 2 })
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('Saudi Arabia')
    // The share is of all three, not of the two that survived the limit.
    expect(rows[0].share).toBeCloseTo(2030 / 2415 * 100, 4)
  })
})

describe('deviceRows', () => {
  const devices = [
    { device: 'DESKTOP', clicks: 95, impressions: 2050, ctr: 0.046, position: 20.8 },
    { device: 'MOBILE', clicks: 52, impressions: 1252, ctr: 0.042, position: 9.1 },
  ]

  it('labels devices the way a person would say them', () => {
    expect(deviceRows(devices, []).map(d => d.label)).toEqual(['Desktop', 'Mobile'])
  })

  it('has no delta when the previous window is empty', () => {
    expect(deviceRows(devices, [])[0].impressionsDelta).toBeNull()
  })

  it('compares per device when there is a previous window', () => {
    const rows = deviceRows(devices, [{ device: 'DESKTOP', impressions: 1000 }])
    expect(rows.find(d => d.device === 'DESKTOP').impressionsDelta).toBe(1050)
    // Present in this window and absent from the last one is an arrival, and
    // `change` against a missing row is measured from zero, not skipped.
    expect(rows.find(d => d.device === 'MOBILE').impressionsDelta).toBe(1252)
  })
})

describe('appearanceRows', () => {
  it('names the appearance types Google returns in constant case', () => {
    expect(appearanceRows([{ searchAppearance: 'TRANSLATED_RESULT', impressions: 1, ctr: 0 }])[0].label)
      .toBe('Translated result')
  })
  it('makes an unknown type readable rather than shouting it', () => {
    expect(appearanceRows([{ searchAppearance: 'SOME_NEW_THING', impressions: 1 }])[0].label)
      .toBe('some new thing')
  })
})

describe('sitemapHealth', () => {
  // The real one: submitted July 2021, last downloaded February 2025, pointing
  // at the www host that redirects to the apex.
  const sitemaps = [{
    path: 'https://www.arak-sa.com/sitemap.xml',
    lastSubmitted: '2021-07-06T09:09:30.259Z',
    lastDownloaded: '2025-02-26T18:13:28.106Z',
    warnings: '2', errors: '0',
  }]
  const now = new Date('2026-09-20T00:00:00Z')

  it('measures staleness from the last download, not the last submission', () => {
    const [s] = sitemapHealth(sitemaps, { now, site: 'sc-domain:arak-sa.com' })
    // 570 and not 571: the download landed at 18:13 on the 26th, and a
    // partial day is not a day. Floored deliberately — "last read 570 days
    // ago" must never round up into a day that has not finished.
    expect(s.staleDays).toBe(570)
    expect(s.submittedDays).toBe(1901)
    expect(s.stale).toBe(true)
  })

  it('notices a sitemap on a host that only redirects', () => {
    expect(sitemapHealth(sitemaps, { now, site: 'sc-domain:arak-sa.com' })[0].offCanonicalHost).toBe(true)
    expect(sitemapHealth([{ ...sitemaps[0], path: 'https://arak-sa.com/sitemap.xml' }],
      { now, site: 'sc-domain:arak-sa.com' })[0].offCanonicalHost).toBe(false)
  })

  it('tells "never downloaded" apart from "downloaded long ago"', () => {
    const [s] = sitemapHealth([{ path: 'https://x.com/s.xml', lastSubmitted: '2026-09-01T00:00:00Z' }], { now })
    expect(s.neverDownloaded).toBe(true)
    expect(s.staleDays).toBeNull()
    // Unknown is not stale: a sitemap submitted an hour ago has not been read
    // yet either, and flagging it red would be wrong.
    expect(s.stale).toBe(false)
  })

  it('casts the counts Google sends as strings', () => {
    expect(sitemapHealth(sitemaps, { now })[0].warnings).toBe(2)
  })

  it('answers nothing for a property with no sitemap', () => {
    expect(sitemapHealth([], { now })).toEqual([])
    expect(sitemapHealth()).toEqual([])
  })
})

describe('websiteSummary', () => {
  const data = {
    queries: [
      { query: 'arak', clicks: 7, impressions: 202, ctr: 0.034, position: 6 },
      { query: 'lighting consultant riyadh', clicks: 0, impressions: 180, ctr: 0, position: 18 },
    ],
    pages: [],
    previous: [],
    brandTerms: ['arak'],
    types: {
      web: { clicks: 147, impressions: 3312, ctr: 0.0443, position: 16.3, previous: { impressions: 0, clicks: 0, ctr: 0, position: 0 } },
      image: { clicks: 1, impressions: 892, ctr: 0.0011, position: 39.9, previous: { impressions: 0 } },
    },
  }

  it('reports web search in the tiles, never web plus images', () => {
    const s = websiteSummary(data)
    expect(s.impressions).toBe(3312)
    expect(s.clicks).toBe(147)
    // Every surface is available, separately, and only separately.
    expect(s.allSurfaces.impressions).toBe(4204)
  })

  it('splits the brand’s own name out of the demand', () => {
    const s = websiteSummary(data)
    expect(s.brand.impressions).toBe(202)
    expect(s.nonBrand.impressions).toBe(180)
  })

  // The rule this module exists to enforce. The property held nothing before
  // 2026-08-25; a page that renders that as a collapse is reporting the date
  // it was verified as a catastrophe, every period, until the window clears it.
  it('is a baseline, not a 100% fall, when the previous window is empty', () => {
    const s = websiteSummary(data)
    expect(s.baseline).toBe(true)
    expect(s.impressionsDelta).toBeNull()
    expect(s.clicksDelta).toBeNull()
    expect(s.ctrDelta).toBeNull()
    expect(s.positionDelta).toBeNull()
  })

  it('flips the sign on position, so better always reads as better', () => {
    const s = websiteSummary({
      ...data,
      previous: [{ query: 'x', impressions: 100, clicks: 1, position: 20 }],
      types: { web: { ...data.types.web, previous: { impressions: 3000, clicks: 100, ctr: 0.03, position: 20.3 } } },
    })
    // Moved from 20.3 to 16.3: four places better, reported as a positive.
    expect(s.positionDelta).toBeCloseTo(4)
    expect(s.impressionsDelta).toBe(312)
    expect(s.baseline).toBe(false)
  })

  it('survives a property that answered with nothing', () => {
    const s = websiteSummary({})
    expect(s.impressions).toBe(0)
    expect(s.position).toBeNull()
    expect(s.baseline).toBe(true)
  })
})

describe('change and asPercent', () => {
  it('refuses to compare against a period that does not exist', () => {
    expect(change(100, 0, false)).toBeNull()
    expect(change(100, 40, true)).toBe(60)
  })
  it('scales a Search Console fraction to a percentage', () => {
    expect(asPercent(0.0443)).toBeCloseTo(4.43)
    expect(asPercent(undefined)).toBe(0)
  })
})

describe('prettyPath', () => {
  it('decodes an Arabic path into something a reader can tell apart', () => {
    expect(prettyPath('/%d8%ae%d8%af%d9%85%d8%a7%d8%aa%d9%86%d8%a7')).toBe('/خدماتنا')
  })

  it('leaves a plain path untouched', () => {
    expect(prettyPath('/services/smart-poles')).toBe('/services/smart-poles')
    expect(prettyPath('/')).toBe('/')
  })

  // decodeURIComponent('%zz') is a URIError, and one malformed row on the
  // property must not take the whole page down.
  it('returns a malformed escape exactly as it arrived', () => {
    expect(prettyPath('/%zz%')).toBe('/%zz%')
  })
})

describe('pageRows label', () => {
  // The canonical path stays the identity, because grouping and matching must
  // happen on one spelling. Two forms of the same path would split a page's
  // impressions in half.
  it('groups on the encoded path and prints the decoded one', () => {
    const rows = pageRows([
      { page: 'https://arak-sa.com/%d8%ae%d8%af%d9%85%d8%a7%d8%aa%d9%86%d8%a7', impressions: 10, clicks: 1, position: 8 },
      { page: 'https://www.arak-sa.com/%d8%ae%d8%af%d9%85%d8%a7%d8%aa%d9%86%d8%a7', impressions: 5, clicks: 0, position: 9 },
    ], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].impressions).toBe(15)
    expect(rows[0].path).toBe('/%d8%ae%d8%af%d9%85%d8%a7%d8%aa%d9%86%d8%a7')
    expect(rows[0].label).toBe('/خدماتنا')
  })
})

// ─── Image search ──────────────────────────────────────────────────────────

describe('imageSearch', () => {
  // The rows Google returned for this property on 2026-09-20. The three
  // airline queries are the finding: photographs of buildings ARAK lit,
  // ranking for the buildings.
  const imageQueries = [
    { query: 'air arabia headquarters', clicks: 0, impressions: 2, position: 34.5 },
    { query: 'almarai headquarters riyadh', clicks: 0, impressions: 5, position: 79.2 },
    { query: 'arak logo', clicks: 0, impressions: 1, position: 86 },
    { query: 'smart poles', clicks: 1, impressions: 8, position: 22 },
  ]
  const imagePages = [
    { page: 'https://arak-sa.com/', clicks: 1, impressions: 230, position: 43.4 },
    { page: 'https://arak-sa.com/ar', clicks: 0, impressions: 89, position: 45.7 },
    { page: 'https://arak-sa.com/ar/projects/ritz-carlton', clicks: 0, impressions: 14, position: 49.5 },
  ]
  const lines = [{ key: 'poles', label: 'Smart poles', paths: ['/services/smart-poles'], words: ['smart poles'] }]
  const types = { image: { clicks: 1, impressions: 892, position: 39.9 } }

  it('carries the surface totals and the queries that explain them', () => {
    const img = imageSearch({ imageQueries, imagePages, brandTerms: ['arak'], lines, types })
    expect(img).toMatchObject({ impressions: 892, clicks: 1, position: 39.9, namedQueries: 4 })
    expect(img.queries[0].query).toBe('smart poles')
  })

  it('marks a query as unrelated only when it names neither us nor what we sell', () => {
    const img = imageSearch({ imageQueries, imagePages, brandTerms: ['arak'], lines, types })
    const by = Object.fromEntries(img.queries.map(q => [q.query, q]))
    expect(by['arak logo'].unrelated).toBe(false)          // our own name
    expect(by['smart poles'].unrelated).toBe(false)        // a business line
    expect(by['air arabia headquarters'].unrelated).toBe(true)
    expect(img.unrelated.impressions).toBe(7)
  })

  // A brand with no business lines configured has no vocabulary to match
  // against, so every query would score as unrelated. The panel must be able
  // to say "cannot tell" rather than "all of it".
  it('says when the unrelated share cannot be measured', () => {
    const img = imageSearch({ imageQueries, imagePages, brandTerms: ['arak'], lines: [], types })
    expect(img.unrelated.measurable).toBe(false)
  })

  it('folds the host and language variants of a page, as every other panel does', () => {
    const img = imageSearch({ imageQueries, imagePages, brandTerms: [], lines, types })
    expect(img.pages[0]).toMatchObject({ path: '/', impressions: 319 })
    expect(img.pages.map(p => p.path)).toEqual(['/', '/projects/ritz-carlton'])
  })

  // Google withholds rare queries on this surface too, so the table under a
  // total of 892 adds up to 16.
  it('reports what the named queries account for', () => {
    const img = imageSearch({ imageQueries, imagePages, brandTerms: [], lines, types })
    expect(img.named).toBe(16)
    expect(img.impressions).toBe(892)
  })

  it('is an empty answer, not a crash, with nothing to report', () => {
    expect(imageSearch()).toMatchObject({ impressions: 0, queries: [], pages: [] })
  })
})
