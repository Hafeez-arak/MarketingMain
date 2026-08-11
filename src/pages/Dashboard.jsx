import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/app'
import { Card, Button, Badge, PlatformPill, Empty, PostImage, IconBadge, PageHeader } from '../components/ui/index'
import { Icon } from '../components/ui/icons'
import { formatDateTime } from '../lib/utils'

// ─── Dashboard ───────────────────────────────────────────────────────────
// Built entirely from the shared primitives (PageHeader, Card, IconBadge, the
// Icon set) rather than page-local styling, so it can't drift away from the
// rest of the app the way it did before — this page used to carry a warm
// gradient hero and decorative progress rings that existed nowhere else.
//
// The layout is a stack of divided strips: a KPI row split by vertical rules,
// then a 2/1 content split, then a platform row using the same divided-strip
// treatment as the KPIs. Repeating one structural idea down the page is what
// makes it read as designed rather than assembled.

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', color: '#e0687a' },
  { key: 'facebook',  label: 'Facebook',  color: '#657b81' },
  { key: 'linkedin',  label: 'LinkedIn',  color: '#4c5e61' },
  { key: 'tiktok',    label: 'TikTok',    color: '#325130' },
  { key: 'x',         label: 'X',         color: '#7a848c' },
]

export default function Dashboard() {
  const { state } = useApp()
  const navigate  = useNavigate()

  const live      = state.campaigns.filter(c => c.status === 'live').length
  const scheduled = state.posts.filter(p => p.status === 'scheduled').length
  const pending   = state.approvals.filter(a => a.status === 'pending').length
  const flows     = state.emailFlows.filter(f => f.status === 'active').length
  const totalPosts = state.posts.length

  const recentPosts     = [...state.posts].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0,6)
  const recentApprovals = state.approvals.filter(a => a.status === 'pending').slice(0,4)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const kpis = [
    { label: 'Live campaigns',    value: live,      icon: Icon.checkCircle, path: '/campaigns' },
    { label: 'Scheduled posts',   value: scheduled, icon: Icon.calendar,    path: '/schedule' },
    { label: 'Email flows',       value: flows,      icon: Icon.mail,        path: '/email' },
    { label: 'Pending approvals', value: pending,    icon: Icon.approve,     path: '/social/approvals' },
    { label: 'Total posts',       value: totalPosts, icon: Icon.image,       path: '/schedule' },
  ]

  const quickActions = [
    { label: 'Create Instagram post', icon: Icon.image,       path: '/social/instagram' },
    { label: 'Schedule content',      icon: Icon.calendar,     path: '/schedule' },
    { label: 'New campaign',          icon: Icon.trending,     path: '/campaigns/new' },
    { label: 'Upload media',          icon: Icon.grid,         path: '/media' },
    { label: 'View analytics',        icon: Icon.activity,     path: '/analytics' },
  ]

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader
        title={greeting}
        subtitle={pending > 0
          ? <><span className="font-semibold text-amber-800">{pending} item{pending !== 1 ? 's' : ''}</span> awaiting approval{scheduled > 0 && <> · <span className="font-semibold text-text">{scheduled}</span> scheduled</>}.</>
          : 'You\'re all caught up — nothing waiting on you right now.'}>
        <Button variant="secondary" onClick={() => navigate('/schedule')}>View calendar</Button>
        <Button onClick={() => navigate('/social/instagram')}>Create post</Button>
      </PageHeader>

      {/* KPI strip. One card split by vertical rules rather than five separate
          cards — five bordered boxes with gaps between them puts eight visible
          edges across the row; this puts four. */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {kpis.map(k => (
            <button key={k.label} onClick={() => navigate(k.path)}
              className="p-4 text-left hover:bg-surface-subtle transition-colors focus:outline-none focus-visible:bg-surface-subtle">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-text-tertiary flex-shrink-0">{k.icon}</span>
                <p className="eyebrow truncate">{k.label}</p>
              </div>
              <p className="text-2xl font-bold text-text leading-none tabular-nums">{k.value || 0}</p>
            </button>
          ))}
        </div>
      </Card>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">

        {/* Recent posts - 2 cols */}
        <Card className="lg:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2.5 min-w-0">
              <IconBadge>{Icon.document}</IconBadge>
              <div className="min-w-0">
                <h3 className="font-semibold text-text text-sm leading-tight">Recent posts</h3>
                <p className="text-xs text-text-tertiary mt-0.5">Across all platforms</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/schedule')}>View all</Button>
          </div>
          {recentPosts.length === 0 ? (
            <Empty
              icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18"/><path d="M3 9h18M9 21V9"/></svg>}
              title="No posts yet"
              description="Create your first post using the AI-powered Instagram generator."
              action={<Button onClick={() => navigate('/social/instagram')}>Create a post</Button>}
            />
          ) : (
            <ul className="divide-y divide-border">
              {recentPosts.map(p => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-subtle transition-colors">
                  {(p.imageUrl || p.mediaUrls?.[0]) ? (
                    <PostImage src={p.imageUrl || p.mediaUrls?.[0]} alt="" className="w-9 h-9 object-cover flex-shrink-0 border border-border" />
                  ) : (
                    <div className="w-9 h-9 bg-surface-subtle border border-border flex items-center justify-center flex-shrink-0 text-text-tertiary">
                      {Icon.image}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text truncate">{p.copy?.slice(0, 65) || 'No caption'}…</p>
                    <div className="flex items-center gap-2 mt-1">
                      <PlatformPill platform={p.platform} />
                      <span className="text-[10px] text-text-tertiary tabular-nums">{formatDateTime(p.createdAt)}</span>
                    </div>
                  </div>
                  <Badge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Right column */}
        <div className="space-y-4">
          {/* Quick actions */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2.5">
              <IconBadge tone="sage">{Icon.activity}</IconBadge>
              <h3 className="font-semibold text-text text-sm">Quick actions</h3>
            </div>
            {/* Ruled rows, flush to the card edge. The old version floated
                inset pills inside 8px of padding, which left a ragged column
                of rounded shapes against the card's own straight edge. */}
            <div className="divide-y divide-border">
              {quickActions.map(q => (
                <button key={q.label} onClick={() => navigate(q.path)}
                  className="w-full text-left px-4 py-2.5 text-sm text-text-secondary
                    hover:text-text hover:bg-surface-subtle transition-colors flex items-center gap-2.5">
                  <span className="text-text-tertiary flex-shrink-0">{q.icon}</span>
                  {q.label}
                </button>
              ))}
            </div>
          </Card>

          {/* Pending approvals */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <IconBadge tone="rose">{Icon.approve}</IconBadge>
                <h3 className="font-semibold text-text text-sm">Pending approvals</h3>
              </div>
              {pending > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-amber-700 text-white tabular-nums leading-[1.4]">{pending}</span>
              )}
            </div>
            {recentApprovals.length === 0 ? (
              <div className="py-7 text-center">
                <div className="w-8 h-8 border border-sage-200 bg-sage-50 flex items-center justify-center mx-auto mb-2 text-sage-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <p className="text-xs text-text-tertiary">All clear</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recentApprovals.map(a => (
                  <li key={a.id} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-surface-subtle transition-colors">
                    <PlatformPill platform={a.platform} />
                    <p className="flex-1 text-xs text-text truncate">{a.title}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="px-4 py-2.5 border-t border-border">
              <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate('/social/approvals')}>
                View all approvals
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Platform overview — same divided-strip structure as the KPI row. */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <IconBadge>{Icon.grid}</IconBadge>
            <div className="min-w-0">
              <h3 className="font-semibold text-text text-sm leading-tight">Platform overview</h3>
              <p className="text-xs text-text-tertiary mt-0.5">Posts by platform, all time</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/analytics')}>Analytics</Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {PLATFORMS.map(p => {
            const count = state.posts.filter(post => post.platform === p.key).length
            return (
              <div key={p.key} className="p-4">
                <p className="eyebrow mb-2 flex items-center gap-1.5">
                  {/* Square swatch. A round dot is the only circle that would
                      appear on this page, and it isn't standing in for
                      anything circular — it's a color key. */}
                  <span className="w-2 h-2 flex-shrink-0" style={{ background: p.color }} />
                  <span className="truncate">{p.label}</span>
                </p>
                <p className="text-2xl font-bold text-text leading-none tabular-nums">{count}</p>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
