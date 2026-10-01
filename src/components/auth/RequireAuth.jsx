import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { PendingApproval } from '../../pages/auth/PendingApproval'

export function RequireAuth({ children }) {
  const { session, loading, isApproved, workspaces } = useAuth()
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

  // Signed in, but the admin hasn't let them in yet — or has taken it away.
  // Rendered in place rather than redirected to a route, so there's no URL
  // for a pending user to skip past by typing a different one.
  if (!isApproved) {
    return <PendingApproval />
  }

  // Approved, but holding no company. The ordinary case for someone who was
  // just approved: approval lets you sign in and gives you nothing until the
  // admin ticks a company for you. The onboarding page says that — or, for
  // the admin with no companies at all, offers to create the first one.
  if (workspaces.length === 0) {
    return <Navigate to="/onboarding" replace />
  }

  return children
}
