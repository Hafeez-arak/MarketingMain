import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isLeadsHost } from './leadsHost.js'

describe('isLeadsHost', () => {
  it('is true only on sales.*, the sales team\'s address', () => {
    expect(isLeadsHost('sales.araklighting.com')).toBe(true)
    expect(isLeadsHost('SALES.araklighting.com')).toBe(true)
    expect(isLeadsHost('leads.araklighting.com')).toBe(false)
    expect(isLeadsHost('wholesales.example.com')).toBe(false)
    expect(isLeadsHost('marketing-main-ten.vercel.app')).toBe(false)
    expect(isLeadsHost('localhost')).toBe(false)
  })
  it('sends the old leads.* addresses to sales.araklighting.com', () => {
    const { redirects = [] } = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
    for (const host of ['leads.araklighting.com', 'leads.arak-sa.com']) {
      expect(redirects).toContainEqual({ source: '/:path*', has: [{ type: 'host', value: host }], destination: 'https://sales.araklighting.com/:path*', permanent: true })
    }
  })
})
