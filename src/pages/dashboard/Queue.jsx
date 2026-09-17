import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Button, Skeleton, IconBadge, Empty, PostImage, PlatformPill } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { useAuth } from '../../store/auth'
import { fetchScheduledPosts } from '../../lib/scheduledPosts'
import { queueBucket } from '../../lib/postLock'
import { formatBrandDateTime } from '../../lib/brandTime'

// ─── What is going out, and what is stuck ──────────────────────────────────
//
// Both read Supabase directly through fetchScheduledPosts — the same function
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

const DAYS_AHEAD = 14
const TRAY_STATUSES = ['not_published', 'failed']

const textOf = p => (p.caption || p.topic || p.hook || '').replace(/\s+/g, ' ').trim()
const mediaOf = p => (Array.isArray(p.image_urls) && p.image_urls.length ? p.image_urls[0] : p.image_url) || ''

function Thumb({ post }) {
  const src = mediaOf(post)
  return src
    ? <PostImage src={src} alt="" className="w-9 h-9 object-cover flex-shrink-0 border border-border" />
    : (
      <div className="w-9 h-9 bg-surface-subtle border border-border flex items-center justify-center flex-shrink-0 text-text-tertiary">
        {Icon.image}
      </div>
    )
}

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

/**
 * Both lists in one fetch pass.
 *
 * Two queries rather than one, for the reason the calendar needs two: a post
 * with no slot has `scheduled_publish_at = NULL`, and NULL fails both `gte`
 * and `lte`, so no single range can return the stuck ones alongside the
 * booked ones however wide it is opened.
 */
function useQueue() {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [state, setState] = useState({ upcoming: [], attention: [], loading: true })

  // Deferred a tick, like every other first fetch in this app: both branches
  // write state, and doing that from an effect BODY is a cascading render.
  useEffect(() => {
    let cancelled = false
    queueMicrotask(async () => {
      if (cancelled) return
      if (!activeWorkspaceId || !accessToken) {
        setState({ upcoming: [], attention: [], loading: false })
        return
      }
      setState(s => ({ ...s, loading: true }))
      const now = new Date()
      const to = new Date(now.getTime() + DAYS_AHEAD * 86_400_000)
      const [booked, tray] = await Promise.all([
        fetchScheduledPosts(activeWorkspaceId, accessToken, {
          from: now.toISOString(), to: to.toISOString(), limit: 40,
        }),
        fetchScheduledPosts(activeWorkspaceId, accessToken, {
          unscheduled: true, publishStatus: TRAY_STATUSES, limit: 40,
        }),
      ])
      if (cancelled) return
      setState({
        // `queueBucket` rather than the raw status: a post whose slot has just
        // passed is already gone, and listing it as "upcoming" would be the
        // dashboard telling somebody to wait for something that has happened.
        upcoming: booked.filter(p => queueBucket(p) === 'upcoming'),
        attention: tray,
        loading: false,
      })
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken])

  return state
}

export function QueueCards() {
  const navigate = useNavigate()
  const { upcoming, attention, loading } = useQueue()

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <IconBadge>{Icon.calendar}</IconBadge>
            <div className="min-w-0">
              <h3 className="font-semibold text-text text-sm leading-tight">Going out next</h3>
              <p className="text-xs text-text-tertiary mt-0.5">Scheduled for the next {DAYS_AHEAD} days</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/schedule')}>Calendar</Button>
        </div>
        {loading ? <ListSkeleton /> : upcoming.length === 0 ? (
          <Empty
            icon={Icon.calendar}
            title="Nothing scheduled"
            description={`No post is booked for the next ${DAYS_AHEAD} days.`}
            action={<Button onClick={() => navigate('/campaigns')}>Plan a month</Button>} />
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.slice(0, 6).map(p => (
              <li key={p.id}>
                <button onClick={() => navigate('/schedule')}
                  className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-surface-subtle transition-colors">
                  <Thumb post={p} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text truncate">{textOf(p) || 'No caption yet'}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <PlatformPill platform={p.platform} />
                      <span className="text-[10px] text-text-tertiary tabular-nums">
                        {formatBrandDateTime(p.scheduled_publish_at)}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {upcoming.length > 6 && (
          <div className="px-4 py-2.5 border-t border-border">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate('/schedule')}>
              {upcoming.length - 6} more scheduled
            </Button>
          </div>
        )}
      </Card>

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
    </>
  )
}
