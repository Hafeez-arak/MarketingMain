import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp, actions } from '../../store/app'
import { useAuth } from '../../store/auth'
import { fetchPostCounts } from '../../lib/scheduledPosts'
import { Card, Button, Badge, Empty, PostImage, Skeleton, Avatar } from '../../components/ui/index'
import { PLATFORM_META, LIVE_PLATFORMS, formatDateTime } from '../../lib/utils'
import { useConnectedAccounts } from '../../lib/useConnectedAccounts'
import { ConnectAccounts } from '../../components/social/ConnectAccounts'

// ─── Social Overview ──────────────────────────────────────────────────────
// One card per platform. "Connected" now means Zernio currently lists an
// active account for THIS workspace. It used to mean a boolean in
// localStorage that the Connect button set to true without connecting
// anything — so every card claimed success, and the first publish attempt was
// where the truth arrived.
//
// Beta platforms (Snapchat) get no card. It used to sit here as a greyed-out
// "Coming soon" card, which the team read as clutter rather than news.
//
// Each card has four states, from statusOf() in useConnectedAccounts: loading
// draws a skeleton of the card, failed says so, and only Zernio's own answer
// may say "Not connected". A connected card carries the green ring and the
// account itself; a not-connected one is drawn quieter, so the eye lands on
// what is live.

function AccountAvatar({ account }) {
  const name = account.username || account.display_name || '?'
  return account.profile_picture
    ? <img src={account.profile_picture} alt="" className="w-8 h-8 rounded-full object-cover border border-border flex-shrink-0" />
    : <Avatar name={name} size="md" />
}

function StatusPill({ status }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 leading-[1.4] bg-sage-100 text-sage-800 border border-sage-200 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-sage-600" />
        Connected
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] bg-red-50 text-red-600 flex-shrink-0">
        Not checked
      </span>
    )
  }
  return (
    <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] bg-surface-muted text-text-tertiary flex-shrink-0">
      Not connected
    </span>
  )
}

function PlatformHeading({ meta, muted = false }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={`w-8 h-8 flex items-center justify-center text-xs font-bold flex-shrink-0 ${meta.bg} ${meta.text} ${muted ? 'opacity-60' : ''}`}>{meta.abbr}</span>
      <span className={`font-semibold truncate ${muted ? 'text-text-secondary' : 'text-text'}`}>{meta.label}</span>
    </div>
  )
}

// The card's own shape with nothing claimed in it. The platform's name and
// mark say nothing about the account, so they show; the rest waits.
function PlatformCardSkeleton({ meta }) {
  return (
    <div className="bg-white border border-border overflow-hidden" aria-busy="true" aria-label={`Checking ${meta.label}`}>
      <Skeleton className="h-1 w-full" />
      <div className="p-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <PlatformHeading meta={meta} />
          <Skeleton className="h-[18px] w-20" />
        </div>
        <div className="flex items-center gap-2.5 mb-3 px-3 py-2 border border-border-light">
          <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <Skeleton className="h-3 w-24 mb-4" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  )
}

function PlatformCard({ meta, status, postCount, accounts, onOpen, onRetry }) {
  if (status === 'loading') return <PlatformCardSkeleton meta={meta} />

  const connected = status === 'connected'
  const live = accounts.filter(a => a.is_active !== false)
  const postLine = postCount === null ? '' : postCount === 0 ? 'No posts created yet.' : `${postCount} post${postCount === 1 ? '' : 's'} created`

  return (
    <div onClick={onOpen}
      className={`overflow-hidden cursor-pointer transition-colors duration-150 ${connected
        ? 'bg-white border border-sage-300 ring-1 ring-sage-300 hover:border-sage-500 hover:ring-sage-500'
        : 'bg-surface-subtle border border-border hover:border-stone-400'}`}>
      <div className="h-1" style={connected ? { background: meta.color } : undefined} />
      <div className="p-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <PlatformHeading meta={meta} muted={!connected} />
          <StatusPill status={status} />
        </div>

        {connected ? (
          <div className="space-y-1.5 mb-3">
            {live.map(a => (
              <div key={a.zernio_account_id || a.id || a.username}
                className="flex items-center gap-2.5 px-3 py-2 bg-sage-50 border border-sage-200">
                <AccountAvatar account={a} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text truncate">
                    {a.username ? `@${a.username}` : (a.display_name || 'Connected account')}
                  </p>
                  <p className={`text-xs truncate ${a.needs_reconnection ? 'text-red-600' : 'text-text-secondary'}`}>
                    {a.needs_reconnection
                      ? 'Needs reconnecting'
                      : a.followers_count != null
                      ? `${Number(a.followers_count).toLocaleString('en-US')} followers`
                      : 'Ready to publish'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-secondary mb-3 min-h-[3.25rem]">
            {status === 'failed'
              ? "Couldn't load connected accounts, so this one wasn't checked."
              : `Connect a ${meta.label} account to publish and see analytics here.`}
          </p>
        )}

        <p className="text-xs text-text-tertiary mb-4 min-h-[1rem]">{postLine}</p>

        {/* Two actions, because a card that only says "Open" gives someone
            with nothing connected no idea what to do next. The Connect button
            navigates to the platform page rather than starting OAuth here —
            the flow needs a page to come back to, and one implementation of
            it is enough. */}
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          <Button variant="secondary" size="sm" className="flex-1 justify-center" onClick={onOpen}>
            Open
          </Button>
          {status === 'not_connected' && (
            <Button variant="primary" size="sm" className="flex-1 justify-center" onClick={onOpen}>
              Connect
            </Button>
          )}
          {status === 'failed' && (
            <Button variant="outline" size="sm" className="flex-1 justify-center" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function SocialOverview() {
  const navigate = useNavigate()
  const { allAccounts, statusOf, error, refresh } = useConnectedAccounts()
  const { activeWorkspaceId, accessToken } = useAuth()
  // Posts live in Supabase, not in state.posts — that store only holds what
  // this browser session created, so counting it said "No posts created yet"
  // for every post made before the page loaded. null = not answered yet.
  // Kept with the workspace it answers for, so a switch reads as "not
  // answered yet" without a reset inside the effect.
  const [answered, setAnswered] = useState({ ws: null, counts: null })
  const counts = answered.ws === activeWorkspaceId ? answered.counts : null
  useEffect(() => {
    let live = true
    // null back means the count failed: kept as `failed`, so each card says
    // nothing about its posts rather than "No posts created yet".
    fetchPostCounts(activeWorkspaceId, accessToken).then(c => {
      if (live) setAnswered({ ws: activeWorkspaceId, counts: c ?? { failed: true } })
    })
    return () => { live = false }
  }, [activeWorkspaceId, accessToken])

  const platforms = LIVE_PLATFORMS.map(key => [key, PLATFORM_META[key]])
  // Said once, above the cards, and only while some card has no answer. A
  // refresh that fails over an answer already on screen keeps that answer,
  // and the cards are still right.
  const failed = platforms.some(([key]) => statusOf(key) === 'failed')

  return (
    <div className="max-w-7xl space-y-5">
      {failed && (
        <Card className="p-4 flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-600">Couldn't load connected accounts</p>
            {error && <p className="text-xs text-text-secondary mt-0.5">{error}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={refresh}>Try again</Button>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {platforms.map(([key, meta]) => (
          <PlatformCard
            key={key}
            meta={meta}
            status={statusOf(key)}
            postCount={counts === null || counts.failed ? null : (counts[key] || 0)}
            accounts={allAccounts.filter(a => a.platform === key)}
            onOpen={() => navigate(`/social/${key}`)}
            onRetry={refresh}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Single Platform Page ─────────────────────────────────────────────────
// The generic fallback. Instagram, LinkedIn, TikTok and Snapchat each have their own
// page; this renders any platform that does not, so a platform added to
// PLATFORM_META before its page exists still shows something honest rather
// than a blank route.
export function SocialPlatform() {
  // The route's own parameter, not a split of the path: v2 moved the page
  // from /social/:platform to /marketing/social/:platform.
  const { platform } = useParams()
  const { state, dispatch } = useApp()
  const meta = PLATFORM_META[platform]
  const posts = state.posts.filter(p => p.platform === platform)
  const [filter, setFilter] = useState('all')
  const { accounts, loading, status, error, refresh } = useConnectedAccounts(platform)

  if (!meta) return <p className="text-text-secondary">Platform not found.</p>

  const connected = accounts.some(a => a.is_active !== false)
  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter)

  return (
    <div className="max-w-7xl space-y-5">
      <Card className="overflow-hidden">
        <div className="h-1" style={{ background: meta.color }} />
        <div className="p-5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${meta.bg} ${meta.text}`}>{meta.abbr}</span>
            <div>
              <h2 className="font-semibold text-text">{meta.label}</h2>
              <p className="text-xs text-text-secondary">
                {posts.length} post{posts.length === 1 ? '' : 's'} · {loading ? 'Checking connection…' : connected ? 'Connected' : status === 'failed' ? 'Connection not checked' : 'Not connected'}
              </p>
            </div>
          </div>
        </div>
        <div className="px-5 pb-5 border-t border-border pt-4">
          <ConnectAccounts platform={platform} accounts={accounts}
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
