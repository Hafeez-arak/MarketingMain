import { describe, it, expect } from 'vitest'
import {
  propertyPath, isoDate, normalizeReport, totalsOf, reportBody, reportPlan,
  ga4Summary, ga4Config, delta, TOTAL_METRICS,
} from './ga4.js'

describe('propertyPath', () => {
  it('accepts a bare numeric property id', () => {
    expect(propertyPath('123456789')).toEqual({ path: 'properties/123456789', error: '' })
  })

  it('accepts the forms people paste from the GA4 URL and the API docs', () => {
    expect(propertyPath('properties/123').path).toBe('properties/123')
    expect(propertyPath('p123').path).toBe('properties/123')
    expect(propertyPath('  123  ').path).toBe('properties/123')
  })

  // The trap this function exists for. A G- id is the one GA4 identifier most
  // people have ever seen, and the API's own error for it says nothing about
  // which number to look for instead.
  it('names a measurement id rather than passing it through', () => {
    const { path, error } = propertyPath('G-ABC123XYZ')
    expect(path).toBe('')
    expect(error).toContain('Measurement ID')
    expect(error).toContain('Property settings')
  })

  it('rejects anything that is not digits, and says what it wanted', () => {
    expect(propertyPath('arak-sa.com').error).toContain('digits')
  })

  it('treats nothing configured as nothing wrong', () => {
    expect(propertyPath('')).toEqual({ path: '', error: '' })
    expect(propertyPath(null)).toEqual({ path: '', error: '' })
  })
})

describe('isoDate', () => {
  it('puts the dashes back in GA4 dates', () => {
    expect(isoDate('20260917')).toBe('2026-09-17')
  })

  // Anything already ISO, or a bucket name like `(other)`, passes through:
  // a date parser that mangles a non-date is worse than one that ignores it.
  it('leaves anything that is not a GA4 date alone', () => {
    expect(isoDate('2026-09-17')).toBe('2026-09-17')
    expect(isoDate('(other)')).toBe('(other)')
    expect(isoDate('')).toBe('')
  })
})

describe('normalizeReport', () => {
  const res = {
    dimensionHeaders: [{ name: 'date' }],
    metricHeaders: [{ name: 'sessions' }, { name: 'engagementRate' }],
    rows: [
      { dimensionValues: [{ value: '20260901' }], metricValues: [{ value: '12' }, { value: '0.6341463414634146' }] },
      { dimensionValues: [{ value: '20260902' }], metricValues: [{ value: '4' }, { value: '0.5' }] },
    ],
  }

  it('names the columns and converts the dates', () => {
    expect(normalizeReport(res)[0].date).toBe('2026-09-01')
  })

  // GA4 sends every metric as a string, floats included. A string that looks
  // like a number survives every operation except the one that matters.
  it('casts metric strings to numbers', () => {
    const rows = normalizeReport(res)
    expect(rows[0].sessions).toBe(12)
    expect(rows[0].sessions + rows[1].sessions).toBe(16)
    expect(rows[0].engagementRate).toBeCloseTo(0.634146, 5)
  })

  it('answers an empty report with an empty array rather than throwing', () => {
    expect(normalizeReport({})).toEqual([])
    expect(normalizeReport()).toEqual([])
    expect(normalizeReport({ dimensionHeaders: [], metricHeaders: [], rows: [] })).toEqual([])
  })
})

describe('totalsOf', () => {
  it('reads the single row a no-dimension report returns', () => {
    expect(totalsOf([{ sessions: 40, totalUsers: 31 }], ['sessions', 'totalUsers']))
      .toEqual({ sessions: 40, totalUsers: 31 })
  })

  it('answers zeroes, not undefined, when the report came back empty', () => {
    expect(totalsOf([], ['sessions'])).toEqual({ sessions: 0 })
  })
})

describe('reportBody', () => {
  it('shapes a request the Data API will take', () => {
    const b = reportBody({ start: '2026-08-21', end: '2026-09-17', dimensions: ['date'], metrics: ['sessions'] })
    expect(b.dateRanges).toEqual([{ startDate: '2026-08-21', endDate: '2026-09-17' }])
    expect(b.dimensions).toEqual([{ name: 'date' }])
    expect(b.metrics).toEqual([{ name: 'sessions' }])
  })

  it('orders by a metric or by a dimension, whichever was named', () => {
    expect(reportBody({ dimensions: ['date'], orderBy: 'date', desc: false }).orderBys[0])
      .toEqual({ dimension: { dimensionName: 'date' }, desc: false })
    expect(reportBody({ dimensions: ['country'], metrics: ['sessions'], orderBy: 'sessions' }).orderBys[0])
      .toEqual({ metric: { metricName: 'sessions' }, desc: true })
  })

  it('clamps a nonsense limit rather than sending it', () => {
    expect(reportBody({ limit: 0 }).limit).toBe(25)
    expect(reportBody({ limit: 5e9 }).limit).toBe(100_000)
  })
})

describe('reportPlan', () => {
  const plan = reportPlan({ current: { start: 'a', end: 'b' }, previous: { start: 'c', end: 'd' } })

  it('asks both windows the same question, so the two are comparable', () => {
    const totals = plan.find(p => p.id === 'totals')
    const prev = plan.find(p => p.id === 'previousTotals')
    expect(totals.body.metrics).toEqual(prev.body.metrics)
    expect(totals.body.dateRanges[0].startDate).toBe('a')
    expect(prev.body.dateRanges[0].startDate).toBe('c')
  })

  // Only the date series. A channel that sent nobody is not worth a row; a DAY
  // that sent nobody is, or the line chart draws a rise that did not happen.
  it('keeps empty rows for the daily series and nowhere else', () => {
    for (const r of plan) {
      expect(r.body.keepEmptyRows, r.id).toBe(r.id === 'daily')
    }
  })

  it('marks the reports a normal property may legitimately refuse', () => {
    expect(plan.find(p => p.id === 'keyEvents').optional).toBe(true)
    expect(plan.find(p => p.id === 'totals').optional).toBeUndefined()
  })

  it('never asks for `conversions`, which GA4 removed rather than aliased', () => {
    const asked = plan.flatMap(p => p.body.metrics.map(m => m.name))
    expect(asked).not.toContain('conversions')
    expect(asked).toContain('keyEvents')
  })
})

describe('ga4Summary', () => {
  const totals = {
    sessions: 200, totalUsers: 160, newUsers: 120, screenPageViews: 480,
    engagedSessions: 130, engagementRate: 0.65, bounceRate: 0.35, averageSessionDuration: 74.3,
  }

  it('scales GA4 fractions to the percentages this app renders', () => {
    const s = ga4Summary({ totals, previousTotals: { sessions: 150 } })
    expect(s.engagementRate).toBeCloseTo(65)
    expect(s.bounceRate).toBeCloseTo(35)
  })

  it('works out pages per session rather than making the page do it twice', () => {
    expect(ga4Summary({ totals, previousTotals: {} }).pagesPerSession).toBeCloseTo(2.4)
  })

  // The rule this whole file shares with websiteAnalytics.js: a previous
  // window holding nothing is a BASELINE, and rendering it as a fall reports
  // the tag's installation date as a collapse in traffic.
  it('reports a baseline rather than a 100% fall when the previous window is empty', () => {
    const s = ga4Summary({ totals, previousTotals: { sessions: 0, totalUsers: 0 } })
    expect(s.baseline).toBe(true)
    expect(s.sessionsDelta).toBeNull()
    expect(s.usersDelta).toBeNull()
    expect(s.pageViewsDelta).toBeNull()
  })

  it('compares against a previous window that does hold something', () => {
    const s = ga4Summary({ totals, previousTotals: { sessions: 150, totalUsers: 100, screenPageViews: 400 } })
    expect(s.baseline).toBe(false)
    expect(s.sessionsDelta).toBe(50)
    expect(s.usersDelta).toBe(60)
  })

  it('survives a property that answered with nothing at all', () => {
    const s = ga4Summary({})
    expect(s.sessions).toBe(0)
    expect(s.pagesPerSession).toBe(0)
    expect(s.baseline).toBe(true)
  })
})

describe('delta', () => {
  it('is null with no previous period, and null against a zero base', () => {
    expect(delta(10, 5, { hasPrevious: false })).toBeNull()
    expect(delta(10, 0)).toBeNull()
  })
  it('is the difference in the tile’s own units', () => {
    expect(delta(10, 4)).toBe(6)
    expect(delta(4, 10)).toBe(-6)
  })
})

describe('ga4Config', () => {
  it('reads the property from customFields, like every other brand setting', () => {
    expect(ga4Config({ customFields: { ga4_property_id: '123' } }).path).toBe('properties/123')
    expect(ga4Config({ customFields: { ga4_property: '456' } }).path).toBe('properties/456')
  })

  // Nothing is inferred from the website, the workspace name or the brand's
  // prose: a guessed property id produces a 403 that looks like a permissions
  // bug and is not one.
  it('is unconfigured rather than guessed when nobody set it', () => {
    expect(ga4Config({ customFields: { website: 'sc-domain:arak-sa.com' } })).toEqual({ path: '', error: '' })
    expect(ga4Config({})).toEqual({ path: '', error: '' })
  })
})

describe('TOTAL_METRICS', () => {
  it('holds the metrics both windows are measured with', () => {
    expect(TOTAL_METRICS).toContain('sessions')
    expect(TOTAL_METRICS).toContain('engagementRate')
    expect(new Set(TOTAL_METRICS).size).toBe(TOTAL_METRICS.length)
  })
})
