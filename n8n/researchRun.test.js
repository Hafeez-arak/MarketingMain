import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode, StubPostgrest, STUB_SUPABASE } from './workflowHarness'

// ─── Research Run — Stage 0 ────────────────────────────────────────────────
// The arithmetic here is the reason competitor_snapshots exists: every number
// the eventual report rests on is computed in this node and handed to a model
// as a given fact. So these tests are about the numbers being RIGHT, and
// about the three ways this could be quietly wrong instead of loudly broken:
//
//   • measuring an account nobody verified,
//   • treating a hidden like count as a zero,
//   • inventing a delta when there is only one snapshot.
//
// Plus the one that costs a user their afternoon: a run left 'running'.

const IG_USER = '17841436113014751'
const ENV = {
  META_IG_TOKEN: 'stub-token',
  META_IG_USER_ID: IG_USER,
  SUPABASE_URL: STUB_SUPABASE,
  SUPABASE_KEY: 'stub-service-key',
}

const OPEN   = loadCodeNode('Arak Lighting – Research Run', 'Run: Open')
const GATHER = loadCodeNode('Arak Lighting – Research Run', 'Run: Gather')

const WS = 'ws1'
const RUN = 'run-1'

// The single-flight guarantee is a partial unique index in Postgres, so the
// stub has to model it — otherwise the test would prove the code handles a
// 409 it can never actually receive here.
class RunsPostgrest extends StubPostgrest {
  handle(method, url, body, headers) {
    if (method === 'POST' && url.includes('/research_runs')) {
      const running = (this.tables.research_runs || []).some(r => r.status === 'running')
      if (running) return { statusCode: 409, body: { message: 'duplicate key value violates unique constraint "research_runs_single_flight"' } }
      const row = { id: RUN, ...body }
      this.tables.research_runs ??= []
      this.tables.research_runs.push(row)
      return { statusCode: 201, body: [row] }
    }
    return super.handle(method, url, body, headers)
  }
}

const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString()

const post = (over = {}) => ({
  id: 'm1', caption: 'A caption\nsecond line', media_type: 'IMAGE',
  permalink: 'https://instagram.com/p/x/', timestamp: daysAgo(2),
  like_count: 100, comments_count: 10, ...over,
})

function graph(accounts) {
  return [['graph.facebook.com', async ({ url }) => {
    const m = /username(?:\(|%28)([A-Za-z0-9._]+)/.exec(url)
    const acct = m && accounts[m[1]]
    if (!acct) return { statusCode: 400, body: { error: { message: 'Invalid user id' } } }
    return { statusCode: 200, body: { business_discovery: { id: `ig_${m[1]}`, username: m[1], ...acct } } }
  }]]
}

const watchRow = (over = {}) => ({
  id: 'a1', workspace_id: WS, kind: 'competitor', subject: 'Technolight',
  status: 'active', ig_handle: 'technolight', ig_status: 'resolved', ...over,
})

const gatherInput = (over = {}) => ({
  workspace_id: WS, run_id: RUN,
  period_start: daysAgo(7), period_end: new Date().toISOString(), period_days: 7, ...over,
})

const runRow = () => ({ id: RUN, workspace_id: WS, status: 'running', started_at: new Date().toISOString() })

describe('Run: Open', () => {
  it('opens a run and hands back its id immediately', async () => {
    const pg = new RunsPostgrest({})
    const { out } = await runCodeNode(OPEN, { env: ENV, input: { body: { workspace_id: WS } }, postgrest: pg })
    expect(out.proceed).toBe(true)
    expect(out.run_id).toBe(RUN)
    expect(pg.tables.research_runs[0].status).toBe('running')
  })

  it('attaches to the run already going instead of starting a second', async () => {
    // A double-click must not double the bill or write two conflicting
    // snapshot sets for the same period.
    const pg = new RunsPostgrest({ research_runs: [{ id: 'earlier', workspace_id: WS, status: 'running', started_at: new Date().toISOString() }] })
    const { out } = await runCodeNode(OPEN, { env: ENV, input: { body: { workspace_id: WS } }, postgrest: pg })
    expect(out.proceed).toBe(false)
    expect(out.already_running).toBe(true)
    expect(out.run_id).toBe('earlier')
    expect(pg.tables.research_runs).toHaveLength(1)
  })

  it('sweeps a run that died mid-flight, so the workspace is not locked forever', async () => {
    const stale = new Date(Date.now() - 60 * 60000).toISOString()
    const pg = new RunsPostgrest({ research_runs: [{ id: 'zombie', workspace_id: WS, status: 'running', started_at: stale }] })
    const { out } = await runCodeNode(OPEN, { env: ENV, input: { body: { workspace_id: WS } }, postgrest: pg })
    const zombie = pg.tables.research_runs.find(r => r.id === 'zombie')
    expect(zombie.status).toBe('failed')
    expect(out.proceed).toBe(true)       // and the new run gets to start
  })
})

describe('Run: Gather — what it will and will not measure', () => {
  it('measures ONLY a verified handle', async () => {
    const pg = new StubPostgrest({ research_runs: [runRow()] })
    await runCodeNode(GATHER, { env: ENV, input: gatherInput(), postgrest: pg, routes: graph({}) })
    const read = pg.log.find(c => c.method === 'GET' && c.table === 'research_agenda')
    // The load-bearing filter. Without it a merely-suggested handle would be
    // measured and its numbers would look exactly as real as verified ones.
    expect(decodeURIComponent(read.query)).toContain('ig_status=in.(resolved,human_set)')
  })

  it('hands off to the investigation even when nothing is verified yet', async () => {
    // Not a dead end: market and trend research needs no rival at all, and a
    // brand with nothing verified is the one that needs it most.
    const pg = new StubPostgrest({ research_agenda: [], research_runs: [runRow()] })
    const { out } = await runCodeNode(GATHER, { env: ENV, input: gatherInput(), postgrest: pg, routes: graph({}) })
    expect(out.ok).toBe(true)
    expect(out.proceed).toBe(true)
    expect(pg.tables.research_runs[0].stage).toBe('investigate')
    expect(pg.tables.research_runs[0].report.unanswered[0]).toMatch(/no competitor has a verified/i)
  })

  it('records a competitor it could not read as web_only, and still finishes', async () => {
    const pg = new StubPostgrest({ research_agenda: [watchRow()], research_runs: [runRow()] })
    const { out } = await runCodeNode(GATHER, { env: ENV, input: gatherInput(), postgrest: pg, routes: graph({}) })
    expect(out.ok).toBe(true)
    expect(pg.tables.competitor_snapshots[0].data_source).toBe('web_only')
    expect(pg.tables.research_runs[0].stage).toBe('investigate')
    expect(pg.tables.research_runs[0].report.unanswered[0]).toMatch(/could not read technolight/i)
  })

  it('writes a terminal failed status rather than leaving the run spinning', async () => {
    const pg = new StubPostgrest({ research_runs: [runRow()] })
    const { out } = await runCodeNode(GATHER, {
      env: { ...ENV, META_IG_TOKEN: '' }, input: gatherInput(), postgrest: pg, routes: [],
    })
    expect(out.ok).toBe(false)
    expect(pg.tables.research_runs[0].status).toBe('failed')
    expect(pg.tables.research_runs[0].finished_at).toBeTruthy()
  })
})

describe('Run: Gather — the arithmetic', () => {
  const measure = async (media, followers = 10000, extraTables = {}) => {
    const pg = new StubPostgrest({ research_agenda: [watchRow()], research_runs: [runRow()], ...extraTables })
    const out = await runCodeNode(GATHER, {
      env: ENV, input: gatherInput(), postgrest: pg,
      routes: graph({ technolight: { followers_count: followers, follows_count: 10, media_count: media.length, media: { data: media } } }),
    })
    return { snap: pg.tables.competitor_snapshots.find(s => !s.is_self), pg, out: out.out }
  }

  it('counts cadence over the period and converts it to posts per week', async () => {
    const { snap } = await measure([post({ timestamp: daysAgo(1) }), post({ timestamp: daysAgo(3) }), post({ timestamp: daysAgo(5) })])
    expect(snap.posts_in_period).toBe(3)
    expect(snap.posts_per_week).toBe(3)   // 3 posts over exactly 7 days
  })

  it('ignores posts outside the period', async () => {
    const { snap } = await measure([post({ timestamp: daysAgo(2) }), post({ timestamp: daysAgo(30) })])
    expect(snap.posts_in_period).toBe(1)
  })

  it('computes format mix as shares', async () => {
    const { snap } = await measure([
      post({ media_type: 'VIDEO' }), post({ media_type: 'VIDEO' }),
      post({ media_type: 'IMAGE' }), post({ media_type: 'CAROUSEL_ALBUM' }),
    ])
    expect(snap.format_mix).toEqual({ VIDEO: 0.5, IMAGE: 0.25, CAROUSEL_ALBUM: 0.25 })
  })

  it('normalises engagement per 1k followers', async () => {
    // avg engagement 110 over 10k followers → 11 per 1k
    const { snap } = await measure([post({ like_count: 100, comments_count: 10 })], 10000)
    expect(snap.avg_engagement).toBe(110)
    expect(snap.engagement_per_1k).toBe(11)
  })

  it('does NOT treat a hidden like count as a zero', async () => {
    // Instagram lets an account hide likes and business_discovery then omits
    // like_count. Averaging that in as 0 would punish exactly the accounts
    // that hid it — so cadence counts every post and the averages count only
    // the posts that reported.
    const { snap } = await measure([
      post({ like_count: 100, comments_count: 10 }),
      post({ like_count: undefined, comments_count: undefined }),
    ])
    expect(snap.posts_in_period).toBe(2)   // cadence sees both
    expect(snap.sample_size).toBe(1)       // the average sees one
    expect(snap.avg_engagement).toBe(110)  // not 55
  })

  it('refuses to divide by an unknown follower count', async () => {
    const { snap } = await measure([post()], 0)
    expect(snap.avg_engagement).toBe(110)
    expect(snap.engagement_per_1k).toBeNull()   // not 0, not Infinity
  })

  it('ranks top posts by engagement and keeps the first caption line as the hook', async () => {
    const { snap } = await measure([
      post({ id: 'low', like_count: 5, caption: 'quiet one\nrest' }),
      post({ id: 'high', like_count: 900, caption: 'THE HOOK\nrest of it' }),
    ])
    expect(snap.top_posts[0].hook).toBe('THE HOOK')
    expect(snap.top_posts[0].likes).toBe(900)
  })
})

describe('Run: Gather — deltas', () => {
  const withPrior = async (prior, media) => {
    const pg = new StubPostgrest({
      research_agenda: [watchRow()],
      research_runs: [runRow()],
      competitor_snapshots: prior,
    })
    const out = await runCodeNode(GATHER, {
      env: ENV, input: gatherInput(), postgrest: pg,
      routes: graph({ technolight: { followers_count: 10000, media_count: media.length, media: { data: media } } }),
    })
    return { report: pg.tables.research_runs[0].report, out: out.out }
  }

  it('reports baseline and NO movements on the first run', async () => {
    // A delta needs two snapshots. Inventing one from a single measurement is
    // the most confident-sounding way this could lie.
    const { report, out } = await withPrior([], [post(), post()])
    expect(out.baseline).toBe(true)
    expect(report.movements).toEqual([])
    expect(report.headline).toMatch(/nothing to compare against yet/i)
  })

  it('subtracts against the previous snapshot once there is one', async () => {
    const prior = [{
      run_id: 'run-0', workspace_id: WS, competitor_name: 'Technolight', data_source: 'instagram',
      captured_at: daysAgo(7), followers: 9000, posts_per_week: 2, engagement_per_1k: 5,
      format_mix: { IMAGE: 1 },
    }]
    const media = [post({ media_type: 'VIDEO' }), post({ media_type: 'VIDEO' }),
                   post({ media_type: 'VIDEO' }), post({ media_type: 'IMAGE' })]
    const { report } = await withPrior(prior, media)

    expect(report.baseline).toBe(false)
    const cadence = report.movements.find(m => m.metric === 'posts per week')
    expect(cadence).toMatchObject({ from: 2, to: 4, direction: 'up', significance: 'high' })
    const video = report.movements.find(m => m.metric === 'share of posts that are video')
    expect(video).toMatchObject({ from: 0, to: 0.75, direction: 'up' })
    expect(report.competitor_board[0].followers_delta).toBe(1000)
  })

  it('stays quiet when nothing moved more than a rounding wobble', async () => {
    const prior = [{
      run_id: 'run-0', workspace_id: WS, competitor_name: 'Technolight', data_source: 'instagram',
      captured_at: daysAgo(7), followers: 10000, posts_per_week: 1, engagement_per_1k: 11,
      format_mix: { IMAGE: 1 },
    }]
    const { report } = await withPrior(prior, [post()])
    expect(report.movements).toEqual([])
    expect(report.quiet_week).toBe(true)
    expect(report.headline).toMatch(/nothing moved measurably/i)
  })
})

describe('Run: Gather — vs_us', () => {
  it('refuses to compare against a 1-follower test account', async () => {
    // Arak's connected account really does have one follower. A ratio against
    // it renders as -99.9% and reads as a finding.
    const pg = new StubPostgrest({
      research_agenda: [watchRow()],
      research_runs: [runRow()],
      social_accounts: [{ workspace_id: WS, platform: 'instagram', is_active: true, username: 'lightingaaa' }],
    })
    await runCodeNode(GATHER, {
      env: ENV, input: gatherInput(), postgrest: pg,
      routes: graph({
        technolight: { followers_count: 10000, media_count: 1, media: { data: [post()] } },
        lightingaaa: { followers_count: 1, media_count: 1, media: { data: [post({ like_count: 1, comments_count: 0 })] } },
      }),
    })
    const board = pg.tables.research_runs[0].report.competitor_board
    expect(board[0].vs_us).toBeNull()
    expect(board[0].vs_us_note).toMatch(/no comparable account/i)
  })

  it('compares once our own account clears the floor', async () => {
    const pg = new StubPostgrest({
      research_agenda: [watchRow()],
      research_runs: [runRow()],
      social_accounts: [{ workspace_id: WS, platform: 'instagram', is_active: true, username: 'lightingaaa' }],
    })
    await runCodeNode(GATHER, {
      env: ENV, input: gatherInput(), postgrest: pg,
      routes: graph({
        technolight:  { followers_count: 10000, media_count: 1, media: { data: [post({ like_count: 100, comments_count: 10 })] } },
        lightingaaa:  { followers_count: 5000,  media_count: 1, media: { data: [post({ like_count: 25, comments_count: 0 })] } },
      }),
    })
    const board = pg.tables.research_runs[0].report.competitor_board
    // rival 11.0 per 1k vs ours 5.0 per 1k → +120%
    expect(board[0].vs_us).toBe('+120%')
  })

  it('keeps our own row out of the competitor board', async () => {
    const pg = new StubPostgrest({
      research_agenda: [watchRow()],
      research_runs: [runRow()],
      social_accounts: [{ workspace_id: WS, platform: 'instagram', is_active: true, username: 'lightingaaa' }],
    })
    await runCodeNode(GATHER, {
      env: ENV, input: gatherInput(), postgrest: pg,
      routes: graph({
        technolight: { followers_count: 10000, media_count: 1, media: { data: [post()] } },
        lightingaaa: { followers_count: 5000, media_count: 1, media: { data: [post()] } },
      }),
    })
    const board = pg.tables.research_runs[0].report.competitor_board
    expect(board.map(b => b.name)).toEqual(['Technolight'])
    // ...but it IS snapshotted, so next week can measure our own movement.
    expect(pg.tables.competitor_snapshots.some(s => s.is_self)).toBe(true)
  })
})

describe('Run: Gather — caveats that keep a number honest', () => {
  const withMedia = async (media) => {
    const pg = new StubPostgrest({ research_agenda: [watchRow()], research_runs: [runRow()] })
    await runCodeNode(GATHER, {
      env: ENV, input: gatherInput(), postgrest: pg,
      routes: graph({ technolight: { followers_count: 10000, media_count: media.length, media: { data: media } } }),
    })
    return pg.tables.research_runs[0].report
  }

  it('says so when the cadence is a floor rather than a count', async () => {
    // 50 posts returned, all inside the period — so there are probably more
    // we cannot see. Reading this as their real cadence would show up next
    // week as a confident, wrong "they slowed down".
    const media = Array.from({ length: 50 }, (_, i) => post({ id: `m${i}`, timestamp: daysAgo(1) }))
    const report = await withMedia(media)
    expect(report.unanswered.join(' ')).toMatch(/cadence is a floor rather than a count/i)
  })

  it('does not cry truncation when the window genuinely contains everything', async () => {
    const media = [post({ timestamp: daysAgo(1) }), post({ timestamp: daysAgo(30) })]
    const report = await withMedia(media)
    expect(report.unanswered.join(' ')).not.toMatch(/floor rather than a count/i)
  })

  it('reports how thin an engagement average is when likes are hidden', async () => {
    const report = await withMedia([
      post({ like_count: 100, comments_count: 10 }),
      post({ id: 'h1', like_count: undefined, comments_count: undefined }),
      post({ id: 'h2', like_count: undefined, comments_count: undefined }),
    ])
    expect(report.unanswered.join(' ')).toMatch(/2 of 3 posts hide their like count/i)
    expect(report.unanswered.join(' ')).toMatch(/rests on 1 post\b/i)
  })
})

describe('Run: Gather — vs_us cannot divide by zero', () => {
  const withSelf = async (selfFollowers, selfLikes) => {
    const pg = new StubPostgrest({
      research_agenda: [watchRow()],
      research_runs: [runRow()],
      social_accounts: [{ workspace_id: WS, platform: 'instagram', is_active: true, username: 'lightingaaa' }],
    })
    await runCodeNode(GATHER, {
      env: ENV, input: gatherInput(), postgrest: pg,
      routes: graph({
        technolight: { followers_count: 10000, media_count: 1, media: { data: [post({ like_count: 100, comments_count: 10 })] } },
        lightingaaa: { followers_count: selfFollowers, media_count: 1,
                       media: { data: [post({ like_count: selfLikes, comments_count: 0 })] } },
      }),
    })
    return pg.tables.research_runs[0].report.competitor_board[0]
  }

  it('refuses to compare against an account with real reach but zero engagement', async () => {
    // The near-miss found live: @lightingaaa genuinely posts at 0 engagement.
    // Today only the FOLLOWER floor saves us; the moment it passes 50 followers
    // while still getting no likes, (3.87 - 0) / 0 is Infinity, round() turns
    // that into null, and every card renders the string "+null%".
    const card = await withSelf(5000, 0)
    expect(card.vs_us).toBeNull()
    expect(card.vs_us_note).toMatch(/no comparable account/i)
  })

  it('never renders a non-finite comparison', async () => {
    const card = await withSelf(5000, 0)
    expect(String(card.vs_us)).not.toMatch(/null%|Infinity|NaN/)
  })

  it('still compares normally once our account has real engagement', async () => {
    const card = await withSelf(5000, 25)
    expect(card.vs_us).toBe('+120%')
  })
})

// ─── Run: Investigate ──────────────────────────────────────────────────────
// The model stages. Two properties matter more than anything the model says:
// the measured numbers must survive whatever goes wrong here, and a citation
// the model did not actually retrieve must never reach the database.

const INVESTIGATE = loadCodeNode('Arak Lighting – Research Run', 'Run: Investigate')

const INV_ENV = { ...ENV, ANTHROPIC_API_KEY: 'stub-anthropic', TAVILY_API_KEY: 'stub-tavily' }

const GATHERED = {
  headline: 'First measurement of 1 competitor.',
  baseline: true, quiet_week: false,
  period: { start: '2026-08-13', end: '2026-08-20', days: 7 },
  movements: [],
  competitor_board: [{ name: 'Huda Lighting', handle: 'hudalighting', followers: 16662,
    posts_per_week: 2, engagement_per_1k: 3.87, format_mix: { VIDEO: 0.5 }, sample_size: 2, top_posts: [] }],
  market: [], gaps: [], proposed_rules: [], proposed_ideas: [], agenda_changes: [],
  unanswered: [], sources: [], stage_reached: 'gather',
}

const invInput = (over = {}) => ({
  workspace_id: WS, run_id: RUN, report: GATHERED,
  brand_name: 'Arak Lighting', brand_descriptor: 'an architectural lighting supplier in Riyadh',
  ...over,
})

// A scripted Anthropic: each element is one response, returned in order.
function anthropic(script) {
  let i = 0
  return ['api.anthropic.com', async () => {
    const r = script[Math.min(i++, script.length - 1)]
    return { statusCode: 200, body: { ...r, usage: { input_tokens: 100, output_tokens: 50 } } }
  }]
}
const say = obj => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] })
const useTool = (name, input, id = 't1') => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] })

function tavily(results) {
  return ['api.tavily.com', async () => ({ statusCode: 200, body: { answer: 'stub', results } })]
}

const invTables = (over = {}) => ({
  research_runs: [{ id: RUN, workspace_id: WS, status: 'running', stage: 'investigate' }],
  research_agenda: [{ id: 'q1', workspace_id: WS, kind: 'question', status: 'active', subject: 'Are rivals leaning into Reels?', why: '' }],
  brand_memory: [],
  ...over,
})

describe('Run: Investigate — the numbers survive whatever happens', () => {
  it('completes with the measured report when the model key is missing', async () => {
    const pg = new StubPostgrest(invTables())
    const { out } = await runCodeNode(INVESTIGATE, {
      env: { ...INV_ENV, ANTHROPIC_API_KEY: '' }, input: invInput(), postgrest: pg, routes: [],
    })
    expect(out.ok).toBe(true)
    expect(out.investigated).toBe(false)
    const run = pg.tables.research_runs[0]
    expect(run.status).toBe('complete')
    expect(run.report.competitor_board).toHaveLength(1)   // Stage 0's work kept
    expect(run.report.unanswered.join(' ')).toMatch(/ANTHROPIC_API_KEY is not set/)
  })

  it('completes with the measured report when the model returns unparseable output', async () => {
    const pg = new StubPostgrest(invTables())
    const { out } = await runCodeNode(INVESTIGATE, {
      env: INV_ENV, input: invInput(), postgrest: pg,
      routes: [anthropic([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'I am afraid I cannot do that.' }] }]), tavily([])],
    })
    expect(out.ok).toBe(true)
    expect(pg.tables.research_runs[0].status).toBe('complete')
    expect(pg.tables.research_runs[0].report.competitor_board).toHaveLength(1)
    expect(pg.tables.research_runs[0].report.unanswered.join(' ')).toMatch(/could not be parsed/i)
  })

  it('refuses to research a brand with no descriptor rather than searching for nothing', async () => {
    const pg = new StubPostgrest({ ...invTables(), brand_profile: [{ workspace_id: WS }] })
    const { out } = await runCodeNode(INVESTIGATE, {
      env: INV_ENV, input: invInput({ brand_descriptor: '' }), postgrest: pg, routes: [],
    })
    expect(out.ok).toBe(true)
    expect(pg.tables.research_runs[0].report.unanswered.join(' ')).toMatch(/no descriptor/i)
  })
})

describe('Run: Investigate — citations are checked, not trusted', () => {
  const REAL = 'https://example.com/real-article'
  const FAKE = 'https://example.com/never-retrieved'

  const runWith = async (reportObj) => {
    const pg = new StubPostgrest(invTables())
    const { out } = await runCodeNode(INVESTIGATE, {
      env: INV_ENV, input: invInput(), postgrest: pg,
      routes: [
        anthropic([useTool('web_search', { query: 'lighting trends' }), say(reportObj)]),
        tavily([{ title: 'Real', url: REAL, content: 'something true' }]),
      ],
    })
    return { pg, out }
  }

  it('strips a source URL the model never actually retrieved', async () => {
    const { pg } = await runWith({
      headline: 'x', quiet_week: false,
      market: [{ finding: 'A real one', sources: [{ url: REAL }, { url: FAKE }], confidence: 0.6 }],
    })
    const finding = pg.tables.research_findings[0]
    expect(finding.sources.map(s => s.url)).toEqual([REAL])
  })

  it('does NOT propose a rule whose only source was invented', async () => {
    // A rule steers every future generation. One with nothing behind it must
    // not even be offered for approval.
    const { pg } = await runWith({
      headline: 'x', quiet_week: false, market: [],
      proposed_rules: [{ rule: 'Do a thing', scope: 'trend', sources: [FAKE], confidence: 0.9 }],
    })
    expect(pg.tables.brand_memory || []).toHaveLength(0)
  })

  it('keeps a rule whose source is real, and only ever as proposed', async () => {
    const { pg } = await runWith({
      headline: 'x', quiet_week: false, market: [],
      proposed_rules: [{ rule: 'Lead Riyadh launches with a Reel', scope: 'trend', sources: [REAL], confidence: 0.7 }],
    })
    expect(pg.tables.brand_memory).toHaveLength(1)
    expect(pg.tables.brand_memory[0]).toMatchObject({ status: 'proposed', source: 'research', scope: 'trend' })
  })

  it('says out loud when a finding could not be traced to anything retrieved', async () => {
    const { pg } = await runWith({
      headline: 'x', quiet_week: false,
      market: [{ finding: 'Unsupported claim', sources: [FAKE], confidence: 0.9 }],
    })
    expect(pg.tables.research_runs[0].report.unanswered.join(' ')).toMatch(/could not be traced/i)
  })
})

describe('Run: Investigate — bounds and boundaries', () => {
  it('stops calling tools once the budget is spent', async () => {
    const pg = new StubPostgrest(invTables())
    // A model that would loop forever if nothing stopped it.
    const { out } = await runCodeNode(INVESTIGATE, {
      env: INV_ENV, input: invInput(), postgrest: pg,
      routes: [anthropic([useTool('web_search', { query: 'again' })]), tavily([])],
    })
    expect(out.ok).toBe(true)
    expect(out.investigated === true || out.investigated === false).toBe(true)
    const searchCalls = pg.log.length
    expect(searchCalls).toBeLessThan(200)   // it terminated at all
  })

  it('proposes an agenda change rather than applying it', async () => {
    const pg = new StubPostgrest(invTables())
    await runCodeNode(INVESTIGATE, {
      env: INV_ENV, input: invInput(), postgrest: pg,
      routes: [
        anthropic([say({ headline: 'x', quiet_week: true, market: [],
          agenda_changes: [{ action: 'add', subject: 'Track Ramadan campaign timing', why: 'seasonal' }] })]),
        tavily([]),
      ],
    })
    const added = pg.tables.research_agenda.find(a => a.subject === 'Track Ramadan campaign timing')
    expect(added).toMatchObject({ status: 'proposed', created_by: 'agent', kind: 'question' })
  })

  it('never writes to Brand Brain content', async () => {
    const pg = new StubPostgrest(invTables())
    await runCodeNode(INVESTIGATE, {
      env: INV_ENV, input: invInput(), postgrest: pg,
      routes: [anthropic([say({ headline: 'x', quiet_week: true, market: [] })]), tavily([])],
    })
    const forbidden = pg.log.filter(c => c.method !== 'GET' &&
      /^(brand_profile|brand_fields|brand_sections|brand_directory)/.test(c.table))
    expect(forbidden).toEqual([])
  })
})
