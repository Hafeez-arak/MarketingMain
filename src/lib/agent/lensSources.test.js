import { describe, it, expect } from 'vitest'
import { LENS_PROMPTS, sourcesBlock } from './lensPrompts'
import { opportunityFromFinding } from './intel'
import { targetFinding } from './lenses'

// ─── Where to look, sizing and social search (2026-10-17) ──────────────────
// The 13 Oct run proposed giga-projects off weak pages. These pin the three
// instructions that answer it: read the team's source list first, size a
// project against what we win, and search where projects are announced.

const brand = { brandName: 'Brand', descriptor: 'what they do', geography: 'Riyadh' }
const SOURCES = [
  { subject: '#example_projects', source_type: 'hashtag', tier: 2, why: 'tracker posts' },
  { subject: 'exchange.example', source_type: 'exchange', tier: 1, why: 'contract announcements' },
]

describe('the source list', () => {
  it('renders nothing without sources, so other brands are unaffected', () => {
    expect(sourcesBlock([])).toBe('')
    expect(LENS_PROMPTS.openings(brand, { motion: 'specification' })).not.toMatch(/WHERE TO LOOK FIRST/)
  })

  it('lists tier 1 first, with what each source carries', () => {
    const text = sourcesBlock(SOURCES)
    expect(text.indexOf('exchange.example')).toBeLessThan(text.indexOf('#example_projects'))
    expect(text).toMatch(/\[tier 1\] stock-exchange announcements: exchange\.example — contract announcements/)
  })

  it('reaches both project lenses', () => {
    expect(LENS_PROMPTS.openings(brand, { motion: 'specification', sources: SOURCES })).toMatch(/WHERE TO LOOK FIRST/)
    expect(LENS_PROMPTS.targets(brand, { sources: SOURCES })).toMatch(/WHERE TO LOOK FIRST/)
  })
})

describe('social search and source quality', () => {
  it('asks both project lenses to build their own hashtags, in the local language too', () => {
    for (const text of [
      LENS_PROMPTS.openings(brand, { motion: 'specification', language: 'Arabic' }),
      LENS_PROMPTS.targets(brand, { language: 'Arabic' }),
    ]) {
      expect(text).toMatch(/Build your own hashtags and keywords/)
      expect(text).toMatch(/in Arabic as well as English/)
      expect(text).toMatch(/site:instagram\.com and site:linkedin\.com\/posts/)
      expect(text).toMatch(/must not be the ONLY source for a project finding/)
    }
  })
})

describe('sizing', () => {
  it('tells openings to name the piece of a big project, only when an ICP exists', () => {
    const fit = 'PACKAGE SIZE: best under 500k SAR; fine up to 2M SAR.'
    const withFit = LENS_PROMPTS.openings(brand, { motion: 'specification', fit })
    expect(withFit).toMatch(/SIZE EVERY PROJECT AGAINST WHAT WE ACTUALLY WIN/)
    expect(withFit).toContain(fit)
    expect(LENS_PROMPTS.openings(brand, { motion: 'specification' })).not.toMatch(/SIZE EVERY PROJECT/)
  })

  it('carries the package fields from the lens into the tracker', () => {
    const opp = opportunityFromFinding(targetFinding({
      headline: 'Diriyah hotels awarded',
      sources: [{ url: 'https://example.com/a' }],
      target: {
        name: 'Diriyah hotels', kind: 'project', value_sar: 'SAR 2.7 billion', value_kind: 'project',
        package: 'Hotel 3 interiors — fit-out by X', package_value_sar: '',
      },
    }))
    expect(opp).toMatchObject({
      value_sar: 2.7e9, value_kind: 'project', package: 'Hotel 3 interiors — fit-out by X', package_value_sar: null,
    })
  })
})
