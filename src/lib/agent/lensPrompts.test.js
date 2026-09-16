import { describe, it, expect } from 'vitest'
import { rivalsPrompt } from './lensPrompts.js'

describe('the watchlist note reaches the rivals lens', () => {
  const brand = { brandName: 'Arak', descriptor: 'lighting', audience: 'specifiers', geography: 'Riyadh' }

  it('renders the note under the name, so the lens knows which company is meant', () => {
    const p = rivalsPrompt(brand, {
      competitors: ['Al Nasser Group'],
      notes: [{ name: 'Al Nasser Group', why: 'Lighting + Controls · alnasser.me · Riyadh · Manufacturer' }],
    })
    expect(p).toContain('1. Al Nasser Group')
    expect(p).toContain('alnasser.me')
  })

  it('still renders a name that has no note', () => {
    const p = rivalsPrompt(brand, { competitors: ['Someone'], notes: [] })
    expect(p).toContain('1. Someone')
  })

  it('matches a note to its name case-insensitively', () => {
    const p = rivalsPrompt(brand, {
      competitors: ['Futuron'],
      notes: [{ name: 'futuron', why: 'Controls · futuron.sa' }],
    })
    expect(p).toContain('futuron.sa')
  })

  it('tells the lens to research the domain, not the name', () => {
    // "Lumiere" is four Saudi companies; a name alone already sent this lens
    // to the wrong one.
    const p = rivalsPrompt(brand, { competitors: ['X'], notes: [{ name: 'X', why: 'Lighting · x.com' }] })
    expect(p).toContain('research that domain')
    expect(p).toContain('SKIP that company')
  })
})

describe('when the watchlist is longer than the budget', () => {
  const brand = { brandName: 'Arak', descriptor: 'lighting', audience: 'specifiers', geography: 'Riyadh' }
  const many = Array.from({ length: 17 }, (_, i) => `Rival ${i + 1}`)

  it('rolls every name, so a whole business line cannot fall off the bottom', () => {
    // 17 names cut to 12 dropped every controls competitor on the real list.
    const p = rivalsPrompt(brand, { competitors: many, searches: 8 })
    expect(p).toContain('17. Rival 17')
  })

  it('does not promise one search per name when it cannot keep that promise', () => {
    const p = rivalsPrompt(brand, { competitors: many, searches: 8 })
    expect(p).toContain('8 searches and there are 17 names')
    expect(p).not.toContain('Spend one on each name above')
  })

  it('still promises it when the budget genuinely covers the list', () => {
    const p = rivalsPrompt(brand, { competitors: ['A', 'B'], searches: 8 })
    expect(p).toContain('Spend one on each name above')
  })
})
