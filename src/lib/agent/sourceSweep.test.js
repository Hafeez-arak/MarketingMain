import { describe, it, expect } from 'vitest'
import {
  sweepPlan, siteOf, handleOf, linkedinOf, belongs, headlinesFrom, mergeResults,
  sweepBlock, findingsBySource, sourceRecord, depthOf,
} from './sourceSweep.js'
import { sourcesBlock } from './lensPrompts.js'

const src = (source_type, subject, tier = 2, id = subject) => ({ id, source_type, subject, tier, why: '' })

describe('reading a subject', () => {
  it('turns a domain, a URL or a path into a site', () => {
    expect(siteOf('meed.com')).toEqual({ host: 'meed.com', path: 'meed.com' })
    expect(siteOf('https://www.saudigulfprojects.com/')).toEqual({ host: 'saudigulfprojects.com', path: 'saudigulfprojects.com' })
    expect(siteOf('enterpriseam.com/ksa')).toEqual({ host: 'enterpriseam.com', path: 'enterpriseam.com/ksa' })
    expect(siteOf('ALEC FITOUT')).toBeNull()
  })
  it('finds a handle however it was typed', () => {
    expect(handleOf('@addadruh')).toBe('addadruh')
    expect(handleOf('https://www.instagram.com/SaudiProjects/')).toBe('saudiprojects')
    expect(handleOf('Saudi Projects')).toBe('')
  })
  it('tells a LinkedIn page from a company name', () => {
    expect(linkedinOf('linkedin.com/company/saudi-projects')).toEqual({ slug: 'saudi-projects' })
    expect(linkedinOf('https://sa.linkedin.com/company/saudi-projects/')).toEqual({ slug: 'saudi-projects' })
    expect(linkedinOf('ALEC FITOUT')).toEqual({ name: 'ALEC FITOUT' })
  })
})

describe('sweepPlan', () => {
  it('reads a top site closely: its front page and a deeper search, never with Arabic words', () => {
    const p = sweepPlan(src('news', 'meed.com', 1), { geography: 'Saudi Arabia' })
    expect(p.read).toBe('https://meed.com')
    expect(p.searches.map(s => s.query)).toEqual(['site:meed.com Saudi Arabia project contract awarded'])
    expect(p.searches[0].limit).toBe(8)
    expect(p.keep).toEqual({ host: 'meed.com' })
  })
  it('reads a normal site with one search and skims a light one', () => {
    const two = sweepPlan(src('news', 'zawya.com', 2))
    expect(two.read).toBeNull()
    expect(two.searches).toHaveLength(1)
    expect(two.searches[0].limit).toBe(5)
    expect(sweepPlan(src('news', 'zawya.com', 3)).searches[0].limit).toBe(3)
  })
  it('keeps only the first part of a long geography', () => {
    const p = sweepPlan(src('website', 'saudigulfprojects.com', 2), { geography: 'Riyadh, Jeddah and the Eastern Province' })
    expect(p.searches[0].query).toBe('site:saudigulfprojects.com Riyadh project contract awarded')
  })
  it('searches an account on its own platform', () => {
    expect(sweepPlan(src('instagram', '@addadruh', 1)).searches[0].query).toBe('site:instagram.com/addadruh')
    expect(sweepPlan(src('linkedin', 'linkedin.com/company/saudi-projects', 1)).searches[0].query)
      .toBe('site:linkedin.com/posts "saudi-projects"')
    expect(sweepPlan(src('linkedin', 'Depa Interiors', 3)).searches[0].query).toBe('site:linkedin.com/posts "Depa Interiors"')
  })
  it('searches a hashtag or a phrase as written', () => {
    expect(sweepPlan(src('hashtag', '#مشاريع_الرياض', 1)).searches.map(s => s.query))
      .toEqual(['#مشاريع_الرياض', 'site:instagram.com #مشاريع_الرياض'])
    expect(sweepPlan(src('keyword', 'ترسية عقد تشطيب الرياض', 2)).searches.map(s => s.query)).toEqual(['ترسية عقد تشطيب الرياض'])
  })
  it('gives up on a site type with no domain rather than searching nonsense', () => {
    expect(sweepPlan(src('website', 'not a domain'))).toBeNull()
    expect(sweepPlan(src('news', ''))).toBeNull()
  })
  it('treats an unknown tier as a normal one', () => {
    expect(depthOf(null)).toEqual(depthOf(2))
  })
})

describe('belongs', () => {
  it('drops pages from other sites when a search engine ignored site:', () => {
    const keep = sweepPlan(src('website', 'saudigulfprojects.com', 1)).keep
    expect(belongs('https://www.saudigulfprojects.com/2026/10/x/', keep)).toBe(true)
    expect(belongs('https://x.com/sharqetrade/status/1', keep)).toBe(false)
  })
  it('keeps an account to its own posts, not a longer handle', () => {
    const keep = sweepPlan(src('instagram', '@addadruh')).keep
    expect(belongs('https://www.instagram.com/addadruh/p/Ddhfc8hDC8x/?hl=hi', keep)).toBe(true)
    expect(belongs('https://www.instagram.com/addadruh2/p/x/', keep)).toBe(false)
  })
  it('keeps a LinkedIn page to posts it made', () => {
    const keep = sweepPlan(src('linkedin', 'linkedin.com/company/saudi-projects')).keep
    expect(belongs('https://www.linkedin.com/posts/saudi-projects_riyadh-activity-1', keep)).toBe(true)
    expect(belongs('https://sa.linkedin.com/posts/saudi-projects_x-activity-2', keep)).toBe(true)
    expect(belongs('https://www.linkedin.com/posts/esapai_saudi-projects-activity-3', keep)).toBe(false)
  })
})

describe('headlinesFrom', () => {
  const md = [
    '[Saudi Arabia’s 2GW Khulais Solar PV Project Completes Piling Works](https://www.saudigulfprojects.com/2026/10/khulais/ "t")![](https://www.saudigulfprojects.com/img.png)',
    '### [Saudi Arabia’s 2GW Khulais Solar PV Project Completes Piling Works](https://www.saudigulfprojects.com/2026/10/khulais/ "t")',
    '[Home](https://www.saudigulfprojects.com/)',
    '[An advertiser page with a long enough title](https://ads.example.com/x)',
    '[BEC Arabia Awarded $208.2 Million MEP Contract](https://www.saudigulfprojects.com/2026/09/bec/)',
  ].join('\n')
  it('keeps each story once, on the site, and drops navigation', () => {
    const h = headlinesFrom(md, 'saudigulfprojects.com')
    expect(h.map(r => r.url)).toEqual([
      'https://www.saudigulfprojects.com/2026/10/khulais/',
      'https://www.saudigulfprojects.com/2026/09/bec/',
    ])
  })
})

describe('mergeResults', () => {
  it('drops repeats by URL and cuts long snippets', () => {
    const out = mergeResults([[{ title: 'a', url: 'https://a.com/1/', snippet: 'x'.repeat(900) }], [{ title: 'b', url: 'https://a.com/1' }]])
    expect(out).toHaveLength(1)
    expect(out[0].snippet).toHaveLength(300)
  })
})

describe('snippets', () => {
  it('keep the words and drop the markdown and portal links', () => {
    const [r] = mergeResults([[{ title: 't', url: 'https://a.com/x', snippet: '## Compare [ARABIAN SHIELD](https://a.com/very/long) announces **award** https://a.com/z' }]])
    expect(r.snippet).toBe('Compare ARABIAN SHIELD announces award')
  })
})

describe('sweepBlock', () => {
  const checks = [
    { status: 'done', source: src('news', 'zawya.com', 3), results: [{ title: 'Z', url: 'https://zawya.com/z', snippet: '' }] },
    { status: 'done', source: src('news', 'meed.com', 1), results: [{ title: 'Contractor wins $208m Almoosa hospital MEP contract', url: 'https://www.meed.com/a', snippet: 'Riyadh-based BEC Arabia' }] },
    { status: 'done', source: src('instagram', '@riyadh_today', 2), results: [] },
    { status: 'failed', source: src('tender_portal', 'tenders.etimad.sa', 1), results: [] },
  ]
  it('lists the top tier first, as leads to confirm', () => {
    const b = sweepBlock(checks)
    expect(b).toContain('ALREADY SEARCHED FOR YOU')
    expect(b).toContain('These are LEADS, not findings')
    expect(b.indexOf('meed.com')).toBeLessThan(b.indexOf('zawya.com'))
    expect(b).toContain('https://www.meed.com/a — Riyadh-based BEC Arabia')
  })
  it('names the empty and the unreachable in one line each', () => {
    const b = sweepBlock(checks)
    expect(b).toContain('Searched, nothing new came back: @riyadh_today.')
    expect(b).toContain('Could not be checked this week: tenders.etimad.sa.')
  })
  it('is what the project lenses get in place of the bare list when there is a sweep', () => {
    expect(sourcesBlock([src('news', 'meed.com', 1)], { sweep: checks })).toBe(sweepBlock(checks))
    expect(sourcesBlock([src('news', 'meed.com', 1)])).toContain('WHERE TO LOOK FIRST')
  })
})

describe('findingsBySource', () => {
  const sources = [src('news', 'meed.com', 1, 's1'), src('instagram', '@addadruh', 1, 's2'), src('hashtag', '#x', 2, 's3')]
  it('counts the project findings that rest on each source', () => {
    const counts = findingsBySource([
      { lens: 'targets', sources: [{ url: 'https://www.meed.com/a' }, 'https://www.instagram.com/addadruh/p/1/'] },
      { lens: 'openings', sources: ['https://www.meed.com/b'] },
      { lens: 'events', sources: ['https://www.meed.com/c'] },
    ], sources)
    expect(counts.get('s1')).toBe(2)
    expect(counts.get('s2')).toBe(1)
    // A hashtag has no page of its own, so nothing can be said to rest on it.
    expect(counts.get('s3')).toBe(0)
  })
})

describe('sourceRecord', () => {
  it('reads the newest finished check and the last one that led somewhere', () => {
    const r = sourceRecord([
      { status: 'done', result_count: 2, findings: 1, checked_at: '2026-10-12T04:00:00Z' },
      { status: 'claimed', result_count: 0, findings: null, checked_at: '2026-10-26T04:00:00Z' },
      { status: 'done', result_count: 6, findings: 0, checked_at: '2026-10-19T04:00:00Z' },
    ])
    expect(r.checkedAt).toBe('2026-10-19T04:00:00Z')
    expect(r.results).toBe(6)
    expect(r.lastHitAt).toBe('2026-10-12T04:00:00Z')
    expect(r.runs).toBe(2)
  })
  it('says nothing was checked when nothing was', () => {
    expect(sourceRecord([]).checkedAt).toBeNull()
  })
})
