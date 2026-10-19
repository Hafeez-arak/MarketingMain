import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { sectionOf, menuPages } from '../../lib/modules'
import { NavIcon } from './icons'
import { useBadges } from './useNavBadges'

// ─── The open section's pages (v2) ─────────────────────────────────────────
// 2026-10-19. v1 had one sidebar listing every page in the app under ten
// headings. v2 shows only the pages of the section you are in, next to the
// rail (Rail.jsx) that switches sections. Home, the global pages (assistant,
// Requests, Settings) and one-page sections get no sidebar: the page gets
// the width. See lib/modules.js.

// Collapsible (2026-10-19): the panel button at the left of the top bar, or
// Ctrl/⌘+B (shadcn/ui's shortcut), hides it; AppLayout keeps the choice. On
// a phone it is part of the drawer and never collapsed.
export function Sidebar({ onNavigate, collapsed = false }) {
  const { pathname } = useLocation()
  const { isAccessAdmin } = useAuth()
  const badges = useBadges()
  const section = sectionOf(pathname)
  const pages = menuPages(pathname, { isAccessAdmin })
  if (!pages.length) return null

  return (
    <aside aria-label={section.label} data-print-hide
      className={`w-52 flex-shrink-0 flex flex-col h-full overflow-hidden bg-surface-muted border-r border-border ${collapsed ? 'md:hidden' : ''}`}>
      {/* The section's name, level with the top bar's title. */}
      <div className="h-14 flex-shrink-0 px-4 flex items-center">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text text-sm leading-none tracking-tight truncate">{section.label}</p>
          <p className="text-[11px] text-text-tertiary mt-1">Arak</p>
        </div>
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
