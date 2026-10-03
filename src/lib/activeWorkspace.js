// ─── Which company you were in, across a refresh ───────────────────────────
// The active company lived only in React state, so a refresh forgot it and
// the app reopened in the first company the membership query returned —
// Arak, for most people — whichever one they had been working in.
//
// Kept in localStorage, keyed by user, because it is a per-browser
// convenience and nothing more: it never grants anything. The id is only
// honoured while it is still in the list of companies the database says this
// person belongs to, so a company removed from them (or deleted) quietly
// gives way to the first one they do hold.

const KEY_PREFIX = 'campai_active_workspace:'

const keyFor = userId => `${KEY_PREFIX}${userId}`

/** The company id this user last chose in this browser, or '' if none. */
export function rememberedWorkspace(userId) {
  if (!userId) return ''
  try {
    return localStorage.getItem(keyFor(userId)) || ''
  } catch {
    // Private browsing or blocked storage: behave as if nothing was saved.
    return ''
  }
}

export function rememberWorkspace(userId, workspaceId) {
  if (!userId || !workspaceId) return
  try {
    localStorage.setItem(keyFor(userId), workspaceId)
  } catch { /* a convenience, never a blocker */ }
}

/**
 * Which company to show, given the one already open (if any), the one saved
 * from last time, and the companies this person actually holds. The first
 * of those that is still in the list wins.
 */
export function pickActiveWorkspace(current, remembered, workspaces = []) {
  const holds = id => !!id && workspaces.some(w => w.id === id)
  if (holds(current)) return current
  if (holds(remembered)) return remembered
  return workspaces[0]?.id || null
}
