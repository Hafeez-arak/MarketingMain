import { describe, it, expect, vi } from 'vitest'
import { shouldDrive, nextStep, chainTarget, chainAuth, dispatch, advance } from './_chain.js'

const req = (headers = {}) => ({ headers })

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

describe('nextStep', () => {
  const planned = ['openings', 'calendar', 'demand']
  it('picks the first lens with no result, in plan order', () => {
    expect(nextStep(planned, [])).toEqual({ route: 'lens', lens: 'openings' })
    expect(nextStep(planned, [{ lens: 'openings' }])).toEqual({ route: 'lens', lens: 'calendar' })
  })
  it('counts a failed lens as done, so one bad lens cannot stall the brief', () => {
    const done = planned.map(lens => ({ lens, status: 'failed' }))
    expect(nextStep(planned, done)).toEqual({ route: 'synthesise' })
  })
  it('goes straight to the brief when nothing was planned', () => {
    expect(nextStep([], [])).toEqual({ route: 'synthesise' })
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
    const auth = chainAuth({ ...target, incoming: 'Bearer user-jwt', secret: 's3cret' })
    expect(auth).toBe('Bearer user-jwt')
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
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    const out = await dispatch('http://x/api/agent/lens', { a: 1 }, { fetchImpl, authorization: 'Bearer t' })
    expect(out.dispatched).toBe(true)
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer t')
    expect(JSON.parse(init.body)).toEqual({ a: 1 })
  })
  it('counts a step still working when the wait ends as started', async () => {
    const fetchImpl = (url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
    const out = await dispatch('http://x', {}, { fetchImpl, waitMs: 10 })
    expect(out).toEqual({ dispatched: true, answered: false })
  })
  it('reports a step that was refused', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: 'Sign in.' }) })
    expect(await dispatch('http://x', {}, { fetchImpl })).toMatchObject({ dispatched: false, status: 401, error: 'Sign in.' })
  })
  it('reports a step that could not be reached at all', async () => {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED') }
    expect(await dispatch('http://x', {}, { fetchImpl })).toMatchObject({ dispatched: false, error: 'ECONNREFUSED' })
  })
})

describe('advance', () => {
  const base = { workspaceId: 'ws', runId: 'run', cadence: 'weekly', planned: ['openings', 'calendar'] }
  const local = req({ host: 'localhost:5173', authorization: 'Bearer user-jwt' })
  const okFetch = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))

  it('starts the next lens with chain on, and leaves the run alone', async () => {
    const patch = vi.fn(async () => {})
    const fetchImpl = okFetch()
    const out = await advance(local, { ...base, done: [{ lens: 'openings' }] }, { patch, fetchImpl, env: {} })
    expect(out.ok).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('http://localhost:5173/api/agent/lens')
    expect(JSON.parse(init.body)).toEqual({ workspace_id: 'ws', run_id: 'run', lens: 'calendar', cadence: 'weekly', chain: true })
    expect(patch).not.toHaveBeenCalled()
  })

  it('starts the brief once every lens has a result', async () => {
    const fetchImpl = okFetch()
    await advance(local, { ...base, done: [{ lens: 'openings' }, { lens: 'calendar' }] }, { patch: async () => {}, fetchImpl, env: {} })
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:5173/api/agent/synthesise')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).chain).toBeUndefined()
  })

  it('fails the run, with the reason, when the next step is refused', async () => {
    const patch = vi.fn(async () => {})
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
    const out = await advance(local, { ...base, done: [] }, { patch, fetchImpl, env: {} })
    expect(out.ok).toBe(false)
    expect(patch).toHaveBeenCalledWith('ws', 'run', expect.objectContaining({
      status: 'failed', error: 'Could not start the openings lens: boom',
    }))
  })

  it('fails the run when it cannot find its own address', async () => {
    const patch = vi.fn(async () => {})
    const out = await advance(req({}), { ...base, done: [] }, { patch, fetchImpl: vi.fn(), env: {} })
    expect(out.ok).toBe(false)
    expect(patch.mock.calls[0][2].status).toBe('failed')
  })
})
