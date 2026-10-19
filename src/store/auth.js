import { createContext, useContext } from 'react'
import { sectionLevel, atLeast } from '../lib/modules'

// ─── Auth context and hook ─────────────────────────────────────────────────
// Split out of AuthContext.jsx, which keeps <AuthProvider>, for the Fast
// Refresh reason described in ./app.js.

export const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  // v2's section fields (AuthContext.jsx) for a context built without them,
  // like the dev harnesses' hand-made ones: v1's admin / member rule.
  if (ctx.who) return ctx
  const who = { isAccessAdmin: Boolean(ctx.isAccessAdmin), sections: ctx.sections ?? null }
  return {
    ...ctx,
    who,
    sectionsReady: ctx.sectionsReady ?? true,
    sectionLevel: key => sectionLevel(key, who),
    canSection: (key, min = 'view') => atLeast(sectionLevel(key, who), min),
  }
}
