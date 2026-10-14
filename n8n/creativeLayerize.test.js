import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode } from './workflowHarness'

// ─── Creative Layerize — what the editor is handed ─────────────────────────
// The editor places every layer by the box this returns, in the same 0–1
// fractions every other layer uses. fal states bounds as integers in 0–1000,
// so a missed division puts each element a thousand canvases off-screen —
// not an error, just an editor that looks like the split did nothing.

const LAYERIZE = loadCodeNode('Arak Lighting – Creative Layerize', 'Split Into Layers')
const ENV = { FAL_KEY: 'stub-fal-key' }

const falResult = {
  layers: [
    // Deliberately out of order: z_index, not array position, is the stacking.
    { z_index: 2, name: 'Headline', image: { url: 'https://cdn.fal.test/2.png', width: 400, height: 120 },
      bounding_box: { normalized: [100, 50, 900, 200], absolute: [102, 51, 921, 205] } },
    { z_index: 0, image: { url: 'https://cdn.fal.test/0.png', width: 1024, height: 1024 } },
    { z_index: 1, name: 'Pendant lamp', image: { url: 'https://cdn.fal.test/1.png', width: 300, height: 500 },
      bounding_box: { normalized: [350, 300, 650, 800] } },
  ],
}

function run(body, route = async () => ({ statusCode: 200, body: falResult })) {
  const calls = []
  return runCodeNode(LAYERIZE, {
    env: ENV,
    input: { body },
    routes: [['fal.run/bytedance/seedream/v5/flash/layerize', async req => { calls.push(req); return route(req) }]],
  }).then(r => ({ ...r, calls }))
}

describe('Creative Layerize', () => {
  it('returns the clean background and each element boxed in 0–1 fractions, bottom to top', async () => {
    const { out, calls } = await run({ image_url: 'https://cdn.test/photo.png' })
    expect(calls[0].body).toEqual({ image_url: 'https://cdn.test/photo.png', image_size: 'auto' })
    expect(out.ok).toBe(true)
    expect(out.base.url).toBe('https://cdn.fal.test/0.png')
    expect(out.layers.map(l => l.name)).toEqual(['Pendant lamp', 'Headline'])
    expect(out.layers[0].box).toEqual([0.35, 0.3, 0.65, 0.8])
    expect(out.layers[1].box).toEqual([0.1, 0.05, 0.9, 0.2])
  })

  it('spends nothing without an image', async () => {
    const { out, calls } = await run({ image_url: '' })
    expect(out.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it("passes fal's own words back when the call fails", async () => {
    const { out } = await run({ image_url: 'https://cdn.test/photo.png' },
      async () => ({ statusCode: 403, body: { detail: 'User is locked. Reason: Exhausted balance.' } }))
    expect(out.ok).toBe(false)
    expect(out.error).toContain('Exhausted balance')
  })
})
