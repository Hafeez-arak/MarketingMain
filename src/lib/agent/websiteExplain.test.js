import { describe, it, expect } from 'vitest'
import {
  explainFacts, explainPrompt, parseExplain, EXPLAIN_SCHEMA, MAX_POINT, MAX_POINTS,
} from './websiteExplain.js'

describe('explainFacts', () => {
  const summary = {
    impressions: 3312, clicks: 147, ctr: 4.438259, position: 16.34821,
    impressionsDelta: 12.4, baseline: false,
    brand: { impressions: 900, clicks: 110 }, nonBrand: { impressions: 2412, clicks: 37 },
  }

  it('rounds to what the screen shows, not to what Google sent', () => {
    const facts = explainFacts({ summary, coverage: { named: 1310, all: 3312, namedQueries: 202 } })
    expect(facts.totals.ctrPercent).toBe(4.4)
    expect(facts.totals.averagePosition).toBe(16.3)
    expect(facts.queryCoverage.withheldPercent).toBe(60)
  })

  // "We have no earlier period" and "the earlier period was zero" are
  // different facts, and only one of them is a collapse.
  it('keeps a missing comparison missing', () => {
    const facts = explainFacts({ summary: { ...summary, impressionsDelta: null, baseline: true } })
    expect(facts.totals.impressionsChangePercent).toBeNull()
    expect(facts.totals.baseline).toBe(true)
  })

  it('is small: a handful of rows per list, never the payload', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ query: `q${i}`, impressions: i }))
    const facts = explainFacts({ summary, queries: many, pages: many.map(q => ({ path: q.query })) })
    expect(facts.topQueries).toHaveLength(10)
    expect(facts.topPages).toHaveLength(8)
    expect(JSON.stringify(facts).length).toBeLessThan(6000)
  })

  it('leaves out the halves that were not asked for', () => {
    const facts = explainFacts({ summary })
    expect(facts.imageSearch).toBeNull()
    expect(facts.indexing).toBeNull()
    expect(facts.sitemap).toBeNull()
  })

  it('carries the image and indexing findings when they are there', () => {
    const facts = explainFacts({
      summary,
      image: {
        impressions: 892, clicks: 1, position: 39.94,
        queries: [{ query: 'air arabia headquarters', impressions: 2, unrelated: true }],
        unrelated: { measurable: true, share: 43.2 },
      },
      index: {
        checked: 89,
        counts: { indexed: 52, excluded: 12, unknown: 24 },
        missing: { rows: [{ url: 'https://arak-sa.com/services/lighting-controls' }] },
        referrers: [{ host: 'a.com' }, { host: 'b.com' }],
        richResults: [{ type: 'Breadcrumbs' }],
      },
    })
    expect(facts.imageSearch).toMatchObject({ impressions: 892, averagePosition: 39.9, unrelatedShare: 43 })
    expect(facts.indexing).toMatchObject({ neverSeenByGoogle: 24, externalLinkingDomains: 2 })
    expect(facts.indexing.examplesMissing[0]).toContain('lighting-controls')
  })

  // A brand with no business lines cannot measure the unrelated share, and a
  // zero there would be read as "none of it is unrelated".
  it('passes an unmeasurable share through as unknown', () => {
    const facts = explainFacts({
      summary, image: { impressions: 10, queries: [], unrelated: { measurable: false, share: 0 } },
    })
    expect(facts.imageSearch.unrelatedShare).toBeNull()
  })
})

describe('explainPrompt', () => {
  const facts = explainFacts({ summary: { impressions: 10, clicks: 1 } })

  it('states the length limit, the no-arithmetic rule and the baseline rule', () => {
    const prompt = explainPrompt(facts)
    expect(prompt).toContain('170 characters')
    expect(prompt).toContain('Do NOT calculate')
    expect(prompt).toContain('That is not a fall')
  })

  it('says where the answer will be read', () => {
    expect(explainPrompt(facts, { audience: 'analytics' })).toContain('website analytics screen')
    expect(explainPrompt(facts, { audience: 'research' })).toContain('weekly research report')
  })

  it('carries the facts verbatim, so every number in the answer can be checked', () => {
    expect(explainPrompt(explainFacts({ summary: { impressions: 3312 } }))).toContain('3312')
  })
})

describe('parseExplain', () => {
  it('reads the points back', () => {
    const out = parseExplain(JSON.stringify({
      points: [{ text: 'Most of your clicks are people typing your own name.', kind: 'context' }],
    }))
    expect(out.ok).toBe(true)
    expect(out.points).toHaveLength(1)
  })

  // Truncating makes a page look broken; dropping makes a shorter list.
  it('drops an over-long point rather than cutting it', () => {
    const out = parseExplain(JSON.stringify({
      points: [{ text: 'x'.repeat(MAX_POINT + 1), kind: 'good' }, { text: 'Short one.', kind: 'good' }],
    }))
    expect(out.points.map(p => p.text)).toEqual(['Short one.'])
  })

  it('caps the list and defaults a missing kind', () => {
    const out = parseExplain(JSON.stringify({
      points: Array.from({ length: 9 }, () => ({ text: 'A point.' })),
    }))
    expect(out.points).toHaveLength(MAX_POINTS)
    expect(out.points[0].kind).toBe('context')
  })

  // A parse failure and an empty month must not read the same on screen.
  it('separates malformed output from an empty answer', () => {
    expect(parseExplain('not json')).toMatchObject({ ok: false, points: [] })
    expect(parseExplain('not json').error).toBeTruthy()
    expect(parseExplain(JSON.stringify({ points: [] }))).toMatchObject({ ok: true, points: [], error: '' })
  })
})

describe('EXPLAIN_SCHEMA', () => {
  // The structured-output limits this project already hit once: a schema that
  // is too large, or too loose, fails at the API rather than in a test.
  it('is small, closed, and fixes the vocabulary of `kind`', () => {
    const item = EXPLAIN_SCHEMA.schema.properties.points.items
    expect(item.additionalProperties).toBe(false)
    expect(item.required).toEqual(['text', 'kind'])
    expect(item.properties.kind.enum).toEqual(['good', 'problem', 'opportunity', 'context'])
    expect(JSON.stringify(EXPLAIN_SCHEMA).length).toBeLessThan(4000)
  })
})

describe('explainFacts on the research side', () => {
  // The research report already prints the lens's own sentences. The model is
  // shown them so it does not spend its three points restating them.
  it('carries what the report already says, and the prompt forbids repeating it', () => {
    const facts = explainFacts({
      summary: { impressions: 3312 },
      findings: [
        { headline: 'We appear for "lighting consultant riyadh" 180 times at position 18.3', action: 'Write the page', line: 'lighting' },
        { headline: '' },
      ],
    })
    expect(facts.alreadyReported).toHaveLength(1)
    expect(facts.alreadyReported[0].line).toBe('lighting')
    expect(explainPrompt(facts, { audience: 'research' })).toContain('Do not')
  })

  it('is absent when nothing has been reported', () => {
    expect(explainFacts({ summary: {} }).alreadyReported).toEqual([])
  })
})
