import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode, StubPostgrest, STUB_SUPABASE } from './workflowHarness'

// ─── Creative Generate ─────────────────────────────────────────────────────
// One prompt, two candidates, one per provider. The thing worth testing here
// is not that an image comes back — it is WHEN each row is written.
//
// The node used to hand both candidates to a downstream Upload → Save pair.
// n8n finishes a node across all of its items before the next node starts, so
// neither row reached the table until the slower model returned: the team
// watched two spinners while one image already existed and had already been
// paid for. Everything below exists to keep that from coming back, because it
// is invisible in any test that simply awaits the whole run.

const ENV = {
  FAL_KEY: 'stub-fal-key',
  SUPABASE_URL: STUB_SUPABASE,
  SUPABASE_KEY: 'stub-service-key',
}

const GENERATE = loadCodeNode('Arak Lighting – Creative Generate', 'Generate Candidates')

const WS = '11111111-1111-1111-1111-111111111111'
const SESSION = '22222222-2222-2222-2222-222222222222'
const GPT = 'v_gpt'
const GEM = 'v_gem'

// A real PNG signature. looksLikeImage() checks the file's magic bytes rather
// than its size, so a byte-plausible stub would pass a test the pipeline
// itself would reject.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
])

function db() {
  return new StubPostgrest({
    creative_versions: [
      { id: GPT, session_id: SESSION, workspace_id: WS, provider: 'openai', status: 'pending', image_url: '' },
      { id: GEM, session_id: SESSION, workspace_id: WS, provider: 'gemini', status: 'pending', image_url: '' },
    ],
  })
}

const row = (postgrest, id) => postgrest.tables.creative_versions.find(r => r.id === id)

const okImage = url => async () => ({ statusCode: 200, body: { images: [{ url }] } })
const download = async () => ({ statusCode: 200, body: PNG })

const body = {
  session_id: SESSION,
  prompt: 'A warm bronze pendant over a marble counter',
  aspect_ratio: '4:5',
  targets: [{ version_id: GPT, provider: 'openai' }, { version_id: GEM, provider: 'gemini' }],
}

const run = (postgrest, routes, over = {}) =>
  runCodeNode(GENERATE, { env: ENV, input: { body: { ...body, ...over } }, postgrest, routes })

// Spin until `check` holds. The whole point of these tests is to observe the
// table midway through the run, which means asking repeatedly rather than
// awaiting the run itself.
async function until(check, what) {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error(`Timed out waiting for: ${what}`)
}

describe('Creative Generate — each candidate lands on its own clock', () => {
  it('writes the fast provider row while the slow one is still rendering', async () => {
    const postgrest = db()
    let releaseOpenAI
    const slow = new Promise(r => { releaseOpenAI = r })

    const routes = [
      ['nano-banana-2', okImage('https://cdn.fal.test/gemini.png')],
      ['gpt-image-2', async () => { await slow; return { statusCode: 200, body: { images: [{ url: 'https://cdn.fal.test/openai.png' }] } } }],
      ['cdn.fal.test', download],
    ]

    // Deliberately NOT awaited — the assertion is about the state of the table
    // before the run is over.
    const running = run(postgrest, routes)

    await until(() => row(postgrest, GEM).status === 'ready', 'the Gemini row to go ready')

    // The real regression test: Gemini is readable while ChatGPT has not even
    // returned from fal yet. Under the old downstream-node shape this was
    // impossible — both rows stayed pending until the slower model finished.
    expect(row(postgrest, GEM).image_url).toContain('creative-studio/')
    expect(row(postgrest, GPT).status).toBe('pending')
    expect(row(postgrest, GPT).image_url).toBe('')

    releaseOpenAI()
    const { items } = await running

    expect(row(postgrest, GPT).status).toBe('ready')
    expect(row(postgrest, GEM).status).toBe('ready')
    // Nothing is left for the Mark Failed branch to do.
    expect(items.every(i => i.json._written === true)).toBe(true)
  })

  it('uploads the image as raw bytes, not a JSON-serialised Buffer', async () => {
    const postgrest = db()
    const routes = [
      ['nano-banana-2', okImage('https://cdn.fal.test/gemini.png')],
      ['gpt-image-2', okImage('https://cdn.fal.test/openai.png')],
      ['cdn.fal.test', download],
    ]
    const { calls } = await run(postgrest, routes)

    const uploads = calls.filter(c => c.method === 'POST' && c.url.includes('/storage/v1/object/'))
    expect(uploads).toHaveLength(2)
    for (const up of uploads) {
      // A Buffer that went through a JSON serialiser arrives as
      // {type:'Buffer',data:[...]} and stores a file no viewer can open — the
      // exact corruption reviveBinary() undoes on the way in.
      expect(Buffer.isBuffer(up.body)).toBe(true)
      expect(up.body.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    }
  })

  it('records one provider failing without touching the other candidate', async () => {
    const postgrest = db()
    const routes = [
      ['nano-banana-2', async () => ({ statusCode: 403, body: { detail: 'User is locked. Reason: Exhausted balance.' } })],
      ['gpt-image-2', okImage('https://cdn.fal.test/openai.png')],
      ['cdn.fal.test', download],
    ]
    const { items } = await run(postgrest, routes)

    expect(row(postgrest, GEM).status).toBe('failed')
    // The provider's OWN words, not "Request failed with status code 403" —
    // an exhausted balance and a rejected prompt need different actions.
    expect(row(postgrest, GEM).error).toContain('Exhausted balance')
    expect(row(postgrest, GPT).status).toBe('ready')
    // Both were written from inside the node, so Mark Failed stays idle.
    expect(items.every(i => i.json._written === true)).toBe(true)
  })

  it('leaves a promptless request to the Mark Failed branch', async () => {
    const postgrest = db()
    const { items } = await run(postgrest, [], { prompt: '   ' })

    expect(items).toHaveLength(2)
    for (const i of items) {
      expect(i.json._written).toBe(false)
      expect(i.json.error).toBe('No prompt to generate from.')
    }
    // Nothing was spent and nothing was written — the downstream node marks
    // these, which is what its IF gate now tests for.
    expect(row(postgrest, GPT).status).toBe('pending')
  })
})
