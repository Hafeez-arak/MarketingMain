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
      className="w-52 flex-shrink-0 flex flex-col h-full overflow-hidden bg-white border-r border-border">
      {/* The section's name, the height of the top bar so the two rules form
          one line across the window. */}
      <div className="h-14 flex-shrink-0 px-5 flex flex-col justify-center border-b border-border">
        <p className="font-semibold text-text text-sm leading-none tracking-tight">{section.label}</p>
        <p className="eyebrow text-text-tertiary mt-1">Arak</p>
      </div>

      {/* Items run full-bleed so the active marker sits flush against the
          sidebar's own border; an inset pill would float it in a gutter. */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3" onClick={e => { if (e.target.closest('a')) onNavigate?.() }}>
        {pages.map(item => (
          <NavLink key={item.to} to={item.to} end={item.exact}
            // `notUnder` carves child routes out of a prefix match: the Post
            // Queue and Auto-replies live under Social Media's URL but have
            // their own entries, and two lit items is two answers to "where
            // am I".
            className={({ isActive: matched }) => {
              const isActive = matched && !(item.notUnder || []).some(p => pathname.startsWith(p))
              return `flex items-center gap-2.5 pl-[18px] pr-4 py-1.5 text-[13px] w-full border-l-2 border-transparent transition-colors duration-150
                ${isActive ? 'nav-active' : 'text-text-secondary hover:bg-surface-subtle hover:text-text'}`
            }}>
            <span className="flex-shrink-0"><NavIcon name={item.icon} /></span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge && badges[item.badge] > 0 && (
              <span className="flex-shrink-0 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-amber-700">
                {badges[item.badge]}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
