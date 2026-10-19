import { Link } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { sectionsFor, GLOBAL_PAGES } from '../../lib/modules'
import { NavIcon } from '../../components/layout/icons'
import { useBadges, sectionBadge } from '../../components/layout/useNavBadges'

// ─── Home (v2) ─────────────────────────────────────────────────────────────
// 2026-10-19. The first screen: one tile per section this person can open,
// as on Odoo's home, each saying in a line what is inside and how many things
// wait there. On a phone it is the way in, since the rail is behind the menu.
// v1's dashboard is Marketing's Overview now (/marketing).

const hello = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function HomePage() {
  const { user, isAccessAdmin, activeWorkspace } = useAuth()
  const badges = useBadges()
  const sections = sectionsFor({ isAccessAdmin })
  const name = String(user?.user_metadata?.full_name || user?.email?.split('@')[0] || '').split(/[.\s_]/)[0]

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <h1 className="text-lg font-bold text-text tracking-tight leading-none">
          {hello()}{name ? `, ${name.charAt(0).toUpperCase()}${name.slice(1)}` : ''}
        </h1>
        <p className="text-xs text-text-secondary mt-2">{activeWorkspace?.name || 'Arak'} · pick where to work.</p>
      </header>

      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {sections.map(s => {
          const n = sectionBadge(s, badges)
          return (
            <li key={s.key}>
              <Link to={s.pages[0].to}
                className="group relative flex flex-col h-full bg-white border border-border px-4 py-4 hover:border-amber-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
                {/* Light against dark: Arak's gold on its near-black. */}
                <span className="w-10 h-10 flex items-center justify-center bg-stone-950 text-amber-400">
                  <NavIcon name={s.icon} className="w-5 h-5" />
                </span>
                <span className="text-sm font-semibold text-text mt-3">{s.label}</span>
                <span className="text-[11px] text-text-secondary leading-snug mt-1 line-clamp-3">{s.blurb}</span>
                {n > 0 && (
                  <span className="absolute top-3 right-3 min-w-[20px] h-5 px-1.5 flex items-center justify-center text-[11px] font-bold text-white bg-red-600 rounded-full"
                    title={`${n} waiting`}>
                    {n}
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>

      <section>
        <h2 className="eyebrow mb-2">Everywhere</h2>
        <ul className="flex flex-wrap gap-2">
          {GLOBAL_PAGES.map(g => (
            <li key={g.to}>
              <Link to={g.to} className="inline-flex items-center gap-2 bg-white border border-border px-3 py-2 text-xs text-text hover:border-stone-400">
                <NavIcon name={g.icon} />
                {g.label}
                {g.badge && badges[g.badge] > 0 && <span className="text-[10px] font-bold text-white bg-amber-700 px-1">{badges[g.badge]}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
