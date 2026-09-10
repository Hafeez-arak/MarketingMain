import { describe, it, expect } from 'vitest'
import {
  PROVIDERS, shouldFallThrough, explainFallThrough,
  normaliseResult, normalisePage, availableProviders, webHealthNote,
} from './web'

describe('falling through is not the same as failing', () => {
  // The distinction this module exists for. Two failures look identical in a
  // try/catch and mean opposite things: the PROVIDER being down (the next one
  // will work) versus the CONTENT being bad (every provider fails the same).

  it('falls through when the provider is out of quota or throttled', () => {
    expect(shouldFallThrough({ status: 402 })).toBe(true)
    expect(shouldFallThrough({ status: 429 })).toBe(true)
  })

  it('falls through on a rejected key — that is a config problem, not a page problem', () => {
    expect(shouldFallThrough({ status: 401 })).toBe(true)
    expect(shouldFallThrough({ status: 403 })).toBe(true)
  })

  it('falls through on their outage', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(shouldFallThrough({ status }), String(status)).toBe(true)
    }
  })

  it('falls through when we never got an answer at all', () => {
    // A timeout and a DNS failure are the case a chain exists for.
    expect(shouldFallThrough({ networkError: true })).toBe(true)
    expect(shouldFallThrough({ status: 0, networkError: true })).toBe(true)
  })

  it('does NOT fall through when the page itself is the problem', () => {
    // The expensive mistake. On a free tier, exhausting the backup on pages
    // that do not exist is exactly how you have no backup on the day you
    // need one — and it arrives at the same answer, more slowly.
    expect(shouldFallThrough({ status: 404 })).toBe(false)
    expect(shouldFallThrough({ status: 410 })).toBe(false)
    expect(shouldFallThrough({ status: 400 })).toBe(false)
    expect(shouldFallThrough({ status: 422 })).toBe(false)
  })

  it('treats an unrecognised failure as provider-side', () => {
    // Erring this way costs one extra call. Erring the other way silently
    // loses a result we could have had, and that loss is invisible.
    expect(shouldFallThrough({ status: 418 })).toBe(true)
    expect(shouldFallThrough({ status: 599 })).toBe(true)
  })

  it('a success never falls through', () => {
    expect(shouldFallThrough({ status: 200 })).toBe(false)
  })
})

describe('the reason is written for a person, not a log', () => {
  it('names quota, key and outage differently', () => {
    expect(explainFallThrough('firecrawl', 402)).toMatch(/out of quota/i)
    expect(explainFallThrough('firecrawl', 401)).toMatch(/rejected the API key/i)
    expect(explainFallThrough('firecrawl', 503)).toMatch(/outage/i)
    expect(explainFallThrough('firecrawl', 0)).toMatch(/could not be reached/i)
  })

  it('says what to do about a bad key', () => {
    expect(explainFallThrough('tavily', 401)).toMatch(/wrong or revoked/i)
  })
})

describe('a provider with no key is skipped, not attempted', () => {
  it('lists only what is configured, in order', () => {
    expect(availableProviders({ FIRECRAWL_API_KEY: 'a', TAVILY_API_KEY: 'b' })).toEqual(PROVIDERS)
    expect(availableProviders({ TAVILY_API_KEY: 'b' })).toEqual(['tavily'])
    expect(availableProviders({ FIRECRAWL_API_KEY: 'a' })).toEqual(['firecrawl'])
  })

  it('reports nothing configured rather than pretending', () => {
    // A 401 costs a round trip to learn something the environment already
    // knew.
    expect(availableProviders({})).toEqual([])
  })

  it('keeps Firecrawl first — order is the policy', () => {
    expect(PROVIDERS[0]).toBe('firecrawl')
    expect(PROVIDERS[1]).toBe('tavily')
  })
})

describe('one shape, whichever provider answered', () => {
  it('normalises a Firecrawl and a Tavily hit identically', () => {
    // Callers must never branch on who served, or the seam stops being one.
    const fc = normaliseResult({ url: 'https://a.com', title: 'A', description: 'd' }, 'firecrawl')
    const tv = normaliseResult({ url: 'https://a.com', title: 'A', content: 'd' }, 'tavily')
    expect(Object.keys(fc).sort()).toEqual(Object.keys(tv).sort())
    expect(fc.snippet).toBe('d')
    expect(tv.snippet).toBe('d')
  })

  it('caps a page hard and says when it truncated', () => {
    // A 200KB page dropped whole into a prompt costs more than every search
    // that found it, and the useful part is almost always early.
    const huge = 'x'.repeat(50_000)
    const page = normalisePage({ markdown: huge }, 'firecrawl', 'https://a.com')
    expect(page.markdown.length).toBe(20_000)
    expect(page.truncated).toBe(true)
  })

  it('does not claim truncation when nothing was cut', () => {
    expect(normalisePage({ markdown: 'short' }, 'tavily', 'https://a.com').truncated).toBe(false)
  })

  it('reads Tavily\'s raw_content as well as Firecrawl\'s markdown', () => {
    expect(normalisePage({ raw_content: 'hello' }, 'tavily', 'x').markdown).toBe('hello')
  })
})

describe('running on the backup is worth saying out loud', () => {
  it('is silent while the primary is serving', () => {
    // A note that appears every week is a note nobody reads.
    expect(webHealthNote({ used: 'firecrawl', available: ['firecrawl', 'tavily'] })).toBe('')
  })

  it('says so when the backup served, and names what to check', () => {
    // Learning you are on the fallback from a report beats learning it from a
    // bill at the end of the month.
    const note = webHealthNote({ used: 'tavily', available: ['firecrawl', 'tavily'] })
    expect(note).toMatch(/ran on tavily/i)
    expect(note).toMatch(/check the firecrawl account/i)
  })

  it('says when there is no web research at all', () => {
    expect(webHealthNote({ available: [] })).toMatch(/no web provider is configured/i)
  })
})
