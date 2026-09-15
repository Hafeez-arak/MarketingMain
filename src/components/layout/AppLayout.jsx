import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { AssistantDrawer } from '../AssistantDrawer'
export function AppLayout({ children }) {
  const location = useLocation()
  return (
    // ── data-print-* ──
    // This shell is `h-screen overflow-hidden` around an inner scroller, which
    // is right on a screen and fatal on paper: printed untouched it emits one
    // page — the first viewport — and clips the rest inside an overflow that
    // print has no concept of. The report pages are real documents, so the
    // chain from here down is marked for the @media print block in index.css
    // to unwind. Nothing changes on screen.
    <div className="flex h-screen overflow-hidden" data-print-shell>
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden" data-print-shell>
        <Topbar />
        <main className="flex-1 overflow-y-auto scrollbar-thin bg-surface-muted" data-print-shell>
          {/* One page gutter, everywhere. Pages set their own max-width and
              internal rhythm, but none of them should change this number —
              the gutter is what makes a card's left edge line up with the
              card on the page you just came from. */}
          <div key={location.pathname} className="p-6 page-enter" data-print-gutter>{children}</div>
        </main>
      </div>
      {/* Mounted at the layout, not per page, so the conversation survives
          navigation. AGENT.md §5a: continuing a thread across screens is the
          difference between an assistant and a search box. */}
      {/* Wrapped only because the drawer returns a fragment, and an attribute
          cannot be hung on one. Its children are all `fixed`, so the wrapper
          is a zero-width flex item and changes nothing on screen. */}
      <div data-print-hide><AssistantDrawer /></div>
    </div>
  )
}
