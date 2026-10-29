import { describe, it, expect } from 'vitest'
import {
  cleanDemographics, audienceMix, industryBucket, compareRows, weekStartOf, previousWeekStart,
  latestPair, audienceSummary, hasDemographics,
} from './linkedinAudience.js'

// Shaped like Zernio's live answer for ARAK Lighting on 2026-10-29.
const zernio = {
  success: true,
  demographics: {
    industry: [
      { dimension: 'Construction', id: 'urn:li:industry:48', value: 365 },
      { dimension: 'Appliances, Electrical, and Electronics Manufacturing', id: 'urn:li:industry:112', value: 885 },
      { dimension: 'Electric Lighting Equipment Manufacturing', id: 'urn:li:industry:998', value: 221 },
      { dimension: 'Architecture and Planning', id: 'urn:li:industry:50', value: 151 },
      { dimension: 'Hospitality', id: 'urn:li:industry:31', value: 28 },
      { dimension: 'IT Services and IT Consulting', id: 'urn:li:industry:96', value: 203 },
      { dimension: 'Bogus', id: 'x', value: 0 },
    ],
    seniority: [
      { dimension: 'Entry', id: 'urn:li:seniority:3', value: 1711 },
      { dimension: 'Senior', id: 'urn:li:seniority:4', value: 1446 },
      { dimension: 'Manager', id: 'urn:li:seniority:5', value: 501 },
      { dimension: 'Director', id: 'urn:li:seniority:6', value: 351 },
      { dimension: 'Owner', id: 'urn:li:seniority:10', value: 75 },
      { dimension: 'Training', id: 'urn:li:seniority:2', value: 15 },
    ],
    function: [{ dimension: 'Sales', id: 'urn:li:function:25', value: 1086 }],
    company_size: [{ dimension: '51-200', id: 'SIZE_51_TO_200', value: 976 }],
    geo: [{ dimension: 'Saudi Arabia', id: 'x', value: 1 }],
  },
}

describe('cleanDemographics', () => {
  const d = cleanDemographics(zernio)
  it('keeps the four dimensions, sorted, zero rows dropped, unknown dimensions ignored', () => {
    expect(Object.keys(d)).toEqual(['industry', 'function', 'seniority', 'company_size'])
    expect(d.industry[0]).toEqual({ label: 'Appliances, Electrical, and Electronics Manufacturing', id: 'urn:li:industry:112', value: 885 })
    expect(d.industry.find(r => r.label === 'Bogus')).toBeUndefined()
    expect(d.geo).toBeUndefined()
  })
  it('an empty answer is no demographics', () => {
    expect(hasDemographics(cleanDemographics({}))).toBe(false)
    expect(hasDemographics(d)).toBe(true)
  })
})

describe('the buckets', () => {
  it('sorts the industries the request named', () => {
    expect(industryBucket('Construction')).toBe('customer')
    expect(industryBucket('Building Equipment Contractors')).toBe('customer')
    expect(industryBucket('Real Estate Agents and Brokers')).toBe('customer')
    expect(industryBucket('Hospitality')).toBe('customer')
    expect(industryBucket('Engineering Services')).toBe('customer')
    expect(industryBucket('Electric Lighting Equipment Manufacturing')).toBe('trade')
    expect(industryBucket('Wholesale Import and Export')).toBe('trade')
    expect(industryBucket('Electric Power Transmission, Control, and Distribution')).toBe('other')
    expect(industryBucket('IT Services and IT Consulting')).toBe('other')
  })

  it('computes the mix as shares of the followers who list the field', () => {
    const mix = audienceMix(cleanDemographics(zernio))
    // industry total 1853: customer 365+151+28 = 544, trade 885+221 = 1106
    expect(mix.customer_sectors).toEqual({ count: 544, pct: 29.4 })
    expect(mix.lighting_trade).toEqual({ count: 1106, pct: 59.7 })
    // seniority total 4099: manager+ 501+351+75 = 927, entry and below 1711+15 = 1726
    expect(mix.decision_makers).toEqual({ count: 927, pct: 22.6 })
    expect(mix.early_career).toEqual({ count: 1726, pct: 42.1 })
  })

  it('no rows is no percentage, never 0%', () => {
    expect(audienceMix({}).customer_sectors.pct).toBeNull()
  })
})

describe('weeks', () => {
  it('a week starts on Sunday, Riyadh time', () => {
    // The Sunday cron fires 04:00 UTC = 07:00 Riyadh.
    expect(weekStartOf(new Date('2026-11-01T04:00:00Z'))).toBe('2026-11-01')
    // Saturday 22:00 UTC is already Sunday 01:00 in Riyadh.
    expect(weekStartOf(new Date('2026-10-31T22:00:00Z'))).toBe('2026-11-01')
    expect(weekStartOf(new Date('2026-10-31T20:00:00Z'))).toBe('2026-10-25')
    expect(weekStartOf(new Date('2026-10-29T10:00:00Z'))).toBe('2026-10-25')
    expect(previousWeekStart('2026-11-01')).toBe('2026-10-25')
  })
})

describe('comparing weeks', () => {
  const demo = cleanDemographics(zernio)
  const grown = cleanDemographics({
    demographics: { ...zernio.demographics, industry: [...zernio.demographics.industry.map(r => r.id === 'urn:li:industry:48' ? { ...r, value: 465 } : r)] },
  })

  it('pairs the latest week with exactly the week before', () => {
    const snaps = [
      { week_start: '2026-10-18', demographics: demo },
      { week_start: '2026-11-01', demographics: grown },
      { week_start: '2026-10-25', demographics: demo },
    ]
    const { current, previous } = latestPair(snaps)
    expect(current.week_start).toBe('2026-11-01')
    expect(previous.week_start).toBe('2026-10-25')
  })

  it('a missing week is no comparison, not a comparison with an older one', () => {
    const { previous } = latestPair([
      { week_start: '2026-11-01', demographics: grown },
      { week_start: '2026-10-18', demographics: demo },
    ])
    expect(previous).toBeNull()
  })

  it('row changes are matched by id', () => {
    const rows = compareRows(grown.industry, demo.industry)
    const construction = rows.find(r => r.id === 'urn:li:industry:48')
    expect(construction.change).toBe(100)
    expect(construction.pct_change).toBeGreaterThan(0)
    expect(compareRows(grown.industry, null)[0].change).toBeNull()
  })

  it('the brief summary carries the change in points and says location is unknown', () => {
    const s = audienceSummary([
      { week_start: '2026-11-01', followers: 4900, demographics: grown },
      { week_start: '2026-10-25', followers: 4866, demographics: demo },
    ])
    expect(s.available).toBe(true)
    expect(s.week_of).toBe('2026-11-01')
    expect(s.compared_with_week_of).toBe('2026-10-25')
    expect(s.customer_sectors.change_points_vs_last_week).toBeGreaterThan(0)
    expect(s.lighting_trade.change_points_vs_last_week).toBeLessThan(0)
    expect(s.notes).toMatch(/Saudi Arabia is unknown/)
    expect(audienceSummary([])).toEqual({ available: false })
  })
})
