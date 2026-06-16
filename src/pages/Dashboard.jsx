import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/appStore'
import { Card, WarmCard, Button, Badge, PlatformPill, Empty, StatCard, PostImage } from '../components/ui/index'
import { formatDateTime } from '../lib/utils'

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

  return (
    <div className="max-w-7xl space-y-8">

      {/* Welcome hero */}
      <WarmCard className="p-8 animate-slide-up">
        <div className="flex items-center justify-between flex-wrap gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-5 rounded-full btn-amber" />
              <p className="text-xs font-semibold text-amber-700 tracking-[0.12em] uppercase">Arak Lighting · Content Studio</p>
            </div>
            <h1 className="font-display text-4xl font-bold text-stone-900 leading-tight mb-2">
              Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 17 ? 'Afternoon' : 'Evening'} ✦
            </h1>
            <p className="text-text-secondary text-sm max-w-md leading-relaxed">
              Your brand's content is performing. You have{' '}
              <span className="font-semibold text-amber-700">{pending} item{pending !== 1 ? 's' : ''} awaiting approval</span>
              {scheduled > 0 && <> and <span className="font-semibold text-stone-700">{scheduled} post{scheduled !== 1 ? 's' : ''} scheduled</span></>}.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="navy" onClick={() => navigate('/social/instagram')}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              Create Post
            </Button>
            <Button variant="secondary" onClick={() => navigate('/schedule')}>
              View Calendar
            </Button>
          </div>
        </div>

        {/* Quick platform icons */}
        <div className="flex items-center gap-4 mt-6 pt-6" style={{ borderTop: '1px solid rgba(212,160,23,0.2)' }}>
          <span className="text-xs text-text-tertiary font-medium">Platforms:</span>
          {[
            { label: 'Instagram', color: '#E1306C', bg: '#fce4f0' },
            { label: 'Facebook', color: '#1877F2', bg: '#e8f0fe' },
            { label: 'LinkedIn', color: '#0A66C2', bg: '#e1f0fb' },
            { label: 'TikTok', color: '#010101', bg: '#f0f0f0' },
            { label: 'X', color: '#000000', bg: '#f0f0f0' },
          ].map(p => (
            <div key={p.label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{ background: p.bg, color: p.color }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
              {p.label}
            </div>
          ))}
        </div>
      </WarmCard>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Live Campaigns" value={live || '0'} sub="Active right now" accent={live > 0}
          onClick={() => navigate('/campaigns')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>} />
        <StatCard label="Scheduled Posts" value={scheduled || '0'} sub="Queued up"
          onClick={() => navigate('/schedule')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>} />
        <StatCard label="Email Flows" value={flows || '0'} sub="Sending"
          onClick={() => navigate('/email')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>} />
        <StatCard label="Pending Approvals" value={pending || '0'} sub="Need review" accent={pending > 0}
          onClick={() => navigate('/approvals')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>} />
        <StatCard label="Total Posts" value={totalPosts || '0'} sub="All time"
          onClick={() => navigate('/schedule')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>} />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Recent posts - 2 cols */}
        <Card className="lg:col-span-2 overflow-hidden animate-stagger-1" shimmer>
          <div className="flex items-center justify-between px-6 pt-6 pb-4" style={{ borderBottom: '1px solid rgba(232,217,190,0.5)' }}>
            <div>
              <h3 className="font-display font-semibold text-text text-lg">Recent Posts</h3>
              <p className="text-xs text-text-tertiary mt-0.5">Across all platforms</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/schedule')}>
              View all
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </Button>
          </div>
          {recentPosts.length === 0 ? (
            <Empty
              icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>}
              title="No posts yet"
              description="Create your first post using the AI-powered Instagram generator."
              action={<Button onClick={() => navigate('/social/instagram')}>Create a Post</Button>}
            />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'rgba(232,217,190,0.3)' }}>
              {recentPosts.map((p, i) => (
                <li key={p.id}
                  className="flex items-center gap-4 px-6 py-3.5 hover:bg-surface-subtle/50 transition-colors group"
                  style={{ animationDelay: `${i * 0.05}s` }}>
                  {/* Platform dot */}
                  <div className="w-1 h-8 rounded-full flex-shrink-0"
                    style={{ background: p.platform === 'instagram' ? 'linear-gradient(135deg,#f09433,#bc1888)' : p.platform === 'facebook' ? '#1877F2' : p.platform === 'linkedin' ? '#0A66C2' : '#888' }} />
                  {/* Thumbnail */}
                  {(p.imageUrl || p.mediaUrls?.[0]) ? (
                    <PostImage src={p.imageUrl || p.mediaUrls?.[0]} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0 shadow-sm" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-surface-subtle flex items-center justify-center flex-shrink-0">
                      <PlatformPill platform={p.platform} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text truncate font-medium">{p.copy?.slice(0, 65) || 'No caption'}…</p>
                    <p className="text-xs text-text-tertiary mt-0.5">{formatDateTime(p.createdAt)}</p>
                  </div>
                  <Badge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Right column */}
        <div className="space-y-5">
          {/* Quick actions */}
          <WarmCard className="p-5 animate-stagger-2">
            <p className="text-xs font-bold tracking-[0.12em] uppercase text-amber-700 mb-4">Quick Actions</p>
            <div className="space-y-2">
              {[
                { label: '✦  Create Instagram Post', path: '/social/instagram' },
                { label: '◆  Schedule Content',      path: '/schedule' },
                { label: '◇  New Campaign',          path: '/campaigns/new' },
                { label: '◈  Upload Media',          path: '/media' },
                { label: '◉  View Analytics',        path: '/analytics' },
              ].map(q => (
                <button key={q.label} onClick={() => navigate(q.path)}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium text-text-secondary
                    hover:text-navy-900 hover:bg-white/60 transition-all duration-200 group flex items-center justify-between">
                  <span>{q.label}</span>
                  <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-gold-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
              ))}
            </div>
          </WarmCard>

          {/* Pending approvals */}
          <Card className="overflow-hidden animate-stagger-3">
            <div className="flex items-center justify-between px-5 pt-5 pb-3.5" style={{ borderBottom: '1px solid rgba(232,217,190,0.5)' }}>
              <h3 className="font-semibold text-text text-sm">Pending Approvals</h3>
              {pending > 0 && (
                <span className="btn-amber text-stone-900 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-amber">{pending}</span>
              )}
            </div>
            {recentApprovals.length === 0 ? (
              <div className="py-8 text-center">
                <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center mx-auto mb-2">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <p className="text-xs text-text-tertiary">All clear</p>
              </div>
            ) : (
              <ul className="divide-y py-1" style={{ borderColor: 'rgba(232,217,190,0.3)' }}>
                {recentApprovals.map(a => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-subtle/50 transition-colors">
                    <PlatformPill platform={a.platform} />
                    <p className="flex-1 text-xs text-text truncate">{a.title}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="px-5 py-3" style={{ borderTop: '1px solid rgba(232,217,190,0.3)' }}>
              <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => navigate('/approvals')}>
                View all approvals
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Platform performance overview */}
      <Card className="overflow-hidden animate-stagger-4">
        <div className="flex items-center justify-between px-6 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(232,217,190,0.5)' }}>
          <div>
            <h3 className="font-display font-semibold text-text text-lg">Platform Overview</h3>
            <p className="text-xs text-text-tertiary mt-0.5">Posts by platform this month</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/analytics')}>Analytics</Button>
        </div>
        <div className="p-6 grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { name: 'Instagram', color: 'linear-gradient(135deg,#f09433,#bc1888)', count: state.posts.filter(p => p.platform === 'instagram').length },
            { name: 'Facebook',  color: '#1877F2', count: state.posts.filter(p => p.platform === 'facebook').length },
            { name: 'LinkedIn',  color: '#0A66C2', count: state.posts.filter(p => p.platform === 'linkedin').length },
            { name: 'TikTok',    color: '#010101', count: state.posts.filter(p => p.platform === 'tiktok').length },
            { name: 'X',         color: '#000000', count: state.posts.filter(p => p.platform === 'x').length },
          ].map(p => (
            <div key={p.name} className="text-center group">
              <div className="relative w-14 h-14 mx-auto mb-3">
                <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(232,217,190,0.4)" strokeWidth="3" />
                  <circle cx="18" cy="18" r="14" fill="none" stroke="url(#g1)" strokeWidth="3"
                    strokeDasharray={`${Math.min(p.count * 10, 88)} 88`}
                    strokeLinecap="round" className="transition-all duration-700" />
                  <defs>
                    <linearGradient id={`g${p.name}`} x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#f5c000" /><stop offset="100%" stopColor="#d4a017" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-bold text-text">{p.count}</span>
                </div>
              </div>
              <p className="text-xs font-semibold text-text-secondary">{p.name}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
