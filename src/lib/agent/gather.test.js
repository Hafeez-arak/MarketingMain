import { describe, it, expect } from 'vitest'
import {
  metricsFor, videoShare, discoveryFields, MEDIA_LIMIT, caveatsFor,
  movement, MOVEMENT_FLOOR, priorByName, computeMovements,
  buildBoard, selfIsComparable, MIN_SELF_BASELINE,
  gatherReport, emptyReport, periodFor,
  looksLikeCredentialsFailure, credentialsNote,
} from './gather'
import { competitorBoard, splitSeries } from './aggregate'

const PERIOD = { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-09-08T00:00:00Z'), days: 7 }
const post = (over = {}) => ({
  timestamp: '2026-09-03T10:00:00Z', media_type: 'IMAGE',
  like_count: 10, comments_count: 2, permalink: 'https://instagram.com/p/x', ...over,
})

describe('metrics are computed from posts, in code', () => {
  it('counts only posts inside the period', () => {
    const m = metricsFor([
      post(), post(),
      post({ timestamp: '2026-08-01T10:00:00Z' }),   // before
      post({ timestamp: '2026-10-01T10:00:00Z' }),   // after
    ], 1000, PERIOD)
    expect(m.posts_in_period).toBe(2)
    expect(m.posts_per_week).toBe(2)
  })

  it('a hidden like count is not a zero', () => {
    // Instagram lets an account hide likes and business_discovery then omits
    // the field. Averaging a missing count in as 0 would quietly punish
    // exactly the accounts that hid it, so cadence counts every post while the
    // average counts only those that reported.
    const m = metricsFor([
      post({ like_count: 100, comments_count: 10 }),
      post({ like_count: null, comments_count: null }),
    ], 1000, PERIOD)
    expect(m.posts_in_period).toBe(2)
    expect(m.sample_size).toBe(1)
    expect(m.likes_hidden).toBe(1)
    expect(m.avg_engagement).toBe(110)
  })

  it('engagement per 1k is null without a follower count, never zero', () => {
    // A ratio over an unknown denominator is not a small number, it is not a
    // number — and a zero here would rank an unmeasurable account last rather
    // than excluding it.
    expect(metricsFor([post()], 0, PERIOD).engagement_per_1k).toBeNull()
    expect(metricsFor([post()], 1000, PERIOD).engagement_per_1k).toBe(12)
  })

  it('flags a cadence that is really a floor', () => {
    // If every post the API returned falls inside the period, there may be
    // more we never saw. Read next week as a fall, that is a movement the
    // report would state with total confidence and be wrong about.
    const many = Array.from({ length: MEDIA_LIMIT }, () => post())
    expect(metricsFor(many, 1000, PERIOD).truncated).toBe(true)
    expect(metricsFor([post()], 1000, PERIOD).truncated).toBe(false)
  })

  it('turns both hazards into sentences a person can read', () => {
    const m = metricsFor([post(), post({ like_count: null, comments_count: null })], 1000, PERIOD)
    const out = caveatsFor('Technolight', m)
    expect(out.join(' ')).toMatch(/hide their like count/)
  })

  it('an empty account produces no averages rather than zeroes', () => {
    const m = metricsFor([], 1000, PERIOD)
    expect(m.posts_in_period).toBe(0)
    expect(m.avg_engagement).toBeNull()
    expect(m.engagement_per_1k).toBeNull()
  })

  it('asks for a bounded amount of media', () => {
    // The limit is load-bearing: `truncated` is computed from it, so changing
    // it silently changes what that flag means.
    expect(discoveryFields('technolight')).toContain(`media.limit(${MEDIA_LIMIT})`)
    expect(discoveryFields('technolight')).toContain('business_discovery.username(technolight)')
  })
})

describe('video share treats reels as video', () => {
  it('adds the two together', () => {
    expect(videoShare({ VIDEO: 0.3, REELS: 0.2, IMAGE: 0.5 })).toBe(0.5)
    expect(videoShare({})).toBe(0)
  })
})

describe('a movement has to clear a floor to be news', () => {
  it('ignores a wobble below the floor', () => {
    // Without a floor a rounding difference gets reported as news, and a
    // report that cries wolf weekly is one people stop opening.
    expect(movement('A', 'followers', 1000, 1050, 'followers')).toBeNull()
    expect(MOVEMENT_FLOOR).toBe(0.15)
  })

  it('reports a real change with a direction and a significance', () => {
    const m = movement('Technolight', 'posts per week', 3, 7, 'posts/week')
    expect(m).toMatchObject({
      competitor: 'Technolight', from: 3, to: 7, direction: 'up', significance: 'high',
      evidence_source: 'instagram',
    })
  })

  it('will not compare against a metric we could not read', () => {
    // The most damaging wrong this report can produce, because it reads as a
    // finding: a rival whose account went private has null engagement, and
    // comparing that against last week's real figure announces a collapse
    // that never happened.
    expect(movement('A', 'engagement per 1k followers', 6, null, 'per 1k')).toBeNull()
    expect(movement('A', 'engagement per 1k followers', null, 6, 'per 1k')).toBeNull()
  })

  it('zero to zero is not a movement', () => {
    expect(movement('A', 'followers', 0, 0, 'followers')).toBeNull()
  })

  it('starting from zero is a real, high-significance change', () => {
    // They went from not posting to posting. That is news, and the relative
    // change is treated as total rather than as an infinity.
    const m = movement('A', 'posts per week', 0, 5, 'posts/week')
    expect(m.change_pct).toBe(100)
    expect(m.significance).toBe('high')
  })
})

describe('deltas need a stored prior row', () => {
  const snap = (over = {}) => ({
    competitor_name: 'Technolight', data_source: 'instagram', captured_at: '2026-09-08', ...over,
  })

  it('the latest prior snapshot per name wins', () => {
    const map = priorByName([
      snap({ captured_at: '2026-09-01', followers: 100 }),
      snap({ captured_at: '2026-08-25', followers: 50 }),
    ])
    expect(map.get('technolight').followers).toBe(100)
  })

  it('a first run has nothing comparable and invents nothing', () => {
    const { movements, comparable } = computeMovements([snap({ followers: 100 })], [])
    expect(comparable).toBe(0)
    expect(movements).toEqual([])
  })

  it('web-only rivals are skipped rather than compared to nothing', () => {
    const { comparable } = computeMovements(
      [snap({ data_source: 'web_only' })],
      [snap({ captured_at: '2026-09-01', followers: 100 })],
    )
    expect(comparable).toBe(0)
  })

  it('biggest movers lead', () => {
    const { movements } = computeMovements(
      [snap({ competitor_name: 'Big', followers: 1000 }), snap({ competitor_name: 'Small', followers: 120 })],
      [
        snap({ competitor_name: 'Big', captured_at: '2026-09-01', followers: 100 }),
        snap({ competitor_name: 'Small', captured_at: '2026-09-01', followers: 100 }),
      ],
    )
    expect(movements[0].competitor).toBe('Big')
  })
})

describe('comparing rivals to us — the two floors that were paid for', () => {
  it('a one-follower test account is not a baseline', () => {
    // @lightingaaa. A ratio against it renders as -99.9% and reads as a
    // finding, which is worse than rendering nothing at all.
    expect(selfIsComparable({ followers: 1, engagement_per_1k: 500 })).toBe(false)
    expect(MIN_SELF_BASELINE).toBe(50)
  })

  it('an account with real followers but zero engagement is not a baseline either', () => {
    // The separate hazard: dividing by that zero yields Infinity, which rounds
    // to null and renders as "+null%" on every card. Observed live as a
    // near-miss on 2026-08-20, caught only by the follower floor.
    expect(selfIsComparable({ followers: 500, engagement_per_1k: 0 })).toBe(false)
  })

  it('a real account clears both', () => {
    expect(selfIsComparable({ followers: 500, engagement_per_1k: 4 })).toBe(true)
  })

  it('the board says so rather than showing a broken percentage', () => {
    const board = buildBoard([
      { competitor_name: 'Us', is_self: true, data_source: 'instagram', followers: 1, engagement_per_1k: 500 },
      { competitor_name: 'Technolight', data_source: 'instagram', followers: 9000, engagement_per_1k: 4 },
    ], [])
    expect(board).toHaveLength(1)          // ours is excluded from the board
    expect(board[0].vs_us).toBeNull()
    expect(board[0].vs_us_note).toMatch(/no comparable account/i)
  })

  it('compares when our account is real', () => {
    const board = buildBoard([
      { competitor_name: 'Us', is_self: true, data_source: 'instagram', followers: 800, engagement_per_1k: 2 },
      { competitor_name: 'Technolight', data_source: 'instagram', followers: 9000, engagement_per_1k: 4 },
    ], [])
    expect(board[0].vs_us).toBe('+100%')
  })
})

describe('the stage-0 report', () => {
  const snaps = [
    { competitor_name: 'Technolight', data_source: 'instagram', followers: 900, posts_per_week: 7, captured_at: '2026-09-08' },
  ]
  const prior = [
    { competitor_name: 'Technolight', data_source: 'instagram', followers: 300, posts_per_week: 3, captured_at: '2026-09-01' },
  ]

  it('a first run reports a baseline, not a quiet week', () => {
    const r = gatherReport({ snapshots: snaps, prior: [], period: PERIOD })
    expect(r.baseline).toBe(true)
    expect(r.quiet_week).toBe(false)
    expect(r.headline).toMatch(/nothing to compare against/i)
    expect(r.movements).toEqual([])
  })

  it('says plainly when nothing moved', () => {
    // The behaviour that separates this from every tool built to manufacture
    // four exciting insights per run.
    const flat = [{ ...snaps[0], followers: 300, posts_per_week: 3 }]
    const r = gatherReport({ snapshots: flat, prior, period: PERIOD })
    expect(r.quiet_week).toBe(true)
    expect(r.headline).toMatch(/nothing moved/i)
  })

  it('reports real movement', () => {
    const r = gatherReport({ snapshots: snaps, prior, period: PERIOD })
    expect(r.baseline).toBe(false)
    expect(r.movements.length).toBeGreaterThan(0)
    expect(r.headline).toMatch(/measurable change/i)
  })

  it('carries failures and caveats into unanswered rather than dropping them', () => {
    const r = gatherReport({
      snapshots: snaps, prior, period: PERIOD,
      failures: [{ name: 'Alnasser', handle: 'alnasser', error: 'not found' }],
      caveats: ['Technolight: cadence is a floor.'],
    })
    expect(r.unanswered.join(' ')).toMatch(/Could not read Alnasser/)
    expect(r.unanswered.join(' ')).toMatch(/cadence is a floor/)
  })

  it('is marked as the gather stage so a partial run is legible', () => {
    // How a reader tells a full brief from the measured half left behind by a
    // run that died during investigation.
    expect(gatherReport({ snapshots: snaps, prior, period: PERIOD }).stage_reached).toBe('gather')
    expect(emptyReport(PERIOD).stage_reached).toBe('gather')
  })

  it('no verified handles is an empty report, not a failure', () => {
    // Market and trend research needs no rival at all, and a brand with
    // nothing verified is the one that needs it most.
    const r = emptyReport(PERIOD)
    expect(r.baseline).toBe(true)
    expect(r.competitor_board).toEqual([])
    expect(r.unanswered[0]).toMatch(/no competitor has a verified/i)
  })
})

describe('the period a run covers', () => {
  it('ends now and starts days back, in UTC', () => {
    const p = periodFor(7, new Date('2026-09-10T12:00:00Z'))
    expect(p.end).toBe('2026-09-10T12:00:00.000Z')
    expect(p.start).toBe('2026-09-03T12:00:00.000Z')
    expect(p.days).toBe(7)
  })
})

describe('the chat tool and the weekly brief agree', () => {
  // The reason competitorBoard delegates to gather.js instead of keeping its
  // own idea of what counts as a change: two implementations meant the brief
  // and the answer to "what are competitors doing?" could disagree about the
  // same two rows in the same database.
  const rows = [
    { competitor_name: 'Technolight', data_source: 'instagram', followers: 900, captured_at: '2026-09-08' },
    { competitor_name: 'Technolight', data_source: 'instagram', followers: 300, captured_at: '2026-09-01' },
  ]

  it('splits a flat series into current and older', () => {
    const { current, older } = splitSeries(rows)
    expect(current).toHaveLength(1)
    expect(current[0].followers).toBe(900)
    expect(older[0].followers).toBe(300)
  })

  it('produces the same movement the report would', () => {
    const tool = competitorBoard(rows)
    const report = gatherReport({
      snapshots: [rows[0]], prior: [rows[1]], period: PERIOD,
    })
    expect(tool.movements).toEqual(report.movements)
  })

  it('an empty board explains itself rather than looking like a quiet week', () => {
    const out = competitorBoard([])
    expect(out.competitors).toEqual([])
    expect(out.quiet_week).toBe(false)
    expect(out.note).toMatch(/no competitor snapshots/i)
  })

  it('counts how many rivals rest on Instagram evidence rather than the web', () => {
    // "Instagram findings prove; web findings explain" — the report has to be
    // able to say which, on every card.
    const out = competitorBoard([
      { competitor_name: 'A', data_source: 'instagram', followers: 10, captured_at: '2026-09-01' },
      { competitor_name: 'B', data_source: 'web_only', captured_at: '2026-09-01' },
    ])
    expect(out.with_instagram).toBe(1)
    expect(out.competitors).toHaveLength(2)
  })
})

describe('a blocked token is not three private competitors', () => {
  // These are indistinguishable in a per-rival failure list and are completely
  // different problems. Three "could not read X" lines read as three rivals
  // having gone private; the same three lines when the app is blocked mean
  // nothing was ever going to be measured and someone needs to open a
  // dashboard. Observed live 2026-09-10: a well-formed token returning "API
  // access blocked" on every call, including debug_token.

  const authFail = name => ({ name, handle: name.toLowerCase(), error: 'API access blocked.' })

  it('spots it when every read failed the same credentials-shaped way', () => {
    const failures = [authFail('Technolight'), authFail('Huda'), authFail('Us')]
    expect(looksLikeCredentialsFailure(failures, 3)).toBe(true)
    expect(credentialsNote(failures)).toMatch(/credentials or app-permissions problem/i)
    expect(credentialsNote(failures)).toMatch(/not a problem with these competitors/i)
  })

  it('recognises the other auth wordings too', () => {
    for (const error of [
      'Error validating access token: Session has expired',
      'The access token is invalid',
      '(#10) Application does not have permission for this action',
      'Unsupported get request',
    ]) {
      expect(looksLikeCredentialsFailure([{ error }], 1), error).toBe(true)
    }
  })

  it('does NOT fire when only some rivals failed', () => {
    // One rival erroring while others succeed is genuinely that rival's
    // problem, and calling it a token failure sends someone to the wrong
    // dashboard entirely.
    expect(looksLikeCredentialsFailure([authFail('Technolight')], 3)).toBe(false)
  })

  it('does NOT fire on ordinary per-account failures', () => {
    const failures = [
      { name: 'A', error: 'no business_discovery payload' },
      { name: 'B', error: 'no business_discovery payload' },
    ]
    expect(looksLikeCredentialsFailure(failures, 2)).toBe(false)
  })

  it('does not fire when nothing failed at all', () => {
    expect(looksLikeCredentialsFailure([], 3)).toBe(false)
    expect(looksLikeCredentialsFailure(null, 0)).toBe(false)
  })
})

describe('zero posts this week is not a dead account', () => {
  // The agent raised this against its own board on the first live run:
  // Technolight read "0 posts/wk, n=0" while holding 768 lifetime posts, and
  // it warned a future reader would take that for a dormant account. Same
  // null-vs-zero confusion as everywhere else here, one level up — the number
  // was right and the label was wrong.
  it('says the account is live even when the week is empty', () => {
    const [card] = buildBoard([{
      competitor_name: 'Technolight', data_source: 'instagram',
      followers: 1522, media_count: 768, posts_in_period: 0, sample_size: 0,
    }], [])
    expect(card.media_count).toBe(768)
    expect(card.activity).toMatch(/no NEW posts this period/i)
    expect(card.activity).toMatch(/account itself is live/i)
  })

  it('counts the posts when there are some', () => {
    const [card] = buildBoard([{
      competitor_name: 'Huda', data_source: 'instagram', posts_in_period: 3,
    }], [])
    expect(card.activity).toBe('3 posts this period')
  })

  it('a web-only rival is described as unmeasurable, not as silent', () => {
    // The distinction that matters most: "we could not look" and "they did
    // not post" are different facts and only one is about the competitor.
    const [card] = buildBoard([{ competitor_name: 'Arclight', data_source: 'web_only' }], [])
    expect(card.activity).toMatch(/not measurable/i)
  })
})
