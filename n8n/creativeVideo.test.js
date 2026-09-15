import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode, StubPostgrest, STUB_SUPABASE } from './workflowHarness'
import { VIDEO_MODELS, modelImageRole } from '../src/components/studio/videoModels'

// ─── Creative Video — what each model is actually sent ─────────────────────
// Every model on the picker has its own fal endpoint with its own field names,
// and the differences fail SILENTLY: fal ignores a key it doesn't recognise
// rather than rejecting the request. A mis-named start frame produces a render
// that succeeds, bills in full, and had nothing to do with the picture it was
// given — which is indistinguishable from "the model wasn't very good" unless
// something asserts the request body.
//
// So these tests are about the REQUEST, not the response. Each one pins a
// difference that has no visible symptom:
//   · Wan's start frame is start_image_url, and its audio flag is `audio`,
//     which DEFAULTS TO TRUE — omit it and brand assets get invented sound.
//   · H3 Max wants uppercase resolutions and an integer duration.
//   · Gemini Omni's references go in image_urls, not reference_image_urls.
//   · Veo's duration needs an 's' suffix.
//   · Seedance 2.5 takes real aspect ratios again (it was 'auto'-only, so the
//     workflow used to send none at all).

const ENV = {
  FAL_KEY: 'stub-fal-key',
  SUPABASE_URL: STUB_SUPABASE,
  SUPABASE_KEY: 'stub-service-key',
}

const RENDER = loadCodeNode('Arak Lighting – Creative Video', 'Render Video')

const SESSION = '33333333-3333-3333-3333-333333333333'
const VERSION = 'v_clip'

// 'ftyp' at offset 4 is what looksLikeVideo checks — a truncated download is
// otherwise byte-plausible and corrupts the asset silently.
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'ascii'), Buffer.alloc(32, 3),
])

// Captures the submit call, which is the whole point of this file.
function fal() {
  const submits = []
  const routes = [
    ['queue.fal.run', async ({ url, body, method }) => {
      if (method === 'POST') {
        submits.push({ endpoint: url.replace('https://queue.fal.run/', ''), input: body })
        // COMPLETED straight away, so the node's 3s poll loop never runs and
        // the test stays fast. The result URL is still fetched below.
        return {
          statusCode: 200,
          body: {
            request_id: 'req_1', status: 'COMPLETED',
            response_url: 'https://queue.fal.run/result/req_1',
          },
        }
      }
      return { statusCode: 200, body: { video: { url: 'https://cdn.fal.test/clip.mp4' } } }
    }],
    ['cdn.fal.test', async () => ({ statusCode: 200, body: MP4 })],
  ]
  return { routes, submits }
}

const db = () => new StubPostgrest({
  creative_versions: [{ id: VERSION, session_id: SESSION, status: 'pending' }],
})

async function render(over = {}) {
  const { routes, submits } = fal()
  // `items` rather than `out`: this node returns ONE item object rather than an
  // array of them, so the harness's out?.[0] convenience is null here.
  const { items } = await runCodeNode(RENDER, {
    env: ENV,
    input: {
      body: {
        session_id: SESSION, version_id: VERSION,
        prompt: 'A bronze pendant warming a marble lobby',
        aspect_ratio: '4:5', duration: '6', resolution: '720p',
        ...over,
      },
    },
    postgrest: db(),
    routes,
  })
  // A throw inside the node is reported as _ok:false rather than raised, so an
  // assertion on the submit body would otherwise fail with a confusing
  // "undefined" instead of the real reason.
  expect(items.json._ok, items.json.error).toBe(true)
  return submits[0]
}

describe('Creative Video — per-model request bodies', () => {
  it('sends Wan its own field names, and turns its default-on audio off', async () => {
    const { endpoint, input } = await render({
      model: 'wan-3.0-prime', image_url: 'https://cdn.test/start.png',
    })
    expect(endpoint).toBe('alibaba/wan-3.0-prime/image-to-video')
    // The trap: image_url is silently ignored by this endpoint.
    expect(input.start_image_url).toBe('https://cdn.test/start.png')
    expect(input.image_url).toBeUndefined()
    // `audio` defaults to true at fal, so an omitted flag is not "off".
    expect(input.audio).toBe(false)
    expect(input.generate_audio).toBeUndefined()
    expect(input.duration).toBe(6)
    expect(input.aspect_ratio).toBe('3:4')   // no 4:5 bucket
  })

  it('sends H3 Max an uppercase resolution and an integer duration', async () => {
    const { endpoint, input } = await render({ model: 'h3-max', resolution: '768p' })
    expect(endpoint).toBe('minimax/h3-max/text-to-video')
    expect(input.resolution).toBe('768P')
    expect(input.duration).toBe(6)
    expect(typeof input.duration).toBe('number')
    expect(input.aspect_ratio).toBe('3:4')
  })

  it("never sends H3 Max a shape keyword its text-to-video enum lacks", async () => {
    // H3 Max is the one model with no "decide for me" value on text-to-video,
    // so an unrecognised ratio has to land on a real one rather than on
    // 'auto'/'adaptive', which it would reject outright.
    const { input } = await render({ model: 'h3-max', aspect_ratio: '' })
    expect(input.aspect_ratio).toBe('16:9')
    expect(['auto', 'adaptive']).not.toContain(input.aspect_ratio)
  })

  it('puts Gemini Omni references in image_urls and forces an orientation', async () => {
    const { endpoint, input } = await render({
      model: 'gemini-omni-flash-1.1',
      reference_image_urls: ['https://cdn.test/a.png', 'https://cdn.test/b.png'],
    })
    expect(endpoint).toBe('google/gemini-omni-flash/v1.1/reference-to-video')
    expect(input.image_urls).toHaveLength(2)
    expect(input.reference_image_urls).toBeUndefined()
    // 16:9 or 9:16 only; 4:5 is portrait, so it renders 9:16 and Creative
    // Compose crops it back when the text layer goes on.
    expect(input.aspect_ratio).toBe('9:16')
    expect(input.duration).toBe(6)
  })

  it('gives Seedance 2.5 a real aspect ratio again on text-to-video', async () => {
    // It was 'auto'-only, so the workflow sent no ratio at all and the picker
    // warned that this model had no shape control. Both are now untrue.
    const { endpoint, input } = await render({ model: 'seedance-2.5', resolution: '1080p' })
    expect(endpoint).toBe('bytedance/seedance-2.5/text-to-video')
    expect(input.aspect_ratio).toBe('3:4')
    expect(input.resolution).toBe('1080p')
  })

  it('leaves the models that take no aspect ratio alone', async () => {
    for (const model of ['kling-2.5-turbo-pro', 'hailuo-2.3']) {
      const { input } = await render({ model })
      expect(input.aspect_ratio, model).toBeUndefined()
      expect(input.resolution, model).toBeUndefined()
    }
  })

  it("keeps Veo's 's' suffix on duration", async () => {
    const { endpoint, input } = await render({ model: 'veo-3.1-fast', duration: '8' })
    expect(endpoint).toBe('fal-ai/veo3.1/fast')
    expect(input.duration).toBe('8s')
    expect(input.aspect_ratio).toBe('9:16')
  })

  // ── The two halves have to agree ─────────────────────────────────────────
  // The picker decides whether to OFFER a reference slot (videoModels.js), and
  // the workflow decides whether to USE one (MODEL_CONFIGS). When those
  // disagree in the permissive direction, the render succeeds, bills in full,
  // and silently ignored the pictures — there is no error to notice. This
  // walks every model on the picker and checks the two halves behave the same,
  // so adding a ninth model cannot reintroduce it in either direction.
  it('agrees with the picker about which models take references', async () => {
    for (const m of VIDEO_MODELS) {
      const { endpoint } = await render({
        model: m.id,
        // Kling/Hailuo take no resolution, and every model's own default is
        // the only value guaranteed valid for it.
        duration: m.defaultDuration, resolution: m.defaultResolution,
        reference_image_urls: ['https://cdn.test/a.png'],
      })
      const offered = modelImageRole(m.id) === 'references'
      expect(endpoint.includes('reference-to-video'), `${m.id} (picker offers refs: ${offered})`)
        .toBe(offered)
    }
  })

  it('routes references only to models that have a reference endpoint', async () => {
    // Kling has none, so the reference-to-video branch must not be taken —
    // otherwise the request falls through to text-to-video and the pictures
    // are discarded at full price.
    const { endpoint, input } = await render({
      model: 'kling-2.5-turbo-pro',
      reference_image_urls: ['https://cdn.test/a.png'],
    })
    expect(endpoint).toBe('fal-ai/kling-video/v2.5-turbo/pro/text-to-video')
    expect(input.reference_image_urls).toBeUndefined()
    expect(input.image_urls).toBeUndefined()
  })
})
