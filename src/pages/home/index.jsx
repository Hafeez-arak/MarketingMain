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

      {/* The apps, as on Odoo's home (the owner, 2026-10-28): a big icon and
          its name. Hovering lifts the icon a little; resting on it for a
          moment shows what is inside. The pin (top corner, on hover; always
          on a phone) puts the section on the left bar. */}
      <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-3 gap-y-7 pt-2">
        {sections.map(s => {
          const n = sectionBadge(s, badges)
          const on = pins.sections?.some(p => p.key === s.key)
          const name = labelOf(s, lang)
          const blurb = (lang === 'ar' && s.blurbAr) || s.blurb
          return (
            <li key={s.key} className="group relative flex justify-center">
              <Link to={s.pages[0].to} aria-describedby={`app-${s.key}-about`}
                className="flex flex-col items-center gap-2.5 w-full rounded-xl focus:outline-none [&:focus-visible>span:first-child]:ring-2 [&:focus-visible>span:first-child]:ring-stone-400">
                <span className="relative w-[76px] h-[76px] md:w-[84px] md:h-[84px] rounded-2xl bg-white border border-border flex items-center justify-center text-text
                  shadow-[0_1px_2px_rgba(9,9,11,0.06)] transition-[transform,box-shadow,border-color] duration-200 ease-out
                  group-hover:-translate-y-1 group-hover:scale-[1.06] group-hover:border-stone-300 group-hover:shadow-[0_10px_24px_-6px_rgba(9,9,11,0.16),0_2px_6px_rgba(9,9,11,0.06)]
                  group-active:scale-[0.98] group-active:translate-y-0 motion-reduce:transform-none">
                  <NavIcon name={s.icon} className="w-8 h-8 md:w-9 md:h-9" />
                  {n > 0 && (
                    <span className="absolute -top-1.5 -end-1.5 min-w-[20px] h-5 px-1.5 flex items-center justify-center text-[11px] font-semibold text-white bg-red-500 rounded-full ring-2 ring-white">
                      {n > 99 ? '99+' : n}
                    </span>
                  )}
                </span>
                <span className="text-[13px] font-medium text-text-secondary group-hover:text-text text-center leading-tight transition-colors">{name}</span>
              </Link>

              {/* What is inside: after a short rest on the icon (or keyboard
                  focus), never on a quick pass across the grid. Desktop only:
                  a phone has no hover, and a tap opens the section. */}
              <div id={`app-${s.key}-about`} role="tooltip"
                className="hidden md:block pointer-events-none absolute top-full start-1/2 -ms-[88px] mt-2 w-44 z-30
                  rounded-lg bg-stone-900 text-white px-3 py-2.5 shadow-dropdown
                  opacity-0 translate-y-1 transition duration-150 ease-out
                  group-hover:opacity-100 group-hover:translate-y-0 group-hover:delay-[550ms]
                  group-has-[a:focus-visible]:opacity-100 group-has-[a:focus-visible]:translate-y-0 group-has-[a:focus-visible]:delay-[550ms]
                  motion-reduce:transition-none">
                <span className="absolute -top-1 start-1/2 -ms-1 w-2 h-2 rotate-45 bg-stone-900" aria-hidden="true" />
                <span className="block text-[11px] leading-snug text-stone-200">{blurb}</span>
                {n > 0 && <span className="block text-[11px] font-semibold text-white mt-1.5">{t.waiting(n)}</span>}
              </div>

              {/* Beside the link, not in it: a button inside a link is invalid. */}
              {pinnable && (
                <button type="button" onClick={() => pins.toggle(s.key)} aria-pressed={on}
                  title={on ? c.unpin : c.pin} aria-label={`${on ? c.unpin : c.pin}: ${name}`}
                  className={`absolute -top-2 start-1/2 -ms-[50px] md:-ms-[54px] w-6 h-6 rounded-full flex items-center justify-center border transition
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:opacity-100
                    md:opacity-0 md:group-hover:opacity-100 md:group-hover:-translate-y-1
                    ${on ? 'bg-stone-900 border-stone-900 text-white' : 'bg-white border-border text-text-tertiary hover:text-text hover:border-stone-400'}`}>
                  <NavIcon name="pin" className={`w-3.5 h-3.5 ${on ? '[&>path]:fill-current' : ''}`} />
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
