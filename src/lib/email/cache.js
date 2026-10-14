// ─── Email: what has been read this session ────────────────────────────────
// Each tab of the Email section reads only what it shows, when it is opened.
// What it read is kept here, by key, for the rest of the session, so going
// back to a tab paints at once from what was read last time and refreshes
// quietly behind it.
//
// A key names one read in full: what, for which workspace, with which
// filters and page ("contacts:<ws>:<filters>:<page>"). Two companies never
// share a key, so a workspace switch can never paint the other one's rows.
//
// After a change (a save, an import, a send) the page calls invalidate():
// every key goes stale at once. What is on screen re-reads now, keeping its
// rows up meanwhile; the rest re-reads when it is next shown.
//
// Pure: no React, no Supabase. src/pages/email/data.js is the React side.

const MAX_AGE_MS = 60_000      // older than this re-reads (quietly) when shown again
const MAX_KEYS = 150           // a long session paging through thousands stays small

const entries = new Map()       // key -> { data, error, at, gen, token, pendingGen }
const listeners = new Set()
let generation = 0

function notify() { for (const fn of listeners) fn() }

function write(key, entry) {
  entries.delete(key)           // re-insert: the Map's order is the age order
  entries.set(key, entry)
  if (entries.size > MAX_KEYS) {
    for (const [k, e] of entries) {
      if (entries.size <= MAX_KEYS) break
      if (!e.token) entries.delete(k)
    }
  }
  notify()
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getEntry(key) { return key ? entries.get(key) : undefined }
export function getGeneration() { return generation }

/** Whether a key's last answer can be shown without asking again. */
export function isFresh(entry, now = Date.now()) {
  return Boolean(entry && !entry.token && !entry.error && entry.gen === generation && now - entry.at < MAX_AGE_MS)
}

/** Read `key` with `fetcher` unless a fresh answer, or a read of this generation, is already there. */
export function ensure(key, fetcher) {
  const e = entries.get(key)
  if (e?.token && e.pendingGen === generation) return
  if (isFresh(e)) return
  refresh(key, fetcher)
}

/** Read `key` again now, whatever is there. What was there stays up until the answer lands. */
export function refresh(key, fetcher) {
  const token = {}
  const gen = generation
  write(key, { ...entries.get(key), error: '', token, pendingGen: gen })
  return Promise.resolve().then(fetcher).then(
    data => {
      if (entries.get(key)?.token !== token) return
      write(key, { data, error: '', at: Date.now(), gen, token: null, pendingGen: null })
    },
    err => {
      const cur = entries.get(key)
      if (cur?.token !== token) return
      // A failed read keeps the last good rows (a refresh that failed is not
      // an empty list), and says it failed.
      write(key, { data: cur.data, error: err?.message || String(err) || 'Could not load.', at: Date.now(), gen, token: null, pendingGen: null })
    },
  )
}

/** Put an answer in without reading: a row just saved, so the next screen has it. */
export function prime(key, data) {
  write(key, { data, error: '', at: Date.now(), gen: generation, token: null, pendingGen: null })
}

/** Everything read so far is stale: what is shown re-reads now, the rest when next shown. */
export function invalidate() {
  generation++
  notify()
}

/** For tests. */
export function clearCache() {
  entries.clear()
  generation = 0
  notify()
}
