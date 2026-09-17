import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Button, Skeleton, IconBadge } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { summariseRuns } from '../../lib/researchSummary'

// ─── What the last research run found ──────────────────────────────────────
//
// A summary and a way through, not a second Research page and not a to-do
// list. What stood here first was a ranked strip of urgent items, and on real
// data it came out as a calendar reminder, an admin nag about unbooked posts,
// and a repeat of the Search Console card further down the page — three rows,
// none of which said what the research had actually found.
//
// The fix was not a better ranking. It was reading the field the synthesis
// prompt asks for in plain prose: `headline`, one sentence on what changed this
// week. See src/lib/researchSummary.js.

const fmtDate = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? ''
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function ResearchSkeleton() {
  return (
    <Card className="overflow-hidden" aria-busy="true">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2.5">
        <Skeleton className="w-7 h-7" />
        <Skeleton className="h-3.5 w-32" />
      </div>
      <div className="px-4 py-4 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-3 w-2/3 mt-3" />
      </div>
    </Card>
  )
}

export function ResearchCard({ runs, loading }) {
  const navigate = useNavigate()
  const s = useMemo(() => summariseRuns(runs), [runs])

  if (loading) return <ResearchSkeleton />

  const open = () => navigate('/insights')

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <IconBadge tone="sage">{Icon.document}</IconBadge>
          <div className="min-w-0">
            <h3 className="font-semibold text-text text-sm leading-tight">Research</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              {/* Dated, always. The run this came from is the whole basis for
                  believing any of it, and a fortnight-old brief read as this
                  week's is the failure this line exists to prevent. */}
              {s.ok
                ? `Last run ${fmtDate(s.runAt)}${s.scaleLine ? ` · ${s.scaleLine}` : ''}`
                : 'The market, every week'}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={open}>Open</Button>
      </div>

      {/* ── A run that stopped before it could think ──
          Named, never swallowed. Arak's 17 Sep run gathered 33 findings, wrote
          a headline, and produced no analysis at all because it had spent its
          monthly budget — and on the dashboard that was indistinguishable from
          a quiet week. The reason is the run's own sentence, not our guess. */}
      {s.skipped.length > 0 && (
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200">
          <p className="text-xs text-amber-900 leading-relaxed">
            <span className="font-semibold">
              The {fmtDate(s.skipped[0].runAt)} run stopped before it could analyse anything.
            </span>{' '}
            {s.skipped[0].reason
              || 'It gathered findings but produced no analysis, so the last complete run is shown instead.'}
          </p>
        </div>
      )}

      {!s.ok ? (
        <div className="px-4 py-5">
          <p className="text-sm text-text-secondary mb-3">
            {s.everRan
              ? 'No run has produced an analysis yet — the ones on record stopped before that stage.'
              : 'Research has never been run for this workspace. It reads the market weekly and writes up what changed.'}
          </p>
          <Button size="sm" variant="secondary" onClick={open}>
            {s.everRan ? 'Open research' : 'Set up research'}
          </Button>
        </div>
      ) : (
        <button type="button" onClick={open}
          className="w-full text-left px-4 py-4 hover:bg-surface-subtle transition-colors
            focus:outline-none focus-visible:bg-surface-subtle">
          {/* The headline, whole. It is the one field the prompt asks for as
              prose, it is already scoped to a week, and it is the only field
              allowed to say "nothing moved" — which is a complete answer.
              Truncating it into a row was the mistake this card replaces. */}
          <p className="text-[15px] text-text leading-relaxed">{s.headline}</p>

          {s.points.length > 0 && (
            <ul className="mt-3 space-y-2">
              {s.points.map((p, i) => (
                <li key={`${p.from}-${i}`} className="flex gap-2.5">
                  <span className="text-text-tertiary flex-shrink-0 mt-[7px] w-1 h-1 bg-text-tertiary" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm text-text-secondary leading-snug">{p.text}</span>
                    {p.note && (
                      <span className="block text-xs text-text-tertiary mt-0.5 leading-snug">{p.note}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <span className="inline-flex items-center gap-1 text-xs font-semibold text-text mt-3.5">
            Read the full research
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2"
              viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </span>
        </button>
      )}
    </Card>
  )
}
