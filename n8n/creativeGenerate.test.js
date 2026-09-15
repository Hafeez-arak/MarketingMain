import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode, StubPostgrest, STUB_SUPABASE } from './workflowHarness'

// ─── Creative Generate ─────────────────────────────────────────────────────
// One prompt, two candidates — but ONE CALL EACH, so each candidate is its own
// n8n execution. That is what lets the fast model's picture appear while the
// slow one is still rendering: n8n finishes a node across every input item
// before the next node runs, so two candidates sharing an execution meant
// neither row was written until the slower model returned.
//
// The tempting shortcut is to upload and mark the row ready from inside this
// Code node. It was tried on 2026-09-15 and corrupted every image:
// `this.helpers.httpRequest` is proxied to n8n's main process as one
// JSON.stringify'd message, and a Buffer nested in the options object is never
// reconstructed — it is stored as the literal text '{"type":"Buffer",...}',
// served back as image/png, and renders as a white card. Only
// prepareBinaryData survives, because its Buffer is a top-level RPC argument.
//
// The last test here is the guard against that coming back. It cannot be
// caught by stubbing httpRequest — the stub receives the Buffer intact,
// because the stub IS in-process and the RPC boundary is the whole problem.
// So it asserts the shape instead: this node hands bytes onward as binary and
// never writes the image itself.

const ENV = {
  FAL_KEY: 'stub-fal-key',
  SUPABASE_URL: STUB_SUPABASE,
  SUPABASE_KEY: 'stub-service-key',
}

const GENERATE = loadCodeNode('Arak Lighting – Creative Generate', 'Generate Candidates')

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

const db = () => new StubPostgrest({
  creative_versions: [
    { id: GPT, session_id: SESSION, provider: 'openai', status: 'pending', image_url: '' },
    { id: GEM, session_id: SESSION, provider: 'gemini', status: 'pending', image_url: '' },
  ],
})

const okImage = url => async () => ({ statusCode: 200, body: { images: [{ url }] } })
const download = async () => ({ statusCode: 200, body: PNG })

const routes = () => [
  ['nano-banana-2', okImage('https://cdn.fal.test/gemini.png')],
  ['gpt-image-2', okImage('https://cdn.fal.test/openai.png')],
  ['cdn.fal.test', download],
]

// One candidate per call, which is how the browser fires it now.
function run(target, { postgrest = db(), over = {} } = {}) {
  return runCodeNode(GENERATE, {
    env: ENV,
    postgrest,
    routes: routes(),
    input: {
      body: {
        session_id: SESSION,
        prompt: 'A warm bronze pendant over a marble counter',
        aspect_ratio: '4:5',
        targets: [target],
        ...over,
      },
    },
  })
}

describe('Creative Generate', () => {
  it('renders one candidate per call and hands the bytes on as binary', async () => {
    const { items } = await run({ version_id: GEM, provider: 'gemini' })

    expect(items).toHaveLength(1)
    const [item] = items
    expect(item.json._ok).toBe(true)
    expect(item.json.version_id).toBe(GEM)
    expect(item.json.bucket).toBe('creative-studio')
    // The downstream Upload node addresses the file by bucket + filename, so
    // both have to be on the item rather than only in a local variable.
    expect(item.json.filename).toContain(`${SESSION}/`)
    expect(item.json.filename).toMatch(/\.png$/)
  })

  it('carries the real PNG bytes through prepareBinaryData', async () => {
    const { items } = await run({ version_id: GPT, provider: 'openai' })
    const binary = items[0].binary.data

    expect(binary.mimeType).toBe('image/png')
    // The bytes the Upload node will send. A JSON-serialised Buffer here is
    // the corruption that stores a file nothing can open.
    expect(Buffer.isBuffer(binary.data)).toBe(true)
    expect(binary.data.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  it('reports a provider failure as _ok:false for the Mark Failed branch', async () => {
    const { items } = await runCodeNode(GENERATE, {
      env: ENV,
      postgrest: db(),
      routes: [
        ['nano-banana-2', async () => ({ statusCode: 403, body: { detail: 'User is locked. Reason: Exhausted balance.' } })],
        ['cdn.fal.test', download],
      ],
      input: { body: { session_id: SESSION, prompt: 'x', targets: [{ version_id: GEM, provider: 'gemini' }] } },
    })

    expect(items[0].json._ok).toBe(false)
    expect(items[0].json.version_id).toBe(GEM)
    // The provider's OWN words, not "Request failed with status code 403" — an
    // exhausted balance and a rejected prompt need different actions.
    expect(items[0].json.error).toContain('Exhausted balance')
  })

  it('spends nothing on a promptless request', async () => {
    const { items } = await run({ version_id: GEM, provider: 'gemini' }, { over: { prompt: '   ' } })
    expect(items[0].json._ok).toBe(false)
    expect(items[0].json.error).toBe('No prompt to generate from.')
  })

  it('never writes the image itself — the bytes leave through the Upload node', async () => {
    // The regression guard. Uploading from inside a Code node cannot survive
    // n8n's RPC boundary, and the failure is invisible in-process: it stores a
    // JSON-serialised Buffer, serves it as image/png, and paints a white card.
    // So the SHAPE is asserted, not the behaviour under a stub.
    const postgrest = db()
    const { calls } = await run({ version_id: GEM, provider: 'gemini' }, { postgrest })

    const wrote = calls.filter(c => c.url.startsWith(STUB_SUPABASE))
    expect(wrote, `this node must not talk to Supabase: ${wrote.map(c => c.method + ' ' + c.url).join(', ')}`)
      .toHaveLength(0)
    // The row is still pending here; Supabase: Save Version is what readies it.
    expect(postgrest.tables.creative_versions.find(r => r.id === GEM).status).toBe('pending')
    expect(GENERATE).toContain('prepareBinaryData')
  })
})
