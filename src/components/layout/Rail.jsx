import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { HOME, GLOBAL_PAGES, sectionsFor, sectionOf, sectionMenu } from '../../lib/modules'
import { usePins } from './usePins'
import { NavIcon } from './icons'
import { useBadges, sectionBadge } from './useNavBadges'
import { ArakMark } from './ArakMark'
import { SectionPanel } from './Sidebar'
import { useLang, labelOf, COMMON } from '../../lib/i18n'

// ─── The rail: one icon per section (v2) ───────────────────────────────────
// 2026-10-19. The far-left column: the logo, Home, the sections this person
// can open, and at the foot the pages that belong to no section (assistant,
// Requests, Settings). One click moves between sections, which a launcher
// alone cannot do: it sends you back to Home each time. See lib/modules.js
// and docs/COMPANY-HUB-PLAN.md.
//
// 2026-10-28 (docs/SHELL.md): the grid button at the top opens Home, where
// every section this person may open is a tile with a pin. The rail draws
// only the pinned ones (lib/shell/pins.js), plus the open section while you
// are in it, so you can always see where you are.

// Light and quiet (shadcn/ui), with a short label under each icon, as in
// Slack's rail (the owner asked for it, 2026-10-19): an icon alone made people
// guess. The open section's icon sits in a soft grey square.
const box = active => `relative w-10 h-8 rounded-lg flex items-center justify-center transition-colors
  ${active ? 'bg-stone-200/80 text-text' : 'text-text-secondary group-hover:bg-stone-100 group-hover:text-text'}`

function Dot({ n }) {
  if (!n) return null
  return (
    <span className="absolute -top-1 -end-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-semibold text-white bg-red-500 rounded-full ring-2 ring-surface-muted">
      {n > 99 ? '99+' : n}
    </span>
  )
}

// Hovering a section's icon shows its pages in a floating panel (2026-10-19,
// the owner's ask: "like the general hovering in websites"), so a page in
// another section is one move and one click away. Clicking the icon still
// opens the section. Only where there is a real mouse: on touch there is no
// hover, and the drawer already shows the menu.
const OPEN_MS = 120   // a pass across the rail on the way elsewhere does not flash panels
const CLOSE_MS = 200  // time to travel from the icon into the panel
const canHover = () => typeof window !== 'undefined'
  && window.matchMedia?.('(hover: hover) and (pointer: fine) and (min-width: 768px)').matches

export function Rail({ onNavigate, menuHidden = false }) {
  const { pathname } = useLocation()
  const { who } = useAuth()
  const lang = useLang()
  const badges = useBadges()
  const pins = usePins()
  const all = sectionsFor(who)
  const here = sectionOf(pathname)?.key || null
  // Until the pins are read, no sections rather than the wrong ones.
  const pinned = pins.sections ?? (pins.ready ? all : [])
  const sections = all.filter(s => s.key === here || pinned.some(p => p.key === s.key))

  // ── The hover panel ──
  const [peek, setPeek] = useState(null) // a section key, or null
  const openT = useRef(null)
  const closeT = useRef(null)
  const clear = () => { clearTimeout(openT.current); clearTimeout(closeT.current) }
  useEffect(() => clear, [])
  useEffect(() => {
    if (!peek) return
    const onKey = e => { if (e.key === 'Escape') setPeek(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [peek])
  const hoverIn = key => {
    if (!canHover()) return
    clear()
    // The open section's own menu is already on screen, unless it is hidden.
    const s = all.find(x => x.key === key)
    const wanted = s && sectionMenu(s, who).length && (key !== here || menuHidden) ? key : null
    openT.current = setTimeout(() => setPeek(wanted), peek ? 0 : OPEN_MS)
  }
  const hoverOut = () => {
    clear()
    closeT.current = setTimeout(() => setPeek(null), CLOSE_MS)
  }
  const keep = () => clearTimeout(closeT.current)
  const done = () => { clear(); setPeek(null); onNavigate?.() }
  const peeked = peek && all.find(x => x.key === peek)

  const link = (to, label, icon, active, n, key = null) => (
    <NavLink key={to} to={to} aria-current={active ? 'page' : undefined} onClick={done}
      onMouseEnter={key ? () => hoverIn(key) : () => { clear(); setPeek(null) }}
      onMouseLeave={key ? hoverOut : undefined}
      className="group w-full flex flex-col items-center gap-1 py-1 focus:outline-none focus-visible:[&>span:first-child]:ring-2 focus-visible:[&>span:first-child]:ring-stone-300">
      <span className={box(active || key === peek)}>
        <NavIcon name={icon} className="w-[18px] h-[18px]" />
        <Dot n={n} />
      </span>
      <span className={`text-[10px] leading-tight text-center ${active ? 'text-text font-semibold' : 'text-text-secondary group-hover:text-text'}`}>{label}</span>
    </NavLink>
  )

  return (
    <div className="relative h-full flex-shrink-0 flex">
      <nav aria-label={COMMON[lang].sections} data-print-hide
        className="w-[72px] flex-shrink-0 h-full bg-surface-muted border-e border-border flex flex-col items-center py-2 overflow-y-auto scrollbar-thin">
        {/* Arak's mark, at the top bar's height so the two line up. */}
        <div className="h-12 flex items-center justify-center mb-1 flex-shrink-0">
          <ArakMark />
        </div>
        {/* The grid button: Home, with every section as a tile. */}
        {link(HOME.to, COMMON[lang].allModules, 'grid', pathname === '/', 0)}
        <span className="w-8 border-t border-border my-1.5 flex-shrink-0" aria-hidden="true" />
        {sections.map(s => link(s.pages[0].to, labelOf(s, lang), s.icon, here === s.key, sectionBadge(s, badges), s.key))}
        <div className="flex-1 min-h-4" />
        {GLOBAL_PAGES.map(g => link(g.to, labelOf(g, lang), g.icon, pathname === g.to || pathname.startsWith(`${g.to}/`), g.badge ? badges[g.badge] : 0))}
      </nav>
      {peeked && (
        <SectionPanel section={peeked} pages={sectionMenu(peeked, who)} onNavigate={done}
          onMouseEnter={keep} onMouseLeave={hoverOut}
          className="absolute start-full top-0 bottom-0 w-52 z-40 border-e border-border shadow-dropdown animate-fade-scale" />
      )}
    </div>
  )
}
