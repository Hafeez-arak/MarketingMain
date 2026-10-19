import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { HOME, GLOBAL_PAGES, sectionsFor, sectionOf } from '../../lib/modules'
import { NavIcon } from './icons'
import { useBadges, sectionBadge } from './useNavBadges'

// ─── The rail: one icon per section (v2) ───────────────────────────────────
// 2026-10-19. The far-left column: the logo, Home, the sections this person
// can open, and at the foot the pages that belong to no section (assistant,
// Requests, Settings). One click moves between sections, which a launcher
// alone cannot do: it sends you back to Home each time. See lib/modules.js
// and docs/COMPANY-HUB-PLAN.md.

// Near-black, as Arak's brand: the open section is lit in its gold, the way
// the brand shows light against shadow. Everything else is a quiet grey.
const cell = active => `relative w-10 h-10 flex items-center justify-center transition-colors
  ${active ? 'bg-white/10 text-amber-400' : 'text-stone-400 hover:bg-white/5 hover:text-white'}`

function Dot({ n }) {
  if (!n) return null
  return (
    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-600 rounded-full">
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

  // The rail's labels are tooltips and aria-labels: at 56px there is no room
  // for words, and the section sidebar beside it names the open section.
  const link = (to, label, icon, active, n) => (
    <NavLink key={to} to={to} title={label} aria-label={label} aria-current={active ? 'page' : undefined} onClick={onNavigate} className={cell(active)}>
      <NavIcon name={icon} className="w-5 h-5" />
      <Dot n={n} />
    </NavLink>
  )

  return (
    <nav aria-label="Sections" data-print-hide
      className="w-14 flex-shrink-0 h-full bg-stone-950 flex flex-col items-center py-2 gap-1.5">
      {/* The brand mark, the height of the top bar so their rules line up. */}
      <div className="h-12 flex items-center justify-center mb-1">
        <div className="w-8 h-8 border border-white/15 flex items-center justify-center" title="Arak">
          <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
          </svg>
        </div>
      </div>
      {link(HOME.to, HOME.label, HOME.icon, pathname === '/', 0)}
      <span className="w-6 border-t border-white/10 my-1" aria-hidden="true" />
      {sections.map(s => link(s.pages[0].to, s.label, s.icon, here === s.key, sectionBadge(s, badges)))}
      <div className="flex-1" />
      {GLOBAL_PAGES.map(g => link(g.to, g.label, g.icon, pathname === g.to || pathname.startsWith(`${g.to}/`), g.badge ? badges[g.badge] : 0))}
    </nav>
  )
}
