import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { sectionsFor, GLOBAL_PAGES } from '../../lib/modules'
import { NavIcon } from '../../components/layout/icons'
import { useBadges, sectionBadge } from '../../components/layout/useNavBadges'
import { useTaskBoard } from '../tasks/useTaskBoard'
import { TaskList } from '../tasks/parts'
import { bucketOf } from '../../lib/tasks/logic'
import { useT, labelOf, COMMON } from '../../lib/i18n'
import { usePins } from '../../components/layout/usePins'
import { canPin } from '../../lib/shell/pins'
import { CrmHomeItems } from '../crm/HomeItems'

const HW = {
  en: {
    hello: h => (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'),
    pick: 'pick where to work.', everywhere: 'Everywhere', waiting: n => `${n} waiting`, today: 'Today', allTasks: 'All my tasks',
  },
  ar: {
    hello: h => (h < 12 ? 'صباح الخير' : 'مساء الخير'),
    pick: 'اختر أين تعمل.', everywhere: 'في كل مكان', waiting: n => `${n} بانتظارك`, today: 'اليوم', allTasks: 'كل مهامي',
  },
}

// ─── Home (v2) ─────────────────────────────────────────────────────────────
// 2026-10-19. The first screen: one tile per section this person can open,
// as on Odoo's home, each saying in a line what is inside and how many things
// wait there. On a phone it is the way in, since the rail is behind the menu.
// v1's dashboard is Marketing's Dashboard now (/marketing), unchanged.
//
// 2026-10-28 (docs/SHELL.md): this is also the "all modules" screen the
// rail's grid button opens. Each tile has a pin that puts the section on
// the left bar or takes it off (lib/shell/pins.js); one screen, not two.

export function HomePage() {
  const { user, who, activeWorkspace } = useAuth()
  const { t, lang, dir } = useT(HW)
  const badges = useBadges()
  const sections = sectionsFor(who)
  const pins = usePins()
  const pinnable = canPin(who) && pins.ready
  const c = COMMON[lang]
  const name = String(user?.user_metadata?.full_name || user?.email?.split('@')[0] || '').split(/[.\s_]/)[0]

  return (
    <div className="max-w-5xl space-y-6" dir={dir} lang={lang}>
      <header>
        <h1 className="text-lg font-bold text-text tracking-tight leading-none">
          {t.hello(new Date().getHours())}{name ? `${lang === 'ar' ? '، ' : ', '}${name.charAt(0).toUpperCase()}${name.slice(1)}` : ''}
        </h1>
        <p className="text-xs text-text-secondary mt-2">{activeWorkspace?.name || 'Arak'} · {t.pick}</p>
      </header>

      <Today />
      <CrmHomeItems />

      {pins.saveError && <p role="alert" className="text-xs text-red-600">{c.pinSaveFailed}</p>}

      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {sections.map(s => {
          const n = sectionBadge(s, badges)
          const on = pins.sections?.some(p => p.key === s.key)
          return (
            <li key={s.key} className="relative">
              <Link to={s.pages[0].to}
                className="group relative flex flex-col h-full bg-white border border-border rounded-xl px-4 py-4 hover:bg-stone-50 hover:border-stone-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300">
                <span className="w-9 h-9 rounded-lg flex items-center justify-center bg-stone-100 text-text border border-border">
                  <NavIcon name={s.icon} className="w-5 h-5" />
                </span>
                <span className="text-sm font-semibold text-text mt-3">{labelOf(s, lang)}</span>
                <span className="text-[11px] text-text-secondary leading-snug mt-1 line-clamp-3">{(lang === 'ar' && s.blurbAr) || s.blurb}</span>
                {n > 0 && (
                  <span className="absolute top-3 end-12 min-w-[20px] h-5 px-1.5 flex items-center justify-center text-[11px] font-semibold text-white bg-red-500 rounded-full"
                    title={t.waiting(n)}>
                    {n}
                  </span>
                )}
              </Link>
              {/* Beside the link, not in it: a button inside a link is invalid. */}
              {pinnable && (
                <button type="button" onClick={() => pins.toggle(s.key)} aria-pressed={on}
                  title={on ? c.unpin : c.pin} aria-label={`${on ? c.unpin : c.pin}: ${labelOf(s, lang)}`}
                  className={`absolute top-2.5 end-2.5 w-7 h-7 rounded-md flex items-center justify-center transition-colors
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300
                    ${on ? 'text-text bg-stone-100 hover:bg-stone-200' : 'text-text-tertiary hover:bg-stone-100 hover:text-text'}`}>
                  <NavIcon name="pin" className={`w-4 h-4 ${on ? '[&>path]:fill-current' : ''}`} />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <section>
        <h2 className="eyebrow mb-2">{t.everywhere}</h2>
        <ul className="flex flex-wrap gap-2">
          {GLOBAL_PAGES.map(g => (
            <li key={g.to}>
              <Link to={g.to} className="inline-flex items-center gap-2 bg-white border border-border rounded-md px-3 py-2 text-xs text-text hover:bg-stone-50">
                <NavIcon name={g.icon} />
                {labelOf(g, lang)}
                {g.badge && badges[g.badge] > 0 && <span className="text-[10px] font-semibold text-white bg-stone-900 rounded-full px-1.5">{badges[g.badge]}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/**
 * Today: my tasks that are late or due today, above everything else (v2,
 * docs/TASKS-PLAN.md). Hidden when there are none, so a clear day shows a
 * clean Home; quiet where the tasks table does not exist yet.
 */
function Today() {
  const navigate = useNavigate()
  const { tasks, people, now, toggle, busyId } = useTaskBoard('mine')
  const { t: w, lang } = useT(HW)
  const due = (tasks || []).filter(t => ['overdue', 'today'].includes(bucketOf(t, now)))
  if (!due.length) return null
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-text">{w.today}</h2>
        <Link to="/tasks" className="text-xs text-text-secondary hover:text-text">{w.allTasks} {lang === 'ar' ? '←' : '→'}</Link>
      </div>
      <TaskList tasks={due} people={people} now={now} showSetter hideDone busyId={busyId}
        onOpen={t => navigate(`/tasks?id=${t.id}`)} onToggle={toggle} />
    </section>
  )
}
