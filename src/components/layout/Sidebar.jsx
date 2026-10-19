import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { sectionOf, canOpen } from '../../lib/modules'
import { NavIcon } from './icons'
import { useBadges } from './useNavBadges'

// ─── The open section's pages (v2) ─────────────────────────────────────────
// 2026-10-19. v1 had one sidebar listing every page in the app under ten
// headings. v2 shows only the pages of the section you are in, next to the
// rail (Rail.jsx) that switches sections. Home, the global pages (assistant,
// Requests, Settings) and one-page sections get no sidebar: the page gets
// the width. See lib/modules.js.

export function Sidebar({ onNavigate }) {
  const { pathname } = useLocation()
  const { isAccessAdmin } = useAuth()
  const badges = useBadges()
  const section = sectionOf(pathname)
  if (!section) return null
  const pages = section.pages.filter(pg => !pg.hidden && canOpen(pg, { isAccessAdmin }))
  // A one-page section (CEO, Admin today) needs no menu: the rail already
  // opened it, and a column holding one link is 208px taken for nothing.
  if (pages.length < 2) return null

  return (
    <aside aria-label={section.label} data-print-hide
      className="w-52 flex-shrink-0 flex flex-col h-full overflow-hidden bg-surface-muted border-r border-border">
      {/* The section's name, level with the top bar's title. */}
      <div className="h-14 flex-shrink-0 px-4 flex flex-col justify-center">
        <p className="font-semibold text-text text-sm leading-none tracking-tight">{section.label}</p>
        <p className="text-[11px] text-text-tertiary mt-1">Arak</p>
      </div>

      {/* v2: inset rounded items, the selected one a soft grey pill
          (.nav-active), as in shadcn/ui's sidebars. */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-0.5" onClick={e => { if (e.target.closest('a')) onNavigate?.() }}>
        {pages.map(item => (
          <NavLink key={item.to} to={item.to} end={item.exact}
            // `notUnder` carves child routes out of a prefix match: the Post
            // Queue and Auto-replies live under Social Media's URL but have
            // their own entries, and two lit items is two answers to "where
            // am I".
            className={({ isActive: matched }) => {
              const isActive = matched && !(item.notUnder || []).some(p => pathname.startsWith(p))
              return `flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] w-full transition-colors duration-150
                ${isActive ? 'nav-active' : 'text-text-secondary hover:bg-stone-100 hover:text-text'}`
            }}>
            <span className="flex-shrink-0"><NavIcon name={item.icon} /></span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge && badges[item.badge] > 0 && (
              <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[10px] font-semibold text-white bg-stone-900">
                {badges[item.badge]}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
