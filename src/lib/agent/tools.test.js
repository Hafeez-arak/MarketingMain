import { describe, it, expect } from 'vitest'
import {
  READ_TOOLS, ALL_TOOLS, toolDefs, findTool, isFree, toolsExposingWorkspace, FREE,
} from './tools'
import {
  engagementOf, performanceBy, ourPerformance,
  engagementPer1k, deltaFor, competitorBoard,
} from './aggregate'

describe('the tool belt cannot be talked across workspaces', () => {
  // The single most important assertion in this file. AGENT.md §2 puts
  // isolation in the tool layer rather than the prompt, and this is what makes
  // that a fact rather than an intention: no tool may accept a workspace id
  // from the model, because a model that hallucinated another workspace's uuid
  // — or read one off a competitor's web page — would otherwise be issuing a
  // cross-tenant read with nothing but its own good behaviour in the way.
  it('no tool exposes a workspace or tenant parameter', () => {
    expect(toolsExposingWorkspace()).toEqual([])
  })

  it('stays true as tools are added', () => {
    // Proves the guard actually detects the mistake, rather than passing
    // because it never looks at anything.
    const bad = [{
      name: 'get_anything',
      input_schema: { type: 'object', properties: { workspace_id: { type: 'string' } } },
    }]
    expect(toolsExposingWorkspace(bad)).toEqual(['get_anything'])
  })

  it('catches the camelCase and aliased spellings too', () => {
    const variants = [
      { name: 'a', input_schema: { properties: { workspaceId: {} } } },
      { name: 'b', input_schema: { properties: { tenant_id: {} } } },
      { name: 'c', input_schema: { properties: { org_id: {} } } },
    ]
    expect(toolsExposingWorkspace(variants).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('tool definitions', () => {
  it('every tool has a name, a description and a schema', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.input_schema.type).toBe('object')
    }
  })

  it('names are unique', () => {
    const names = ALL_TOOLS.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('the read tools are all free — none of them can cost money', () => {
    // The split exists so the search loop knows what to pace itself against.
    // A read tool that quietly became metered would blow a run's budget
    // without anything looking different at the call site.
    for (const tool of READ_TOOLS) expect(tool.cost).toBe(FREE)
    expect(isFree('get_posts')).toBe(true)
  })

  it('an unknown tool is treated as metered, not free', () => {
    // Fail toward the expensive side: an unrecognised name must not slip
    // through a budget check as free.
    expect(isFree('get_whatever_it_wants')).toBe(false)
    expect(findTool('get_whatever_it_wants')).toBeNull()
  })

  it('toolDefs sends only what the provider expects', () => {
    // `cost` is ours. Sending it risks a rejected request and, worse, changes
    // the bytes of the cached prefix for no reason at all.
    for (const def of toolDefs()) {
      expect(Object.keys(def).sort()).toEqual(['description', 'input_schema', 'name'])
    }
  })
})

describe('engagement is measured, not guessed', () => {
  it('no analytics row means null, not zero', () => {
    // "We have no data" and "nobody engaged" are different facts. Collapsing
    // them drags every average toward zero as unsynced posts accumulate.
    expect(engagementOf([])).toBeNull()
    expect(engagementOf(null)).toBeNull()
  })

  it('takes the newest snapshot rather than summing them', () => {
    // Analytics re-sync daily and each row holds cumulative totals. Summing
    // would count the same like once per sync.
    const rows = [
      { metric_date: '2026-09-01', likes: 10, comments: 2 },
      { metric_date: '2026-09-03', likes: 14, comments: 3 },
      { metric_date: '2026-09-02', likes: 12, comments: 2 },
    ]
    const out = engagementOf(rows)
    expect(out.likes).toBe(14)
    expect(out.engagement).toBe(17)
    expect(out.metric_date).toBe('2026-09-03')
  })

  it('an analytics row whose metrics are all null is not a zero score', () => {
    // The sync can insert a row before the platform returns figures — which is
    // why post_analytics carries metrics_present at all. Number(null) is 0 and
    // isFinite(0) is true, so the obvious check turns "not measured yet" into
    // "measured, scored nothing" and quietly drags every average down.
    expect(engagementOf([{ metric_date: '2026-09-01', likes: null, comments: null }])).toBeNull()
  })

  it('counts interactions, not impressions', () => {
    // Reach reflects how far the platform pushed a post; engagement reflects
    // whether anyone cared. Only the second says anything about the content.
    const out = engagementOf([{ metric_date: '2026-09-01', likes: 5, comments: 1, reach: 99999 }])
    expect(out.engagement).toBe(6)
    expect(out.reach).toBe(99999)
  })
})

describe('sample sizes travel with the averages', () => {
  const posts = [
    { id: 'a', format: 'carousel' },
    { id: 'b', format: 'carousel' },
    { id: 'c', format: 'reel' },
  ]
  const byPostId = {
    a: [{ metric_date: '2026-09-01', likes: 20 }],
    b: [{ metric_date: '2026-09-01', likes: 10 }],
    // 'c' deliberately has none.
  }

  it('reports posts and measured separately', () => {
    const rows = performanceBy(posts, byPostId, p => p.format)
    const carousel = rows.find(r => r.key === 'carousel')
    const reel = rows.find(r => r.key === 'reel')
    expect(carousel).toMatchObject({ posts: 2, measured: 2, avg_engagement: 15 })
    // The case that matters: one published post, zero measured. An average of
    // null rather than 0 is what stops "reels get no engagement" being stated
    // about a post nobody has numbers for.
    expect(reel).toMatchObject({ posts: 1, measured: 0, avg_engagement: null })
  })

  it('an empty workspace says so instead of returning zeroes', () => {
    const out = ourPerformance([], [])
    expect(out.posts_total).toBe(0)
    expect(out.note).toMatch(/no published posts/i)
  })

  it('posts with no synced analytics are called out distinctly', () => {
    // This is the live state for @lightingaaa today: posts can exist while
    // nothing has been measured, and the honest answer is "we cannot tell
    // yet" rather than a confident zero.
    const out = ourPerformance([{ id: 'a', format: 'reel' }], [])
    expect(out.posts_total).toBe(1)
    expect(out.posts_measured).toBe(0)
    expect(out.note).toMatch(/none has analytics/i)
  })
})

describe('competitor comparison ranks on the only comparable number', () => {
  it('engagement per 1k needs a real follower count', () => {
    expect(engagementPer1k(50, 10_000)).toBe(5)
    // Guard against dividing by an account we could not measure. Zero
    // followers must not become an infinite engagement rate that then leads
    // the board.
    expect(engagementPer1k(50, 0)).toBeNull()
    expect(engagementPer1k(50, null)).toBeNull()
    expect(engagementPer1k(null, 1000)).toBeNull()
  })
})

describe('deltas are a subtraction over stored rows', () => {
  const base = {
    competitor_name: 'Technolight', ig_handle: 'technolight', data_source: 'instagram',
  }

  it('one snapshot is a baseline and says so', () => {
    // Inventing a movement from a single point is exactly the manufactured
    // insight the identity prompt forbids.
    const out = deltaFor([{ ...base, followers: 1000, posts_per_week: 3, captured_at: '2026-09-01' }])
    expect(out.baseline).toBe(true)
    expect(out.movements).toEqual([])
  })

  it('two snapshots produce real movement', () => {
    const out = deltaFor([
      { ...base, followers: 1200, posts_per_week: 7, engagement_per_1k: 4, captured_at: '2026-09-08' },
      { ...base, followers: 1000, posts_per_week: 3, engagement_per_1k: 6, captured_at: '2026-09-01' },
    ])
    expect(out.baseline).toBe(false)
    const cadence = out.movements.find(m => m.metric === 'posts_per_week')
    expect(cadence).toMatchObject({ from: 3, to: 7, change: 4 })
    // The headline case from AGENT.md: cadence up, engagement down.
    const eng = out.movements.find(m => m.metric === 'engagement_per_1k')
    expect(eng.change).toBe(-2)
  })

  it('does not report a percent change from zero', () => {
    // "Up infinity percent" is how a report loses a reader.
    const out = deltaFor([
      { ...base, posts_per_week: 5, captured_at: '2026-09-08' },
      { ...base, posts_per_week: 0, captured_at: '2026-09-01' },
    ])
    expect(out.movements[0].percent).toBeNull()
    expect(out.movements[0].change).toBe(5)
  })

  it('a metric we could not read this week is not a collapse', () => {
    // The most damaging wrong this report can produce, because it reads as a
    // finding: a rival whose account went private has null engagement, and
    // comparing null against last week's 6 would announce that their
    // engagement fell to zero.
    const out = deltaFor([
      { ...base, data_source: 'web_only', engagement_per_1k: null, captured_at: '2026-09-08' },
      { ...base, engagement_per_1k: 6, captured_at: '2026-09-01' },
    ])
    expect(out.movements.find(m => m.metric === 'engagement_per_1k')).toBeUndefined()
  })

  it('unchanged metrics are not listed as movements', () => {
    const out = deltaFor([
      { ...base, followers: 1000, captured_at: '2026-09-08' },
      { ...base, followers: 1000, captured_at: '2026-09-01' },
    ])
    expect(out.movements).toEqual([])
  })
})

describe('a quiet week is a reportable answer', () => {
  it('says nothing moved when nothing moved', () => {
    // The behaviour that separates this from every tool built to manufacture
    // four exciting insights per run.
    const board = competitorBoard([
      { competitor_name: 'A', data_source: 'instagram', followers: 100, captured_at: '2026-09-08' },
      { competitor_name: 'A', data_source: 'instagram', followers: 100, captured_at: '2026-09-01' },
    ])
    expect(board.quiet_week).toBe(true)
    expect(board.baseline).toBe(false)
  })

  it('a first run is a baseline, not a quiet week', () => {
    // Distinct states: "nothing to compare against yet" is not "we compared
    // and nothing changed", and reporting the first as the second would make
    // week one look like a dull week rather than the start of the series.
    const board = competitorBoard([
      { competitor_name: 'A', data_source: 'instagram', followers: 100, captured_at: '2026-09-01' },
    ])
    expect(board.baseline).toBe(true)
    expect(board.quiet_week).toBe(true)
  })

  it('an empty board explains itself rather than looking like a quiet week', () => {
    const board = competitorBoard([])
    expect(board.competitors).toEqual([])
    expect(board.quiet_week).toBe(false)
    expect(board.note).toMatch(/no competitor snapshots/i)
  })

  it('counts how many rivals rest on Instagram evidence rather than the web', () => {
    // "Instagram findings prove; web findings explain" — the report has to be
    // able to say which, on every card.
    const board = competitorBoard([
      { competitor_name: 'A', data_source: 'instagram', followers: 10, captured_at: '2026-09-01' },
      { competitor_name: 'B', data_source: 'web_only', captured_at: '2026-09-01' },
    ])
    expect(board.with_instagram).toBe(1)
    expect(board.competitors).toHaveLength(2)
  })

  it('biggest movers lead the board', () => {
    const board = competitorBoard([
      { competitor_name: 'Still', data_source: 'instagram', followers: 100, captured_at: '2026-09-08' },
      { competitor_name: 'Still', data_source: 'instagram', followers: 100, captured_at: '2026-09-01' },
      { competitor_name: 'Mover', data_source: 'instagram', followers: 900, captured_at: '2026-09-08' },
      { competitor_name: 'Mover', data_source: 'instagram', followers: 100, captured_at: '2026-09-01' },
    ])
    expect(board.competitors[0].competitor_name).toBe('Mover')
  })
})
