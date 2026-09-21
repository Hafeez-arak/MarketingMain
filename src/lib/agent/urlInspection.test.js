import { describe, it, expect } from 'vitest'
import {
  sitemapUrls, inspectionTargets, normalizeInspection, stateOf,
  indexHealth, externalReferrers, richResultTally, samePageKey, MAX_INSPECTIONS,
} from './urlInspection.js'

// The shape Google actually returned for https://arak-sa.com/ on 2026-09-20,
// trimmed. Recorded rather than invented: `VERDICT_UNSPECIFIED` on a result
// block Google did not check is the detail a tidy fixture would have left out,
// and it is the one that decides what half these functions do.
const HOMEPAGE = {
  inspectionResultLink: 'https://search.google.com/search-console/inspect?resource_id=sc-domain:arak-sa.com&id=BZ',
  indexStatusResult: {
    verdict: 'PASS',
    coverageState: 'Submitted and indexed',
    robotsTxtState: 'ALLOWED',
    indexingState: 'INDEXING_ALLOWED',
    lastCrawlTime: '2026-09-18T04:31:26Z',
    pageFetchState: 'SUCCESSFUL',
    googleCanonical: 'https://arak-sa.com/',
    userCanonical: 'https://arak-sa.com/',
    referringUrls: [
      'https://arak-sa.com/ar',
      'https://aeroleads.com/in/ahmed-ghonim-b05996228',
      'https://website-like.com/similar/arak-sa.com/',
    ],
    crawledAs: 'MOBILE',
  },
  mobileUsabilityResult: { verdict: 'VERDICT_UNSPECIFIED' },
}

const UNKNOWN = {
  indexStatusResult: {
    verdict: 'NEUTRAL',
    coverageState: 'URL is unknown to Google',
    robotsTxtState: 'ROBOTS_TXT_STATE_UNSPECIFIED',
    indexingState: 'INDEXING_STATE_UNSPECIFIED',
    pageFetchState: 'PAGE_FETCH_STATE_UNSPECIFIED',
  },
  mobileUsabilityResult: { verdict: 'VERDICT_UNSPECIFIED' },
}

describe('sitemapUrls', () => {
  it('reads the locations out of a urlset', () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://arak-sa.com/</loc><lastmod>2026-08-30</lastmod></url>
      <url><loc>https://arak-sa.com/ar</loc></url>
    </urlset>`
    expect(sitemapUrls(xml)).toEqual({
      urls: ['https://arak-sa.com/', 'https://arak-sa.com/ar'],
      sitemaps: [],
    })
  })

  // Both documents hold <loc>. A caller that cannot tell them apart inspects
  // a list of sitemaps as though each one were a page.
  it('reports a sitemap index as sitemaps, never as pages', () => {
    const xml = `<sitemapindex><sitemap><loc>https://arak-sa.com/pages.xml</loc></sitemap></sitemapindex>`
    expect(sitemapUrls(xml)).toEqual({ urls: [], sitemaps: ['https://arak-sa.com/pages.xml'] })
  })

  it('survives whitespace and an empty document', () => {
    expect(sitemapUrls('<urlset><url><loc>\n  https://a.com/x  \n</loc></url></urlset>').urls)
      .toEqual(['https://a.com/x'])
    expect(sitemapUrls('').urls).toEqual([])
    expect(sitemapUrls(null).urls).toEqual([])
  })
})

describe('inspectionTargets', () => {
  it('spends the first inspections on the pages that earn, then the sitemap', () => {
    const targets = inspectionTargets({
      pages: [
        { page: 'https://arak-sa.com/services/smart-poles', impressions: 255 },
        { page: 'https://arak-sa.com/', impressions: 900 },
      ],
      sitemap: ['https://arak-sa.com/contact', 'https://arak-sa.com/'],
    })
    expect(targets).toEqual([
      'https://arak-sa.com/',
      'https://arak-sa.com/services/smart-poles',
      'https://arak-sa.com/contact',
    ])
  })

  // The English page can be indexed while its Arabic twin is unknown to
  // Google. Everywhere else in this codebase /ar folds onto /; here it must
  // not, or the pair is reported healthy on the strength of one half.
  it('keeps the /ar twin as its own URL', () => {
    const targets = inspectionTargets({ sitemap: ['https://arak-sa.com/about', 'https://arak-sa.com/ar/about'] })
    expect(targets).toHaveLength(2)
  })

  it('drops duplicates that differ only by a trailing slash or case', () => {
    const targets = inspectionTargets({ sitemap: ['https://arak-sa.com/About/', 'https://arak-sa.com/about'] })
    expect(targets).toHaveLength(1)
  })

  // The stale `www` sitemap this property still has submitted put a redirecting
  // twin of every page in the list. Inspecting those can only answer "Page with
  // redirect" — 43 of 93 inspections, and half the wait, for nothing.
  it('inspects one spelling of a page, preferring https and the apex host', () => {
    const targets = inspectionTargets({
      sitemap: [
        'http://www.arak-sa.com/about',
        'https://www.arak-sa.com/about',
        'https://arak-sa.com/about',
      ],
    })
    expect(targets).toEqual(['https://arak-sa.com/about'])
  })

  // The redirecting spelling is the one taking the impressions here, so the
  // canonical twin must not inherit its place at the back of the queue.
  it('keeps the place the page earned, whichever spelling earned it', () => {
    const targets = inspectionTargets({
      pages: [
        { page: 'http://www.arak-sa.com/', impressions: 316 },
        { page: 'https://arak-sa.com/quiet', impressions: 5 },
      ],
      sitemap: ['https://arak-sa.com/'],
    })
    expect(targets).toEqual(['https://arak-sa.com/', 'https://arak-sa.com/quiet'])
  })

  it('ignores anything that is not an http url', () => {
    expect(inspectionTargets({ sitemap: ['/about', '', null, 'mailto:a@b.c'] })).toEqual([])
  })

  it('caps the list, because somebody is waiting for it', () => {
    const many = Array.from({ length: 500 }, (_, i) => `https://arak-sa.com/p${i}`)
    expect(inspectionTargets({ sitemap: many })).toHaveLength(MAX_INSPECTIONS)
    expect(inspectionTargets({ sitemap: many, limit: 5 })).toHaveLength(5)
  })
})

describe('normalizeInspection', () => {
  it('flattens the answer for an indexed page', () => {
    const row = normalizeInspection('https://arak-sa.com/', HOMEPAGE)
    expect(row).toMatchObject({
      state: 'indexed',
      verdict: 'PASS',
      coverage: 'Submitted and indexed',
      lastCrawl: '2026-09-18T04:31:26Z',
      crawledAs: 'MOBILE',
      canonicalMismatch: false,
    })
    expect(row.referrers).toHaveLength(3)
  })

  // VERDICT_UNSPECIFIED means "not checked", not "failed". Rendering the enum
  // Google sent says the second thing.
  it('empties the placeholder enums rather than passing them to a screen', () => {
    const row = normalizeInspection('https://arak-sa.com/about-us', UNKNOWN)
    expect(row.robots).toBe('')
    expect(row.fetch).toBe('')
    expect(row.state).toBe('unknown')
  })

  it('records a failed call as a row rather than losing the URL', () => {
    const row = normalizeInspection('https://arak-sa.com/x', {}, 'HTTP 429')
    expect(row).toMatchObject({ state: 'error', error: 'HTTP 429', verdict: '' })
  })

  it('only calls a canonical mismatch when it can see both', () => {
    const both = normalizeInspection('u', {
      indexStatusResult: { googleCanonical: 'https://a.com/x', userCanonical: 'https://a.com/y' },
    })
    expect(both.canonicalMismatch).toBe(true)
    const one = normalizeInspection('u', { indexStatusResult: { googleCanonical: 'https://a.com/x' } })
    expect(one.canonicalMismatch).toBe(false)
  })
})

describe('stateOf', () => {
  // The distinction the whole panel exists for: never seen (a link problem,
  // minutes to fix) against looked at and declined (a content problem).
  it('separates unknown from excluded', () => {
    expect(stateOf({ verdict: 'NEUTRAL', coverage: 'URL is unknown to Google' })).toBe('unknown')
    expect(stateOf({ verdict: 'NEUTRAL', coverage: 'Crawled - currently not indexed' })).toBe('excluded')
    expect(stateOf({ verdict: 'NEUTRAL', coverage: 'Discovered - currently not indexed' })).toBe('excluded')
    expect(stateOf({ verdict: 'NEUTRAL', coverage: 'Alternate page with proper canonical tag' })).toBe('excluded')
  })

  it('reads PASS as indexed and a failed call as an error', () => {
    expect(stateOf({ verdict: 'PASS', coverage: 'Submitted and indexed' })).toBe('indexed')
    expect(stateOf({ error: 'nope' })).toBe('error')
    expect(stateOf({})).toBe('unchecked')
  })
})

describe('indexHealth', () => {
  const rows = [
    { ...normalizeInspection('https://arak-sa.com/', HOMEPAGE), impressions: 900 },
    { ...normalizeInspection('https://arak-sa.com/about-us', UNKNOWN), impressions: 0 },
    {
      ...normalizeInspection('https://arak-sa.com/old', {
        indexStatusResult: {
          verdict: 'PASS', coverageState: 'Submitted and indexed',
          lastCrawlTime: '2026-01-01T00:00:00Z',
          googleCanonical: 'https://arak-sa.com/new', userCanonical: 'https://arak-sa.com/old',
        },
      }),
      impressions: 40,
    },
  ]
  const now = new Date('2026-09-20T00:00:00Z')

  it('counts the states and lists what is missing', () => {
    const health = indexHealth(rows, { now, site: 'sc-domain:arak-sa.com' })
    expect(health.checked).toBe(3)
    expect(health.counts).toMatchObject({ indexed: 2, unknown: 1 })
    expect(health.missing.rows.map(r => r.url)).toEqual(['https://arak-sa.com/about-us'])
  })

  it('finds a crawl Google has not repeated in months, and a canonical it overrode', () => {
    const health = indexHealth(rows, { now })
    expect(health.stale.rows.map(r => r.url)).toEqual(['https://arak-sa.com/old'])
    expect(health.canonical.rows.map(r => r.url)).toEqual(['https://arak-sa.com/old'])
  })

  // Eighty rows of red reads as "the tool is broken" rather than "the site
  // is", so the list is cut — and says by how much.
  it('caps the problem lists worst-first and reports the remainder', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...normalizeInspection(`https://arak-sa.com/p${i}`, UNKNOWN), impressions: i,
    }))
    const health = indexHealth(many, { now, limit: 5 })
    expect(health.missing.rows).toHaveLength(5)
    expect(health.missing.more).toBe(15)
    expect(health.missing.rows[0].url).toBe('https://arak-sa.com/p19')
  })

  it('an empty set is an empty answer, not a crash', () => {
    expect(indexHealth([], { now }).checked).toBe(0)
    expect(indexHealth().counts.indexed).toBe(0)
  })
})

describe('externalReferrers', () => {
  it('drops our own hosts and folds the rest by host', () => {
    const rows = [normalizeInspection('https://arak-sa.com/', HOMEPAGE)]
    const refs = externalReferrers(rows, 'sc-domain:arak-sa.com')
    expect(refs.map(r => r.host)).toEqual(['aeroleads.com', 'website-like.com'])
    expect(refs[0]).toMatchObject({ links: 1, pages: 1 })
  })

  it('treats www and subdomains of the property as ours', () => {
    const rows = [{ url: 'https://arak-sa.com/', referrers: ['https://www.arak-sa.com/a', 'https://shop.arak-sa.com/b'] }]
    expect(externalReferrers(rows, 'sc-domain:arak-sa.com')).toEqual([])
  })

  it('counts a host that links to several pages once, with both numbers', () => {
    const rows = [
      { url: 'https://arak-sa.com/a', referrers: ['https://news.example/1'] },
      { url: 'https://arak-sa.com/b', referrers: ['https://news.example/2'] },
    ]
    expect(externalReferrers(rows, 'arak-sa.com')[0]).toMatchObject({ host: 'news.example', links: 2, pages: 2 })
  })

  it('skips anything that is not a URL', () => {
    expect(externalReferrers([{ url: 'x', referrers: ['not a url', ''] }], 'a.com')).toEqual([])
  })
})

describe('richResultTally', () => {
  it('counts pages per detected type', () => {
    const rows = [
      { richTypes: ['Breadcrumbs'] },
      { richTypes: ['Breadcrumbs', 'Organization'] },
      { richTypes: [] },
    ]
    expect(richResultTally(rows)).toEqual([
      { type: 'Breadcrumbs', pages: 2 },
      { type: 'Organization', pages: 1 },
    ])
  })

  // An empty tally is a statement — Google found no structured data on any
  // page we asked about — and the panel says so rather than showing nothing.
  it('is empty when nothing was detected', () => {
    expect(richResultTally([{ richTypes: [] }])).toEqual([])
  })
})

describe('samePageKey', () => {
  it('folds scheme, www and a trailing slash, and nothing else', () => {
    expect(samePageKey('http://www.a.com/x/')).toBe(samePageKey('https://a.com/x'))
    // Different documents, each with its own index status.
    expect(samePageKey('https://a.com/ar/x')).not.toBe(samePageKey('https://a.com/x'))
    expect(samePageKey('https://a.com/x?y=1')).not.toBe(samePageKey('https://a.com/x'))
  })
})
