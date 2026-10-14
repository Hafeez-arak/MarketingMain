import { describe, it, expect } from 'vitest'
import { planDraftFromPlan, planAwaitsGeneration } from './campaignPlan'

// Opening a plan n8n is still writing used to drop the wait: the draft had no
// generatingPlanId, so the planner never read the result.
describe('planDraftFromPlan — a plan still generating', () => {
  const plan = { id: 'p1', name: 'November', platforms: ['instagram'] }

  it('resumes the wait for a plan marked generating', () => {
    const d = planDraftFromPlan({ ...plan, status: 'generating', generation_mode: 'more' }, [])
    expect(d).toMatchObject({ generatingPlanId: 'p1', generatingMode: 'more', planId: 'p1' })
  })

  it('resumes for a finished result nobody has consumed, whatever the status', () => {
    const d = planDraftFromPlan({ ...plan, status: 'draft', generation_result: { posts: [{ topic: 'x' }] } }, [])
    expect(d.generatingPlanId).toBe('p1')
    expect(d.generatingMode).toBe('new')
  })

  it('clears any stale wait for an ordinary plan', () => {
    expect(planDraftFromPlan({ ...plan, status: 'active' }, []).generatingPlanId).toBeNull()
    expect(planAwaitsGeneration({ status: 'draft', generation_result: { posts: [] } })).toBe(false)
    expect(planAwaitsGeneration(null)).toBe(false)
  })
})
