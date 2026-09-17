import { describe, it, expect } from 'vitest'
import { rivalsPrompt, competitorLine, axesFor } from './lensPrompts.js'

describe('the watchlist note reaches the rivals lens', () => {
  const brand = { brandName: 'Arak', descriptor: 'lighting', audience: 'specifiers', geography: 'Riyadh' }

  it('renders the note under the name, so the lens knows which company is meant', () => {
    const p = rivalsPrompt(brand, {
      competitors: ['Al Nasser Group'],
      notes: [{ name: 'Al Nasser Group', domain: 'alnasser.me', lines: ['lighting', 'controls'], kinds: ['manufacturer'], city: 'Riyadh' }],
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
      notes: [{ name: 'futuron', domain: 'futuron.sa', lines: ['controls'] }],
    })
    expect(p).toContain('futuron.sa')
  })

  it('tells the lens to research the domain, not the name', () => {
    // "Lumiere" is four Saudi companies; a name alone already sent this lens
    // to the wrong one.
    const p = rivalsPrompt(brand, { competitors: ['X'], notes: [{ name: 'X', domain: 'x.com', lines: ['lighting'] }] })
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

describe('competitorLine', () => {
  it('leads with the domain, because that is the identity', () => {
    expect(competitorLine({ domain: 'selapass.com', lines: ['controls'] }))
      .toContain('RESEARCH THIS DOMAIN: selapass.com')
  })

  it('refuses to let a missing domain read as a blank the model fills in', () => {
    // "Lumiere" is four Saudi companies and "Al Nasser" is three.
    const out = competitorLine({ name: 'Lumiere', lines: ['lighting'] })
    expect(out).toContain('NO DOMAIN')
    expect(out).toContain('Do not guess')
  })

  it('tells the lens not to spend a search on an unresolvable name', () => {
    const out = competitorLine({ name: 'Greenlight', resolution: 'unresolvable' })
    expect(out).toContain('CANNOT BE RESEARCHED')
    expect(out).toContain('Do not spend a search')
  })

  it('carries kind, because it decides which questions are worth asking at all', () => {
    expect(competitorLine({ domain: 'a.com', kinds: ['manufacturer', 'integrator'] }))
      .toContain('kind: manufacturer + integrator')
  })

  it('keeps the human note after the structured fields', () => {
    expect(competitorLine({ domain: 'a.com', why: 'Founded 1976.' })).toContain('Founded 1976.')
  })
})

describe('axesFor', () => {
  it('asks a lighting rival about agencies and references', () => {
    const [a] = axesFor(['lighting'])
    expect(a).toContain('AGENCIES')
    expect(a).toContain('project references')
  })

  it('asks a controls rival about protocols and commissioning instead', () => {
    const [a] = axesFor(['controls'])
    expect(a).toContain('KNX')
    expect(a).toContain('commission')
    expect(a).not.toContain('photometric')
  })

  it('emits each line once, whatever order the watchlist is in', () => {
    expect(axesFor(['controls', 'lighting', 'controls'])).toHaveLength(2)
  })

  it('says nothing at all for a brand with no lines configured', () => {
    expect(axesFor([])).toEqual([])
  })

  it('still asks the question for a line it has no vocabulary for', () => {
    const [a] = axesFor(['tailoring'])
    expect(a).toContain('"tailoring"')
    expect(a).toContain('decide who wins work')
  })
})

describe('the relationship axis', () => {
  it('asks who each rival keeps appearing beside, since that is the moat', () => {
    const p = rivalsPrompt(
      { brandName: 'Arak', descriptor: 'lighting', audience: 'specifiers', geography: 'Riyadh' },
      { competitors: ['A'], notes: [{ name: 'A', domain: 'a.com', lines: ['controls'] }] })
    expect(p).toContain('WHO THEY ARE CLOSE TO')
    expect(p).toContain('partnership')
  })
})

describe('the watchlist row shape', () => {
  it('matches on `subject` too, since that is what the column is called', () => {
    // A caller handing database rows straight through would otherwise render
    // every rival as a bare name with no domain, and say nothing about it.
    const p = rivalsPrompt(
      { brandName: 'Arak', descriptor: 'lighting', audience: 'specifiers', geography: 'Riyadh' },
      { competitors: ['Sela-PASS'], notes: [{ subject: 'Sela-PASS', domain: 'selapass.com', lines: ['controls'] }] })
    expect(p).toContain('RESEARCH THIS DOMAIN: selapass.com')
  })
})
