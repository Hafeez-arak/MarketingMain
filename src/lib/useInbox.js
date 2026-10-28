import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchInbox, markRead } from './requests'

// ─── The bell's saved notifications ────────────────────────────────────────
// Polled, not live: the app uses no realtime anywhere, and a minute's delay
// on "Sara finished your request" is fine. Also re-read whenever the tab
// comes back into focus, which is when a person actually looks.

const EVERY_MS = 60_000

export function useInbox(userId) {
  const [items, setItems] = useState([])
  const alive = useRef(true)

  const load = useCallback(async () => {
    if (!userId) return
    const { rows } = await fetchInbox()
    if (alive.current) setItems(rows)
  }, [userId])

  useEffect(() => {
    alive.current = true
    if (!userId) return undefined
    // The first read is deferred a tick so the effect body itself sets no state.
    const first = setTimeout(load, 0)
    const timer = setInterval(load, EVERY_MS)
    const onFocus = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      alive.current = false
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [userId, load])

  const read = useCallback(async ids => {
    const want = (ids || items.filter(n => !n.read_at).map(n => n.id))
    if (!want.length) return
    const now = new Date().toISOString()
    setItems(list => list.map(n => (want.includes(n.id) && !n.read_at ? { ...n, read_at: now } : n)))
    await markRead(want)
  }, [items])

  return { items, unread: items.filter(n => !n.read_at).length, read, reload: load }
}
