import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'

export function RequireAuth({ children }) {
  const { session, loading, workspaces } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#EEF1EF' }}>
        <div className="w-5 h-5 border-2 border-[#5E6572] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Authenticated but no workspace yet — shouldn't normally happen since
  // handle_new_user() provisions one at signup, but covers the edge case
  // (e.g. email confirmation flows where the session resolves separately).
  if (workspaces.length === 0) {
    return <Navigate to="/onboarding" replace />
  }

  return children
}
