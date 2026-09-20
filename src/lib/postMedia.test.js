import { describe, it, expect } from 'vitest'
import { mediaItemsOf } from './postMedia'

// The shape captured live from Zernio on 2026-09-20 for ARAK's LinkedIn
// carousel — each slide carries both a full url and its own thumbnail.
const SLIDE = (n) => ({
  type: 'image',
  url: `https://media.licdn.com/dms/image/slide-${n}`,
  thumbnail: `https://media.licdn.com/dms/image/slide-${n}-thumb`,
})

describe('mediaItemsOf', () => {
  it('returns every slide of a carousel, in order', () => {
    const post = { mediaItems: [SLIDE(1), SLIDE(2), SLIDE(3)], thumbnailUrl: 'https://x/first' }
    expect(mediaItemsOf(post)).toHaveLength(3)
    expect(mediaItemsOf(post)[0].url).toContain('slide-1')
  })

  it('makes a one-image post a one-item carousel rather than nothing', () => {
    // The thumbnail IS the image here, and it is still worth enlarging.
    expect(mediaItemsOf({ thumbnailUrl: 'https://x/one' }))
      .toEqual([{ type: 'image', url: 'https://x/one' }])
  })

  it('prefers the slides over the thumbnail when both are present', () => {
    // A carousel's thumbnail is only its first frame; opening that alone
    // answers "which post is this" a second time.
    const post = { mediaItems: [SLIDE(1), SLIDE(2)], thumbnailUrl: 'https://x/first' }
    expect(mediaItemsOf(post)).toHaveLength(2)
  })

  it('drops slides with nothing to show', () => {
    const post = { mediaItems: [SLIDE(1), { type: 'image' }, null, { type: 'video', url: 'https://x/v' }] }
    expect(mediaItemsOf(post).map(m => m.type)).toEqual(['image', 'video'])
  })

  it('has nothing to open for a post with no media at all', () => {
    // The caller shows a plain placeholder rather than a zoom that opens
    // onto nothing.
    expect(mediaItemsOf({})).toEqual([])
    expect(mediaItemsOf(null)).toEqual([])
    expect(mediaItemsOf({ mediaItems: [], thumbnailUrl: '' })).toEqual([])
  })

  it('survives mediaItems being something other than a list', () => {
    expect(mediaItemsOf({ mediaItems: 'nope', thumbnailUrl: 'https://x/one' }))
      .toEqual([{ type: 'image', url: 'https://x/one' }])
  })
})
