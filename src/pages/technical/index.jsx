import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { useT, fmtDay } from '../../lib/i18n'
import { stageLabel } from '../../lib/technical/projects'
import { W } from './words'
import { Frame, Dot, StageBar, Reasons, Note, field } from './parts'
import { useTechnical } from './data'

// ─── Technical → Projects (v2) ─────────────────────────────────────────────
// 2026-10-19. Every project this person may see (the database decides: a
// project manager sees the projects they manage in Odoo, the Technical
// manager and the CEO all of them), worst first: red, then amber, then
// green. Each row says which of the nine stages it is in, for how long
// against the stage's limit, and why it is red or amber.

const FILTERS = ['all', 'red', 'amber', 'green']

export function TechnicalProjects() {
  const { t, lang, dir } = useT(W)
  const { canSection } = useAuth()
  const { data, error } = useTechnical()
  const [params, setParams] = useSearchParams()
  const filter = FILTERS.includes(params.get('show')) ? params.get('show') : 'all'
  const [q, setQ] = useState('')
  const manager = canSection('technical', 'manage') || canSection('ceo', 'view')

  const board = useMemo(() => data?.board || [], [data])
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f, f === 'all' ? board.length : board.filter(p => p.health.level === f).length])), [board])
  const shown = board
    .filter(p => filter === 'all' || p.health.level === filter)
    .filter(p => !q.trim() || `${p.name} ${p.customer} ${p.pm}`.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div dir={dir} lang={lang}>
      <Frame title={t.projectsTitle} sub={`${t.projectsSub}${manager ? '' : ` ${t.mineOnly}`}`} data={data} error={error}>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(f => (
            <button key={f} type="button" aria-pressed={filter === f}
              onClick={() => setParams(p => { const n = new URLSearchParams(p); if (f === 'all') n.delete('show'); else n.set('show', f); return n }, { replace: true })}
              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs transition-colors
                ${filter === f ? 'border-stone-900 bg-stone-900 text-white' : 'border-border bg-white text-text-secondary hover:text-text'}`}>
              {f !== 'all' && <Dot level={f} />}
              {t[f]} <span className="tabular-nums opacity-70">{counts[f]}</span>
            </button>
          ))}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t.search} aria-label={t.search}
            className={`${field} ms-auto max-w-[15rem] h-7 py-0 text-xs`} />
        </div>

        {!board.length ? <Note>{manager ? t.noProjects : t.noProjectsMine}</Note> : !shown.length ? <Note>{t.noProjects}</Note> : (
          <ul className="space-y-2">
            {shown.map(p => (
              <li key={p.id}>
                <Link to={`/technical/project?id=${p.id}`}
                  className="block border border-border rounded-xl bg-white px-4 py-3 hover:border-stone-400 transition-colors">
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1 basis-60">
                      <p className="flex items-center gap-2 text-sm font-semibold text-text">
                        <Dot level={p.health.level} /> <span className="truncate">{p.name}</span>
                      </p>
                      <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                        {[p.customer, p.pm && `${t.pm}: ${p.pm}`, p.endDate && `${t.delivery}: ${fmtDay(p.endDate, lang, { day: 'numeric', month: 'short', year: 'numeric' })}`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="w-full sm:w-64 flex-shrink-0">
                      <div className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="font-medium text-text truncate">{p.stageKey ? stageLabel(p.stageKey, lang) : (p.stageName || t.noStage)}</span>
                        {p.health.inStage != null && p.health.allowed && (
                          <span className={`tabular-nums flex-shrink-0 ${p.health.inStage > p.health.allowed ? 'text-red-700 font-semibold' : 'text-text-tertiary'}`}>
                            {t.daysInStage(p.health.inStage, p.health.allowed)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5"><StageBar stageKey={p.stageKey} level={p.health.level} /></div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                    <Reasons reasons={p.health.reasons} t={t} max={2} />
                    <p className="text-[11px] text-text-tertiary">
                      {t.lastUpdate}: {p.update ? t.daysAgo(p.health.updateDays) : t.never}
                      {p.tasksOpen ? ` · ${t.odooTasks(p.tasksOpen, p.tasksLate)}` : ''}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Frame>
    </div>
  )
}
