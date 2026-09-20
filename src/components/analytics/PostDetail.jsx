import { useState } from 'react'
import { Modal, PostImage, PlatformPill, Button } from '../ui/index'
import { MetricInfoDot } from './MetricLabel'
import { fmt, pct } from '../../pages/analytics/format'
import { engagementRate, interactionsOf } from '../../lib/dashboardOverview'
import { MediaLightbox } from './MediaLightbox'
import { mediaItemsOf } from '../../lib/postMedia'

// ─── One post, on its own ──────────────────────────────────────────────────
//
// The tables could rank posts and could not open one. The only affordance was
// a four-character "View ↗" beside the date — easy to miss, and it leaves the
// app entirely, so "let me look at this post" and "let me look at how this
// post did" both ended at Instagram, which does not know what we measured.
//
// Clicking the row opens this instead: everything we hold about that one
// post, with the link out as a button rather than as the only way in.
//
// ── WHY METRICS ARE FILTERED, NOT ZEROED ──
//
// The same rule as everywhere else in this app — a number nobody measured is
// absent, never 0. Instagram reports no impressions since Graph v22 and
// LinkedIn takes no saves, so rendering the full grid for every platform
// would print a confident "0 saves" against a LinkedIn post that cannot have
// any. A metric the platform does not report is simply not shown, and one it
// reports as genuinely zero is.

const METRICS = [
  { key: 'likes', label: 'Likes', info: 'row.likes' },
  { key: 'comments', label: 'Comments', info: 'row.comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'saves', label: 'Saves' },
  { key: 'views', label: 'Views', info: 'row.views' },
  { key: 'reach', label: 'Reach', info: 'row.reach' },
  { key: 'impressions', label: 'Impressions', info: 'row.impressions' },
  { key: 'clicks', label: 'Clicks', info: 'row.clicks' },
]

const PRETTY_MEDIA = {
  IMAGE: 'Image', VIDEO: 'Video', REEL: 'Reel', REELS: 'Reel',
  CAROUSEL_ALBUM: 'Carousel', CAROUSEL: 'Carousel', STORY: 'Story',
}

const when = iso => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? (iso || '')
    : d.toLocaleString('en-US', {
      day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    })
}

export function PostDetail({ post, onClose }) {
  const open = !!post
  const a = post?.analytics || {}

  // −1 is closed. An index rather than a boolean because a carousel opens on
  // the slide that was clicked and moves from there.
  const [zoom, setZoom] = useState(-1)
  const media = mediaItemsOf(post)

  // A new post must not inherit the last one's open slide. Adjusted DURING
  // RENDER rather than in an effect — the same pattern PostImage uses for the
  // same reason: React discards the in-progress output and re-renders
  // immediately, so the new post never gets a frame showing the old one's
  // picture blown up over it.
  const [shownPost, setShownPost] = useState(post)
  if (shownPost !== post) {
    setShownPost(post)
    setZoom(-1)
  }

  // Present means reported. A platform that never fills a metric omits it, so
  // the absence is the signal — see the note above.
  const shown = METRICS.filter(m => typeof a[m.key] === 'number')
  const er = post ? (a.engagementRate ?? engagementRate(a)) : null
  const interactions = post ? interactionsOf(a) : 0
  const mediaLabel = PRETTY_MEDIA[String(post?.mediaProductType || post?.mediaType || '').toUpperCase()]
    || post?.mediaType || ''

  return (
    <Modal open={open} onClose={onClose} title="Post" width="max-w-2xl">
      {zoom >= 0 && (
        <MediaLightbox items={media} index={zoom} onIndex={setZoom} onClose={() => setZoom(-1)} />
      )}
      {post && (
        <div className="p-5 space-y-5">
          <div className="flex gap-4">
            {/* The thumbnail is the way in to the full picture — a 112px
                square is enough to recognise a post and not enough to look
                at one, which is half of why anybody opens a post that did
                well. */}
            {media.length > 0 ? (
              <button onClick={() => setZoom(0)}
                title={media.length > 1 ? `Open all ${media.length} images` : 'Open image'}
                className="relative w-28 h-28 flex-shrink-0 border border-border cursor-zoom-in
                  hover:border-stone-400 transition-colors group">
                <PostImage src={post.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                {media.length > 1 && (
                  <span className="absolute bottom-1 right-1 text-[10px] font-semibold text-white
                    px-1.5 py-0.5 tabular-nums" style={{ background: 'rgba(12,15,14,0.72)' }}>
                    1/{media.length}
                  </span>
                )}
                <span className="absolute inset-0 flex items-center justify-center opacity-0
                  group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(12,15,14,0.32)' }}>
                  <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="none"
                    stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
                  </svg>
                </span>
              </button>
            ) : (
              <PostImage src={post.thumbnailUrl} alt=""
                className="w-28 h-28 object-cover flex-shrink-0 border border-border" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <PlatformPill platform={post.platform} />
                {mediaLabel && (
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] leading-[1.4]
                    px-1.5 py-0.5 bg-surface-subtle text-text-secondary">{mediaLabel}</span>
                )}
                {post.isExternal && (
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] leading-[1.4]
                    px-1.5 py-0.5 bg-surface-subtle text-text-secondary"
                    title="Published on the platform directly, not through this app">Direct</span>
                )}
              </div>
              <p className="text-xs text-text-tertiary mb-2">{when(post.publishedAt)}</p>
              {/* The whole caption, wrapping. The table truncates to a line
                  and the truncation is most of why somebody opens this. */}
              <p className="text-sm text-text-secondary whitespace-pre-wrap break-words">
                {post.content || post.caption || <span className="text-text-tertiary">No caption</span>}
              </p>
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="text-xs text-text-tertiary border-t border-border pt-4">
              {post.platform === 'instagram' || post.platform === 'linkedin'
                ? 'Nothing has been reported for this post yet — the platforms can lag by up to 48 hours.'
                : 'This platform does not report per-post numbers.'}
            </p>
          ) : (
            <div className="border-t border-border pt-4">
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-4">
                {shown.map(m => (
                  <div key={m.key}>
                    <p className="eyebrow mb-1.5 flex items-center gap-1.5">
                      <span className="truncate">{m.label}</span>
                      {m.info && <MetricInfoDot metric={m.info} label={m.label} />}
                    </p>
                    <p className="text-xl font-bold text-text tabular-nums leading-none">{fmt(a[m.key])}</p>
                  </div>
                ))}
                <div>
                  <p className="eyebrow mb-1.5">Interactions</p>
                  <p className="text-xl font-bold text-text tabular-nums leading-none">{fmt(interactions)}</p>
                </div>
                <div>
                  <p className="eyebrow mb-1.5 flex items-center gap-1.5">
                    <span className="truncate">Engagement</span>
                    <MetricInfoDot metric="row.engagement_rate" label="Engagement rate" />
                  </p>
                  {/* A rate over a denominator nobody measured is not 0%. */}
                  <p className="text-xl font-bold text-text tabular-nums leading-none">
                    {er === null || er === undefined ? '—' : pct(er)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {post.platformPostUrl && (
            <div className="border-t border-border pt-4">
              <Button variant="secondary" size="sm"
                onClick={() => window.open(post.platformPostUrl, '_blank', 'noopener,noreferrer')}>
                Open on {post.platform === 'linkedin' ? 'LinkedIn' : 'Instagram'} ↗
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
