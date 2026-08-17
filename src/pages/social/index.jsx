import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useApp, actions } from '../../store/app'
import { Card, Button, Badge, Empty, PostImage } from '../../components/ui/index'
import { uid, PLATFORM_META, formatDateTime } from '../../lib/utils'

// ─── Social Overview ──────────────────────────────────────────────────────
export function SocialOverview() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()

  const platforms = Object.entries(PLATFORM_META)

  return (
    <div className="max-w-7xl space-y-5">
      {/* Connected accounts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {platforms.map(([key, meta]) => {
          const connected = state.connectedAccounts[key]
          const posts     = state.posts.filter(p => p.platform === key)
          return (
            <Card key={key} className="overflow-hidden cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all"
              onClick={() => navigate(`/social/${key}`)}>
              <div className="h-1" style={{ background: meta.color }} />
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${meta.bg} ${meta.text}`}>{meta.abbr}</span>
                    <span className="font-semibold text-text">{meta.label}</span>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] ${connected ? 'bg-green-50 text-green-700' : 'bg-surface-subtle text-text-tertiary'}`}>
                    {connected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <p className="text-sm text-text-secondary mb-4">
                  {posts.length === 0 ? 'No posts created yet.' : `${posts.length} post${posts.length===1?'':'s'} created`}
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-1 justify-center" onClick={e => { e.stopPropagation(); navigate(`/social/${key}`) }}>Open</Button>
                  {!connected && (
                    <Button variant="outline" size="sm" className="flex-1 justify-center" onClick={e => { e.stopPropagation(); dispatch(actions.connectAccount(key)); dispatch(actions.addNotification({ id: uid(), message: `${meta.label} account connected.`, createdAt: new Date().toISOString() })) }}>
                      Connect
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ─── Single Platform Page ─────────────────────────────────────────────────
export function SocialPlatform() {
  const { pathname } = useLocation()
  const platform = pathname.split('/')[2] // /social/facebook -> 'facebook'
  const { state, dispatch } = useApp()
  const meta = PLATFORM_META[platform]
  const connected = state.connectedAccounts[platform]
  const posts = state.posts.filter(p => p.platform === platform)
  const [filter, setFilter] = useState('all')

  if (!meta) return <p className="text-text-secondary">Platform not found.</p>

  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter)

  return (
    <div className="max-w-7xl space-y-5">
      {/* Header card */}
      <Card className="overflow-hidden">
        <div className="h-1" style={{ background: meta.color }} />
        <div className="p-5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${meta.bg} ${meta.text}`}>{meta.abbr}</span>
            <div>
              <h2 className="font-semibold text-text">{meta.label}</h2>
              <p className="text-xs text-text-secondary">{posts.length} post{posts.length===1?'':'s'} · {connected ? 'Connected' : 'Not connected'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {!connected && (
              <Button variant="outline" size="sm" onClick={() => { dispatch(actions.connectAccount(platform)); dispatch(actions.addNotification({ id: uid(), message: `${meta.label} connected.`, createdAt: new Date().toISOString() })) }}>
                Connect account
              </Button>
            )}
            {connected && (
              <Button variant="ghost" size="sm" onClick={() => dispatch(actions.disconnectAccount(platform))}>Disconnect</Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
          <div className="p-4 text-center"><p className="font-semibold text-text">{posts.length}</p><p className="text-xs text-text-secondary">Total posts</p></div>
          <div className="p-4 text-center"><p className="font-semibold text-text">{posts.filter(p=>p.status==='scheduled').length}</p><p className="text-xs text-text-secondary">Scheduled</p></div>
          <div className="p-4 text-center"><p className="font-semibold text-text">{posts.filter(p=>p.status==='published').length}</p><p className="text-xs text-text-secondary">Published</p></div>
        </div>
      </Card>

      {/* Posts list */}
      <div className="flex w-fit">
        {['all','scheduled','published','draft'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 border -ml-px first:ml-0 text-xs font-semibold capitalize transition-colors ${filter===f?'bg-amber-700 text-white border-amber-700 relative z-10':'bg-white text-text-secondary border-border hover:text-text hover:bg-surface-subtle'}`}>
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
            title={`No ${filter === 'all' ? '' : filter + ' '}posts for ${meta.label}`}
            description="Posts reach this page from a content plan — plan a month, approve the ideas, and they appear here."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => {
            const campaign = state.campaigns.find(c => c.id === p.campaignId)
            return (
              <Card key={p.id} className="p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge status={p.status} />
                      {campaign && <span className="text-[10px] font-bold uppercase tracking-[0.08em] bg-amber-100 text-amber-800 px-1.5 py-0.5 leading-[1.4]">{campaign.name}</span>}
                      {p.scheduledAt && <span className="text-xs text-text-tertiary">{formatDateTime(p.scheduledAt)}</span>}
                    </div>
                    <p className="text-sm text-text whitespace-pre-line line-clamp-3">{p.copy || 'No caption'}</p>
                    {p.hashtags && <p className="text-xs text-amber-500 mt-1">{p.hashtags}</p>}
                    {p.mediaUrls?.length > 0 && (
                      <div className="flex gap-2 mt-3">
                        {p.mediaUrls.map((url,i) => <PostImage key={i} src={url} alt="" className="w-16 h-16 rounded-xl object-cover border border-border"/>)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button variant="ghost" size="xs" onClick={() => dispatch(actions.deletePost(p.id))}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
