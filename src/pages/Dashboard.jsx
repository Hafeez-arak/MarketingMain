import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/app'
import { Card, Button, Badge, PlatformPill, Empty, PostImage, IconBadge } from '../components/ui/index'
import { Icon } from '../components/ui/icons'
import { formatDateTime } from '../lib/utils'

// ─── Dashboard ───────────────────────────────────────────────────────────
// Restyled to match the Analytics page's look (flat KPI strip, icon badges
// in front of section titles, thin borders instead of heavy shadows/
// gradients) rather than the old warm-gradient hero + decorative progress
// rings — same shared primitives (IconBadge, the Icon set) Analytics uses,
// so the two pages read as one app instead of two different ones.

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
    <div className="max-w-7xl space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-900">{greeting}</h1>
          <p className="text-sm text-text-secondary mt-1">
            {pending > 0
              ? <><span className="font-semibold text-amber-700">{pending} item{pending !== 1 ? 's' : ''}</span> awaiting approval{scheduled > 0 && <> · <span className="font-semibold text-text">{scheduled}</span> scheduled</>}.</>
              : 'You\'re all caught up — nothing waiting on you right now.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate('/schedule')}>View Calendar</Button>
          <Button onClick={() => navigate('/social/instagram')}>Create Post</Button>
        </div>
      </div>

      {/* KPI strip — one flat row divided by rules, matching Analytics */}
      <Card className="shadow-none border-border/80 overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 divide-x-0 sm:divide-x divide-border">
          {kpis.map(k => (
            <div key={k.label} onClick={() => navigate(k.path)}
              className="p-5 cursor-pointer hover:bg-surface-subtle/60 transition-colors">
              <p className="text-xs text-text-tertiary mb-1.5">{k.label}</p>
              <p className="text-2xl font-bold text-text flex items-center gap-1.5">
                <span className="text-text-tertiary">{k.icon}</span>{k.value || 0}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Recent posts - 2 cols */}
        <Card className="lg:col-span-2 overflow-hidden shadow-none border-border/80">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <IconBadge>{Icon.document}</IconBadge>
              <div>
                <h3 className="font-semibold text-text text-sm">Recent posts</h3>
                <p className="text-xs text-text-tertiary mt-0.5">Across all platforms</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/schedule')}>View all</Button>
          </div>
          {recentPosts.length === 0 ? (
            <Empty
              icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>}
              title="No posts yet"
              description="Create your first post using the AI-powered Instagram generator."
              action={<Button onClick={() => navigate('/social/instagram')}>Create a Post</Button>}
            />
          ) : (
            <ul className="divide-y divide-border">
              {recentPosts.map(p => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-muted/60 transition-colors">
                  {(p.imageUrl || p.mediaUrls?.[0]) ? (
                    <PostImage src={p.imageUrl || p.mediaUrls?.[0]} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-surface-subtle flex items-center justify-center flex-shrink-0 text-text-tertiary">
                      {Icon.image}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text truncate">{p.copy?.slice(0, 65) || 'No caption'}…</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <PlatformPill platform={p.platform} />
                      <span className="text-[10px] text-text-tertiary">{formatDateTime(p.createdAt)}</span>
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
          <Card className="overflow-hidden shadow-none border-border/80">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
              <IconBadge tone="sage">{Icon.activity}</IconBadge>
              <h3 className="font-semibold text-text text-sm">Quick actions</h3>
            </div>
            <div className="p-2">
              {quickActions.map(q => (
                <button key={q.label} onClick={() => navigate(q.path)}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-text-secondary
                    hover:text-text hover:bg-surface-muted transition-colors flex items-center gap-2.5">
                  <span className="text-text-tertiary">{q.icon}</span>
                  {q.label}
                </button>
              ))}
            </div>
          </Card>

          {/* Pending approvals */}
          <Card className="overflow-hidden shadow-none border-border/80">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <IconBadge tone="rose">{Icon.approve}</IconBadge>
                <h3 className="font-semibold text-text text-sm">Pending approvals</h3>
              </div>
              {pending > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-600 text-white">{pending}</span>
              )}
            </div>
            {recentApprovals.length === 0 ? (
              <div className="py-8 text-center">
                <div className="w-8 h-8 rounded-lg bg-sage-50 flex items-center justify-center mx-auto mb-2 text-sage-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <p className="text-xs text-text-tertiary">All clear</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recentApprovals.map(a => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-muted/60 transition-colors">
                    <PlatformPill platform={a.platform} />
                    <p className="flex-1 text-xs text-text truncate">{a.title}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="px-5 py-3 border-t border-border">
              <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => navigate('/social/approvals')}>
                View all approvals
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Platform overview — flat list, replaces the old decorative progress rings */}
      <Card className="overflow-hidden shadow-none border-border/80">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <IconBadge>{Icon.grid}</IconBadge>
            <div>
              <h3 className="font-semibold text-text text-sm">Platform overview</h3>
              <p className="text-xs text-text-tertiary mt-0.5">Posts by platform, all time</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/analytics')}>Analytics</Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 divide-x-0 sm:divide-x divide-border">
          {PLATFORMS.map(p => {
            const count = state.posts.filter(post => post.platform === p.key).length
            return (
              <div key={p.key} className="p-5">
                <p className="text-xs text-text-tertiary mb-1.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
                  {p.label}
                </p>
                <p className="text-2xl font-bold text-text">{count}</p>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
