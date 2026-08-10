import { createContext, useContext } from 'react'

// ─── Auth context and hook ─────────────────────────────────────────────────
// Split out of AuthContext.jsx, which keeps <AuthProvider>, for the Fast
// Refresh reason described in ./app.js.

export const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
