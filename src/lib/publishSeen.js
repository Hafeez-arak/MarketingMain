import { useSyncExternalStore, useCallback } from 'react'

// ─── Which publishes you have already been told about ──────────────────────
// Two sets, per workspace, in localStorage:
//
//   announced  post ids that have already produced a notification. Stops the
//              bell from re-announcing the same post every poll, and — because
//              the notification store itself is NOT persisted (see
//              appStore's PERSIST_KEYS) — every time the tab is reloaded.
//   unseen     post ids announced but not yet opened. The calendar draws these
//              darker; clicking one clears it.
//
// The first time a workspace is watched there is no record, so everything
// already published is folded straight into `announced` with nothing unseen.
// Without that seeding, signing in would announce months of history at once.
//
// localStorage rather than a table: this is "has this person looked at it
// yet", which is per-person and per-device, and inventing a synced read-state
// table for a notification dot would be a schema change to avoid a refresh.

const KEY = ws => `arak.publishSeen.${ws || 'none'}`
const CAP = 400   // ids kept, newest first — a publish history, not an archive

const EMPTY = { announced: [], unseen: [], seeded: false }

// One cached snapshot per key. useSyncExternalStore compares getSnapshot()
// results by identity, so parsing localStorage fresh on every call would
// return a new object each time and spin forever.
const cache = new Map()
const listeners = new Set()

function read(workspaceId) {
  const key = KEY(workspaceId)
  if (cache.has(key)) return cache.get(key)
  let value = EMPTY
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const p = JSON.parse(raw)
      value = {
        announced: Array.isArray(p.announced) ? p.announced : [],
        unseen: Array.isArray(p.unseen) ? p.unseen : [],
        seeded: p.seeded === true,
      }
    }
  } catch { /* private browsing, bad JSON — an empty record is a safe start */ }
  cache.set(key, value)
  return value
}

function write(workspaceId, next) {
  const key = KEY(workspaceId)
  const value = {
    announced: next.announced.slice(0, CAP),
    unseen: next.unseen.slice(0, CAP),
    seeded: next.seeded === true,
  }
  cache.set(key, value)
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota, private mode */ }
  for (const fn of listeners) fn()
  return value
}

const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }

// Fold a fresh list of published posts into the record.
//
// Returns the posts worth announcing — empty on the seeding pass, and empty
// whenever nothing new has landed, so the caller can skip dispatching without
// having to diff anything itself.
export function recordPublished(workspaceId, publishedPosts) {
  if (!workspaceId) return []
  const record = read(workspaceId)
  const ids = publishedPosts.map(p => p.id).filter(Boolean)
  const known = new Set(record.announced)
  const fresh = publishedPosts.filter(p => p.id && !known.has(p.id))

  // First sight of this workspace: everything already out is history.
  if (!record.seeded) {
    write(workspaceId, { announced: ids, unseen: [], seeded: true })
    return []
  }
  if (!fresh.length) return []

  write(workspaceId, {
    announced: [...fresh.map(p => p.id), ...record.announced],
    unseen: [...fresh.map(p => p.id), ...record.unseen],
    seeded: true,
  })
  return fresh
}

export function markSeen(workspaceId, postId) {
  if (!workspaceId || !postId) return
  const record = read(workspaceId)
  if (!record.unseen.includes(postId)) return
  write(workspaceId, { ...record, unseen: record.unseen.filter(id => id !== postId) })
}

export function markAllSeen(workspaceId) {
  if (!workspaceId) return
  const record = read(workspaceId)
  if (!record.unseen.length) return
  write(workspaceId, { ...record, unseen: [] })
}

// The unseen ids, as a Set the calendar can ask about per chip.
export function useUnseenPublished(workspaceId) {
  const snapshot = useSyncExternalStore(
    subscribe,
    useCallback(() => read(workspaceId), [workspaceId]),
    useCallback(() => EMPTY, []),
  )
  return snapshot.unseen
}
