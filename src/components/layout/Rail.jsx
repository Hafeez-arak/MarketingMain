import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { HOME, GLOBAL_PAGES, sectionsFor, sectionOf } from '../../lib/modules'
import { NavIcon } from './icons'
import { useBadges, sectionBadge } from './useNavBadges'
import { ArakMark } from './ArakMark'

// ─── The rail: one icon per section (v2) ───────────────────────────────────
// 2026-10-19. The far-left column: the logo, Home, the sections this person
// can open, and at the foot the pages that belong to no section (assistant,
// Requests, Settings). One click moves between sections, which a launcher
// alone cannot do: it sends you back to Home each time. See lib/modules.js
// and docs/COMPANY-HUB-PLAN.md.

// Light and quiet (shadcn/ui), with a short label under each icon, as in
// Slack's rail (the owner asked for it, 2026-10-19): an icon alone made people
// guess. The open section's icon sits in a soft grey square.
const box = active => `relative w-10 h-8 rounded-lg flex items-center justify-center transition-colors
  ${active ? 'bg-stone-200/80 text-text' : 'text-text-secondary group-hover:bg-stone-100 group-hover:text-text'}`

function Dot({ n }) {
  if (!n) return null
  return (
    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-semibold text-white bg-red-500 rounded-full ring-2 ring-surface-muted">
      {n > 99 ? '99+' : n}
    </span>
  )
}

export function Rail({ onNavigate }) {
  const { pathname } = useLocation()
  const { isAccessAdmin } = useAuth()
  const badges = useBadges()
  const sections = sectionsFor({ isAccessAdmin })
  const here = sectionOf(pathname)?.key || null

  const link = (to, label, icon, active, n) => (
    <NavLink key={to} to={to} aria-current={active ? 'page' : undefined} onClick={onNavigate}
      className="group w-full flex flex-col items-center gap-1 py-1 focus:outline-none focus-visible:[&>span:first-child]:ring-2 focus-visible:[&>span:first-child]:ring-stone-300">
      <span className={box(active)}>
        <NavIcon name={icon} className="w-[18px] h-[18px]" />
        <Dot n={n} />
      </span>
      <span className={`text-[10px] leading-tight text-center ${active ? 'text-text font-semibold' : 'text-text-secondary group-hover:text-text'}`}>{label}</span>
    </NavLink>
  )

  return (
    <nav aria-label="Sections" data-print-hide
      className="w-[72px] flex-shrink-0 h-full bg-surface-muted border-r border-border flex flex-col items-center py-2 overflow-y-auto scrollbar-thin">
      {/* Arak's mark, at the top bar's height so the two line up. */}
      <div className="h-12 flex items-center justify-center mb-1 flex-shrink-0">
        <ArakMark />
      </div>
      {link(HOME.to, HOME.label, HOME.icon, pathname === '/', 0)}
      <span className="w-8 border-t border-border my-1.5 flex-shrink-0" aria-hidden="true" />
      {sections.map(s => link(s.pages[0].to, s.label, s.icon, here === s.key, sectionBadge(s, badges)))}
      <div className="flex-1 min-h-4" />
      {GLOBAL_PAGES.map(g => link(g.to, g.label, g.icon, pathname === g.to || pathname.startsWith(`${g.to}/`), g.badge ? badges[g.badge] : 0))}
    </nav>
  )
}
