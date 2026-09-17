import { describe, it, expect } from 'vitest'
import { parseLines, lineFromWords, lineForFinding, stampLines } from './lines'

const LINES = parseLines([
  'lighting | Lighting | /services/facade-lighting, luminaire, facade, lighting design',
  'controls | Controls | /services/lighting-controls, knx, dali, grms',
].join('\n'))

const WATCH = [
  { subject: 'Sela-PASS', lines: ['controls'] },
  { subject: 'ViaLighting', lines: ['lighting'] },
  { subject: 'Al Nasser Group', lines: ['lighting', 'controls'] },
]

describe('parseLines', () => {
  it('splits paths from words', () => {
    expect(LINES[1].paths).toContain('/services/lighting-controls')
    expect(LINES[1].words).toContain('knx')
  })

  it('reads nothing from an empty field rather than inventing a default line', () => {
    expect(parseLines('')).toEqual([])
  })
})

describe('lineForFinding', () => {
  it('reads the finding’s own words first — KNX is controls whoever it is about', () => {
    expect(lineForFinding({ headline: 'They commissioned a KNX system' }, { lines: LINES, watchlist: WATCH }))
      .toBe('controls')
  })

  it('falls back to the competitor when that competitor sells into one line only', () => {
    expect(lineForFinding({ competitor: 'Sela-PASS', headline: 'New CEO appointed' }, { lines: LINES, watchlist: WATCH }))
      .toBe('controls')
  })

  it('refuses to guess from a rival that straddles both lines', () => {
    // This is exactly how a controls finding ends up on the lighting board.
    expect(lineForFinding({ competitor: 'Al Nasser Group', headline: 'New CEO appointed' }, { lines: LINES, watchlist: WATCH }))
      .toBe('')
  })

  it('lets the words win over the competitor, because the words are about this finding', () => {
    expect(lineForFinding(
      { competitor: 'ViaLighting', headline: 'ViaLighting now commissions KNX too' },
      { lines: LINES, watchlist: WATCH })).toBe('controls')
  })

  it('never overwrites a line already stamped from stronger evidence', () => {
    // The search lens stamps from the landing page a query resolved to.
    expect(lineForFinding(
      { line: 'lighting', headline: 'a KNX thing' }, { lines: LINES, watchlist: WATCH })).toBe('lighting')
  })

  it('assigns nothing when the brand has configured no lines', () => {
    expect(lineForFinding({ headline: 'KNX' }, { lines: [], watchlist: WATCH })).toBe('')
  })

  it('assigns nothing rather than a wrong line when neither source answers', () => {
    expect(lineForFinding({ headline: 'A general market note' }, { lines: LINES, watchlist: WATCH })).toBe('')
  })
})

describe('lineFromWords', () => {
  it('matches the first configured line whose word appears', () => {
    expect(lineFromWords('a facade job', LINES)).toBe('lighting')
  })

  it('is empty for text that matches nothing', () => {
    expect(lineFromWords('office chairs', LINES)).toBe('')
  })
})

describe('stampLines', () => {
  it('stamps a whole run without mutating what it was given', () => {
    const findings = [{ headline: 'a DALI install' }]
    const out = stampLines(findings, { lines: LINES, watchlist: WATCH })
    expect(out[0].line).toBe('controls')
    expect(findings[0].line).toBeUndefined()
  })
})
