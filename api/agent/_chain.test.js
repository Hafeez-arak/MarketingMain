import { describe, it, expect, vi } from 'vitest'
import {
  shouldDrive, chainTarget, chainAuth, dispatch, claimSynthesis, finishIfDone, startLenses,
} from './_chain.js'

const req = (headers = {}) => ({ headers })
const local = req({ host: 'localhost:5173', authorization: 'Bearer user-jwt' })
const okFetch = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
const bodyOf = call => JSON.parse(call[1].body)

describe('shouldDrive', () => {
  it('drives a run started from the app, and leaves n8n\'s scheduled run to n8n', () => {
    expect(shouldDrive({ trigger: 'manual' })).toBe(true)
    expect(shouldDrive({ trigger: 'chat' })).toBe(true)
    expect(shouldDrive({ trigger: 'scheduled' })).toBe(false)
  })
  it('lets an explicit flag win either way', () => {
    expect(shouldDrive({ trigger: 'scheduled', drive: true })).toBe(true)
    expect(shouldDrive({ trigger: 'manual', drive: false })).toBe(false)
  })
})

describe('chainTarget and chainAuth', () => {
  it('uses this deployment\'s own URL on Vercel, whatever Host says', () => {
    const env = { VERCEL_URL: 'marketing-main-abc123-aqeeq1.vercel.app' }
    expect(chainTarget(req({ host: 'evil.example' }), env))
      .toEqual({ base: 'https://marketing-main-abc123-aqeeq1.vercel.app', trusted: true })
  })
  it('trusts localhost in dev', () => {
    expect(chainTarget(req({ host: 'localhost:5173' }), {}))
      .toEqual({ base: 'http://localhost:5173', trusted: true })
  })
  it('never sends the secret to an address taken from a Host header', () => {
    const target = chainTarget(req({ host: 'evil.example' }), {})
    expect(target.trusted).toBe(false)
    expect(chainAuth({ ...target, incoming: 'Bearer user-jwt', secret: 's3cret' })).toBe('Bearer user-jwt')
  })
  it('uses the secret on a trusted address, so a long run outlives the user token', () => {
    expect(chainAuth({ trusted: true, incoming: 'Bearer user-jwt', secret: 's3cret' })).toBe('Bearer s3cret')
    expect(chainAuth({ trusted: true, incoming: 'Bearer user-jwt', secret: '' })).toBe('Bearer user-jwt')
  })
  it('refuses a malformed host', () => {
    expect(chainTarget(req({ host: 'a b/c' }), {}).base).toBe('')
  })
})

describe('dispatch', () => {
  it('counts a step that finished inside the wait as started', async () => {
    const fetchImpl = okFetch()
    const out = await dispatch('http://x/api/agent/lens', { a: 1 }, { fetchImpl, authorization: 'Bearer t' })
    expect(out.dispatched).toBe(true)
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer t')
  })
  it('counts a step still working when the wait ends as started', async () => {
    const fetchImpl = (url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
    expect(await dispatch('http://x', {}, { fetchImpl, waitMs: 10 })).toEqual({ dispatched: true, answered: false })
  })
  it('reports a step that was refused, like the 508 Vercel sends for a deep chain', async () => {
    const fetchImpl = async () => ({ ok: false, status: 508, json: async () => { throw new Error('html') } })
    expect(await dispatch('http://x', {}, { fetchImpl })).toMatchObject({ dispatched: false, status: 508, error: 'returned 508' })
  })
  it('reports a step that could not be reached at all', async () => {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED') }
    expect(await dispatch('http://x', {}, { fetchImpl })).toMatchObject({ dispatched: false, error: 'ECONNREFUSED' })
  })
})

describe('startLenses', () => {
  const base = { workspaceId: 'ws', runId: 'run', cadence: 'weekly', planned: ['openings', 'calendar', 'demand'] }

  it('starts every planned lens at once, each with chain on, and nothing else', async () => {
    const fetchImpl = okFetch()
    const patch = vi.fn()
    const out = await startLenses(local, base, { fetchImpl, patch, env: {} })
    expect(out).toEqual({ ok: true, started: ['openings', 'calendar', 'demand'] })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls.every(c => c[0] === 'http://localhost:5173/api/agent/lens')).toBe(true)
    expect(fetchImpl.mock.calls.map(c => bodyOf(c).lens).sort()).toEqual(['calendar', 'demand', 'openings'])
    expect(fetchImpl.mock.calls.every(c => bodyOf(c).chain === true)).toBe(true)
    expect(patch).not.toHaveBeenCalled()
  })

  it('never calls a lens from inside another lens, so the chain stays three deep', async () => {
    const fetchImpl = okFetch()
    await startLenses(local, base, { fetchImpl, patch: vi.fn(), env: {} })
    // All dispatched by /run itself: none of these requests is the synthesise
    // route, and there is exactly one request per lens.
    expect(fetchImpl.mock.calls.some(c => c[0].endsWith('/synthesise'))).toBe(false)
  })

  it('fails the run, naming the lens and why, when one cannot be started', async () => {
    const patch = vi.fn(async () => {})
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    fetchImpl.mockImplementationOnce(async () => ({ ok: false, status: 508, json: async () => ({}) }))
    const out = await startLenses(local, base, { fetchImpl, patch, env: {} })
    expect(out.ok).toBe(false)
    expect(out.error).toBe('Could not start the openings lens (returned 508).')
    expect(patch).toHaveBeenCalledWith('ws', 'run', expect.objectContaining({ status: 'failed' }))
  })

  it('fails the run when it cannot find its own address', async () => {
    const patch = vi.fn(async () => {})
    const out = await startLenses(req({}), base, { fetchImpl: vi.fn(), patch, env: {} })
    expect(out.ok).toBe(false)
    expect(patch.mock.calls[0][2].status).toBe('failed')
  })
})

describe('claimSynthesis', () => {
  it('moves the run only while it is still running at lenses', async () => {
    const query = vi.fn(async () => [{ id: 'run' }])
    expect(await claimSynthesis('ws', 'run', { db: query })).toBe(true)
    const [path, init] = query.mock.calls[0]
    expect(path).toContain('status=eq.running')
    expect(path).toContain('stage=eq.lenses')
    expect(init).toMatchObject({ method: 'PATCH', body: { stage: 'synthesise' } })
  })
  it('reports a lost race as not claimed', async () => {
    expect(await claimSynthesis('ws', 'run', { db: async () => [] })).toBe(false)
  })
})

describe('finishIfDone', () => {
  const base = { workspaceId: 'ws', runId: 'run', cadence: 'weekly', planned: ['openings', 'calendar'] }

  it('does nothing while a lens is still out', async () => {
    const fetchImpl = okFetch()
    const query = vi.fn()
    const out = await finishIfDone(local, { ...base, done: [{ lens: 'calendar' }] }, { fetchImpl, db: query, env: {} })
    expect(out).toEqual({ ok: true, step: 'waiting', pending: ['openings'] })
    expect(query).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('starts the brief once, when the last lens lands', async () => {
    const fetchImpl = okFetch()
    const done = [{ lens: 'calendar' }, { lens: 'openings', status: 'failed' }]
    const out = await finishIfDone(local, { ...base, done }, { fetchImpl, db: async () => [{ id: 'run' }], env: {} })
    expect(out).toEqual({ ok: true, step: 'synthesise' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:5173/api/agent/synthesise')
    expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({ workspace_id: 'ws', run_id: 'run', cadence: 'weekly' })
  })

  it('leaves the brief alone when another lens already claimed it', async () => {
    const fetchImpl = okFetch()
    const done = [{ lens: 'calendar' }, { lens: 'openings' }]
    const out = await finishIfDone(local, { ...base, done }, { fetchImpl, db: async () => [], env: {} })
    expect(out.step).toBe('claimed_elsewhere')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails the run, with the reason, when the brief is refused', async () => {
    const patch = vi.fn(async () => {})
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
    const done = [{ lens: 'calendar' }, { lens: 'openings' }]
    const out = await finishIfDone(local, { ...base, done }, { fetchImpl, patch, db: async () => [{ id: 'run' }], env: {} })
    expect(out.ok).toBe(false)
    expect(patch).toHaveBeenCalledWith('ws', 'run', expect.objectContaining({ status: 'failed', error: 'Could not start the brief: boom' }))
  })
})
