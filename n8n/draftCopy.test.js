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

// ─── Reading the reply ─────────────────────────────────────────────────────
// The first live captions-from-the-picture run (2026-09-14) came back as "No
// caption options returned by the model." with nothing else to go on. Every
// reply shape below used to end the same way.

async function draftWithReply(body, text, extra = {}) {
  const routes = [['api.anthropic.com/v1/messages', async () =>
    ({ statusCode: 200, body: { type: 'message', stop_reason: 'end_turn', ...extra, content: [{ type: 'text', text }] } })]]
  const { items } = await runCodeNode(DRAFT, { env: ENV, input: { body }, routes })
  return items?.json ?? items?.[0]?.json
}

describe('Draft Copy — reading the reply', () => {
  const CAPTION_ONLY = { ...BASE, caption_only: true, image_urls: ['https://cdn.test/a.png'] }

  it('reads a reply with // comments copied into it', async () => {
    const out = await draftWithReply(CAPTION_ONLY,
      '{"caption_options":[{"caption_ar":"أ","caption_en":"a"},{"caption_ar":"ب","caption_en":"b"},{"caption_ar":"ج","caption_en":"c"}]  // exactly 3\n,"media_prompt_options":[]  // leave empty\n}')
    expect(out._ok).toBe(true)
    expect(out.caption_options).toHaveLength(3)
  })

  it('reads a caption with a raw line break and keeps the line break', async () => {
    const out = await draftWithReply(CAPTION_ONLY,
      '{"caption_options":[{"caption_ar":"سطر أول\nسطر ثان","caption_en":"line one\nline two"},{"caption_ar":"ب","caption_en":"b"},{"caption_ar":"ج","caption_en":"c"}],"media_prompt_options":[]}')
    expect(out._ok).toBe(true)
    expect(out.caption_options[0].caption_en).toBe('line one\nline two')
  })

  it('reads a reply with a trailing comma', async () => {
    const out = await draftWithReply(CAPTION_ONLY,
      '{"caption_options":[{"caption_ar":"أ","caption_en":"a"},{"caption_ar":"ب","caption_en":"b"},{"caption_ar":"ج","caption_en":"c"},],"media_prompt_options":[],}')
    expect(out._ok).toBe(true)
    expect(out.caption_options).toHaveLength(3)
  })

  it('does not treat // inside a caption as a comment', async () => {
    const out = await draftWithReply(CAPTION_ONLY,
      '{"caption_options":[{"caption_ar":"أ","caption_en":"See https://arak-sa.com today"},{"caption_ar":"ب","caption_en":"b"},{"caption_ar":"ج","caption_en":"c"}],"media_prompt_options":[]}')
    expect(out.caption_options[0].caption_en).toBe('See https://arak-sa.com today')
  })

  it('says what the model replied when no captions come back', async () => {
    const out = await draftWithReply(CAPTION_ONLY, "I can't see an image attached, so I can't describe it.")
    expect(out._ok).toBe(false)
    expect(out.error).toContain('No caption options returned by the model.')
    expect(out.error).toContain('Reply began: "I can\'t see an image attached')
  })

  it('says when the reply was cut off', async () => {
    const out = await draftWithReply(CAPTION_ONLY, '{"caption_options":[{"caption_ar":"أ', { stop_reason: 'max_tokens' })
    expect(out.error).toContain('(cut off at max_tokens)')
  })
})

describe('Draft Copy — the captions-only prompt', () => {
  it('never tells the model the post has no image while one is attached', async () => {
    const { text } = await draft({ ...BASE, caption_only: true, image_urls: ['https://cdn.test/a.png'] })
    expect(text).toContain('PICTURE IS ATTACHED ABOVE')
    expect(text).not.toContain('no image or video')
    expect(text).toContain('No image prompts')
  })

  it('puts no // comments in the JSON template', async () => {
    for (const body of [{ ...BASE, caption_only: true }, { ...BASE }, { ...BASE, media_type: 'video', format: 'reel' }]) {
      const { text } = await draft(body)
      const template = text.slice(text.indexOf('EXACTLY this shape:'))
      expect(template).not.toContain('//')
      expect(() => JSON.parse(template.slice(template.indexOf('{')))).not.toThrow()
    }
  })
})

// ─── LinkedIn ──────────────────────────────────────────────────────────────
describe('Draft Copy — LinkedIn', () => {
  const LI_TEXT = { ...BASE, platform: 'linkedin', format: 'text', media_type: 'none', caption_only: true }

  it('writes for LinkedIn, with its rules, in the uncached half only', async () => {
    const { content, text } = await draft(LI_TEXT, { caption_options: THREE_CAPTIONS.caption_options })
    expect(content[0].text).toContain('ONE LinkedIn post')
    expect(content[0].text).not.toContain('HOW A LINKEDIN POST WORKS')
    expect(text).toContain('HOW A LINKEDIN POST WORKS')
    expect(text).toContain('about 210 characters, before "…see more"')
    expect(text).toContain('This is a text post: there is no picture or video')
  })

  it('leaves an Instagram prompt without any of it', async () => {
    const { content, text } = await draft({ ...BASE, caption_only: true }, { caption_options: THREE_CAPTIONS.caption_options })
    expect(content[0].text).toContain('ONE Instagram post')
    expect(text).not.toContain('LINKEDIN')
  })

  it('tells the writer what the poll asks', async () => {
    const { text } = await draft({ ...LI_TEXT, format: 'poll', poll: { question: 'Which matters most?', options: ['Energy', 'Glare'] } },
      { caption_options: THREE_CAPTIONS.caption_options })
    expect(text).toContain('This post is a POLL')
    expect(text).toContain('asking: "Which matters most?" with the answers "Energy", "Glare"')
    expect(text).not.toContain('This is a text post')
  })

  it('never puts a dash in the rules it adds', async () => {
    const { text } = await draft(LI_TEXT, { caption_options: THREE_CAPTIONS.caption_options })
    const rules = text.slice(text.indexOf('HOW A LINKEDIN POST WORKS'), text.indexOf('Write:'))
    expect(rules).not.toMatch(/[–—]/)
  })

  it('treats an unknown platform as Instagram', async () => {
    const { content } = await draft({ ...BASE, platform: 'snapchat', caption_only: true }, { caption_options: THREE_CAPTIONS.caption_options })
    expect(content[0].text).toContain('ONE Instagram post')
  })
})

// ─── TikTok ────────────────────────────────────────────────────────────────
describe('Draft Copy — TikTok', () => {
  const TT_VIDEO = { ...BASE, platform: 'tiktok', format: 'video', media_type: 'video', caption_only: true }

  it('writes for TikTok, with its rules, in the uncached half only', async () => {
    const { content, text } = await draft(TT_VIDEO, { caption_options: THREE_CAPTIONS.caption_options })
    expect(content[0].text).toContain('ONE TikTok post')
    expect(content[0].text).not.toContain('HOW A TIKTOK POST WORKS')
    expect(text).toContain('HOW A TIKTOK POST WORKS')
    expect(text).toContain('The video is the star')
    expect(text).not.toContain('LINKEDIN')
  })

  it('tells a photo carousel caption to invite the swipe, not the video advice', async () => {
    const { text } = await draft({ ...TT_VIDEO, format: 'photo_carousel', media_type: 'image' }, { caption_options: THREE_CAPTIONS.caption_options })
    expect(text).toContain('The photos are swiped through')
    expect(text).not.toContain('The video is the star')
  })

  it('never puts a dash in the rules it adds', async () => {
    const { text } = await draft(TT_VIDEO, { caption_options: THREE_CAPTIONS.caption_options })
    const rules = text.slice(text.indexOf('HOW A TIKTOK POST WORKS'), text.indexOf('Write:'))
    expect(rules).not.toMatch(/[–—]/)
  })

  it('leaves an Instagram prompt without any of it', async () => {
    const { text } = await draft({ ...BASE, caption_only: true }, { caption_options: THREE_CAPTIONS.caption_options })
    expect(text).not.toContain('TIKTOK')
  })
})
