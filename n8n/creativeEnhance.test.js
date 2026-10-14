import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode } from './workflowHarness'

// ─── Creative Enhance ──────────────────────────────────────────────────────
// Rewrites a rough brief into an image prompt and, on the same call, reports
// where the brief contradicts a brand default. Anthropic is stubbed: nothing
// here reaches a model.
//
// What this pins: image mode reads the DRAWING rules, not the caption ones.
// The shared PROMPT_RULES end with "say so in post_strategy" and "end with a
// soft call to action" — caption mechanics that, in a picture prompt, read as
// an instruction to letter a CTA into the scene — and image mode must tell the
// model the logo goes on afterwards rather than painting one.

const ENHANCE = loadCodeNode('Arak Lighting – Creative Enhance', 'Enhance Prompt')
const ENV = { ANTHROPIC_API_KEY: 'stub-anthropic-key' }

async function enhance(body, answer = { prompt: 'A warm lobby at dusk', conflicts: [] }) {
  return runCodeNode(ENHANCE, {
    env: ENV,
    input: { body },
    routes: [['api.anthropic.com', async () => ({
      statusCode: 200,
      body: { type: 'message', content: [{ type: 'text', text: JSON.stringify(answer) }] },
    })]],
  })
}
const systemText = calls => calls[0].body.messages[0].content[0].text

describe('Creative Enhance — image mode', () => {
  it('drops the caption-only rules', async () => {
    const { calls } = await enhance({ mode: 'image', prompt: 'hotel lobby', instructions: 'BRAND: Arak Lighting' })
    const prefix = systemText(calls)
    expect(prefix).not.toContain('soft call to action')
    expect(prefix).not.toContain('post_strategy')
    // The precedence order itself is still there.
    expect(prefix).toContain('Brand guardrails always win')
  })

  it('keeps the logo out of the picture', async () => {
    const { calls } = await enhance({ mode: 'image', prompt: 'hotel lobby' })
    expect(systemText(calls)).toContain(
      'Do not put the brand name, wordmark or logo into the picture — logos are added afterwards in the editor.',
    )
  })

  it('returns the conflicts with the prompt', async () => {
    const conflicts = [{ field: 'Brand colours', brandRule: 'warm bronze', promptAsks: 'cool blue' }]
    const { out } = await enhance({ mode: 'image', prompt: 'blue lobby' }, { prompt: 'A cool blue lobby', conflicts })
    expect(out).toMatchObject({ ok: true, prompt: 'A cool blue lobby', conflicts })
  })
})

describe('Creative Enhance — motion mode', () => {
  it('is unchanged: no drawing rules, no caption rules', async () => {
    const { calls } = await enhance({ mode: 'motion', prompt: 'slow pan' })
    const prefix = systemText(calls)
    expect(prefix).toContain('CAMERA MOVEMENT AND MOTION ONLY')
    expect(prefix).not.toContain('logos are added afterwards')
    expect(prefix).not.toContain('soft call to action')
  })
})
