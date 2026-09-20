import { describe, it, expect } from 'vitest'
import { buildPublishRequest } from './publishPost'
import { emptyComposer, setOption } from './composerState'

// What actually goes on the wire. Asserted here rather than only observed in
// production, because two of these are silent failures: TikTok settings in the
// wrong place are ignored rather than rejected, and hashtags sent twice
// duplicate in the published caption.

const composed = (over = {}) => ({
  ...emptyComposer('instagram'),
  accountIds: ['acc_1'],
  caption: 'Warm light over walnut',
  hashtags: '#arak #lighting',
  media: [{ url: 'https://cdn.test/a.jpg', type: 'image', mimeType: 'image/jpeg' }],
  ...over,
})

const opts = { postId: 'p1', workspaceId: 'ws1' }

describe('buildPublishRequest', () => {
  it('folds hashtags into the caption and does not send them twice', () => {
    const req = buildPublishRequest(composed(), opts)

    expect(req.caption).toBe('Warm light over walnut\n\n#arak #lighting')
    // Sending them again would duplicate the tags in the published post,
    // because the workflow joins caption and hashtags when both are present.
    expect(req.hashtags).toBe('')
  })

  it('sends a single image as image_url with no carousel array', () => {
    const req = buildPublishRequest(composed(), opts)
    expect(req.imageUrl).toBe('https://cdn.test/a.jpg')
    expect(req.imageUrls).toBeUndefined()
  })

  it('sends a carousel as an ordered array', () => {
    const media = [
      { url: 'https://cdn.test/1.jpg', type: 'image' },
      { url: 'https://cdn.test/2.jpg', type: 'image' },
    ]
    const req = buildPublishRequest(composed({ format: 'carousel', media }), opts)
    expect(req.imageUrls).toEqual(['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'])
  })

  it('sends a video post as a video and nothing else', () => {
    const media = [{ url: 'https://cdn.test/v.mp4', type: 'video' }]
    const req = buildPublishRequest(composed({ format: 'reel', media }), opts)

    expect(req.videoUrl).toBe('https://cdn.test/v.mp4')
    expect(req.imageUrl).toBeUndefined()
    expect(req.media).toEqual([{ type: 'video', url: 'https://cdn.test/v.mp4' }])
  })

  it('sends a MIXED carousel in order, instead of dropping the pictures', () => {
    // The bug: mediaFields was `if (videos.length) return { videoUrl }`, so a
    // carousel of two pictures and a clip published as the clip alone. The
    // ordered list is what the workflow builds Zernio's mediaItems from.
    const media = [
      { url: 'https://cdn.test/a.jpg', type: 'image' },
      { url: 'https://cdn.test/v.mp4', type: 'video' },
      { url: 'https://cdn.test/b.jpg', type: 'image' },
    ]
    const req = buildPublishRequest(composed({ format: 'carousel', media }), opts)

    expect(req.media).toEqual([
      { type: 'image', url: 'https://cdn.test/a.jpg' },
      { type: 'video', url: 'https://cdn.test/v.mp4' },
      { type: 'image', url: 'https://cdn.test/b.jpg' },
    ])
    // The flat fields stay populated for callers and nodes that predate it.
    expect(req.imageUrls).toEqual(['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'])
    expect(req.videoUrl).toBe('https://cdn.test/v.mp4')
  })

  it('carries Instagram options through as platformSpecificData', () => {
    let s = composed()
    s = setOption(s, 'firstComment', 'Specs below')
    const req = buildPublishRequest(s, opts)

    expect(req.platformSpecificData.firstComment).toBe('Specs below')
    expect(req.tiktokSettings).toBeUndefined()
  })

  // The quirk worth a test: Zernio takes TikTok's settings at the TOP level of
  // the body, not inside platformSpecificData. Getting it wrong is not an
  // error — the block is ignored and the post publishes with TikTok's
  // defaults, which for privacy_level can mean more public than was asked for.
  it('puts TikTok settings at the top level, not inside platformSpecificData', () => {
    let s = { ...composed({ platform: 'tiktok', format: 'video', media: [{ url: 'https://cdn.test/v.mp4', type: 'video' }] }) }
    s = setOption(s, 'privacy_level', 'SELF_ONLY')
    const req = buildPublishRequest(s, opts)

    expect(req.tiktokSettings.privacy_level).toBe('SELF_ONLY')
    expect(req.platformSpecificData).not.toHaveProperty('privacy_level')
    expect(req.tiktokSettings.content_preview_confirmed).toBe(true)
  })

  // Times in a content plan have always meant Riyadh time. Sending the
  // browser's zone is how scheduling from a laptop outside KSA published at
  // the wrong local hour.
  it('schedules in the brand timezone, never the browser\'s', () => {
    const req = buildPublishRequest(composed({ scheduledFor: '2026-09-01T19:00' }), opts)

    expect(req.scheduledFor).toBe('2026-09-01T19:00')
    expect(req.timezone).toBe('Asia/Riyadh')
  })

  it('omits the timezone entirely when publishing now', () => {
    const req = buildPublishRequest(composed(), opts)

    expect(req.scheduledFor).toBeUndefined()
    expect(req.timezone).toBeUndefined()
  })
})
