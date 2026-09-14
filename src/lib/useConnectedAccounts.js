import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useAuth } from '../store/auth'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import {
  fetchConnectedAccounts, startConnect, disconnectAccount,
  readConnectCallback, fetchSelectionOptions, completeSelection,
  explainOAuthError,
} from './zernioConnect'
import { createAccountsStore, browserStorage, MIRROR_SELECT } from './accountsCache'

// ─── The one place a screen asks "what is actually connected?" ─────────────
// Replaces `state.connectedAccounts[platform]`, a boolean in localStorage that
// the Connect button set to true without connecting anything. Every screen
// agreed the account was connected; the platform had never heard of it, and
// the first publish was where that surfaced.
//
// This holds the real list from Zernio, scoped to the active workspace. An
// empty list is a legitimate answer, not an error — a new workspace has
// nothing connected and should be told so plainly.
//
// Shared across every screen and remembered between visits: see
// ./accountsCache.js for why, and for which early answers are allowed to show.

// Our own copy in social_accounts, read with the caller's token (RLS limits it
// to workspaces they belong to) and filtered to this workspace explicitly —
// RLS alone is not isolation for a member of several.
async function readMirror(workspaceId) {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return []
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/social_accounts?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
      `&is_active=eq.true&zernio_account_id=not.is.null&select=${MIRROR_SELECT}&order=platform.asc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
    )
    return res.ok ? await res.json() : []
  } catch {
    return []
  }
}

const store = createAccountsStore({
  fetchLive: fetchConnectedAccounts,
  fetchMirror: readMirror,
  storage: browserStorage(),
})

// For a screen already holding a list fresh from Zernio — the Refresh action
// returns one — so every other screen shows it without asking again.
export function publishConnectedAccounts(workspaceId, accounts) {
  store.replace(workspaceId, accounts)
}

export function useConnectedAccounts(platform = '') {
  const { activeWorkspaceId } = useAuth()
  const workspaceId = activeWorkspaceId || null

  const subscribe = useCallback(fn => store.subscribe(workspaceId, fn), [workspaceId])
  const snapshot = useSyncExternalStore(subscribe, () => store.getSnapshot(workspaceId))

  // Deferred a tick: refresh() marks the entry as refreshing before its first
  // await, and doing that in the effect body is a cascading render. The store
  // drops the call when a live answer is under FRESH_MS old, so five screens
  // mounting together still make one request.
  useEffect(() => {
    if (!workspaceId) return
    queueMicrotask(() => store.refresh(workspaceId))
  }, [workspaceId])

  const refresh = useCallback(() => store.refresh(workspaceId, { force: true }), [workspaceId])

  // "Not answered yet", not "a request is running". A remembered list counts,
  // so a reload paints the accounts at once; an empty memory does not, so no
  // screen says "Not connected" before Zernio has.
  const loading = !!workspaceId && !snapshot.source

  const forPlatform = platform
    ? snapshot.accounts.filter(a => a.platform === platform)
    : snapshot.accounts

  return {
    accounts: forPlatform,
    allAccounts: snapshot.accounts,
    loading,
    // The background check, including over a list already on screen. For a
    // small spinner beside the list, never for replacing it.
    refreshing: snapshot.refreshing,
    // Zernio itself has answered in this session — not memory, not the mirror.
    verified: snapshot.source === 'live',
    error: snapshot.error,
    refresh,
    workspaceId,
    // Live, not cached: "connected" means Zernio currently lists an active
    // account, which is the only definition that can be wrong in a way the
    // user cares about.
    isConnected: forPlatform.some(a => a.is_active !== false),
  }
}

// ─── Driving the OAuth round trip ─────────────────────────────────────────
// Four states, because the flow genuinely has four: idle, about-to-leave,
// back-and-choosing, and committing the choice. TikTok skips the middle two —
// its OAuth identifies exactly one creator, so Zernio finishes the connection
// at the callback. Modelling them explicitly beats a single `busy` boolean,
// which cannot distinguish "we are leaving this page" from "we are back and
// waiting for you to pick something".
//
// Separately from the phase, the hop back may be carrying NEWS: a connection
// that finished on its own, or one that failed at the provider. Both used to
// arrive as an unread query string on a page that rendered as if nothing had
// happened.
export function useConnectFlow(platform, { onConnected } = {}) {
  const { activeWorkspaceId } = useAuth()
  const [phase, setPhase]     = useState('idle')   // idle | starting | selecting | finishing
  const [error, setError]     = useState('')
  // A completed connection, reported rather than left to be inferred from a
  // row appearing in a list the user may not have been looking at.
  const [notice, setNotice]   = useState('')
  const [options, setOptions] = useState([])
  // Distinct from "options is empty" — `loaded` means the list HAS come back,
  // which is what lets the modal tell "still fetching" apart from "fetched,
  // nothing eligible". Conflating them is what made an empty result spin
  // forever instead of saying so.
  const [loaded, setLoaded]   = useState(false)
  const callback              = useRef(null)

  const start = useCallback(async () => {
    setError('')
    setPhase('starting')
    const res = await startConnect(activeWorkspaceId, platform)
    if (res.error) { setError(res.error); setPhase('idle'); return }
    // Full navigation, not a popup: OAuth providers increasingly refuse to
    // render inside one, and a blocked popup is a dead button with no error.
    window.location.href = res.authUrl
  }, [activeWorkspaceId, platform])

  // Declared before the effect below, which calls it. Hoisting would work at
  // runtime — the effect body runs long after this line — but reading it in
  // source order should not require knowing that.
  const finish = useCallback(async (selection) => {
    const cb = callback.current
    if (!cb) return
    setPhase('finishing')
    const res = await completeSelection(activeWorkspaceId, platform, { cb, selection })
    if (res.error) { setError(res.error); setPhase('selecting'); return }
    setPhase('idle')
    setOptions([])
    setNotice(`Connected ${selection?.name ? `${selection.name} ` : ''}successfully.`)
    clearCallbackParams()
    onConnected?.(res.accounts || [])
  }, [activeWorkspaceId, platform, onConnected])

  // Pick up a return from Zernio. Runs on mount, because the callback params
  // are in the URL only on the hop back and re-reading them after the user has
  // moved on would relaunch a flow they already finished.
  //
  // All three outcomes are handled. Previously only the middle one was, so a
  // refusal at the provider and a connection that completed on its own both
  // came back to a screen that rendered exactly as it had before the user left
  // — which is indistinguishable from the button having done nothing.
  useEffect(() => {
    const cb = readConnectCallback()
    if (!cb || !activeWorkspaceId) return
    // The callback lands on /social/<platform>, so a mismatch means this hook
    // belongs to a different platform's panel on the same page. Ignore it and
    // let the right one handle it, rather than both racing for the token.
    if (cb.platform && cb.platform !== platform) return

    // Both terminal branches defer their state write a tick. A setState in an
    // effect BODY runs synchronously during commit — a cascading render, and
    // one React now flags. Same deferral the account list uses for its first
    // fetch.
    if (cb.kind === 'error') {
      const message = explainOAuthError(cb)
      queueMicrotask(() => setError(message))
      clearCallbackParams()
      return
    }

    // Standard mode (TikTok): Zernio already created the account. There is
    // nothing to finish, but the list has to be refreshed — it was fetched on
    // mount, possibly before the account existed — and the user told.
    if (cb.kind === 'connected') {
      const message = cb.username ? `Connected @${cb.username}.` : 'Account connected.'
      queueMicrotask(() => { setNotice(message); onConnected?.([]) })
      clearCallbackParams()
      return
    }

    callback.current = cb
    let cancelled = false
    ;(async () => {
      setPhase('selecting')
      setLoaded(false)
      const res = await fetchSelectionOptions(activeWorkspaceId, platform, cb)
      if (cancelled) return
      // A failed fetch closes the picker with a reason rather than leaving it
      // to spin — the deadlock that hid the first live bug behind an endless
      // spinner. On error the modal closes and the reason shows on the page.
      if (res.error) { setError(res.error); setLoaded(true); setPhase('idle'); return }
      setOptions(res.options)
      setLoaded(true)
      // Zernio can legitimately return exactly one choice — one Facebook Page
      // backs the account — and asking someone to "choose" from a list of one
      // is pure ceremony.
      //
      // Except for a personal identity. LinkedIn always offers the signed-in
      // person's own profile alongside any company pages they administer, so
      // "one option" there means "no company pages came back", and silently
      // connecting somebody's personal LinkedIn because their page admin
      // rights were missing is not a choice to make on their behalf.
      const only = res.options.length === 1 ? res.options[0] : null
      if (only && only.kind !== 'personal') finish(only)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, platform, finish])

  const cancel = useCallback(() => {
    setPhase('idle')
    setOptions([])
    setLoaded(false)
    setError('')
    clearCallbackParams()
  }, [])

  const dismissNotice = useCallback(() => setNotice(''), [])

  return { phase, error, notice, options, loaded, start, finish, cancel, dismissNotice }
}

// Strip the callback params so a reload cannot replay a spent token, reopen a
// picker for a finished flow, or re-show an error the user has already read.
// The path is kept, so the user stays on the platform page they landed on.
function clearCallbackParams() {
  if (typeof window === 'undefined') return
  window.history.replaceState({}, '', window.location.pathname)
}

// Disconnect, with the workspace id supplied for the caller. Kept out of
// useConnectedAccounts so a screen that only READS accounts cannot
// accidentally hold a destructive action it never meant to offer.
export function useDisconnect(refresh) {
  const { activeWorkspaceId } = useAuth()
  const [busyId, setBusyId] = useState('')
  const [error, setError]   = useState('')

  const disconnect = useCallback(async (accountId) => {
    setBusyId(accountId)
    setError('')
    const res = await disconnectAccount(activeWorkspaceId, accountId)
    setBusyId('')
    if (res.error) { setError(res.error); return false }
    await refresh?.()
    return true
  }, [activeWorkspaceId, refresh])

  return { disconnect, busyId, error }
}
