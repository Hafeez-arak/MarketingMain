import { describe, it, expect } from 'vitest'
import {
  normaliseIcp, scoreTarget, parseAmount, formatAmount, icpPromptText, rankTargets, hasIcp, icpToForm, formToIcp,
  packageEstimate, parseShare, icpFitText,
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
    expect(core.flags.join(' ')).toMatch(/too big as one job/)
    const broader = scoreTarget({ name: 'Interiors package', track: 'broader', segment: 'fitout', value_sar: 9_000_000 }, ICP)
    expect(broader.reasons.join(' ')).toMatch(/growth target/)
    // Still told to find the piece that fits — growth is not a licence to
    // pitch a whole programme.
    expect(broader.flags.join(' ')).toMatch(/find the package/)
  })

  it('a value just over the line is worth a call, not a programme', () => {
    const fit = scoreTarget({ name: 'Palm Hotel', value_sar: 3_000_000 }, ICP)
    expect(fit.reasons.join(' ')).toMatch(/worth a call/)
    expect(fit.flags).toEqual([])
  })

  describe('share of a project', () => {
    const WITH_SHARE = { ...ICP, share: { min: 3, max: 5 } }

    it('scores a project on our estimated share, not its headline value', () => {
      // SAR 15M project → our share 450k–750k: the size we win most.
      const fit = scoreTarget({ name: 'School block', value_sar: 'SAR 15 million' }, WITH_SHARE)
      expect(fit.reasons.join(' ')).toMatch(/15M SAR project, our share about 450k–750k SAR — the size we win most/)
    })

    it('without a share, the same value is a package that is far too big', () => {
      const fit = scoreTarget({ name: 'School block', value_sar: 'SAR 15 million' }, ICP)
      expect(fit.flags.join(' ')).toMatch(/too big as one job/)
    })

    it('a giga-project with a named package is pointed at the package', () => {
      const fit = scoreTarget({
        name: 'Diriyah hotels', value_sar: 2_729_000_000, package: 'Hotel 3 guest-room controls — held by UCC Saudi',
      }, WITH_SHARE)
      expect(fit.reasons.join(' ')).toMatch(/go for: Hotel 3 guest-room controls/)
      expect(fit.flags).toEqual([])
    })

    it('a stated package value beats the estimate, and value_kind=package skips it', () => {
      const stated = scoreTarget({ name: 'X Hotel', value_sar: 2_000_000_000, package_value_sar: '400k' }, WITH_SHARE)
      expect(stated.reasons.join(' ')).toMatch(/^.*400k SAR — the size we win most/)
      const asPackage = scoreTarget({ name: 'X Hotel', value_sar: '450k', value_kind: 'package' }, WITH_SHARE)
      expect(asPackage.reasons.join(' ')).toMatch(/450k SAR — the size we win most/)
    })

    it('an old target with no value_kind and a package-sized value is read as a package', () => {
      const fit = scoreTarget({ name: 'Palm Hotel', value_sar: 450_000 }, WITH_SHARE)
      expect(fit.reasons.join(' ')).toMatch(/^.*450k SAR — the size we win most/)
      expect(fit.reasons.join(' ')).not.toMatch(/our share/)
      // …but one marked as a project is still converted.
      const project = scoreTarget({ name: 'Palm Hotel', value_sar: 1_500_000, value_kind: 'project' }, WITH_SHARE)
      expect(project.reasons.join(' ')).toMatch(/our share about 45k–75k SAR/)
    })

    it('a segment can carry its own share', () => {
      const icp = {
        ...WITH_SHARE,
        segments: WITH_SHARE.segments.map(s => (s.key === 'hotels' ? { ...s, share: { min: 8, max: 10 } } : s)),
      }
      const est = packageEstimate({ value_sar: 10_000_000 }, icp, normaliseIcp(icp).segments[0])
      expect(est).toMatchObject({ min: 800_000, max: 1_000_000, estimated: true })
    })

    it('tells the lens which project sizes land in our range', () => {
      expect(icpPromptText(WITH_SHARE)).toMatch(/3–5% of a project's total value.*10M SAR to 66.7M SAR in total/)
    })

    it('round-trips through the editor', () => {
      const form = icpToForm({ ...WITH_SHARE, share: { min: 3, max: 5, note: 'hotels run higher' } })
      expect(form.share).toBe('3-5')
      expect(formToIcp(form, WITH_SHARE).share).toEqual({ min: 3, max: 5, note: 'hotels run higher' })
      expect(parseShare('3–5%')).toEqual({ min: 3, max: 5, note: '' })
      expect(parseShare('nonsense')).toBeNull()
    })
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

describe('offers and when we are hired (2026-10-20)', () => {
  const raw = {
    summary: 'x',
    offers: [{ label: 'Yearly care contract', kind: 'recurring', note: 'n' }, { key: 'build', label: 'Design and build' }],
    hire_stage: 'Late, near handover.',
  }

  it('normalises offers, defaulting to one-off and slugging a missing key', () => {
    const icp = normaliseIcp(raw)
    expect(icp.offers).toEqual([
      { key: 'yearly_care_contract', label: 'Yearly care contract', kind: 'recurring', note: 'n' },
      { key: 'build', label: 'Design and build', kind: 'one_off', note: '' },
    ])
    expect(icp.hire_stage).toBe('Late, near handover.')
  })

  it('puts the hire stage in the fit text the openings lens reads, ahead of size', () => {
    const text = icpFitText(raw)
    expect(text.startsWith('WHEN WE ARE HIRED: Late, near handover.')).toBe(true)
    expect(text).toMatch(/outranks any general advice/)
  })

  it('lists what we sell in the targets prompt', () => {
    expect(icpPromptText(raw)).toContain('- Yearly care contract (recurring: a yearly contract) — n')
  })

  it('round-trips through the editor and keeps an offer key across a save', () => {
    const form = icpToForm(raw)
    expect(form.offers).toBe('Yearly care contract | recurring | n\nDesign and build | one-off')
    const back = formToIcp(form, raw)
    expect(back.offers.map(o => [o.key, o.kind])).toEqual([['yearly_care_contract', 'recurring'], ['build', 'one_off']])
    expect(back.hire_stage).toBe('Late, near handover.')
  })

  it('leaves an older ICP without them untouched', () => {
    const icp = normaliseIcp({ summary: 'x' })
    expect(icp.offers).toEqual([])
    expect(icpFitText({ summary: 'x' })).toBe('')
  })
})
