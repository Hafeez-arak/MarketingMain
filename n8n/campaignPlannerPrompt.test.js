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

// ─── LinkedIn ──────────────────────────────────────────────────────────────
// LinkedIn joined the planner on 2026-09-15. The rulebook for both platforms
// lives in the cached prefix, so a company's second plan in a session still
// reads it cheaply whichever platforms that plan is for; which platforms THIS
// plan is for is the per-request half.

describe('Campaign Planner prompt — platforms', () => {
  it('describes LinkedIn formats and polls in the cached rulebook', async () => {
    const out = await build()
    expect(out.prompt_cached).toContain('linkedin: "text", "image", "multi_image", "video", or "poll"')
    expect(out.prompt_cached).toContain('"poll": ONLY on a linkedin post')
    expect(out.prompt_cached).not.toContain('always exactly "instagram"')
  })

  it('keeps the rulebook identical whichever platforms are asked for', async () => {
    const ig = await build({ platforms: ['instagram'] })
    const both = await build({ platforms: ['instagram', 'linkedin'] })
    expect(both.prompt_cached).toBe(ig.prompt_cached)
  })

  it('names the platforms in the request, and pins a single one', async () => {
    expect((await build({ platforms: ['linkedin'] })).prompt_variable)
      .toContain('PLATFORMS: linkedin (every post\'s "platform" is "linkedin")')
    expect((await build({ platforms: ['instagram', 'linkedin'] })).prompt_variable)
      .toContain('PLATFORMS: instagram, linkedin\n')
  })

  it('drops platforms it cannot plan for, falling back to Instagram', async () => {
    const out = await build({ platforms: ['tiktok', 'snapchat'] })
    expect(out._platforms).toEqual(['instagram'])
    expect((await build({ platforms: ['tiktok', 'linkedin'] }))._platforms).toEqual(['linkedin'])
  })
})

const PARSE_SRC = loadCodeNode('Arak Campaign Planner', 'Parse & Validate Plan')

// The node reads the prompt node's bounds through n8n's $('Build Prompt');
// the harness has no node graph, so that one lookup is supplied here.
async function parse(posts, bounds = {}) {
  const b = { _start_date: '2026-10-01', _end_date: '2026-10-31', _platforms: ['instagram', 'linkedin'], _posting_days: [], _default_time: '19:00', ...bounds }
  const source = `const $ = () => ({ first: () => ({ json: ${JSON.stringify(b)} }) });\n${PARSE_SRC}`
  const reply = { content: [{ type: 'text', text: JSON.stringify({ campaignName: 'October', posts }) }] }
  const { items } = await runCodeNode(source, { env: {}, input: reply })
  return items[0].json.posts
}

const LI = { platform: 'linkedin', date: '2026-10-06', topic: 'SASO changes for contractors' }

describe('Campaign Planner — reading a plan with LinkedIn in it', () => {
  it('keeps each post on its own platform', async () => {
    const posts = await parse([{ ...LI }, { platform: 'instagram', date: '2026-10-07', topic: 'Lobby' }])
    expect(posts.map(p => p.platform)).toEqual(['linkedin', 'instagram'])
  })

  it('drops a post for a platform this plan did not ask for', async () => {
    const posts = await parse([{ ...LI }, { platform: 'instagram', date: '2026-10-07', topic: 'Lobby' }], { _platforms: ['instagram'] })
    expect(posts.map(p => p.platform)).toEqual(['instagram'])
  })

  it('keeps a valid poll, narrowed to what LinkedIn accepts', async () => {
    const [post] = await parse([{ ...LI, suggested_format: 'poll', poll: {
      question: 'Which matters most on a hospitality fit-out?',
      options: ['Energy', 'energy', 'Glare control and visual comfort for guests', 'Cost', 'Speed', 'Warranty'],
    } }])
    expect(post.suggested_format).toBe('poll')
    // Duplicate dropped, long answer cut to 30, fifth and sixth answers cut.
    expect(post.poll.options).toEqual(['Energy', 'Glare control and visual comfo', 'Cost', 'Speed'])
  })

  it('turns a poll with nothing to ask into a text post', async () => {
    const [post] = await parse([{ ...LI, suggested_format: 'poll', poll: { question: '', options: ['a', 'b'] } }])
    expect(post.suggested_format).toBe('text')
    expect(post.poll).toBeUndefined()
  })

  it('gives a text post no picture direction and no orientation', async () => {
    const [post] = await parse([{ ...LI, suggested_format: 'text', suggested_style: 'dramatic', suggested_aspect_ratio: '4:5', design_tip: 'Moody lobby' }])
    expect(post).toMatchObject({ suggested_format: 'text', suggested_style: '', suggested_aspect_ratio: '', design_tip: '' })
  })

  it('treats an unknown LinkedIn format as text, and an unknown Instagram one as a post', async () => {
    const posts = await parse([{ ...LI, suggested_format: 'reel' }, { platform: 'instagram', date: '2026-10-07', topic: 'x', suggested_format: 'poll' }])
    expect(posts.map(p => p.suggested_format)).toEqual(['text', 'post'])
  })

  it('keeps a LinkedIn video orientation only when LinkedIn offers it', async () => {
    const posts = await parse([
      { ...LI, suggested_format: 'video', suggested_aspect_ratio: '16:9' },
      { ...LI, suggested_format: 'image', suggested_aspect_ratio: '9:16' },
    ])
    expect(posts.map(p => p.suggested_aspect_ratio)).toEqual(['16:9', '1.91:1'])
  })
})
