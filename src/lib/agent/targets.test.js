import { describe, it, expect } from 'vitest'
import { lensByKey, lensesFor, makeFinding, targetFinding } from './lenses'
import { LENS_PROMPTS } from './lensPrompts'
import { opportunityFromFinding, planStoreWrites, blankFills } from './intel'
import { countOptional, countProperties } from './schemaLimits.test'

// ─── The targets lens, end to end in pure code ─────────────────────────────
// Sales → Targets (2026-10-07). The lens answers in its own shape, is folded
// back into an ordinary finding with a `lead`, and lands in the same tracker
// every other lead lands in — with the fields the ICP scorer reads.

const raw = {
  headline: 'Contractor awarded the Palm Hotel fit-out',
  detail: 'Award announced on the contractor\'s site.',
  confidence: 0.7,
  suggested_action: 'Call the contractor\'s procurement team; open with samples and a lux study.',
  relevance: 'high',
  sources: [{ url: 'https://example.com/award', title: 'Award' }],
  target: {
    name: 'Palm Hotel', kind: 'project', track: 'core', segment: 'hotels', buyer: 'contractor_awarded',
    client: 'Palm Hospitality', contractor: 'Builder Co', consultant: '', location: 'Riyadh',
    stage: 'awarded', scope: 'fit-out', value_sar: 'SAR 1.2 million', deadline: '', timing: 'unconfirmed',
    why_fit: 'Hotel job held by the contractor.', red_flags: '', contact: 'builderco.example — procurement',
  },
}

describe('the targets lens', () => {
  it('is registered, searches eight times and only runs with an ICP', () => {
    const lens = lensByKey('targets')
    expect(lens.budget.searches).toBe(8)
    expect(lens.requires).toBe('icp')
    expect(lens.schema).toBe('targets')
    expect(lensesFor({ cadence: 'weekly' }).map(l => l.key)).toContain('targets')
  })

  it('leads right after openings for a specification business', () => {
    const keys = lensesFor({ motion: 'specification' }).map(l => l.key)
    expect(keys.indexOf('targets')).toBe(keys.indexOf('openings') + 1)
  })

  it('folds a target into a sales finding with a lead', () => {
    const f = makeFinding('targets', targetFinding(raw))
    expect(f.for_whom).toBe('sales')
    expect(f.lead.name).toBe('Palm Hotel')
    expect(f.lead.type).toBe('project')
    expect(f.lead.buyer).toBe('contractor_awarded')
    expect(makeFinding('targets', targetFinding({ ...raw, target: { ...raw.target, kind: 'company' } })).lead.type).toBe('lead')
    expect(makeFinding('targets', targetFinding({ ...raw, target: { ...raw.target, kind: 'tender' } })).category).toBe('tender')
  })

  it('stores the fields the ICP scorer reads, and the value as a number', () => {
    const opp = opportunityFromFinding(makeFinding('targets', targetFinding(raw)))
    expect(opp).toMatchObject({
      name: 'Palm Hotel', segment: 'hotels', buyer: 'contractor_awarded', track: 'core',
      value_sar: 1_200_000, contact: 'builderco.example — procurement',
    })
  })

  it('a lead from another lens stores blanks, not guesses', () => {
    const opp = opportunityFromFinding(makeFinding('openings', {
      headline: 'x', sources: [{ url: 'https://example.com' }], lead: { name: 'Tower One', buyer: 'nonsense' },
    }))
    expect(opp.buyer).toBe('')
    expect(opp.track).toBe('')
    expect(opp.value_sar).toBeNull()
  })

  it('fills ICP fields on a lead the openings lens found first, without calling it a change', () => {
    const existing = { opportunities: [{ id: 'o1', name: 'Palm Hotel', fingerprint: 'opp|palm hotel', times_seen: 1, contractor: 'Builder Co', client: 'Palm Hospitality', stage: 'awarded', location: 'Riyadh', scope: 'fit-out' }] }
    const plan = planStoreWrites([makeFinding('targets', targetFinding(raw))], existing, { runId: 'r2' })
    const patch = plan.opportunities.update[0].patch
    expect(patch.buyer).toBe('contractor_awarded')
    expect(patch.track).toBe('core')
    expect(patch.last_change).toBeUndefined()
  })

  it('never overwrites an ICP field already filled', () => {
    expect(blankFills({ buyer: 'fitout' }, { buyer: 'contractor_awarded', track: 'core' })).toEqual({ track: 'core' })
  })
})

describe('the targets prompt', () => {
  const brand = { brandName: 'Brand', descriptor: 'what they do', audience: 'who', geography: 'where' }

  it('turns the ICP mix into a search split', () => {
    const text = LENS_PROMPTS.targets(brand, { icp: 'ICP TEXT', mix: { core: 50, broader: 50 }, searches: 8 })
    expect(text).toContain('ICP TEXT')
    expect(text).toMatch(/CORE \(about 4 searches\)/)
    expect(text).toMatch(/BROADER \(about 4 searches\)/)
  })

  it('says outright that the broader track is meant to be unlike the past', () => {
    const text = LENS_PROMPTS.targets(brand, { mix: { core: 70, broader: 30 }, searches: 8 })
    expect(text).toMatch(/CORE \(about 6 searches\)/)
    expect(text).toMatch(/do not skip a target because it is bigger or newer/)
  })

  it('asks for public contacts only', () => {
    expect(LENS_PROMPTS.targets(brand, {})).toMatch(/PUBLIC contact only/)
  })
})

describe('the targets schema stays inside the API limits', () => {
  it('has few optional fields and stays well under the grammar ceiling', async () => {
    const { TARGETS_SCHEMA } = await import('../../../api/agent/_lenses.js')
    expect(countOptional(TARGETS_SCHEMA.schema)).toBeLessThanOrEqual(4)
    // 48 is the largest size measured to compile (schemaLimits.test.js).
    expect(countProperties(TARGETS_SCHEMA.schema)).toBeLessThanOrEqual(40)
  })
})
