// ─── Connected accounts, shared and remembered ─────────────────────────────
// The store behind useConnectedAccounts. Plain JavaScript with its fetchers and
// storage passed in, so the rules below — which answers count, and which one
// wins — run under vitest without React or a network.
//
// Why it exists: every screen used to wait on /api/zernio/accounts before it
// could draw an account, and every screen asked separately. The Instagram page,
// its composer and its Analytics tab made three lists on one page load, each a
// sign-in check, a workspace read, a Zernio call and two mirror writes behind a
// cold serverless start. On a reload the accounts took seconds to appear, every
// time.
//
// Now there is one entry per workspace. It answers at once from the last list
// this browser saw, or — the first time — from our own social_accounts mirror,
// and one live call per workspace checks it in the background. The live answer
// always wins. Nothing done with an account relies on the early answer being
// current: publish, disconnect and analytics all re-verify the account against
// Zernio on the server.

export const CACHE_PREFIX = 'arak.connectedAccounts.v1:'

/** A live answer younger than this is not asked for again unless forced. */
export const FRESH_MS = 30_000

// The account fields screens read, as social_accounts stores them.
export const MIRROR_SELECT = [
  'zernio_account_id', 'zernio_profile_id', 'platform', 'username', 'display_name',
  'profile_picture', 'profile_url', 'is_active', 'needs_reconnection', 'followers_count',
  'login_method', 'account_type', 'connected_at',
].join(',')

const EMPTY = Object.freeze({
  accounts: Object.freeze([]), source: null, error: '', refreshing: false, liveAt: 0,
})

// localStorage throws in some contexts (blocked site data, some private
// windows), so it is probed once. null means memory only.
export function browserStorage() {
  try {
    const storage = window.localStorage
    const probe = `${CACHE_PREFIX}probe`
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

export function readCache(storage, workspaceId) {
  if (!storage || !workspaceId) return null
  try {
    const parsed = JSON.parse(storage.getItem(CACHE_PREFIX + workspaceId) || 'null')
    return Array.isArray(parsed?.accounts) ? parsed.accounts : null
  } catch {
    return null
  }
}

export function writeCache(storage, workspaceId, accounts, at = Date.now()) {
  if (!storage || !workspaceId) return
  try {
    storage.setItem(CACHE_PREFIX + workspaceId, JSON.stringify({ at, accounts }))
  } catch { /* full or blocked — the in-memory entry still works */ }
}

// Mirror rows into the shape /api/zernio/accounts returns. Inactive rows and
// rows with no Zernio id (the retired Meta path) are not connections.
export function accountsFromMirror(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r && r.zernio_account_id && r.is_active !== false)
    .map(r => ({
      zernio_account_id: String(r.zernio_account_id),
      zernio_profile_id: r.zernio_profile_id || '',
      platform: r.platform || '',
      username: r.username || '',
      display_name: r.display_name || '',
      profile_picture: r.profile_picture || '',
      profile_url: r.profile_url || '',
      is_active: true,
      needs_reconnection: r.needs_reconnection === true,
      // null is "not counted yet", never zero — see followerCountOf on the server.
      followers_count: r.followers_count ?? null,
      login_method: r.login_method ?? null,
      account_type: r.account_type ?? null,
      connected_at: r.connected_at ?? null,
    }))
}

export function createAccountsStore({ fetchLive, fetchMirror = null, storage = null, now = () => Date.now() }) {
  const entries = new Map()
  const listeners = new Map()
  const inflight = new Map()

  function getSnapshot(workspaceId) {
    if (!workspaceId) return EMPTY
    if (!entries.has(workspaceId)) {
      const cached = readCache(storage, workspaceId)
      // Only a NON-EMPTY memory is an answer. "Nothing connected", remembered
      // from last week, would paint Connect buttons over an account connected
      // since — the placeholder flash this app does not allow.
      entries.set(workspaceId, cached?.length ? { ...EMPTY, accounts: cached, source: 'cache' } : EMPTY)
    }
    return entries.get(workspaceId)
  }

  function set(workspaceId, patch) {
    entries.set(workspaceId, { ...getSnapshot(workspaceId), ...patch })
    for (const fn of listeners.get(workspaceId) || []) fn()
  }

  function subscribe(workspaceId, fn) {
    if (!workspaceId) return () => {}
    if (!listeners.has(workspaceId)) listeners.set(workspaceId, new Set())
    listeners.get(workspaceId).add(fn)
    return () => { listeners.get(workspaceId)?.delete(fn) }
  }

  // A list fresh from Zernio, handed in by whoever already has one — the
  // Refresh action returns it — so no other screen has to ask again.
  function replace(workspaceId, accounts) {
    if (!workspaceId || !Array.isArray(accounts)) return
    set(workspaceId, { accounts, source: 'live', liveAt: now(), error: '' })
    writeCache(storage, workspaceId, accounts, now())
  }

  function answeredWithError(workspaceId, error) {
    // Answered, with a reason, and whatever was on screen stays. Otherwise the
    // error sits under a loader that never goes away.
    set(workspaceId, {
      error, refreshing: false, source: getSnapshot(workspaceId).source || 'error',
    })
  }

  function refresh(workspaceId, { force = false } = {}) {
    if (!workspaceId) return Promise.resolve()
    // Every screen mounting at once shares one request.
    if (inflight.has(workspaceId)) return inflight.get(workspaceId)
    const current = getSnapshot(workspaceId)
    if (!force && current.source === 'live' && now() - current.liveAt < FRESH_MS) return Promise.resolve()

    set(workspaceId, { refreshing: true })

    // The mirror is asked only when nothing is on screen yet, and only a
    // non-empty mirror is an answer, for the same reason as the cache. It
    // cannot overwrite Zernio: arriving after the live list, it finds a source
    // already set and is dropped.
    if (!current.source && fetchMirror) {
      Promise.resolve()
        .then(() => fetchMirror(workspaceId))
        .then(rows => {
          const accounts = accountsFromMirror(rows)
          if (accounts.length && !getSnapshot(workspaceId).source) {
            set(workspaceId, { accounts, source: 'mirror' })
          }
        }, () => { /* the live call is still coming */ })
    }

    const run = Promise.resolve()
      .then(() => fetchLive(workspaceId))
      .then(res => {
        if (res?.error) return answeredWithError(workspaceId, res.error)
        replace(workspaceId, res?.accounts || [])
        set(workspaceId, { refreshing: false })
      }, err => answeredWithError(workspaceId, String(err?.message || err)))
      .finally(() => { inflight.delete(workspaceId) })
    inflight.set(workspaceId, run)
    return run
  }

  return { getSnapshot, subscribe, refresh, replace }
}
