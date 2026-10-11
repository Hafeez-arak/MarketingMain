import { describe, it, expect } from 'vitest'
import { isLeadsHost } from './leadsHost.js'

describe('isLeadsHost', () => {
  it('is true only on a leads.* address', () => {
    expect(isLeadsHost('leads.arak-sa.com')).toBe(true)
    expect(isLeadsHost('LEADS.arak-sa.com')).toBe(true)
    expect(isLeadsHost('marketing-main-ten.vercel.app')).toBe(false)
    expect(isLeadsHost('localhost')).toBe(false)
    expect(isLeadsHost('myleads.example.com')).toBe(false)
  })
})
