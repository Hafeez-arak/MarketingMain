import { useEffect, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchAccountFeed } from '../../lib/zernioConnect'
import { formatBrandDateTime } from '../../lib/brandTime'
import { Card, Button, PostImage, Skeleton } from '../ui/index'

// ─── "All posts": everything live on the account since it was connected ───
//
// The other tabs on the Instagram page list OUR rows — drafts, the queue,
// what we sent. This one lists what is actually on the account, from Zernio,
// so a post made in the Instagram app shows up too. Each card says which kind
// it is. History from before the account was connected is not shown on
// purpose: the tab tracks from the connection onward. See feedPlan in
// api/zernio/_zernio.js.

const TAG = {
  platform: { label: 'From platform', className: 'bg-amber-50 text-amber-800', title: 'Published through this app' },
  direct:   { label: 'Direct',        className: 'bg-surface-subtle text-text-secondary', title: 'Posted on Instagram directly, not through this app' },
}

const MEDIA_LABEL = { video: 'Reel', reel: 'Reel', carousel: 'Carousel', image: 'Image' }

// Only numbers Zernio actually has. Instagram's reach arrives about a day
// late, so a fresh post shows likes and comments first rather than "0 reach".
function stats(post) {
  return [
    ['likes', 'like'], ['comments', 'comment'], ['reach', 'reached'], ['views', 'view'],
  ]
    .filter(([key]) => post[key] != null)
    .map(([key, word]) => {
      const n = post[key]
      const label = key === 'reach' ? word : `${word}${n === 1 ? '' : 's'}`
      return `${n.toLocaleString()} ${label}`
    })
}

function FeedSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3" aria-busy="true" aria-label="Loading posts">
      {[0, 1, 2].map(i => (
        <Card key={i} className="overflow-hidden">
          <div className="flex">
            <Skeleton className="w-28 h-28 flex-shrink-0" />
            <div className="flex-1 p-4 space-y-2.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

export function AccountFeed({ accounts = [] }) {
  const { activeWorkspaceId } = useAuth()
  const live = accounts.filter(a => a.is_active !== false)
  const [accountId, setAccountId] = useState('')
  const chosen = live.find(a => a.zernio_account_id === accountId) || live[0] || null

  const [state, setState] = useState({ loading: true, error: '', posts: [], fromDate: '', key: '' })
  const key = `${activeWorkspaceId}:${chosen?.zernio_account_id || ''}`

  // State is only written once the answer is back, so the effect below never
  // sets state synchronously; a list for another account is hidden by `key`
  // (see `fresh`) rather than cleared.
  async function fetchInto(isCurrent = () => true) {
    if (!activeWorkspaceId || !chosen) return
    const res = await fetchAccountFeed(activeWorkspaceId, chosen.zernio_account_id)
    if (!isCurrent()) return
    setState(res.error
      ? s => ({ ...s, loading: false, error: res.error, key })
      : { loading: false, error: '', posts: res.posts, fromDate: res.fromDate, key })
  }

  function load() {
    setState(s => ({ ...s, loading: true, error: '' }))
    fetchInto()
  }

  useEffect(() => {
    let current = true
    queueMicrotask(() => fetchInto(() => current))
    return () => { current = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!chosen) {
    return (
      <Card className="p-12 text-center">
        <p className="text-sm font-semibold text-text mb-1">No Instagram account connected</p>
        <p className="text-xs text-text-secondary">Connect one above to see everything posted on it.</p>
      </Card>
    )
  }

  // A different account's list is never shown under this one's name.
  const fresh = state.key === key
  const posts = fresh ? state.posts : []
  const since = fresh && state.fromDate ? formatBrandDateTime(`${state.fromDate}T00:00:00Z`).split(',')[0] : ''

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-text-secondary">
          Everything posted on <span className="font-semibold text-text">@{chosen.username}</span>
          {since ? <> since it was connected ({since})</> : null}, through this app or on Instagram directly.
        </p>
        <div className="flex items-center gap-2">
          {live.length > 1 && (
            <select value={chosen.zernio_account_id} onChange={e => setAccountId(e.target.value)}
              className="text-xs border border-border bg-white px-2 py-1">
              {live.map(a => <option key={a.zernio_account_id} value={a.zernio_account_id}>@{a.username}</option>)}
            </select>
          )}
          <Button size="sm" variant="secondary" onClick={load} disabled={state.loading}>Refresh</Button>
        </div>
      </div>

      {state.error && (
        <Card className="p-3 flex items-center gap-3 border-red-200 bg-red-50">
          <p className="text-xs flex-1 text-red-600">The posts could not be loaded ({state.error}).</p>
          <Button size="sm" variant="secondary" onClick={load} disabled={state.loading}>Try again</Button>
        </Card>
      )}

      {(state.loading || !fresh) && !posts.length && !(fresh && state.error) ? (
        <FeedSkeleton />
      ) : !posts.length ? (
        state.error ? null : (
          <Card className="p-12 text-center">
            <p className="text-sm font-semibold text-text mb-1">Nothing posted yet</p>
            <p className="text-xs text-text-secondary">
              Posts appear here once they are live — a post made in the Instagram app can take up to an hour and a half.
            </p>
          </Card>
        )
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {posts.map(p => {
            const tag = TAG[p.origin] || TAG.direct
            const numbers = stats(p)
            const Wrapper = p.url ? 'a' : 'div'
            return (
              <Wrapper key={p.id} {...(p.url ? { href: p.url, target: '_blank', rel: 'noreferrer' } : {})}
                className="block">
                <Card className="overflow-hidden hover:border-stone-400 transition-colors duration-150">
                  <div className="flex">
                    <PostImage src={p.thumbnail} alt="" className="w-28 h-28 object-cover flex-shrink-0" />
                    <div className="flex-1 p-4 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-2">
                        <span title={tag.title}
                          className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] leading-[1.4] ${tag.className}`}>
                          {tag.label}
                        </span>
                        {MEDIA_LABEL[p.media_type] && (
                          <span className="tag-base bg-surface-subtle text-text-secondary">{MEDIA_LABEL[p.media_type]}</span>
                        )}
                      </div>
                      <p className="text-sm text-text line-clamp-2 leading-relaxed mb-1.5">{p.caption || 'No caption'}</p>
                      <p className="text-[11px] text-text-tertiary">
                        {p.published_at ? formatBrandDateTime(p.published_at) : 'Date unknown'}
                        {numbers.length > 0 && <span className="ml-1.5">· {numbers.join(' · ')}</span>}
                      </p>
                      {p.url && <p className="text-[10px] text-text-tertiary mt-1 opacity-60">Click to open on Instagram</p>}
                    </div>
                  </div>
                </Card>
              </Wrapper>
            )
          })}
        </div>
      )}
    </div>
  )
}
