import { describe, it, expect } from 'vitest'
import {
  scoreCandidate, handlesFrom, resolutionFor, queriesFor,
  domainOf, tokensOf, RESOLVE_AT, SUGGEST_AT,
} from './resolve'

describe('scoring is arithmetic, and says why', () => {
  it('a matching domain in the bio is close to conclusive', () => {
    // The strongest signal there is: an account whose bio links to the rival's
    // own domain is the rival's account.
    const out = scoreCandidate(
      { name: 'Technolight', website: 'https://technolight-ksa.com/' },
      { username: 'technolight', name: 'Technolight', website: 'http://technolight-ksa.com', biography: '' },
    )
    expect(out.score).toBeGreaterThanOrEqual(RESOLVE_AT)
    expect(out.reasons.join(' ')).toMatch(/bio links to technolight-ksa\.com/)
  })

  it('names every signal it used, so a wrong answer is explainable', () => {
    // The property that makes this arithmetic rather than a model call: when
    // it is wrong, a person can read which signal misled it.
    const out = scoreCandidate(
      { name: 'Huda Lighting' },
      { username: 'hudalighting', name: 'Huda Lighting', biography: 'Lighting', followers_count: 50_000 },
    )
    expect(out.reasons.length).toBeGreaterThan(1)
    expect(out.reasons.join(' ')).toMatch(/50000 followers/)
  })

  it('a tiny account is penalised, not rewarded', () => {
    // A real brand's account is rarely tiny; a squatter's usually is.
    const big = scoreCandidate({ name: 'Arclight' }, { username: 'arclight', followers_count: 20_000 })
    const tiny = scoreCandidate({ name: 'Arclight' }, { username: 'arclight', followers_count: 4 })
    expect(tiny.score).toBeLessThan(big.score)
    expect(tiny.reasons.join(' ')).toMatch(/probably not the real account/)
  })

  it('an unrelated account scores near zero', () => {
    const out = scoreCandidate(
      { name: 'Technolight', website: 'https://technolight-ksa.com' },
      { username: 'catsofinstagram', name: 'Cats', biography: 'cats', followers_count: 900_000 },
    )
    expect(out.score).toBeLessThan(SUGGEST_AT)
  })

  it('is deterministic — the same inputs twice give the same answer', () => {
    // The reason this is not a model call. A model gives a confident answer
    // with no auditable reasoning and a different one next Tuesday.
    const args = [{ name: 'Alfanar Lighting' }, { username: 'alfanarprojects', biography: 'Alfanar projects' }]
    expect(scoreCandidate(...args)).toEqual(scoreCandidate(...args))
  })

  it('ignores generic words when matching tokens', () => {
    // Otherwise every lighting company in Saudi Arabia matches every other
    // one on "lighting" and "saudi".
    expect(tokensOf('Alnasser Lighting Saudi Arabia')).toEqual(['alnasser'])
  })

  it('normalises domains before comparing', () => {
    expect(domainOf('https://www.alfanar.com/lighting')).toBe('alfanar.com')
    expect(domainOf('alfanar.com')).toBe('alfanar.com')
    expect(domainOf('')).toBe('')
  })
})

describe('pulling handles out of search results', () => {
  it('finds them in urls and in prose', () => {
    const text = 'Their page is https://instagram.com/technolight and also @hudalighting is theirs.'
    expect(handlesFrom(text)).toEqual(['technolight', 'hudalighting'])
  })

  it('never mistakes an Instagram section path for an account', () => {
    // How "@reel" ends up on a watchlist.
    const text = 'https://instagram.com/p/ABC123 https://instagram.com/explore/tags/lighting'
    expect(handlesFrom(text)).toEqual([])
  })

  it('de-duplicates', () => {
    const text = 'instagram.com/technolight and instagram.com/technolight again'
    expect(handlesFrom(text)).toEqual(['technolight'])
  })

  it('survives empty and malformed input', () => {
    expect(handlesFrom('')).toEqual([])
    expect(handlesFrom(null)).toEqual([])
    expect(handlesFrom('no handles here at all')).toEqual([])
  })
})

describe('the three outcomes stay distinct', () => {
  it('verified and confident becomes resolved — the only measured state', () => {
    const out = resolutionFor({ score: 0.9, verified: true })
    expect(out.ig_status).toBe('resolved')
    expect(out.ig_verified_at).toBeTruthy()
  })

  it('confident but UNVERIFIED is only a suggestion', () => {
    // The rule that protects the numbers: a handle that was found but not
    // verified must never be snapshotted, however good it looks. Two
    // similarly-named companies in one workspace, and a confident week of
    // figures attached to the wrong one is the kind of wrong that does not
    // look wrong.
    const out = resolutionFor({ score: 0.95, verified: false })
    expect(out.ig_status).toBe('unresolved')
    expect(out.ig_verified_at).toBeNull()
  })

  it('a weak candidate is kept as a suggestion rather than discarded', () => {
    // Stored deliberately so there is something for a person to accept or
    // correct, instead of a blank they cannot act on.
    expect(resolutionFor({ score: 0.4, verified: false }).ig_status).toBe('unresolved')
  })

  it('nothing plausible is not_found, which means web evidence only', () => {
    expect(resolutionFor({ score: 0.1, verified: false }).ig_status).toBe('not_found')
    expect(resolutionFor({ score: 0, verified: true }).ig_status).toBe('not_found')
  })
})

describe('the searches it tries', () => {
  it('uses the website when there is one, because the domain is the best signal', () => {
    const q = queriesFor({ name: 'Alfanar Lighting', website: 'https://www.alfanar.com/lighting' })
    expect(q.join(' ')).toMatch(/alfanar\.com Instagram/)
  })

  it('still works with only a name', () => {
    expect(queriesFor({ name: 'Arclight' }).length).toBeGreaterThan(0)
  })
})
