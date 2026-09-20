import { describe, it, expect } from 'vitest'
import {
  slidesFor, slideUrls, hasSlides, hasOwnSlides,
  legacyFieldsFor, addSlide, removeSlide, moveSlide, withStudioRender,
} from './planSlides'

// ─── The bug this module exists to kill ────────────────────────────────────
// `const images = idea.previewImageUrl ? [idea.previewImageUrl] : refs`
// A Studio render won and the uploads were discarded — silently, with nothing
// in the UI to say four slides had just become one.

describe('slidesFor — mixed sources', () => {
  it('keeps AI and your own images together, in order', () => {
    const idea = { slides: [
      { url: 'ai-1.png',  source: 'studio', versionId: 'v1' },
      { url: 'mine-1.jpg', source: 'upload' },
      { url: 'ai-2.png',  source: 'studio' },
      { url: 'mine-2.jpg', source: 'library' },
    ] }
    expect(slideUrls(idea)).toEqual(['ai-1.png', 'mine-1.jpg', 'ai-2.png', 'mine-2.jpg'])
    expect(slidesFor(idea).map(s => s.source)).toEqual(['studio', 'upload', 'studio', 'library'])
    expect(hasOwnSlides(idea)).toBe(true)
  })

  it('carries versionId so a Studio slide can find its session again', () => {
    const idea = { slides: [{ url: 'a.png', source: 'studio', versionId: 'ver-9' }] }
    expect(slidesFor(idea)[0].versionId).toBe('ver-9')
  })

  it('drops slides with no url instead of rendering empty frames', () => {
    const idea = { slides: [{ url: 'a.png' }, { url: '' }, null, { url: '   ' }] }
    expect(slideUrls(idea)).toEqual(['a.png'])
  })

  it('accepts bare strings, and calls an unknown source an upload', () => {
    const idea = { slides: ['a.png', { url: 'b.png', source: 'nonsense' }] }
    expect(slidesFor(idea).map(s => s.source)).toEqual(['upload', 'upload'])
  })
})

// ─── Old plans must not be rearranged by this change ───────────────────────

describe('slidesFor — legacy ideas with no slides column', () => {
  it('reproduces Studio-render-wins exactly, so an in-flight plan is unchanged', () => {
    const idea = { previewImageUrl: 'ai.png', references: ['mine.jpg'], imageMode: 'use_reference' }
    expect(slideUrls(idea)).toEqual(['ai.png'])
    expect(slidesFor(idea)[0].source).toBe('studio')
  })

  it('uses your references when there is no Studio render', () => {
    const idea = { references: ['a.jpg', 'b.jpg'], imageMode: 'use_reference' }
    expect(slideUrls(idea)).toEqual(['a.jpg', 'b.jpg'])
    expect(hasOwnSlides(idea)).toBe(true)
  })

  it('ignores references when the mode was not use_reference', () => {
    expect(slideUrls({ references: ['a.jpg'], imageMode: 'studio' })).toEqual([])
  })

  it('puts the video after the pictures, never instead of them', () => {
    const idea = { references: ['a.jpg', 'b.jpg'], imageMode: 'use_reference', previewVideoUrl: 'clip.mp4' }
    expect(slideUrls(idea)).toEqual(['a.jpg', 'b.jpg', 'clip.mp4'])
    expect(slidesFor(idea).map(s => s.type)).toEqual(['image', 'image', 'video'])
  })

  it('is empty for an idea with nothing attached', () => {
    expect(hasSlides({})).toBe(false)
    expect(slidesFor(null)).toEqual([])
  })

  it('prefers the slides column once it exists', () => {
    const idea = { slides: [{ url: 'new.png', source: 'upload' }], previewImageUrl: 'old.png' }
    expect(slideUrls(idea)).toEqual(['new.png'])
  })
})

// ─── The legacy columns are derived, not abandoned ─────────────────────────

describe('legacyFieldsFor', () => {
  it('sends a Studio-first post back as a Studio post', () => {
    const out = legacyFieldsFor([
      { url: 'ai.png', source: 'studio' },
      { url: 'mine.jpg', source: 'upload' },
    ])
    expect(out.preview_image_url).toBe('ai.png')
    expect(out.reference_image_urls).toEqual(['mine.jpg'])
    expect(out.image_mode).toBe('studio')
    expect(out.slide_count).toBe(2)
  })

  it('leaves preview_image_url empty when the first slide is yours', () => {
    const out = legacyFieldsFor([
      { url: 'mine.jpg', source: 'upload' },
      { url: 'ai.png', source: 'studio' },
    ])
    expect(out.preview_image_url).toBe('')
    expect(out.reference_image_urls).toEqual(['mine.jpg', 'ai.png'])
    expect(out.image_mode).toBe('use_reference')
  })

  it('reads a video-only post as video, and a mixed one as image', () => {
    expect(legacyFieldsFor([{ url: 'c.mp4', type: 'video', source: 'studio' }]).media_type).toBe('video')
    expect(legacyFieldsFor([
      { url: 'a.png', source: 'upload' },
      { url: 'c.mp4', type: 'video', source: 'studio' },
    ]).media_type).toBe('image')
  })

  it('pulls the video out into its own column', () => {
    const out = legacyFieldsFor([{ url: 'a.png', source: 'upload' }, { url: 'c.mp4', type: 'video', source: 'studio' }])
    expect(out.preview_video_url).toBe('c.mp4')
    expect(out.reference_image_urls).toEqual(['a.png'])
  })

  it('never reports a slide_count below one', () => {
    expect(legacyFieldsFor([]).slide_count).toBe(1)
  })
})

// ─── Editing ───────────────────────────────────────────────────────────────

describe('add / remove / move', () => {
  const base = [{ url: 'a.png', source: 'upload' }, { url: 'b.png', source: 'upload' }]

  it('appends, and refuses a slide with no url', () => {
    expect(slideUrls({ slides: addSlide(base, { url: 'c.png' }) })).toEqual(['a.png', 'b.png', 'c.png'])
    expect(addSlide(base, { url: '' })).toHaveLength(2)
  })

  it('removes by index and ignores one out of range', () => {
    expect(slideUrls({ slides: removeSlide(base, 0) })).toEqual(['b.png'])
    expect(removeSlide(base, 9)).toHaveLength(2)
  })

  it('moves a slide without dropping it', () => {
    const moved = moveSlide([...base, { url: 'c.png', source: 'upload' }], 2, 0)
    expect(slideUrls({ slides: moved })).toEqual(['c.png', 'a.png', 'b.png'])
  })

  it('does not mutate the array it was given', () => {
    const copy = [...base]
    moveSlide(copy, 0, 1); removeSlide(copy, 0); addSlide(copy, { url: 'z.png' })
    expect(slideUrls({ slides: copy })).toEqual(['a.png', 'b.png'])
  })
})

describe('withStudioRender', () => {
  it('replaces the previous Studio image instead of stacking near-duplicates', () => {
    let slides = [{ url: 'ai-v1.png', source: 'studio', versionId: 'v1' }, { url: 'mine.jpg', source: 'upload' }]
    slides = withStudioRender(slides, { url: 'ai-v2.png', versionId: 'v2' })
    expect(slideUrls({ slides })).toEqual(['ai-v2.png', 'mine.jpg'])
    expect(slides[0].versionId).toBe('v2')
  })

  it('never touches your own slides', () => {
    const slides = withStudioRender([{ url: 'mine.jpg', source: 'upload' }], { url: 'ai.png', versionId: 'v1' })
    expect(slideUrls({ slides })).toEqual(['mine.jpg', 'ai.png'])
    expect(slides[0].source).toBe('upload')
  })

  it('keeps a Studio video separate from a Studio image', () => {
    let slides = withStudioRender([], { url: 'ai.png' })
    slides = withStudioRender(slides, { url: 'clip.mp4', type: 'video' })
    expect(slideUrls({ slides })).toEqual(['ai.png', 'clip.mp4'])
  })

  it('is a no-op without a url', () => {
    expect(withStudioRender([{ url: 'a.png', source: 'upload' }], { url: '' })).toHaveLength(1)
  })
})
