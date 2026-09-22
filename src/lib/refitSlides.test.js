import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocked at the module boundary rather than stubbed inside: both of these
// touch a canvas and the network, and neither exists under vitest. What is
// being tested here is the DECISIONS — which slides are touched, which are
// left alone, and what happens when one of them fails — not the rendering.
vi.mock('./imageRender', () => ({ autoFit: vi.fn() }))
vi.mock('./mediaLibrary', () => ({ uploadToMediaLibrary: vi.fn() }))

import { autoFit } from './imageRender'
import { uploadToMediaLibrary } from './mediaLibrary'
import { refitSlides } from './refitSlides'

const CTX = { workspaceId: 'ws1', accessToken: 'tok', platform: 'instagram' }

const img = (url, extra = {}) => ({ url, type: 'image', name: 'photo.jpg', ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  autoFit.mockResolvedValue({ blob: new Blob(['x']), width: 1080, height: 1350 })
  uploadToMediaLibrary.mockImplementation(async (_ws, _tok, file) =>
    ({ asset: { url: `https://cdn/${file.name}` } }))
})

describe('refitSlides', () => {
  it('leaves the adjusted slide exactly as it was', async () => {
    const kept = img('https://a/1.jpg', { width: 1, height: 2 })
    const out = await refitSlides([kept, img('https://a/2.jpg')], 0, '4:5', 'fill', CTX)
    expect(out[0]).toBe(kept)
    expect(autoFit).toHaveBeenCalledTimes(1)
    expect(autoFit).toHaveBeenCalledWith('https://a/2.jpg', '4:5', { mode: 'fill' })
  })

  it('re-renders every other image and reports the new dimensions', async () => {
    const out = await refitSlides([img('https://a/1.jpg'), img('https://a/2.jpg'), img('https://a/3.jpg')],
      1, '1:1', 'fit', CTX)
    expect(out[1].url).toBe('https://a/2.jpg')          // untouched
    expect(out[0].url).toBe('https://cdn/photo-1x1.jpg')
    expect(out[2].url).toBe('https://cdn/photo-1x1.jpg')
    // Straight from the render. These are what the composer's shape check
    // reads, so a stale pair here is the original bug all over again.
    expect(out[0]).toMatchObject({ width: 1080, height: 1350, mimeType: 'image/jpeg' })
  })

  // The whole reason this takes a predicate-free `type` check rather than
  // trusting the caller: a video fed to a canvas throws, and the throw would
  // be swallowed into "left as it was" — silently, on every apply-to-all.
  it('never touches a video slide', async () => {
    const video = { url: 'https://a/clip.mp4', type: 'video' }
    const out = await refitSlides([img('https://a/1.jpg'), video], 0, '4:5', 'fill', CTX)
    expect(out[1]).toBe(video)
    expect(autoFit).not.toHaveBeenCalled()
  })

  it('leaves a slide whose type nobody set alone rather than guessing', async () => {
    const untyped = { url: 'https://a/mystery' }
    const out = await refitSlides([img('https://a/1.jpg'), untyped], 0, '4:5', 'fill', CTX)
    expect(out[1]).toBe(untyped)
    expect(autoFit).not.toHaveBeenCalled()
  })

  // Half a carousel in the new shape and half in the old is worse than the
  // mixture the user already had, but a slide that fails is at least still
  // the picture they chose. It must never come back undefined or blank.
  it('keeps the original when the render throws', async () => {
    const bad = img('https://a/2.jpg')
    autoFit.mockRejectedValueOnce(new Error('tainted canvas'))
    const out = await refitSlides([img('https://a/1.jpg'), bad], 0, '4:5', 'fill', CTX)
    expect(out[1]).toBe(bad)
  })

  it('keeps the original when the upload fails', async () => {
    const bad = img('https://a/2.jpg')
    uploadToMediaLibrary.mockResolvedValueOnce({ error: 'Storage is full.' })
    const out = await refitSlides([img('https://a/1.jpg'), bad], 0, '4:5', 'fill', CTX)
    expect(out[1]).toBe(bad)
  })

  it('keeps the original when the upload succeeds but hands back no url', async () => {
    const bad = img('https://a/2.jpg')
    uploadToMediaLibrary.mockResolvedValueOnce({ asset: {} })
    const out = await refitSlides([img('https://a/1.jpg'), bad], 0, '4:5', 'fill', CTX)
    expect(out[1]).toBe(bad)
  })

  it('preserves length and order', async () => {
    const list = [img('https://a/1.jpg'), img('https://a/2.jpg'), { url: 'https://a/c.mp4', type: 'video' }]
    const out = await refitSlides(list, 0, '4:5', 'fill', CTX)
    expect(out).toHaveLength(3)
    expect(out[2].type).toBe('video')
  })

  it('tags the upload with the platform and the shape, and drops a blank platform', async () => {
    await refitSlides([img('https://a/1.jpg'), img('https://a/2.jpg')], 0, '4:5', 'fill',
      { workspaceId: 'ws1', accessToken: 'tok' })
    expect(uploadToMediaLibrary).toHaveBeenCalledWith('ws1', 'tok', expect.anything(),
      { source: 'adjusted', tags: ['adjusted', '4:5'] })
  })

  it('survives an empty or missing list', async () => {
    expect(await refitSlides([], 0, '4:5', 'fill', CTX)).toEqual([])
    expect(await refitSlides(undefined, 0, '4:5', 'fill', CTX)).toEqual([])
  })
})
