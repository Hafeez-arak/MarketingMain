import { describe, it, expect } from 'vitest'
import { mediaOfPost, projectionFor, normaliseMedia, isMixed, countsOf } from './mediaOrder'

// The carousel that started this: two pictures and a clip, in that order.
const IMG1 = 'https://s/img1.jpg'
const IMG2 = 'https://s/img2.jpg'
const CLIP = 'https://s/clip.mp4'
const MIXED = [
  { type: 'image', url: IMG1 },
  { type: 'video', url: CLIP },
  { type: 'image', url: IMG2 },
]

describe('mediaOfPost', () => {
  it('returns the stored order when the row has one', () => {
    expect(mediaOfPost({ media: MIXED }).map(m => m.url)).toEqual([IMG1, CLIP, IMG2])
  })

  it('rebuilds images-then-video for a row written before `media` existed', () => {
    const legacy = { image_urls: [IMG1, IMG2], image_url: IMG1, video_url: CLIP }
    expect(mediaOfPost(legacy)).toEqual([
      { type: 'image', url: IMG1 },
      { type: 'image', url: IMG2 },
      { type: 'video', url: CLIP },
    ])
  })

  it('no longer drops the images when a video is present', () => {
    // The whole bug: `video ? [video] : images` returned one item here.
    const legacy = { image_urls: [IMG1, IMG2], video_url: CLIP }
    expect(mediaOfPost(legacy)).toHaveLength(3)
  })

  it('falls back to the single image_url when image_urls is empty', () => {
    expect(mediaOfPost({ image_url: IMG1, image_urls: [] }))
      .toEqual([{ type: 'image', url: IMG1 }])
  })

  it('is empty for a post with no media at all', () => {
    expect(mediaOfPost({})).toEqual([])
    expect(mediaOfPost(null)).toEqual([])
  })
})

describe('projectionFor', () => {
  it('keeps the legacy columns as a faithful derivation', () => {
    const p = projectionFor(MIXED)
    expect(p.media).toEqual(MIXED)
    expect(p.image_urls).toEqual([IMG1, IMG2])   // order preserved, video skipped
    expect(p.image_url).toBe(IMG1)
    expect(p.video_url).toBe(CLIP)
  })

  it('calls a mixed carousel an image post, because that is what it looks like', () => {
    expect(projectionFor(MIXED).media_type).toBe('image')
    expect(projectionFor([{ type: 'video', url: CLIP }]).media_type).toBe('video')
    expect(projectionFor([]).media_type).toBe('none')
  })

  it('round-trips: what a save writes, a reopen reads back unchanged', () => {
    // This is the test that would have caught the data loss. Before the fix,
    // the row came back with zero images and the next save destroyed them.
    const written = projectionFor(MIXED)
    expect(mediaOfPost(written)).toEqual(MIXED)
    expect(projectionFor(mediaOfPost(written))).toEqual(written)
  })
})

describe('normaliseMedia', () => {
  it('drops blanks and duplicates, keeping first position', () => {
    expect(normaliseMedia([
      { type: 'image', url: IMG1 }, { type: 'image', url: '' },
      { type: 'image', url: IMG1 }, null, { type: 'video', url: CLIP },
    ])).toEqual([{ type: 'image', url: IMG1 }, { type: 'video', url: CLIP }])
  })

  it('sniffs the type when a row does not carry one', () => {
    expect(normaliseMedia([{ url: CLIP }, { url: IMG1 }]))
      .toEqual([{ type: 'video', url: CLIP }, { type: 'image', url: IMG1 }])
  })
})

describe('isMixed / countsOf', () => {
  it('only calls it mixed when both kinds are really there', () => {
    expect(isMixed(MIXED)).toBe(true)
    expect(isMixed([{ type: 'image', url: IMG1 }, { type: 'image', url: IMG2 }])).toBe(false)
    expect(isMixed([{ type: 'video', url: CLIP }])).toBe(false)
  })

  it('counts what a carousel limit is actually measured against', () => {
    expect(countsOf(MIXED)).toEqual({ images: 2, videos: 1, total: 3 })
  })
})
