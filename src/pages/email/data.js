import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { subscribe, getEntry, getGeneration, ensure, refresh } from '../../lib/email/cache'

// ─── Email: reading through the session cache ──────────────────────────────
// useCached(key, fetcher) is the one way a tab reads: it paints what this
// session already read for `key` at once, reads it (again) when it is
// missing, stale or older than a minute, and keeps the old rows up while it
// does. The cache itself, and why keys carry the workspace, are in
// src/lib/email/cache.js.
//
//   data       the answer, or undefined before the first one
//   loading    no answer yet, and no failure: show skeletons
//   error      the last read failed (with data: what is shown is the last
//              good answer; without: say it failed, never "none yet")
//   refetch    read this key again now
//
// keep: a list paging or filtering passes its family ("contacts:<ws>"), so
// the rows of the page it is leaving stay up, dimmed, until the next page
// lands, instead of collapsing to skeletons on every click.

export function useCached(key, fetcher, { keep = '' } = {}) {
  const read = () => getEntry(key)
  const entry = useSyncExternalStore(subscribe, read, read)
  const generation = useSyncExternalStore(subscribe, getGeneration, getGeneration)
  const latest = useRef(fetcher)
  useEffect(() => { latest.current = fetcher })
  useEffect(() => { if (key) ensure(key, () => latest.current()) }, [key, generation])

  // The last answer of the same family, for `keep`.
  const [held, setHeld] = useState(null)
  if (keep && entry?.data !== undefined && (held?.data !== entry.data || held?.keep !== keep)) setHeld({ keep, data: entry.data })
  const fallback = keep && held?.keep === keep ? held.data : undefined

  const own = entry?.data
  const data = own !== undefined ? own : fallback
  const refetch = useCallback(() => (key ? refresh(key, () => latest.current()) : Promise.resolve()), [key])
  return {
    data,
    error: entry?.error || '',
    loading: Boolean(key) && data === undefined && !entry?.error,
    // Rows on screen are from another page or filter, or being re-read.
    stale: own === undefined && data !== undefined,
    refreshing: Boolean(entry?.token),
    refetch,
  }
}

/** Text that settles: the value `ms` after the last change, for a search box. */
export function useDebounced(value, ms = 300) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

/**
 * A page number that goes back to the first page whenever `resetOn` changes
 * (a filter, a search, another workspace).
 */
export function usePage(resetOn) {
  const [state, setState] = useState({ page: 0, on: resetOn })
  if (state.on !== resetOn) setState({ page: 0, on: resetOn })
  const page = state.on === resetOn ? state.page : 0
  const setPage = useCallback(p => setState({ page: Math.max(0, p), on: resetOn }), [resetOn])
  return [page, setPage]
}

/**
 * The page to step back to when the list shrank under the one on screen
 * (its last rows were deleted or answered), or null. Called while
 * rendering, with what the read of this page said.
 */
export function pageBeyond(read, page, size) {
  const count = read.data?.count
  if (read.stale || count == null || page === 0) return null
  const last = Math.max(0, Math.ceil(count / size) - 1)
  return page > last ? last : null
}
