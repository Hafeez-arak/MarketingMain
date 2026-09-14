import { describe, it, expect } from 'vitest'
import {
  createAccountsStore, readCache, writeCache, accountsFromMirror, CACHE_PREFIX, FRESH_MS,
} from './accountsCache'

// ─── Which early answer is allowed on screen ───────────────────────────────
// The store exists to paint accounts before Zernio answers. The failure it must
// never have is the opposite one: painting "Not connected" before Zernio
// answers, or letting a slower, staler answer overwrite the live list.

const WS = '00000000-0000-0000-0000-000000000001'
const OTHER = '00000000-0000-0000-0000-000000000002'
const page = { zernio_account_id: 'li1', platform: 'linkedin', username: 'ARAK Lighting', is_active: true }
const insta = { zernio_account_id: 'ig1', platform: 'instagram', username: 'araklighting', is_active: true }

function memoryStorage(seed = {}) {
  const data = { ...seed }
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: k => { delete data[k] },
    data,
  }
}

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

const tick = () => new Promise(r => setTimeout(r, 0))

describe('the remembered list', () => {
  it('round-trips per workspace', () => {
    const storage = memoryStorage()
    writeCache(storage, WS, [page])
    expect(readCache(storage, WS)).toEqual([page])
    expect(readCache(storage, OTHER)).toBeNull()
  })

  it('reads nothing from a corrupt entry or no storage at all', () => {
    expect(readCache(memoryStorage({ [CACHE_PREFIX + WS]: '{not json' }), WS)).toBeNull()
    expect(readCache(null, WS)).toBeNull()
  })
})

describe('accountsFromMirror', () => {
  it('drops disconnected rows and rows from the retired Meta path', () => {
    const got = accountsFromMirror([
      { ...page, followers_count: 4779 },
      { zernio_account_id: 'old', platform: 'instagram', is_active: false },
      { zernio_account_id: null, platform: 'instagram', is_active: true },
    ])
    expect(got.map(a => a.zernio_account_id)).toEqual(['li1'])
    expect(got[0].followers_count).toBe(4779)
  })

  it('keeps an uncounted follower figure as null, not zero', () => {
    expect(accountsFromMirror([{ ...page, followers_count: null }])[0].followers_count).toBeNull()
  })
})

describe('createAccountsStore', () => {
  it('answers at once from memory, then replaces it with the live list', async () => {
    const storage = memoryStorage()
    writeCache(storage, WS, [page])
    const live = deferred()
    const store = createAccountsStore({ fetchLive: () => live.promise, storage })

    expect(store.getSnapshot(WS)).toMatchObject({ source: 'cache', accounts: [page] })

    const run = store.refresh(WS)
    live.resolve({ accounts: [page, insta] })
    await run
    expect(store.getSnapshot(WS)).toMatchObject({ source: 'live', refreshing: false })
    expect(store.getSnapshot(WS).accounts).toHaveLength(2)
    expect(readCache(storage, WS)).toHaveLength(2)
  })

  // Remembering "nothing connected" would paint Connect over an account
  // connected since. Only Zernio may say there are none.
  it('does not treat an empty memory or an empty mirror as an answer', async () => {
    const storage = memoryStorage()
    writeCache(storage, WS, [])
    const live = deferred()
    const store = createAccountsStore({ fetchLive: () => live.promise, fetchMirror: async () => [], storage })

    expect(store.getSnapshot(WS).source).toBeNull()
    const run = store.refresh(WS)
    await tick()
    expect(store.getSnapshot(WS).source).toBeNull()

    live.resolve({ accounts: [] })
    await run
    expect(store.getSnapshot(WS)).toMatchObject({ source: 'live', accounts: [] })
  })

  it('shows the mirror while Zernio is slow', async () => {
    const live = deferred()
    const store = createAccountsStore({ fetchLive: () => live.promise, fetchMirror: async () => [page] })
    const run = store.refresh(WS)
    await tick()
    expect(store.getSnapshot(WS)).toMatchObject({ source: 'mirror', refreshing: true })
    live.resolve({ accounts: [page] })
    await run
    expect(store.getSnapshot(WS).source).toBe('live')
  })

  it('never lets a late mirror overwrite the live list', async () => {
    const mirror = deferred()
    const store = createAccountsStore({ fetchLive: async () => ({ accounts: [insta] }), fetchMirror: () => mirror.promise })
    await store.refresh(WS)
    mirror.resolve([page])
    await tick()
    expect(store.getSnapshot(WS)).toMatchObject({ source: 'live', accounts: [insta] })
  })

  it('shares one live call between every screen asking at once', async () => {
    let calls = 0
    const live = deferred()
    const store = createAccountsStore({ fetchLive: () => { calls++; return live.promise } })
    const runs = [store.refresh(WS), store.refresh(WS), store.refresh(WS)]
    live.resolve({ accounts: [page] })
    await Promise.all(runs)
    expect(calls).toBe(1)
  })

  it('does not ask again while the live list is fresh, unless forced', async () => {
    let calls = 0
    let clock = 1_000_000
    const store = createAccountsStore({ fetchLive: async () => { calls++; return { accounts: [page] } }, now: () => clock })
    await store.refresh(WS)
    await store.refresh(WS)
    expect(calls).toBe(1)
    await store.refresh(WS, { force: true })
    expect(calls).toBe(2)
    clock += FRESH_MS + 1
    await store.refresh(WS)
    expect(calls).toBe(3)
  })

  it('keeps what is on screen when the live call fails, and says why', async () => {
    const storage = memoryStorage()
    writeCache(storage, WS, [page])
    const store = createAccountsStore({ fetchLive: async () => ({ error: 'Zernio is down.' }), storage })
    await store.refresh(WS)
    expect(store.getSnapshot(WS)).toMatchObject({ source: 'cache', accounts: [page], error: 'Zernio is down.', refreshing: false })
  })

  it('answers a failure with nothing on screen, so no loader spins forever', async () => {
    const store = createAccountsStore({ fetchLive: async () => { throw new Error('offline') } })
    await store.refresh(WS)
    expect(store.getSnapshot(WS)).toMatchObject({ source: 'error', error: 'offline' })
  })

  // One brand's accounts on another brand's screen is how you publish as the
  // wrong company.
  it('keeps workspaces apart', async () => {
    const store = createAccountsStore({
      fetchLive: async ws => ({ accounts: ws === WS ? [page] : [insta] }),
    })
    await Promise.all([store.refresh(WS), store.refresh(OTHER)])
    expect(store.getSnapshot(WS).accounts).toEqual([page])
    expect(store.getSnapshot(OTHER).accounts).toEqual([insta])
    expect(store.getSnapshot(null).accounts).toEqual([])
  })

  it('tells subscribers of their own workspace only', async () => {
    const store = createAccountsStore({ fetchLive: async () => ({ accounts: [page] }) })
    const seen = { ws: 0, other: 0 }
    const off = store.subscribe(WS, () => { seen.ws++ })
    store.subscribe(OTHER, () => { seen.other++ })
    await store.refresh(WS)
    expect(seen.ws).toBeGreaterThan(0)
    expect(seen.other).toBe(0)
    off()
    const before = seen.ws
    store.replace(WS, [insta])
    expect(seen.ws).toBe(before)
  })
})
