import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode } from './workflowHarness'

// ─── Campaign Planner: the async contract and the chosen research ideas ────
//
// Two changes land here and both are about things that used to fail silently.
//
// ASYNC. The workflow answers 202 and writes the plan onto the row itself.
// The only thing that ever moves a plan off status 'generating' is the save
// node at the end, so EVERY failure has to arrive there as data. The parse
// node used to `throw`, which skipped it — survivable when the browser was
// still holding the request and could show the error, and not survivable now:
// the plan would spin forever with no reason attached and no safe way to
// retry. These tests are the guard on that.
//
// CHOSEN IDEAS. A person ticks research ideas on the setup step and each one
// is expected to come back as a real post carrying `from_research`, which is
// what stamps plan_ideas.source and keeps the finding attached to the post
// months later when its analytics arrive. A `from_research` the model made up
// would mark a post as evidence-backed when it is not — a provenance mark
// that lies is worse than none — so the parser only keeps titles that match.
//
// Runs the GENERATED Code nodes — regenerate (python3 gen_workflows.py) first.

const BUILD = loadCodeNode('Arak Campaign Planner', 'Build Prompt')
const PARSE_SRC = loadCodeNode('Arak Campaign Planner', 'Parse & Validate Plan')

async function build(extra = {}) {
  const body = {
    goal: 'A well-rounded month', platforms: ['instagram'],
    start_date: '2026-10-01', end_date: '2026-10-31', plan_id: 'plan-abc',
    ...extra,
  }
  const { items } = await runCodeNode(BUILD, { env: {}, input: { body } })
  return items[0].json
}

// Run the parse node against a raw Anthropic-shaped reply.
async function parseReply(reply, bounds = {}) {
  const b = {
    _start_date: '2026-10-01', _end_date: '2026-10-31', _platforms: ['instagram'],
    _posting_days: [], _default_time: '19:00', _plan_id: 'plan-abc', _chosen_titles: [],
    ...bounds,
  }
  const source = `const $ = () => ({ first: () => ({ json: ${JSON.stringify(b)} }) });\n${PARSE_SRC}`
  const { items } = await runCodeNode(source, { env: {}, input: reply })
  return items[0].json
}

const asPlan = posts => ({ content: [{ type: 'text', text: JSON.stringify({ campaignName: 'October', posts }) }] })
const POST = { platform: 'instagram', date: '2026-10-07', topic: 'Lobby lighting' }

describe('Campaign Planner — the plan row it writes to', () => {
  it('carries plan_id through so the save node knows where the answer goes', async () => {
    expect((await build())._plan_id).toBe('plan-abc')
  })

  it('reports the plan_id on success, so the PATCH targets the right row', async () => {
    const out = await parseReply(asPlan([POST]))
    expect(out).toMatchObject({ _ok: true, plan_id: 'plan-abc' })
  })
})

describe('Campaign Planner — every failure reaches the save node', () => {
  // Each of these used to be a throw, or worse, a silent success.
  it('records unparseable JSON instead of throwing past the save node', async () => {
    const out = await parseReply({ content: [{ type: 'text', text: 'not json at all' }] })
    expect(out._ok).toBe(false)
    expect(out.plan_id).toBe('plan-abc')
    expect(out.error).toMatch(/parse plan JSON/i)
  })

  it('names a truncated plan as a budget problem, not a parse bug', async () => {
    const out = await parseReply({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"posts":[' }] })
    expect(out._ok).toBe(false)
    expect(out.error).toMatch(/cut off/i)
  })

  // `Call Claude` runs onError: continueRegularOutput so an API failure lands
  // here as data. Without this branch it would parse as an empty plan.
  it('reports an Anthropic error rather than treating it as an empty plan', async () => {
    const out = await parseReply({ error: { type: 'overloaded_error', message: 'Overloaded' } })
    expect(out._ok).toBe(false)
    expect(out.error).toMatch(/Overloaded/)
  })

  it('refuses an empty response', async () => {
    const out = await parseReply({ content: [{ type: 'text', text: '   ' }] })
    expect(out._ok).toBe(false)
  })

  // A parsed-but-empty plan is the silent one: it would be written as a
  // perfectly valid result and leave the board blank with no explanation.
  it('refuses a plan that parsed cleanly but has no usable posts', async () => {
    const out = await parseReply(asPlan([]))
    expect(out._ok).toBe(false)
    expect(out.error).toMatch(/no usable posts/i)
  })
})

describe('Campaign Planner — ideas the user chose from the research', () => {
  const chosen = {
    date: '2026-09-19',
    ideas: [{
      title: 'Ramadan lighting guide',
      angle: 'Warm evening scenes',
      rationale: 'Rivals all run Ramadan content and we do not',
      answers: 'No Ramadan content while rivals all run it',
      suggested_format: 'carousel',
    }],
  }

  it('states them as requirements, not as background', async () => {
    const out = await build({ chosen_research_ideas: chosen })
    expect(out.prompt_variable).toContain('IDEAS THE USER CHOSE FROM THE RESEARCH (2026-09-19 run)')
    expect(out.prompt_variable).toContain('REQUIREMENTS, NOT SUGGESTIONS')
    expect(out.prompt_variable).toContain('Ramadan lighting guide — Warm evening scenes')
    expect(out.prompt_variable).toContain('[answers: No Ramadan content while rivals all run it]')
    expect(out.prompt_variable).toContain('[why: Rivals all run Ramadan content and we do not]')
  })

  it('says nothing at all when nothing was ticked', async () => {
    const out = await build()
    expect(out.prompt_variable).not.toContain('IDEAS THE USER CHOSE')
  })

  it('hands the chosen titles to the parser so provenance can be checked', async () => {
    const out = await build({ chosen_research_ideas: chosen })
    expect(out._chosen_titles).toEqual(['ramadan lighting guide'])
  })

  it('keeps from_research on a post that names an idea actually ticked', async () => {
    const out = await parseReply(
      asPlan([{ ...POST, from_research: 'Ramadan lighting guide' }]),
      { _chosen_titles: ['ramadan lighting guide'] },
    )
    expect(out.posts[0].from_research).toBe('Ramadan lighting guide')
  })

  it('strips a from_research the model invented', async () => {
    const out = await parseReply(
      asPlan([{ ...POST, from_research: 'An idea nobody ticked' }]),
      { _chosen_titles: ['ramadan lighting guide'] },
    )
    expect('from_research' in out.posts[0]).toBe(false)
  })

  it('leaves an ordinary post unmarked', async () => {
    const out = await parseReply(asPlan([POST]), { _chosen_titles: ['ramadan lighting guide'] })
    expect('from_research' in out.posts[0]).toBe(false)
  })
})
