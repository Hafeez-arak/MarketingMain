import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useT, fmtDay } from '../../lib/i18n'
import { W } from './words'
import { Frame, Note } from './parts'
import { useTechnical } from './data'

// ─── Technical → Submittals (v2) ───────────────────────────────────────────
// 2026-10-19. Across every project this person may see: each item still with
// the client (oldest first) and each one that came back C or D and has not
// gone in again. The approved ones are on their project's page.

export function TechnicalSubmittals() {
  const { t, lang, dir } = useT(W)
  const { data, error } = useTechnical()
  const rows = useMemo(() => (data?.board || [])
    .flatMap(p => p.submittals.filter(i => i.state === 'waiting' || i.state === 'again').map(i => ({ ...i, project: p })))
    .sort((a, b) => (a.state === 'again' ? 0 : 1) - (b.state === 'again' ? 0 : 1) || (b.days ?? 0) - (a.days ?? 0)), [data])
  const chase = data?.settings?.review_chase_days ?? 10
  const resubmit = data?.settings?.resubmit_days ?? 7

  return (
    <div dir={dir} lang={lang}>
      <Frame title={t.subsTitle} sub={t.subsSub} data={data} error={error}>
        {!rows.length ? <Note>{t.subsNone}</Note> : (
          <div className="border border-border rounded-xl bg-white overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface-subtle text-text-tertiary">
                <tr>{[t.project, t.item, t.round, t.submitted, t.state].map(h => <th key={h} className="text-start font-medium px-3 py-2">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const overdue = r.state === 'again' ? r.days > resubmit : r.days >= chase
                  return (
                    <tr key={`${r.project.id}-${r.title}`} className="border-t border-border">
                      <td className="px-3 py-2"><Link to={`/technical/project?id=${r.project.id}`} className="font-medium text-text hover:underline">{r.project.name}</Link>
                        <p className="text-[11px] text-text-tertiary">{r.project.pm}</p></td>
                      <td className="px-3 py-2 text-text">{r.title}</td>
                      <td className="px-3 py-2 tabular-nums">{r.round}</td>
                      <td className="px-3 py-2 text-text-secondary">{r.last.submitted_at ? fmtDay(r.last.submitted_at, lang) : '—'}</td>
                      <td className={`px-3 py-2 ${overdue ? 'text-red-700 font-medium' : r.state === 'again' ? 'text-yellow-700' : 'text-text-secondary'}`}>
                        {r.state === 'again' ? `${t.codes[r.last.code]} · ${t.daysAgo(r.days)}` : t.waitingClient(r.days)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Frame>
    </div>
  )
}
