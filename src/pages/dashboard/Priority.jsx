import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Button, Skeleton, IconBadge } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { priorityRows } from '../../lib/dashboardPriority'

// ─── What to do now ────────────────────────────────────────────────────────
//
// The top of the dashboard, above the numbers. One list, drawn from the
// research report, the Search Console rules and the post queue at once —
// because a person arriving here has one question, and answering it from three
// separate cards further down the page means answering it three times.
//
// The ranking and the merging are in src/lib/dashboardPriority.js and tested
// there. This file only draws it.
//
// ── THE TAGS ARE LATERAL NAVIGATION ──
//
// Mixing "a post failed to publish" with "the market is moving toward guest
// room management" in one column is a real risk: they are not the same kind of
// claim. The kind tag on every row is what makes one list scan as four —
// somebody looking only for dates can find them without the list being split
// into sections that each need their own heading and their own empty state.

const KIND_TONE = {
  deadline: 'bg-rose-50 text-rose-600 border-rose-200',
  fix: 'bg-amber-50 text-amber-700 border-amber-200',
  direction: 'bg-sage-50 text-sage-700 border-sage-200',
  publish: 'bg-stone-100 text-stone-600 border-stone-300',
}

const ranAt = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? ''
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function PrioritySkeleton() {
  return (
    <Card className="overflow-hidden" aria-busy="true">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2.5">
        <Skeleton className="w-7 h-7" />
        <Skeleton className="h-3.5 w-36" />
      </div>
      <div className="divide-y divide-border">
        {[0, 1, 2].map(i => (
          <div key={i} className="px-4 py-3 space-y-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </Card>
  )
}

export function PriorityList({ report, runAt, everRan, recommendations, attention, loading }) {
  const navigate = useNavigate()

  const rows = useMemo(
    () => priorityRows({ report, recommendations, attention }),
    [report, recommendations, attention],
  )

  if (loading) return <PrioritySkeleton />

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <IconBadge tone="rose">{Icon.activity}</IconBadge>
          <div className="min-w-0">
            <h3 className="font-semibold text-text text-sm leading-tight">What to do now</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              {/* Dated, always. Findings from a three-week-old run must not
                  read as this week's at a glance. */}
              Across research, the website and the post queue
              {runAt && ` · research from ${ranAt(runAt)}`}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/insights')}>Research</Button>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-5">
          <p className="text-sm text-text-secondary">
            {everRan
              ? 'Nothing needs a decision right now — no deadlines, no failed posts, and the website rules found nothing above the reporting floor.'
              : 'Nothing needs a decision right now. Research has never been run for this workspace, so the market half of this list is empty.'}
          </p>
          {!everRan && (
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => navigate('/insights')}>
              Set up research
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map(r => {
            const clickable = Boolean(r.to)
            const Row = clickable ? 'button' : 'div'
            return (
              <li key={r.id}>
                <Row
                  {...(clickable ? { type: 'button', onClick: () => navigate(r.to) } : {})}
                  className={`w-full text-left px-4 py-3 flex items-start gap-2.5 transition-colors
                    ${clickable ? 'hover:bg-surface-subtle focus:outline-none focus-visible:bg-surface-subtle' : ''}`}>
                  <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 border
                    leading-[1.4] flex-shrink-0 mt-0.5 ${KIND_TONE[r.kind] || KIND_TONE.publish}`}>
                    {r.tag}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm leading-snug ${r.urgent ? 'font-semibold text-text' : 'text-text'}`}>
                      {r.title}
                    </span>
                    {r.detail && (
                      <span className="block text-xs text-text-secondary mt-1 leading-relaxed">{r.detail}</span>
                    )}
                    {r.meta && (
                      <span className="block text-[11px] text-text-tertiary mt-1.5">{r.meta}</span>
                    )}
                  </span>
                </Row>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
