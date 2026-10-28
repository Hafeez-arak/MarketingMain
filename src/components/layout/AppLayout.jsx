import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Rail } from './Rail'
import { useNavBadges, NavBadgesContext } from './useNavBadges'
import { usePinsState, PinsContext } from './usePins'
import { SearchPalette } from './SearchPalette'
import { useAuth } from '../../store/auth'
import { menuPages, isTranslated } from '../../lib/modules'
import { useLang, dirOf } from '../../lib/i18n'
import { Topbar } from './Topbar'
import { AssistantDrawer } from '../AssistantDrawer'
import { usePublishWatch } from '../../lib/usePublishWatch'

const MENU_KEY = 'arak.v2.menu'

export function AppLayout({ children }) {
  const location = useLocation()
  // Mounted here rather than on /schedule: a post goes out on Zernio's clock,
  // not on whichever page happens to be open, so the bell has to be watching
  // from wherever you are. See lib/usePublishWatch.js.
  usePublishWatch()
  // The counts on navigation items, read once and shared with the rail, the
  // section sidebar and Home's tiles.
  const badges = useNavBadges()
  // The sections this person pinned to the rail, shared with Home's tiles.
  const pins = usePinsState()
  // The Ctrl/⌘+K search (docs/SHELL.md). Works from anywhere, inputs too.
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.key === 'k' || e.key === 'K') || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      e.preventDefault()
      setSearchOpen(o => !o)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const { who } = useAuth()
  // Arabic turns the shell right-to-left (<html dir>, lib/i18n.js); a page
  // not yet translated keeps its English left-to-right inside it.
  const lang = useLang()
  const pageDir = isTranslated(location.pathname) ? dirOf(lang) : 'ltr'
  // The section menu can be hidden for more room (desktop only; on a phone
  // it lives in the drawer). Remembered per browser.
  const [menuHidden, setMenuHidden] = useState(() => {
    try { return localStorage.getItem(MENU_KEY) === 'hidden' } catch { return false }
  })
  const hasMenu = menuPages(location.pathname, who).length > 0
  const toggleMenu = () => setMenuHidden(h => {
    try { localStorage.setItem(MENU_KEY, h ? 'shown' : 'hidden') } catch { /* private window */ }
    return !h
  })
  // Ctrl/⌘+B, as in shadcn/ui and most editors. Not while typing.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.key === 'b' || e.key === 'B') || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      toggleMenu()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  // The phone drawer (below md). Kept as the path it was opened on, so any
  // navigation — a link, the bell, a workspace switch — closes it without an
  // effect resetting state.
  const [navOpenAt, setNavOpenAt] = useState(null)
  const navOpen = navOpenAt === location.pathname
  const closeNav = () => setNavOpenAt(null)
  useEffect(() => {
    if (!navOpen) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setNavOpenAt(null)
      document.getElementById('nav-toggle')?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navOpen])
  return (
    // ── data-print-* ──
    // This shell is `h-screen overflow-hidden` around an inner scroller, which
    // is right on a screen and fatal on paper: printed untouched it emits one
    // page — the first viewport — and clips the rest inside an overflow that
    // print has no concept of. The report pages are real documents, so the
    // chain from here down is marked for the @media print block in index.css
    // to unwind. Nothing changes on screen.
    <NavBadgesContext.Provider value={badges}>
    <PinsContext.Provider value={pins}>
    <div className="flex h-screen overflow-hidden" data-print-shell dir={dirOf(lang)} lang={lang}>
      {/* v2 (2026-10-19): the rail of sections, then the open section's own
          pages (none on Home and the global pages). Below md both are one
          drawer, opened from the top bar. */}
      <div id="app-sidebar" data-print-hide
        className={`flex h-full flex-shrink-0
          max-md:fixed max-md:inset-y-0 max-md:start-0 max-md:z-50 max-md:shadow-dropdown
          max-md:transition-[transform,visibility] max-md:duration-200
          ${navOpen ? '' : 'max-md:-translate-x-full rtl:max-md:translate-x-full max-md:invisible'}`}>
        <Rail onNavigate={closeNav} menuHidden={menuHidden} />
        <Sidebar onNavigate={closeNav} collapsed={menuHidden} />
      </div>
      {navOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 md:hidden" aria-hidden="true" onClick={closeNav} data-print-hide />
      )}
      {/* v2: the page sits in a white rounded panel inset on the grey frame,
          shadcn/ui's "inset" sidebar layout. Edge to edge on a phone. */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-surface-muted md:py-2 md:pe-2" data-print-shell>
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white md:rounded-xl md:border md:border-border" data-print-shell>
        <Topbar navOpen={navOpen} onMenu={() => (navOpen ? closeNav() : setNavOpenAt(location.pathname))}
          menuHidden={hasMenu ? menuHidden : null} onToggleMenu={toggleMenu} onSearch={() => setSearchOpen(true)} />
        <main className="flex-1 overflow-y-auto scrollbar-thin bg-white" data-print-shell>
          {/* One page gutter, everywhere. Pages set their own max-width and
              internal rhythm, but none of them should change this number —
              the gutter is what makes a card's left edge line up with the
              card on the page you just came from. Narrower on a phone, where
              24px a side is an eighth of the screen. */}
          <div key={location.pathname} dir={pageDir} className="p-3 md:p-6 page-enter" data-print-gutter>{children}</div>
        </main>
      </div>
      </div>
      {/* Mounted at the layout, not per page, so the conversation survives
          navigation. AGENT.md §5a: continuing a thread across screens is the
          difference between an assistant and a search box. */}
      {/* Wrapped only because the drawer returns a fragment, and an attribute
          cannot be hung on one. Its children are all `fixed`, so the wrapper
          is a zero-width flex item and changes nothing on screen. */}
      <div data-print-hide><AssistantDrawer /></div>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
    </PinsContext.Provider>
    </NavBadgesContext.Provider>
  )
}
