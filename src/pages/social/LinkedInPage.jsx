import { useState } from 'react'
import { useApp, actions } from '../../store/app'
import { Card, Button, Badge, Empty, PostImage, Skeleton } from '../../components/ui/index'
import { PLATFORM_META, formatDateTime } from '../../lib/utils'
import { useConnectedAccounts } from '../../lib/useConnectedAccounts'
import { ConnectAccounts } from '../../components/social/ConnectAccounts'
import { AccountAnalytics } from '../../components/social/AccountAnalytics'
import { ComposerHost } from '../../components/composer/ComposerHost'

// ─── LinkedIn ──────────────────────────────────────────────────────────────
// Its own page, with Posts | Analytics like Instagram's, rather than the
// generic platform fallback — which had no analytics at all. A LinkedIn
// company page is measured differently from everything else here: impressions
// and clicks instead of views and saves, plus page-level numbers (follower
// gains, page views) that only an organisation has.

const META = PLATFORM_META.linkedin
const TABS = [{ key: 'posts', label: 'Posts' }, { key: 'analytics', label: 'Analytics' }]

export function LinkedInPage() {
  const { state, dispatch } = useApp()
  const [filter, setFilter] = useState('all')
  const { accounts, loading, error, refresh } = useConnectedAccounts('linkedin')

  // Opened straight on Analytics with ?tab=analytics. Read once rather than
  // through the router: this URL also carries Zernio's OAuth callback params,
  // and nothing here should rewrite them.
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).get('tab') === 'analytics' ? 'analytics' : 'posts')

  const posts = state.posts.filter(p => p.platform === 'linkedin')
  const connected = accounts.some(a => a.is_active !== false)
  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter)

  return (
    <div className="max-w-7xl space-y-5">
      <Card className="overflow-hidden">
        <div className="h-1" style={{ background: META.color }} />
        <div className="p-5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className={`w-10 h-10 flex items-center justify-center text-sm font-bold ${META.bg} ${META.text}`}>{META.abbr}</span>
            <div>
              <h2 className="font-semibold text-text">LinkedIn</h2>
              {loading
                ? <Skeleton className="h-3 w-32 mt-1" />
                : (
                  <p className="text-xs text-text-secondary">
                    {posts.length} post{posts.length === 1 ? '' : 's'} · {connected ? 'Connected' : 'Not connected'}
                  </p>
                )}
            </div>
          </div>
          <ComposerHost platform="linkedin" campaigns={state.campaigns} label="Create post" />
        </div>
      </Card>

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === t.key
              ? 'border-text text-text' : 'border-transparent text-text-secondary hover:text-text'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'analytics' ? (
        <AccountAnalytics platform="linkedin" accounts={accounts} loadingAccounts={loading} />
      ) : (<>
        <Card className="overflow-hidden">
          <div className="p-5">
            <h3 className="text-sm font-semibold text-text mb-3">Connected accounts</h3>
            <ConnectAccounts platform="linkedin" accounts={accounts}
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
              icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>}
              title={`No ${filter === 'all' ? '' : filter + ' '}posts for LinkedIn`}
              description="Posts made in this app appear here. Posts made directly on LinkedIn are counted on the Analytics tab."
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
      </>)}
    </div>
  )
}
