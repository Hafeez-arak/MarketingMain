import { describe, it, expect } from 'vitest'
import {
  analyticsPlan, INSTAGRAM_INSIGHT_METRICS, retryRateLimited, ZernioError,
  LINKEDIN_PAGE_METRICS, LINKEDIN_SERIES_METRICS,
} from './_zernio.js'

// ─── Which Zernio reads one account's Analytics tab makes ──────────────────
// Two things here fail silently if they are wrong. Zernio's analytics
// endpoints are scoped to the API team, so a read that forgets accountId
// shows another brand's numbers under this account's name. And Meta refuses
// an account-insights window of 30 days or more, so the 90-day view would
// lose its insights strip to a 400 nobody sees.

const NOW = Date.parse('2026-09-14T12:00:00Z')
const byKey = plan => Object.fromEntries(plan.requests.map(r => [r.key, r]))

describe('analyticsPlan', () => {
  it('scopes every read to the one account', () => {
    const plan = analyticsPlan({ platform: 'instagram', accountId: 'acc_1', days: 30, now: NOW })
    for (const r of plan.requests) {
      expect(r.query.accountId || r.query.accountIds).toBe('acc_1')
    }
  })

  it('reads posts and daily metrics over the chosen window', () => {
    const plan = analyticsPlan({ platform: 'instagram', accountId: 'acc_1', days: 90, now: NOW })
    expect(plan.fromDate).toBe('2026-06-16')
    expect(plan.toDate).toBe('2026-09-14')
    expect(byKey(plan).overview.query).toMatchObject({ fromDate: '2026-06-16', toDate: '2026-09-14', source: 'all' })
    expect(byKey(plan).daily.query).toMatchObject({ fromDate: '2026-06-16', toDate: '2026-09-14' })
  })

  // Measured live: since=2026-08-15 until=2026-09-14 (30 days) is refused with
  // Meta's #100; since=2026-08-16 (29 days) answers.
  it('caps Instagram account insights at 29 days, whatever the window', () => {
    const plan = analyticsPlan({ platform: 'instagram', accountId: 'acc_1', days: 90, now: NOW })
    expect(byKey(plan).insights.query).toMatchObject({
      since: '2026-08-16', until: '2026-09-14', metrics: INSTAGRAM_INSIGHT_METRICS.join(','),
    })
    expect(plan.insightsFrom).toBe('2026-08-16')
  })

  it('uses the chosen window for insights when it is shorter', () => {
    const plan = analyticsPlan({ platform: 'instagram', accountId: 'acc_1', days: 7, now: NOW })
    expect(byKey(plan).insights.query.since).toBe('2026-09-07')
  })

  it('asks for follower history as a daily series, within the 89-day limit', () => {
    const plan = analyticsPlan({ platform: 'instagram', accountId: 'acc_1', days: 90, now: NOW })
    expect(byKey(plan).followerHistory.query).toMatchObject({ since: '2026-06-18', metricType: 'time_series' })
  })

  it('makes no Instagram-only reads for another platform', () => {
    const plan = analyticsPlan({ platform: 'tiktok', accountId: 'acc_2', days: 30, now: NOW })
    const keys = plan.requests.map(r => r.key)
    expect(keys).not.toContain('insights')
    expect(keys).not.toContain('followerHistory')
    expect(plan.insightsFrom).toBeNull()
    expect(plan.metricsSupported).toBeNull()
  })

  it('falls back to 30 days for a window the page does not offer', () => {
    expect(analyticsPlan({ platform: 'instagram', accountId: 'a', days: 365, now: NOW }).days).toBe(30)
    expect(analyticsPlan({ platform: 'instagram', accountId: 'a', days: 'x', now: NOW }).days).toBe(30)
    expect(analyticsPlan({ platform: 'instagram', accountId: 'a', days: '7', now: NOW }).days).toBe(7)
  })

  it('drops the metric toggles Instagram never fills', () => {
    const { metricsSupported } = analyticsPlan({ platform: 'instagram', accountId: 'a', days: 30, now: NOW })
    expect(metricsSupported).not.toContain('impressions')
  })
})

// The message is Zernio's own, captured live from a third consecutive load.
const limited = seconds => new ZernioError(`Rate limit exceeded. Please retry after ${seconds} seconds.`, { status: 429 })

describe('retryRateLimited', () => {
  it('retries once after the wait Zernio names', async () => {
    const waits = []
    let calls = 0
    const got = await retryRateLimited(async () => { if (calls++ === 0) throw limited(1); return 'ok' },
      { sleep: async ms => { waits.push(ms) } })
    expect(got).toBe('ok')
    expect(calls).toBe(2)
    expect(waits).toEqual([1000])
  })

  it('gives up rather than hold the page for a long wait', async () => {
    let calls = 0
    await expect(retryRateLimited(async () => { calls++; throw limited(30) }, { sleep: async () => {} }))
      .rejects.toThrow(/Rate limit/)
    expect(calls).toBe(1)
  })

  it('does not retry any other failure', async () => {
    let calls = 0
    await expect(retryRateLimited(async () => { calls++; throw new ZernioError('Not found', { status: 404 }) },
      { sleep: async () => {} })).rejects.toThrow('Not found')
    expect(calls).toBe(1)
  })

  it('surfaces a second rate limit instead of looping', async () => {
    let calls = 0
    await expect(retryRateLimited(async () => { calls++; throw limited(1) }, { sleep: async () => {} }))
      .rejects.toThrow(/Rate limit/)
    expect(calls).toBe(2)
  })
})

describe('analyticsPlan metric toggles', () => {
  it('keeps the ones Instagram does fill', () => {
    const { metricsSupported } = analyticsPlan({ platform: 'instagram', accountId: 'a', days: 30, now: NOW })
    expect(metricsSupported).not.toContain('impressions')
    expect(metricsSupported).not.toContain('clicks')
    expect(metricsSupported).toContain('reach')
  })
})

// ─── A LinkedIn company page ───────────────────────────────────────────────
// Its page-level numbers come from a different read with a different limit, and
// its per-post numbers are a different set — impressions and clicks, never
// views or saves. Every value below was measured against the live ARAK
// Lighting page on 2026-09-14.
describe('analyticsPlan for a LinkedIn company page', () => {
  const page = days => analyticsPlan({ platform: 'linkedin', accountId: 'li1', accountType: 'organization', days, now: NOW })

  it('reads the page totals and a daily series, both scoped to the one account', () => {
    const k = byKey(page(30))
    expect(k.linkedinPage).toMatchObject({ path: 'analytics/linkedin/org-aggregate-analytics' })
    expect(k.linkedinPage.query).toMatchObject({ accountId: 'li1', metricType: 'total_value', since: '2026-08-15', until: '2026-09-14' })
    expect(k.linkedinSeries.query).toMatchObject({ accountId: 'li1', metricType: 'time_series' })
  })

  // 89 days was refused live ("Date range cannot exceed 88 days"); 88 answered.
  it('caps the page window at 88 days', () => {
    const plan = page(90)
    expect(byKey(plan).linkedinPage.query.since).toBe('2026-06-18')
    expect(plan.insightsFrom).toBe('2026-06-18')
    expect(plan.fromDate).toBe('2026-06-16')
  })

  // LinkedIn refuses page views as a series, so asking for them there fails the read.
  it('asks for page views in the totals only', () => {
    expect(LINKEDIN_PAGE_METRICS).toContain('page_views_total')
    expect(LINKEDIN_SERIES_METRICS.some(m => m.startsWith('page_views'))).toBe(false)
    expect(byKey(page(30)).linkedinSeries.query.metrics.split(',')).toEqual(LINKEDIN_SERIES_METRICS)
  })

  it('offers impressions and clicks, and neither views nor saves', () => {
    const { metricsSupported } = page(30)
    expect(metricsSupported).toEqual(expect.arrayContaining(['impressions', 'clicks', 'reach']))
    expect(metricsSupported).not.toContain('views')
    expect(metricsSupported).not.toContain('saves')
  })

  it('treats an unrecorded account type as a page', () => {
    const plan = analyticsPlan({ platform: 'linkedin', accountId: 'li1', days: 30, now: NOW })
    expect(plan.requests.map(r => r.key)).toContain('linkedinPage')
  })

  it('makes no page reads for a personal profile, which Zernio refuses', () => {
    const plan = analyticsPlan({ platform: 'linkedin', accountId: 'li2', accountType: 'personal', days: 30, now: NOW })
    const keys = plan.requests.map(r => r.key)
    expect(keys).not.toContain('linkedinPage')
    expect(keys).not.toContain('linkedinSeries')
    expect(plan.insightsFrom).toBeNull()
  })

  it('makes none of Instagram\'s reads', () => {
    const keys = page(30).requests.map(r => r.key)
    expect(keys).not.toContain('insights')
    expect(keys).not.toContain('followerHistory')
  })
})
