import { useT, fmtDay } from '../../lib/i18n'
import { STAGES, stageIndex } from '../../lib/technical/projects'
import { Skeleton } from '../../components/ui/index'
import { timeAgo } from '../../lib/utils'
import { W, LEVEL_DOT } from './words'

// ─── Pieces the Technical pages share ──────────────────────────────────────

export function Dot({ level, className = '' }) {
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${LEVEL_DOT[level] || 'bg-stone-300'} ${className}`} aria-hidden="true" />
}

/** Nine segments, the current one dark; red/amber when the project is. */
export function StageBar({ stageKey, level }) {
  const at = stageIndex(stageKey)
  const now = level === 'red' ? 'bg-red-500' : level === 'amber' ? 'bg-yellow-500' : 'bg-stone-800'
  return (
    <div className="flex gap-0.5" aria-hidden="true">
      {STAGES.map((s, i) => (
        <span key={s.key} className={`h-1.5 flex-1 rounded-full ${i < at ? 'bg-stone-400' : i === at ? now : 'bg-stone-200'}`} />
      ))}
    </div>
  )
}

/** The page frame: a title, a line under it, the Odoo read time, and the states before data. */
export function Frame({ title, sub, data, error, children, actions = null, width = 'max-w-5xl' }) {
  const { t, lang } = useT(W)
  return (
    <div className={`${width} space-y-4`}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-text tracking-tight leading-none">{title}</h1>
          {sub && <p className="text-xs text-text-secondary mt-2 max-w-2xl leading-relaxed">{sub}</p>}
        </div>
        <div className="flex items-center gap-3">
          {data?.sync?.last_ok_at && (
            <p className="text-[11px] text-text-tertiary">{t.lastRead} {lang === 'ar' ? fmtDay(data.sync.last_ok_at, lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : timeAgo(data.sync.last_ok_at)}</p>
          )}
          {actions}
        </div>
      </header>
      {error ? (
        <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3">
          <p className="text-sm font-semibold text-red-800">{t.loadFailed}</p>
          <p className="text-xs text-red-700 mt-1" dir="auto">{error}</p>
        </div>
      ) : data === undefined ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : !data.sync?.last_ok_at ? (
        <Note>{t.notSynced}</Note>
      ) : !(data.sync.models || []).includes('project.project') ? (
        <Note>{t.noProjectApp}</Note>
      ) : children}
    </div>
  )
}

export function Note({ children }) {
  return <div className="border border-border rounded-xl bg-surface-subtle px-4 py-6 text-center text-sm text-text-secondary">{children}</div>
}

export function Box({ title, sub, children, action = null }) {
  return (
    <section className="border border-border rounded-xl bg-white">
      <div className="px-4 pt-3 pb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          {sub && <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="px-4 pb-4">{children}</div>
    </section>
  )
}

export const field = 'w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-200'

/** The reason lines a project carries, worst first. */
export function Reasons({ reasons, t, max = 3 }) {
  const sorted = [...reasons].sort((a, b) => (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1))
  if (!sorted.length) return null
  return (
    <ul className="space-y-0.5">
      {sorted.slice(0, max).map((r, i) => (
        <li key={i} className={`text-xs leading-snug ${r.level === 'red' ? 'text-red-700' : 'text-text-secondary'}`}>{t.reasons[r.kind]?.(r) || r.kind}</li>
      ))}
    </ul>
  )
}
