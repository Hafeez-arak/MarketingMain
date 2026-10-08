import { describe, it, expect } from 'vitest'
import {
  normaliseIcp, scoreTarget, parseAmount, formatAmount, icpPromptText, rankTargets, hasIcp, icpToForm, formToIcp,
} from './icp'

// A made-up ICP. The real one is data in the database, never in this
// repository — it is built from client records.
const ICP = {
  summary: 'Contractors who already hold the job, on hotels and schools.',
  mix: { core: 60 },
  segments: [
    { key: 'hotels', label: 'Hotels & resorts', track: 'core', weight: 3, match: ['hotel', 'resort'] },
    { key: 'schools', label: 'Schools', track: 'core', weight: 2, match: ['school', 'university'] },
    { key: 'fitout', label: 'Fit-out companies', track: 'broader', weight: 2, match: ['fit-out', 'interiors'] },
  ],
  buyers: [
    { key: 'contractor_awarded', weight: 3 },
    { key: 'contractor_bidding', weight: -2, note: 'their loss is our loss — wait for the award' },
  ],
  size: { sweet_max: 500000, ok_max: 2000000 },
  regions: ['riyadh'],
  red_flags: [{ label: 'Specified brand', match: ['approved vendor', 'specified brand'], advice: 'ask for the vendor list first' }],
}

describe('the ICP is read whole, whatever was stored', () => {
  it('fills a missing config with empty lists, not holes', () => {
    const n = normaliseIcp(null)
    expect(n.segments).toEqual([])
    expect(n.mix).toEqual({ core: 50, broader: 50 })
    expect(hasIcp(null)).toBe(false)
    expect(hasIcp(ICP)).toBe(true)
  })

  it('keeps the two tracks adding to 100', () => {
    expect(normaliseIcp({ mix: { core: 70 } }).mix).toEqual({ core: 70, broader: 30 })
    expect(normaliseIcp({ mix: { core: 140 } }).mix).toEqual({ core: 100, broader: 0 })
  })

  it('drops a buyer the scorer does not know', () => {
    expect(normaliseIcp({ buyers: [{ key: 'alien', weight: 3 }] }).buyers).toEqual([])
  })
})

describe('money from what a page wrote', () => {
  it('reads the common ways of writing an amount', () => {
    expect(parseAmount('SAR 1.2 million')).toBe(1_200_000)
    expect(parseAmount('1,200,000')).toBe(1_200_000)
    expect(parseAmount('850k')).toBe(850_000)
    expect(parseAmount('1.5M')).toBe(1_500_000)
    expect(parseAmount(420000)).toBe(420000)
  })

  it('an unknown size is null, never zero', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('not stated')).toBeNull()
    expect(parseAmount(0)).toBeNull()
  })

  it('prints short', () => {
    expect(formatAmount(1_200_000)).toBe('1.2M SAR')
    expect(formatAmount(850_000)).toBe('850k SAR')
    expect(formatAmount(null)).toBe('')
  })
})

describe('how well a target fits', () => {
  it('a core hotel job held by the contractor, in region and in size, is strong', () => {
    const fit = scoreTarget({
      name: 'Palm Hotel Riyadh', buyer: 'contractor_awarded', value_sar: '400k', stage: 'awarded',
    }, ICP)
    expect(fit.band).toBe('strong')
    expect(fit.track).toBe('core')
    expect(fit.segment).toBe('Hotels & resorts')
    expect(fit.flags).toEqual([])
    expect(fit.reasons.join(' ')).toMatch(/Buying now/)
  })

  it('a contractor still bidding is flagged, not hidden', () => {
    const fit = scoreTarget({ name: 'Palm Hotel', buyer: 'contractor_bidding' }, ICP)
    expect(fit.flags.join(' ')).toMatch(/wait for the award/)
    expect(fit.score).toBeLessThan(scoreTarget({ name: 'Palm Hotel', buyer: 'contractor_awarded' }, ICP).score)
  })

  it('a large package warns on the core track and is a growth target on the broader one', () => {
    const core = scoreTarget({ name: 'Grand Resort', value_sar: 9_000_000 }, ICP)
    expect(core.flags.join(' ')).toMatch(/qualify hard/)
    const broader = scoreTarget({ name: 'Interiors package', track: 'broader', segment: 'fitout', value_sar: 9_000_000 }, ICP)
    expect(broader.flags).toEqual([])
    expect(broader.reasons.join(' ')).toMatch(/growth target/)
  })

  it('names the red flag and what to ask', () => {
    const fit = scoreTarget({ name: 'School block', detail: 'Approved vendor list issued by the consultant' }, ICP)
    expect(fit.flags[0]).toBe('Specified brand — ask for the vendor list first')
  })

  it('a red flag the lens itself reported is kept', () => {
    const fit = scoreTarget({ name: 'School block', red_flags: 'Local content rule applies' }, ICP)
    expect(fit.flags).toContain('Local content rule applies')
  })

  it('never goes below zero or above a hundred', () => {
    expect(scoreTarget({}, ICP).score).toBe(0)
    expect(scoreTarget({ name: 'x', buyer: 'contractor_bidding', detail: 'specified brand' }, ICP).score).toBe(0)
  })
})

describe('the ICP editor round-trips', () => {
  it('writes the ICP as lines and reads it back unchanged', () => {
    const once = normaliseIcp({
      ...ICP,
      buyers: [...ICP.buyers.slice(0, 1), { key: 'contractor_bidding', weight: -2, note: 'wait for the award' }],
      ask_first: ['Target price?'],
      pains: [{ pain: 'Slow submittals', angle: 'Submittal pack in 48 hours' }],
    })
    expect(formToIcp(icpToForm(once), once)).toEqual(once)
  })

  it('reads a segment a person typed', () => {
    const icp = formToIcp({ segments: 'Fit-out companies | broader | 2 | fit-out, interiors', core: '50' })
    expect(icp.segments[0]).toMatchObject({ key: 'fit_out_companies', track: 'broader', weight: 2, match: ['fit-out', 'interiors'] })
  })
})

describe('the page and the lens read the same ICP', () => {
  it('ranks by track, strongest first, and keeps the unplaced apart', () => {
    const out = rankTargets([
      { id: 1, name: 'Some warehouse' },
      { id: 2, name: 'Palm Hotel', buyer: 'contractor_awarded' },
      { id: 3, name: 'Old School' },
      { id: 4, name: 'Interiors fit-out house', track: 'broader' },
    ], ICP)
    expect(out.core.map(r => r.id)).toEqual([2, 3])
    expect(out.broader.map(r => r.id)).toEqual([4])
    expect(out.other.map(r => r.id)).toEqual([1])
  })

  it('briefs the lens in plain lines with the keys it must use', () => {
    const text = icpPromptText(ICP)
    expect(text).toMatch(/CORE TRACK/)
    expect(text).toMatch(/BROADER TRACK/)
    expect(text).toContain('[segment key: hotels]')
    expect(text).toContain('[buyer key: contractor_bidding]')
    expect(text).toMatch(/best under 500k SAR/)
  })
})
