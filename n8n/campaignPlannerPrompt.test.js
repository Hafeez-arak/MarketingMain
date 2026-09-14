import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode } from './workflowHarness'

// ─── Campaign Planner: what the month is planned against ───────────────────
// The planner is told about the brand's own research, the research agent's
// memory, and the posts already made. None of it can be seen in the output —
// a plan written without it still looks like a plan — so the prompt itself is
// what gets checked.
//
// Runs the generated Code node — regenerate (python3 gen_workflows.py) first.

const BUILD = loadCodeNode('Arak Campaign Planner', 'Build Prompt')

async function build(extra = {}) {
  const body = {
    goal: 'A well-rounded month', platforms: ['instagram'],
    start_date: '2026-10-01', end_date: '2026-10-31', instructions: 'BRAND: Arak Lighting',
    ...extra,
  }
  const { items } = await runCodeNode(BUILD, { env: {}, input: { body } })
  return items[0].json
}

describe('Campaign Planner prompt', () => {
  it('carries the research headline, findings and proposed ideas with their reasons', async () => {
    const out = await build({
      research: {
        date: '2026-09-12',
        headline: 'SASO enforcement moves to 1 December',
        findings: ['SASO-2663:2025 is enforced from 1 December 2026'],
        ideas: [{ title: 'What the SASO standards change for your BOQ', angle: 'For MEP contractors', rationale: 'Answers the SASO finding' }],
      },
    })
    expect(out.prompt_variable).toContain("LATEST RESEARCH FROM THIS BRAND'S RESEARCH AGENT (2026-09-12)")
    expect(out.prompt_variable).toContain('SASO enforcement moves to 1 December')
    expect(out.prompt_variable).toContain('SASO-2663:2025 is enforced')
    expect(out.prompt_variable).toContain('What the SASO standards change for your BOQ — For MEP contractors [why: Answers the SASO finding]')
  })

  it('carries the agent memory and the recent posts as things not to repeat', async () => {
    const out = await build({
      agent_memory: '## IDEAS YOU HAVE ALREADY PROPOSED\n- How Solitaire Mall stayed on programme',
      recent_posts: [{ platform: 'instagram', date: '2026-09-02', topic: 'Ritz Carlton lobby', caption: 'Light that welcomes' }],
    })
    expect(out.prompt_variable).toContain("RESEARCH AGENT'S MEMORY")
    expect(out.prompt_variable).toContain('How Solitaire Mall stayed on programme')
    expect(out.prompt_variable).toContain('POSTS ALREADY MADE RECENTLY')
    expect(out.prompt_variable).toContain('[instagram, 2026-09-02] Ritz Carlton lobby — "Light that welcomes"')
  })

  it('keeps the per-request material out of the cached prefix', async () => {
    const out = await build({ research: { headline: 'Unique headline 123' }, agent_memory: 'memory 456' })
    expect(out.prompt_cached).not.toContain('Unique headline 123')
    expect(out.prompt_cached).not.toContain('memory 456')
  })

  it('adds no empty sections when there is nothing to say', async () => {
    const out = await build({ research: { headline: '', findings: [], ideas: [] }, agent_memory: '', recent_posts: [] })
    expect(out.prompt_variable).not.toContain('LATEST RESEARCH')
    expect(out.prompt_variable).not.toContain("RESEARCH AGENT'S MEMORY")
    expect(out.prompt_variable).not.toContain('POSTS ALREADY MADE RECENTLY')
  })
})
