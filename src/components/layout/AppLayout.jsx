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
          <div key={location.pathname} className="p-7 page-enter">{children}</div>
        </main>
      </div>
    </div>
  )
}
