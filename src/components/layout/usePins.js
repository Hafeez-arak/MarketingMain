import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchPins, savePins } from '../../lib/shell/client'
import { railSections, togglePin, canPin } from '../../lib/shell/pins'

// ─── The sections pinned to the left bar, read once and shared (v2 shell) ──
// 2026-10-28, docs/SHELL.md. AppLayout reads this person's pins for the open
// company and shares them with the rail (which draws them) and Home's tiles
// (which change them). The rules are in lib/shell/pins.js.

export function usePinsState() {
  const { user, activeWorkspaceId, who, sectionsReady } = useAuth()
  const userId = user?.id || null
  const key = `${activeWorkspaceId}|${userId}`
  // Kept with the company and person it was read for, so switching
  // companies never draws the previous one's pins.
  const [state, setState] = useState({ key: null, stored: null })
  const [saveError, setSaveError] = useState(false)
  const queue = useRef(Promise.resolve())

  const load = useCallback(async () => {
    if (!activeWorkspaceId || !userId) return
    const r = await fetchPins(activeWorkspaceId, userId)
    // A failed read (the table not there yet) draws the defaults.
    setState({ key, stored: r.sections })
  }, [activeWorkspaceId, userId, key])

  useEffect(() => { queueMicrotask(load) }, [load])

  const loaded = state.key === key
  const stored = loaded ? state.stored : null

  /** Pin or unpin a section: drawn at once, saved behind it; a failed save re-reads and says so. */
  const toggle = useCallback(sectionKey => {
    if (!activeWorkspaceId || !userId || !canPin(who)) return
    const next = togglePin(sectionKey, who, stored)
    setState({ key, stored: next })
    setSaveError(false)
    // One save at a time, in order, so the last choice is the one kept.
    queue.current = queue.current.then(async () => {
      const r = await savePins(activeWorkspaceId, userId, next)
      if (r.error) { setSaveError(true); await load() }
    })
  }, [activeWorkspaceId, userId, who, key, load, stored])

  return {
    // Until both the grants and the pins are read, the rail draws no
    // sections rather than the wrong ones.
    ready: loaded && sectionsReady,
    stored,
    sections: railSections(who, stored),
    toggle,
    saveError,
  }
}

const NONE = { ready: true, stored: null, sections: null, toggle: () => {}, saveError: false }

export const PinsContext = createContext(NONE)

/** The pins as AppLayout read them. `sections` null outside the layout: callers fall back to the defaults. */
export const usePins = () => useContext(PinsContext)
