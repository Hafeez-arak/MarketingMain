import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode, StubPostgrest, STUB_SUPABASE } from './workflowHarness'

// ─── Creative Upscale — what Topaz is sent ─────────────────────────────────
// fal takes a scale FACTOR, not a target size, so a 480p clip has to be sent
// as 2.25× to come back at 1080p — 2× (the default) quietly delivers 960p at
// the 1080p price. And Topaz defaults to H.265, which several browsers won't
// play: the clip would arrive, be paid for, and show as a black box.

const UPSCALE = loadCodeNode('Arak Lighting – Creative Upscale', 'Upscale Video')
const ENV = { FAL_KEY: 'stub-fal-key', SUPABASE_URL: STUB_SUPABASE, SUPABASE_KEY: 'stub-service-key' }
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'ascii'), Buffer.alloc(32, 3)])

async function run(body) {
  const submits = []
  const postgrest = new StubPostgrest({ creative_versions: [{ id: 'v1', status: 'pending' }] })
  const { items } = await runCodeNode(UPSCALE, {
    env: ENV, postgrest,
    input: { body: { session_id: 's1', version_id: 'v1', video_url: 'https://cdn.test/clip.mp4', ...body } },
    routes: [
      ['queue.fal.run', async ({ url, body: b, method }) => {
        if (method === 'POST') {
          submits.push({ endpoint: url.replace('https://queue.fal.run/', ''), input: b })
          return { statusCode: 200, body: { request_id: 'req_1', status: 'COMPLETED', response_url: 'https://queue.fal.run/result/req_1' } }
        }
        return { statusCode: 200, body: { video: { url: 'https://cdn.fal.test/up.mp4' } } }
      }],
      ['cdn.fal.test', async () => ({ statusCode: 200, body: MP4 })],
    ],
  })
  return { json: items.json, submit: submits[0], postgrest }
}

describe('Creative Upscale', () => {
  it('sends the factor that lands a 480p clip on 1080, as H.264', async () => {
    const { json, submit } = await run({ resolution: '480p' })
    expect(json._ok, json.error).toBe(true)
    expect(submit.endpoint).toBe('topaz/upscale/video/precision')
    expect(submit.input).toMatchObject({ video_url: 'https://cdn.test/clip.mp4', upscale_factor: 2.25, H264_output: true })
  })

  it('scales 720p and 768p clips by their own factors', async () => {
    expect((await run({ resolution: '720p' })).submit.input.upscale_factor).toBe(1.5)
    expect((await run({ resolution: '768p' })).submit.input.upscale_factor).toBe(1.406)
  })

  it('spends nothing on a clip that is already 1080p', async () => {
    const { json, submit } = await run({ resolution: '1080p' })
    expect(json._ok).toBe(false)
    expect(submit).toBeUndefined()
  })

  it('saves the request id before polling, so Reconcile can recover the clip', async () => {
    const { postgrest } = await run({ resolution: '480p' })
    const row = postgrest.tables.creative_versions[0]
    expect(row.overlay_state.pendingRequest).toMatchObject({ requestId: 'req_1', model: 'topaz/upscale/video/precision' })
  })
})
