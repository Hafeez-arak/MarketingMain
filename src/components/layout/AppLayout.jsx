import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
export function AppLayout({ children }) {
  const location = useLocation()
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto scrollbar-thin bg-surface-muted">
          {/* One page gutter, everywhere. Pages set their own max-width and
              internal rhythm, but none of them should change this number —
              the gutter is what makes a card's left edge line up with the
              card on the page you just came from. */}
          <div key={location.pathname} className="p-6 page-enter">{children}</div>
        </main>
      </div>
    </div>
  )
}
