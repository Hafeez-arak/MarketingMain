import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode } from './workflowHarness'

// ─── Captions that read like a person wrote them ───────────────────────────
// Two workflows write copy that gets published under the brand's name: Draft
// Copy (the three options offered at plan time) and Caption Studio (the
// rewrites a reviewer asks for). Both got the same two halves of one rule —
// the prompt asking for no em dashes and no model-ish phrasing, and a
// cleaner that strips the dashes the model uses anyway.
//
// The cleaner is the half worth pinning: the prompt half can only be checked
// by reading what reaches Anthropic, but the cleaner is the reason a stray
// dash never reaches the marketer. Runs the generated Code nodes, not a copy
// — regenerate (python3 gen_workflows.py) before running these.

const DRAFT = loadCodeNode('Arak Lighting – Draft Copy', 'Draft Copy')
const STUDIO = loadCodeNode('Arak Lighting – Caption Studio', 'Caption Studio')
const ENV = { ANTHROPIC_API_KEY: 'stub-key' }

function anthropic(reply) {
  const sent = []
  const routes = [['api.anthropic.com/v1/messages', async ({ body }) => {
    sent.push(body)
    return { statusCode: 200, body: { type: 'message', content: [{ type: 'text', text: JSON.stringify(reply) }] } }
  }]]
  return { routes, sent }
}

function promptOf(sent) {
  return (sent[0]?.messages?.[0]?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
}

const DRAFT_BODY = {
  plan_idea_id: 'idea-1', topic: 'Lobby chandelier install', format: 'feed_image', media_type: 'image',
  caption_language: 'both', instructions: 'BRAND: Arak Lighting', brand_name: 'Arak Lighting',
}
const STUDIO_BODY = {
  mode: 'variants', language: 'both', brand_name: 'Arak Lighting',
  context: { topic: 'Lobby chandelier install', instructions: 'BRAND: Arak Lighting' },
}

async function draft(reply, body = DRAFT_BODY) {
  const { routes, sent } = anthropic(reply)
  const { items } = await runCodeNode(DRAFT, { env: ENV, input: { body }, routes })
  return { out: items?.json ?? items?.[0]?.json, prompt: promptOf(sent) }
}

async function studio(reply, body = STUDIO_BODY) {
  const { routes, sent } = anthropic(reply)
  const { items } = await runCodeNode(STUDIO, { env: ENV, input: { body }, routes })
  return { out: items?.json ?? items?.[0]?.json, prompt: promptOf(sent) }
}

const captions = (...pairs) => ({
  caption_options: pairs.map(([ar, en]) => ({ caption_ar: ar, caption_en: en })),
  media_prompt_options: [{ media_prompt: 'x' }, { media_prompt: 'y' }, { media_prompt: 'z' }],
})
const three = (ar, en) => captions([ar, en], ['ب', 'b'], ['ج', 'c'])

describe('the prompt asks for a human voice', () => {
  it('bans the em dash in Draft Copy, inside the cached block', async () => {
    const { routes, sent } = anthropic(three('أ', 'a'))
    await runCodeNode(DRAFT, { env: ENV, input: { body: DRAFT_BODY }, routes })
    const cached = sent[0].messages[0].content.find(b => b.cache_control)
    expect(cached.text).toContain('NEVER use an em dash')
    expect(cached.text).toContain('HOW THE COPY MUST SOUND')
  })

  it('bans it in Caption Studio too', async () => {
    const { prompt } = await studio({ variants: [{ caption_ar: 'أ', caption_en: 'a', hashtags: '#x' }] })
    expect(prompt).toContain('NEVER use an em dash')
  })

  // A model copies the punctuation it is reading. A ban typed with the very
  // character it bans is the one way to lose this on the prompt side.
  it('states the rule without using a dash itself', async () => {
    const { prompt } = await draft(three('أ', 'a'))
    const rules = prompt.slice(prompt.indexOf('HOW THE COPY MUST SOUND'))
    const banBlock = rules.slice(0, rules.indexOf('PRECEDENCE'))
    // The two mentions of the characters themselves are the ban naming them.
    expect((banBlock.match(/[—–]/g) || []).length).toBe(2)
  })
})

describe('a dash the model wrote anyway never reaches the marketer', () => {
  it('turns it into a comma in an English caption', async () => {
    const { out } = await draft(three('أ', 'Soft light — all evening.'))
    expect(out.caption_options[0].caption_en).toBe('Soft light, all evening.')
  })

  it('uses an Arabic comma in an Arabic caption', async () => {
    const { out } = await draft(three('ضوء ناعم — طوال المساء', 'a'))
    expect(out.caption_options[0].caption_ar).toBe('ضوء ناعم، طوال المساء')
  })

  it('does not double up punctuation it lands next to', async () => {
    const { out } = await draft(three('أ', 'Warm, — and quiet.'))
    expect(out.caption_options[0].caption_en).toBe('Warm, and quiet.')
  })

  it('drops one opening a line as a bullet, or closing a line', async () => {
    const { out } = await draft(three('أ', '— Warm light\nQuiet rooms —'))
    expect(out.caption_options[0].caption_en).toBe('Warm light\nQuiet rooms')
  })

  it('leaves a divider line alone — that is the bilingual separator', async () => {
    const { out } = await draft(three('أ', 'Warm light\n\n—\n\nضوء دافئ'))
    expect(out.caption_options[0].caption_en).toBe('Warm light\n\n—\n\nضوء دافئ')
  })

  it('catches the en dash as well', async () => {
    const { out } = await draft(three('أ', 'Light – and shadow.'))
    expect(out.caption_options[0].caption_en).toBe('Light, and shadow.')
  })

  it('cleans Caption Studio variants', async () => {
    const { out } = await studio({ variants: [{ caption_ar: 'ضوء — دافئ', caption_en: 'Light — warm', hashtags: '#a #b' }] })
    expect(out.variants[0]).toMatchObject({ caption_ar: 'ضوء، دافئ', caption_en: 'Light, warm', hashtags: '#a #b' })
  })

  it('cleans a single regenerated piece', async () => {
    const body = { ...STUDIO_BODY, mode: 'piece', piece: 'hook' }
    const { out } = await studio({ value_ar: 'ضوء — دافئ', value_en: 'Light — warm' }, body)
    expect(out).toMatchObject({ ok: true, piece: 'hook', value_ar: 'ضوء، دافئ', value_en: 'Light, warm', value: '' })
  })
})
