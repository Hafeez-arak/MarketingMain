import { describe, it, expect } from 'vitest'
import { candidateFromUrl, suggestSources } from './sourceSuggest'

describe('candidateFromUrl', () => {
  it('reads a handle from a profile URL, never from a post', () => {
    expect(candidateFromUrl('https://www.instagram.com/addadruh/')).toEqual({ source_type: 'instagram', subject: '@addadruh' })
    expect(candidateFromUrl('https://www.instagram.com/p/Dd9LxIVCgTo/')).toBeNull()
    expect(candidateFromUrl('https://www.instagram.com/reel/DMnEewTMI6O/')).toBeNull()
  })

  it('turns a LinkedIn post into the page that posted it', () => {
    expect(candidateFromUrl('https://www.linkedin.com/posts/incsolutionsgroup_baker-mckenzie-activity-747'))
      .toEqual({ source_type: 'linkedin', subject: 'linkedin.com/company/incsolutionsgroup' })
    expect(candidateFromUrl('https://sa.linkedin.com/company/alec-fitout/'))
      .toEqual({ source_type: 'linkedin', subject: 'linkedin.com/company/alec-fitout' })
  })

  it('never proposes a job board or a document-sharing site', () => {
    expect(candidateFromUrl('https://www.scribd.com/document/1')).toBeNull()
    expect(candidateFromUrl('https://emit.fa.ca3.oraclecloud.com/hcm/job/1')).toBeNull()
    expect(candidateFromUrl('not a url')).toBeNull()
  })
})

describe('suggestSources', () => {
  const f = (lens, urls, extra = {}) => ({ lens, headline: `${lens} finding`, relevance: 'high', sources: urls.map(url => ({ url })), ...extra })

  it('proposes an account on one project finding, a site only on two', () => {
    const out = suggestSources([
      f('openings', ['https://www.instagram.com/newtracker/', 'https://news.example/a']),
      f('targets', ['https://news.example/b']),
      f('targets', ['https://onlyonce.example/c']),
    ])
    expect(out.map(o => o.subject)).toEqual(['@newtracker', 'news.example'])
    expect(out[1].why).toMatch(/cited by 2 project findings/)
  })

  it('skips what is already on the list in any status, and non-project lenses', () => {
    const out = suggestSources([
      f('openings', ['https://www.instagram.com/addadruh/']),
      f('targets', ['https://argaam.com/x', 'https://argaam.com/y']),
      f('targets', ['https://argaam.com/z']),
      f('rivals_lighting', ['https://www.instagram.com/rival/']),
      f('openings', ['https://www.instagram.com/lowone/'], { relevance: 'low' }),
    ], [{ subject: '@addadruh', status: 'retired' }, { subject: 'argaam.com/en', status: 'active' }])
    expect(out).toEqual([])
  })
})
