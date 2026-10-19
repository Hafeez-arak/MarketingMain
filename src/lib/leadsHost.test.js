import { describe, it, expect } from 'vitest'
import { isLeadsHost } from './leadsHost.js'

describe('isLeadsHost', () => {
  it('is true only on the sales team\'s address, sales.* or leads.*', () => {
    expect(isLeadsHost('sales.araklighting.com')).toBe(true)
    expect(isLeadsHost('leads.arak-sa.com')).toBe(true)
    expect(isLeadsHost('wholesales.example.com')).toBe(false)
    expect(isLeadsHost('LEADS.arak-sa.com')).toBe(true)
    expect(isLeadsHost('marketing-main-ten.vercel.app')).toBe(false)
    expect(isLeadsHost('localhost')).toBe(false)
    expect(isLeadsHost('myleads.example.com')).toBe(false)
  })
})
