import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode } from './workflowHarness'

// ─── Draft Copy: captions written from the finished picture ────────────────
// The planner's captions step runs after the picture exists, and the whole
// point of moving it there is that the model SEES the picture. These tests pin
// what reaches Anthropic, because every way of getting it wrong still returns
// three perfectly plausible captions — just ones written blind.
//
// Runs the generated Code node, not a copy — regenerate (python3
// gen_workflows.py) before running these if you touched the Python.

const DRAFT = loadCodeNode('Arak Lighting – Draft Copy', 'Draft Copy')
const ENV = { ANTHROPIC_API_KEY: 'stub-key' }

function anthropic(reply) {
  const sent = []
  const routes = [['api.anthropic.com/v1/messages', async ({ body }) => {
    sent.push(body)
    return { statusCode: 200, body: { type: 'message', content: [{ type: 'text', text: JSON.stringify(reply) }] } }
  }]]
  return { routes, sent }
}

const THREE_CAPTIONS = {
  caption_options: [
    { caption_ar: 'أ', caption_en: 'a' }, { caption_ar: 'ب', caption_en: 'b' }, { caption_ar: 'ج', caption_en: 'c' },
  ],
  media_prompt_options: [{ media_prompt: 'x' }, { media_prompt: 'y' }, { media_prompt: 'z' }],
}

async function draft(body, reply = THREE_CAPTIONS) {
  const { routes, sent } = anthropic(reply)
  const { items } = await runCodeNode(DRAFT, { env: ENV, input: { body }, routes })
  // This node returns a bare item rather than an array of them.
  const out = items?.json ?? items?.[0]?.json
  const content = sent[0]?.messages?.[0]?.content || []
  return { out, content, images: content.filter(b => b.type === 'image'), text: content.filter(b => b.type === 'text').map(b => b.text).join('\n') }
}

const BASE = {
  plan_idea_id: 'idea-1', topic: 'Lobby chandelier install', format: 'feed_image', media_type: 'image',
  caption_language: 'both', instructions: 'BRAND: Arak Lighting', brand_name: 'Arak Lighting',
}

describe('Draft Copy — the picture', () => {
  it('sends an attached image to the model, after the cached brand block', async () => {
    const { content, images, text } = await draft({ ...BASE, image_urls: ['https://cdn.test/a.png'] })
    expect(images).toEqual([{ type: 'image', source: { type: 'url', url: 'https://cdn.test/a.png' } }])
    // Cached prefix first — an image ahead of it would change the cached bytes per post.
    expect(content[0].cache_control).toBeTruthy()
    expect(content.findIndex(b => b.type === 'image')).toBeGreaterThan(0)
    expect(text).toContain('PICTURE IS ATTACHED ABOVE')
  })

  it('sends at most two images for a carousel', async () => {
    const urls = ['https://cdn.test/1.png', 'https://cdn.test/2.png', 'https://cdn.test/3.png', 'https://cdn.test/4.png']
    const { images, text } = await draft({ ...BASE, format: 'carousel', image_urls: urls })
    expect(images.map(i => i.source.url)).toEqual(urls.slice(0, 2))
    expect(text).toContain('PICTURES ARE ATTACHED ABOVE')
  })

  it('never sends anything for a video post', async () => {
    const { images, text } = await draft({ ...BASE, media_type: 'video', format: 'reel', image_urls: ['https://cdn.test/cover.png'] })
    expect(images).toEqual([])
    expect(text).not.toContain('ATTACHED ABOVE')
  })

  it('drops anything that is not an https URL', async () => {
    const { images } = await draft({ ...BASE, image_urls: ['', 'data:image/png;base64,AAAA', 'http://cdn.test/a.png', 'https://cdn.test/ok.png'] })
    expect(images.map(i => i.source.url)).toEqual(['https://cdn.test/ok.png'])
  })

  it('writes from the brief alone when there is no picture', async () => {
    const { images, text } = await draft({ ...BASE })
    expect(images).toEqual([])
    expect(text).not.toContain('ATTACHED ABOVE')
  })
})

describe('Draft Copy — captions only', () => {
  it('asks for no media prompts and succeeds without them', async () => {
    const { out, text } = await draft({ ...BASE, caption_only: true, image_urls: ['https://cdn.test/a.png'] },
      { caption_options: THREE_CAPTIONS.caption_options })
    expect(out._ok).toBe(true)
    expect(out.caption_options).toHaveLength(3)
    expect(out.media_prompt_options).toEqual([])
    expect(text).toContain('"media_prompt_options":[]')
  })

  it('still asks for media prompts when caption_only is not set (backward compatible)', async () => {
    const { out, text } = await draft({ ...BASE })
    expect(out._ok).toBe(true)
    expect(out.media_prompt_options).toHaveLength(3)
    expect(text).not.toContain('"media_prompt_options":[]')
  })
})
