import { useState } from 'react'
import { useApp, actions } from '../../store/app'
import { Card, Button, Badge, Empty, PostImage } from '../../components/ui/index'
import { PLATFORM_META, formatDateTime } from '../../lib/utils'
import { useConnectedAccounts } from '../../lib/useConnectedAccounts'
import { ConnectAccounts } from '../../components/social/ConnectAccounts'
import { ComposerHost } from '../../components/composer/ComposerHost'

// ─── TikTok ────────────────────────────────────────────────────────────────
// Its own page rather than the generic SocialPlatform fallback, because TikTok
// diverges from Instagram in ways the shared page cannot express: video is the
// only real format, and every post carries required privacy and consent
// settings that Instagram has no equivalent of.
//
// The composer collects those; this page is where it opens from.

const META = PLATFORM_META.tiktok

export function TikTokPage() {
  const { state, dispatch } = useApp()
  const [filter, setFilter] = useState('all')
  const { accounts, loading, error, refresh } = useConnectedAccounts('tiktok')

  const posts = state.posts.filter(p => p.platform === 'tiktok')
  const connected = accounts.some(a => a.is_active !== false)
  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter)

  return (
    <div className="max-w-7xl space-y-5">
      <Card className="overflow-hidden">
        <div className="h-1" style={{ background: META.color }} />
        <div className="p-5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${META.bg} ${META.text}`}>{META.abbr}</span>
            <div>
              <h2 className="font-semibold text-text">TikTok</h2>
              <p className="text-xs text-text-secondary">
                {posts.length} post{posts.length === 1 ? '' : 's'} · {connected ? 'Connected' : 'Not connected'}
              </p>
            </div>
          </div>
          <div>
            <ComposerHost platform="tiktok" campaigns={state.campaigns} label="Create post" />
          </div>
        </div>

        <div className="px-5 pb-5 border-t border-border pt-4">
          <ConnectAccounts platform="tiktok" accounts={accounts}
            loading={loading} error={error} refresh={refresh} />
        </div>

        <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
          <div className="p-4 text-center"><p className="font-semibold text-text">{posts.length}</p><p className="text-xs text-text-secondary">Total posts</p></div>
          <div className="p-4 text-center"><p className="font-semibold text-text">{posts.filter(p => p.status === 'scheduled').length}</p><p className="text-xs text-text-secondary">Scheduled</p></div>
          <div className="p-4 text-center"><p className="font-semibold text-text">{posts.filter(p => p.status === 'published').length}</p><p className="text-xs text-text-secondary">Published</p></div>
        </div>
      </Card>

      <div className="flex w-fit">
        {['all', 'scheduled', 'published', 'draft'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 border -ml-px first:ml-0 text-xs font-semibold capitalize transition-colors ${filter === f ? 'bg-amber-700 text-white border-amber-700 relative z-10' : 'bg-white text-text-secondary border-border hover:text-text hover:bg-surface-subtle'}`}>
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>}
            title={`No ${filter === 'all' ? '' : filter + ' '}posts for TikTok`}
            description="TikTok takes vertical video. Generate one in Creative Studio, or plan a month and approve the ideas."
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
                        {p.mediaUrls.map((url, i) => <PostImage key={i} src={url} alt="" className="w-16 h-16 rounded-xl object-cover border border-border" />)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button variant="ghost" size="xs" onClick={() => dispatch(actions.deletePost(p.id))}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /></svg>
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
