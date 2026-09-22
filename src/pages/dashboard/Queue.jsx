import { useNavigate } from 'react-router-dom'
import { Card, Button, Skeleton, IconBadge, PlatformPill } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'

// ─── What is stuck ─────────────────────────────────────────────────────────
//
// "Going out next" was removed 2026-09-22 at the user's request — the
// calendar (View calendar, top of the page) already answers that question.
//
// It reads Supabase directly through fetchScheduledPosts — the same function
// the calendar and the Post Queue use, over the scheduled_posts view that
// unions generated_posts and instagram_generated_posts.
//
// The old cards read state.posts and state.approvals from the localStorage
// app store, which nothing in the pipeline ever writes to. They were not
// broken; they were never connected.
//
// ── WHY "NEEDS ATTENTION" AND NOT "PENDING APPROVALS" ──
//
// There is no approve/reject step any more. A plan's posts are scheduled when
// the plan is saved, and /social/approvals is the Post Queue now — the route
// keeps the old name so existing links work. `queueBucket` puts a post in
// `attention` when it is not booked, has failed, or has no account to publish
// through, which is the real version of the question the old card was asking.

const textOf = p => (p.caption || p.topic || p.hook || '').replace(/\s+/g, ' ').trim()

function ListSkeleton({ rows = 3 }) {
  return (
    <div className="divide-y divide-border" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <Skeleton className="w-9 h-9 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-2.5 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function QueueCards({ attention, loading }) {
  const navigate = useNavigate()

  return (
    <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <IconBadge tone="rose">{Icon.approve}</IconBadge>
            <div className="min-w-0">
              <h3 className="font-semibold text-text text-sm leading-tight">Needs attention</h3>
              <p className="text-xs text-text-tertiary mt-0.5">Made but not booked, or failed</p>
            </div>
          </div>
          {!loading && attention.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 bg-amber-700 text-white tabular-nums leading-[1.4] flex-shrink-0">
              {attention.length}
            </span>
          )}
        </div>
        {loading ? <ListSkeleton rows={2} /> : attention.length === 0 ? (
          <div className="py-7 text-center">
            <div className="w-8 h-8 border border-sage-200 bg-sage-50 flex items-center justify-center mx-auto mb-2 text-sage-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <p className="text-xs text-text-tertiary">All clear</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {attention.slice(0, 5).map(p => (
              <li key={p.id}>
                <button onClick={() => navigate('/social/approvals')}
                  className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 hover:bg-surface-subtle transition-colors">
                  <PlatformPill platform={p.platform} />
                  <p className="flex-1 text-xs text-text truncate">{textOf(p) || 'Untitled post'}</p>
                  {p.publish_status === 'failed' && (
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4]
                      bg-red-50 text-red-600 flex-shrink-0">Failed</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="px-4 py-2.5 border-t border-border">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate('/social/approvals')}>
            Open the post queue
          </Button>
        </div>
      </Card>
  )
}
