import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../store/auth'
import {
  fetchConnectedAccounts, startConnect, disconnectAccount,
  readConnectCallback, fetchSelectionOptions, completeSelection,
} from './zernioConnect'

// ─── The one place a screen asks "what is actually connected?" ─────────────
// Replaces `state.connectedAccounts[platform]`, a boolean in localStorage that
// the Connect button set to true without connecting anything. Every screen
// agreed the account was connected; the platform had never heard of it, and
// the first publish was where that surfaced.
//
// This holds the real list from Zernio, scoped to the active workspace. An
// empty list is a legitimate answer, not an error — a new workspace has
// nothing connected and should be told so plainly.

export function useConnectedAccounts(platform = '') {
  const { activeWorkspaceId } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  // Guards a stale response from a PREVIOUS workspace overwriting the current
  // one's list. Switching workspace fires a second load while the first is in
  // flight, and out-of-order arrival would leave one workspace's accounts on
  // another's screen — which, on a publish screen, is how you post as the
  // wrong brand.
  const requestSeq = useRef(0)

  const refresh = useCallback(async () => {
    if (!activeWorkspaceId) { setAccounts([]); return }
    const seq = ++requestSeq.current
    setLoading(true)
    setError('')
    const res = await fetchConnectedAccounts(activeWorkspaceId)
    if (seq !== requestSeq.current) return
    setLoading(false)
    if (res.error) { setError(res.error); return }
    setAccounts(res.accounts || [])
  }, [activeWorkspaceId])

  // Deferred a tick rather than called straight from the effect body. refresh()
  // flips `loading` before its first await, so calling it inline sets state
  // synchronously during commit — a cascading render, and one React now flags.
  // Same deferral InstagramPage uses for its first fetch. The requestSeq guard
  // above, not this, is what keeps a stale response from landing.
  useEffect(() => { queueMicrotask(refresh) }, [refresh])

  const forPlatform = platform
    ? accounts.filter(a => a.platform === platform)
    : accounts

  return {
    accounts: forPlatform,
    allAccounts: accounts,
    loading,
    error,
    refresh,
    workspaceId: activeWorkspaceId,
    // Live, not cached: "connected" means Zernio currently lists an active
    // account, which is the only definition that can be wrong in a way the
    // user cares about.
    isConnected: forPlatform.some(a => a.is_active !== false),
  }
}

// ─── Driving the OAuth round trip ─────────────────────────────────────────
// Three states, because Instagram genuinely has three steps: idle, waiting on
// the redirect, and back-from-OAuth-but-still-needing-a-page-chosen. TikTok
// skips the third. Modelling them explicitly beats a single `busy` boolean,
// which cannot distinguish "we are about to leave this page" from "we are back
// and waiting for you to pick something".
export function useConnectFlow(platform, { onConnected } = {}) {
  const { activeWorkspaceId } = useAuth()
  const [phase, setPhase]     = useState('idle')   // idle | starting | selecting | finishing
  const [error, setError]     = useState('')
  const [options, setOptions] = useState([])
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
    const res = await completeSelection(activeWorkspaceId, platform, { ...cb, selection })
    if (res.error) { setError(res.error); setPhase('selecting'); return }
    setPhase('idle')
    setOptions([])
    // Strip the callback params so a refresh doesn't reopen the picker with a
    // token that has already been spent.
    window.history.replaceState({}, '', window.location.pathname)
    onConnected?.(res.accounts || [])
  }, [activeWorkspaceId, platform, onConnected])

  // Pick up a return from Zernio. Runs once on mount: the tempToken is in the
  // URL only on the hop back, and re-reading it after the user has moved on
  // would relaunch a picker for a flow they already finished.
  useEffect(() => {
    const cb = readConnectCallback()
    if (!cb || !activeWorkspaceId) return
    callback.current = cb
    let cancelled = false
    ;(async () => {
      setPhase('selecting')
      const res = await fetchSelectionOptions(activeWorkspaceId, platform, cb)
      if (cancelled) return
      if (res.error) { setError(res.error); setPhase('idle'); return }
      setOptions(res.options)
      // Zernio can legitimately return exactly one choice (one Facebook page
      // backs the account). Asking someone to "choose" from a list of one is
      // pure ceremony, so that case completes itself.
      if (res.options.length === 1) finish(res.options[0])
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, platform, finish])

  const cancel = useCallback(() => {
    setPhase('idle')
    setOptions([])
    setError('')
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  return { phase, error, options, start, finish, cancel }
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
