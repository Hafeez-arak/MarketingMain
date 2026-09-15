import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./supabaseClient', () => ({ SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon' }))
vi.mock('./creativeStudio', () => ({ finalizeVersion: vi.fn(() => Promise.resolve()) }))

const { publishIdeasAsPosts, sendVersionToPosts, SENDABLE_PLATFORMS } = await import('./studioBridge')

// ─── Plan ideas → post rows, with LinkedIn in the plan ─────────────────────
// Before 2026-09-15 LinkedIn had no entry in the table map, so finalising a
// plan dropped every LinkedIn post with "no platform to post to". These pin
// what a LinkedIn row now carries, and that LinkedIn stays drafts-only.

let writes
beforeEach(() => {
  writes = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET'
    if (method === 'GET') return { ok: true, json: async () => [] }   // no existing row for the idea
    const body = JSON.parse(opts.body)
    writes.push({ method, url, body })
    return { ok: true, json: async () => [{ id: `row-${writes.length}`, ...body }] }
  }))
})
afterEach(() => vi.unstubAllGlobals())

const idea = over => ({
  id: 'idea-1', title: 'SASO for contractors', topic: 'SASO', platform: 'linkedin',
  postFormat: 'text', mediaType: 'none', captionEn: 'The standard changes on 1 December.', date: '2026-10-06', time: '19:00',
  ...over,
})

describe('publishIdeasAsPosts — LinkedIn', () => {
  it('writes a LinkedIn text post as a draft with its format and no media', async () => {
    const res = await publishIdeasAsPosts('ws-1', 'tok', 'plan-1', [idea()])
    expect(res.errors).toEqual([])
    expect(writes).toHaveLength(1)
    expect(writes[0].body).toMatchObject({
      platform: 'linkedin', format: 'text', media_type: 'none', post_kind: 'text_only',
      status: 'pending_review', caption: 'The standard changes on 1 December.',
    })
  })

  it('carries a complete poll and the first comment into platform_options', async () => {
    const poll = { question: 'Which matters most?', options: ['Energy', 'Glare'], duration: 'THREE_DAYS' }
    await publishIdeasAsPosts('ws-1', 'tok', 'plan-1', [idea({ postFormat: 'poll', firstComment: 'Details: arak-sa.com', platformOptions: { poll } })])
    expect(writes[0].body.format).toBe('poll')
    expect(writes[0].body.platform_options).toEqual({ firstComment: 'Details: arak-sa.com', poll })
  })

  it('refuses a poll with no question rather than write a post that cannot publish', async () => {
    const res = await publishIdeasAsPosts('ws-1', 'tok', 'plan-1', [idea({ postFormat: 'poll', platformOptions: { poll: { question: '', options: ['a', 'b'] } } })])
    expect(writes).toHaveLength(0)
    expect(res.error).toContain('the poll needs a question')
  })

  it('stores a multi-image post as a carousel', async () => {
    await publishIdeasAsPosts('ws-1', 'tok', 'plan-1', [idea({
      postFormat: 'multi_image', mediaType: 'image', imageMode: 'use_reference', references: ['https://cdn.test/1.png', 'https://cdn.test/2.png'],
    })])
    expect(writes[0].body).toMatchObject({ format: 'multi_image', post_kind: 'carousel', media_type: 'image' })
    expect(writes[0].body.image_urls).toHaveLength(2)
  })

  it('sends a text post to LinkedIn and refuses the Instagram copy of it', async () => {
    const res = await publishIdeasAsPosts('ws-1', 'tok', 'plan-1', [idea({ platforms: ['linkedin', 'instagram'] })])
    expect(writes.map(w => w.body.platform)).toEqual(['linkedin'])
    expect(res.errors.join(' ')).toContain('(instagram): instagram has no format for a post without media')
  })

  it('gives an Instagram reel also sent to LinkedIn LinkedIn’s video format', async () => {
    await publishIdeasAsPosts('ws-1', 'tok', 'plan-1', [idea({
      platform: 'instagram', platforms: ['instagram', 'linkedin'], postFormat: 'reel', mediaType: 'video', previewVideoUrl: 'https://cdn.test/v.mp4',
    })])
    expect(writes.map(w => [w.body.platform, w.body.format])).toEqual([['instagram', 'reel'], ['linkedin', 'video']])
  })

  it('leaves an Instagram post as it was', async () => {
    await publishIdeasAsPosts('ws-1', 'tok', 'plan-1', [idea({ platform: 'instagram', postFormat: 'feed_image', mediaType: 'image', previewImageUrl: 'https://cdn.test/a.png' })])
    expect(writes[0].body).toMatchObject({ platform: 'instagram', format: 'feed_image', media_type: 'image', post_kind: 'caption_image' })
    expect(writes[0].body.platform_options).toBeUndefined()
  })
})

describe('sendVersionToPosts — LinkedIn is drafts only', () => {
  const version = { id: 'v1', image_url: 'https://cdn.test/a.png', is_final: true }

  it('is offered as a target', () => {
    expect(SENDABLE_PLATFORMS).toContain('linkedin')
  })

  it('queues a LinkedIn post for review', async () => {
    const res = await sendVersionToPosts('ws-1', 'tok', { version, targets: ['linkedin'], caption: 'x', when: { mode: 'queue' } })
    expect(res.ok).toBe(true)
    expect(writes[0].body).toMatchObject({ platform: 'linkedin', status: 'pending_review' })
  })

  it('refuses to publish or schedule to LinkedIn before writing anything', async () => {
    for (const mode of ['now', 'schedule']) {
      const res = await sendVersionToPosts('ws-1', 'tok', { version, targets: ['linkedin'], caption: 'x', when: { mode, at: '2026-10-06T19:00' } })
      expect(res.error).toContain('drafts only')
    }
    expect(writes).toHaveLength(0)
  })

  it('still publishes to Instagram alongside a refused LinkedIn', async () => {
    const res = await sendVersionToPosts('ws-1', 'tok', { version, targets: ['instagram', 'linkedin'], caption: 'x', when: { mode: 'now' } })
    expect(writes.map(w => w.body.platform)).toEqual(['instagram'])
    expect(res.warning).toContain('linkedin: drafts only')
  })
})
