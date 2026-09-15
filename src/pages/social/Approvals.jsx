import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../store/app'
import { useAuth } from '../../store/auth'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/supabaseClient'
import { Card, Button, Empty, Spinner, PostImage, PageHeader, Skeleton, ConfirmDialog } from '../../components/ui/index'
import { formatDate, PLATFORM_META } from '../../lib/utils'
import { formatBrandDateTime, formatBrandTime, brandWallToUtc, utcToBrandInputs, BRAND_TIMEZONE_LABEL } from '../../lib/brandTime'
import { logEditFeedback } from '../../lib/brandBrain'
import { fetchBrandProfile } from '../../lib/brandBrain'
import { buildContext, fetchBrandMemory } from '../../lib/brandContext'
import { fetchBrandSchema, fetchDirectoryRows } from '../../lib/brandSchema'
import { fetchApprovalsData, markIdeaProcessing, markIdeasGenerated } from '../../lib/contentPlans'
import { ensureCaptions } from '../../lib/campaignPlanner'
import { publishIdeasAsPosts } from '../../lib/studioBridge'
import { syncZernio } from '../../lib/zernio'
import { defaultWebhookUrl } from '../../lib/n8nWebhooks'
import { fetchScheduledPosts, movePost, unschedulePost } from '../../lib/scheduledPosts'
import { postLock, queueBucket } from '../../lib/postLock'
import { accountFor, bookPost } from '../../lib/planScheduling'
import { isProtectedPlatform } from '../../lib/platformSafety'
import { useConnectedAccounts } from '../../lib/useConnectedAccounts'
import { MediaViewer } from '../../components/PostMediaViewer'
import { dbIdeaToDraft } from '../../lib/campaignPlan'
import { InstagramPostDetail } from './InstagramPage'
import { ComposerHost } from '../../components/composer/ComposerHost'

// ─── Post Queue (was Post Approvals) ─────────────────────────────────────
// Every post the app produces, grouped by the monthly plan it came from, and
// sorted by what happens to it next — see TABS below for why there is no
// approve/reject step any more. Route and file keep the old name so links and
// imports elsewhere still work.
// Every approved idea has a durable generation_status
// (processing / completed / failed) tracked on plan_ideas — see
// 20260723_generation_status — so a card here is never just "missing"; it
// shows the real state, with a Retry action on failure. Posts not from a plan
// (source != 'plan') get their own "Manual posts" group at the bottom since
// they have no plan to group under.
//
// 'processing' is a much shorter window than it used to be. It once covered a
// whole background batch in n8n writing captions and images; now finalize
// writes the post row itself, and the flag only spans the caption draft.

const TABLES = {
  instagram: 'instagram_generated_posts',
}

// A "processing" idea can still get stranded: finalize marks it before
// drafting, and a tab closed mid-draft (or a Draft Copy webhook that never
// answers) leaves generation_status at 'processing' with no error and no
// Retry button. Treat it as stale once it has run well past the time a
// caption draft actually takes.
const STALE_PROCESSING_MS = 90 * 1000

// image_urls (carousel) preferred; fall back to the single image_url.
const mediaOf = r => (Array.isArray(r.image_urls) && r.image_urls.length ? r.image_urls : [r.image_url].filter(Boolean))

// Rows map onto the UI post shape: a single caption, plus the shared media
// and publishing fields. contentRoute is hardcoded to 'scheduled' — the
// alternative routes belonged to a platform that no longer exists here.
function normalizePost(row, platform) {
  const base = {
    id: row.id, platform, _table: row.post_table || TABLES[platform],
    captionAr: row.caption_ar || '', captionEn: row.caption_en || '',
    postKind: row.post_kind || 'caption_image',
    hashtags: row.hashtags, imageUrl: row.image_url, imagePrompt: row.image_prompt,
    style: row.style, topic: row.topic, aspectRatio: row.aspect_ratio,
    scheduledAt: row.scheduled_date || null, publishTime: row.publish_time || '', campaignId: row.campaign_id,
    // The planned moment as an instant, for "has its time passed?".
    plannedAt: row.scheduled_date ? (brandWallToUtc(row.scheduled_date, (row.publish_time || '09:00').slice(0, 5))?.getTime() || null) : null,
    mediaUrls: mediaOf(row), status: row.status, source: row.source,
    planIdeaId: row.plan_idea_id || null,
    // Carried so a hand-written post created from a plan still groups under
    // that plan here, instead of falling into the ungrouped pile as though it
    // had nothing to do with the month it was planned in.
    planId: row.plan_id || null,
    // See InstagramPage: a post the operator wrote themselves is not AI work,
    // and the badge is read as a claim about authorship.
    generatedByWorkflow: row.source !== 'manual', createdAt: row.created_at,
    // Zernio publish state — distinct from `status` (the review decision).
    zernioPostId: row.zernio_post_id || '',
    zernioAccountId: row.zernio_account_id || '',
    // The per-platform block chosen last time this post was composed. Carried
    // so publishing from here sends the same options the composer would.
    platformOptions: row.platform_options || {},
    publishStatus: row.publish_status || 'not_published',
    publishError: row.publish_error || '',
    publishedAt: row.published_at || null,
    scheduledPublishAt: row.scheduled_publish_at || null,
    platformPostUrl: row.platform_post_url || '',
    videoUrl: row.video_url || '',
    coverImageUrl: row.cover_image_url || '',
    _fromSupabase: true,
    // The untouched view row. Everything above is renamed for this screen's
    // own shape, but composerFromPost() reads the DATABASE names — handing it
    // the normalised object would silently load a post with no media, no
    // format and no options, which looks like a composer bug rather than a
    // mismatch. Kept whole rather than mapped back field by field, since the
    // view is the authority on what a post is.
    _raw: row,
  }
  return { ...base, copy: row.caption, contentRoute: 'scheduled' }
}

function useApprovalPosts(accessToken, workspaceId) {
  const [posts,   setPosts]   = useState([])
  const [ideas,   setIdeas]   = useState([])
  const [plans,   setPlans]   = useState([])
  const [loading, setLoading] = useState(false)
  // Whether the first fetch has come back. The page calls fetchAll from an
  // effect, which runs after the first paint — so with `loading` alone that
  // paint showed "Nothing to review" before anything had been asked.
  const [loaded,  setLoaded]  = useState(false)

  const fetchAll = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    // Still scoped to the active company so one company never sees another's
    // posts — fetchScheduledPosts filters on workspace_id, and the view is
    // declared security_invoker so the base tables' RLS applies underneath it
    // too. Both, deliberately: the filter is what makes the query small, the
    // RLS is what makes it safe.
    try {
      // One ordered query over all three post tables, via the scheduled_posts
      // view. This replaced a hand-union of post tables — which is
      // the reason TikTok and Snapchat posts existed in the database but never
      // appeared on this screen. Adding a platform is now a change in the view
      // and in lib/scheduledPosts.js, not here.
      const [rows, approvalsData] = await Promise.all([
        fetchScheduledPosts(workspaceId, accessToken),
        fetchApprovalsData(workspaceId, accessToken),
      ])

      setPosts(rows.map(r => normalizePost(r, r.platform)))
      setIdeas(approvalsData.ideas || [])
      setPlans(approvalsData.plans || [])
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [accessToken, workspaceId])

  async function updateStatus(post, status) {
    if (!accessToken) return
    await fetch(`${SUPABASE_URL}/rest/v1/${post._table}?id=eq.${post.id}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
    })
    setPosts(prev => prev.map(p => p.id === post.id && p.platform === post.platform ? { ...p, status } : p))
  }

  return { posts, ideas, plans, loading, loaded, fetchAll, updateStatus, setIdeas }
}

// Shaped like a plan group with its first cards open, so the page keeps its
// structure while the queue loads.
function ApprovalsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading posts">
      {[2, 0].map((cards, g) => (
        <div key={g} className="border border-border bg-white overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3">
            <Skeleton className="w-3.5 h-3.5" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-12" />
          </div>
          {cards > 0 && (
            <div className="grid grid-cols-1 gap-3 p-4 pt-0">
              {Array.from({ length: cards }, (_, i) => (
                <div key={i} className="flex gap-4 border border-border p-4">
                  <Skeleton className="w-24 h-24 flex-shrink-0" />
                  <div className="flex-1 space-y-2.5">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Small card variants for in-flight/failed generation ──────────────────
function ProcessingCard({ idea }) {
  const m = PLATFORM_META[idea.platform] || PLATFORM_META.instagram
  const platformMeta = { label: m.label, color: `${m.bg} ${m.text}` }
  return (
    <Card className="overflow-hidden">
      <div className="flex">
        <div className="w-28 flex-shrink-0 bg-surface-subtle flex items-center justify-center" style={{ minHeight: '80px', maxHeight: '140px' }}>
          <Spinner />
        </div>
        <div className="flex-1 p-4 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] ${platformMeta.color}`}>{platformMeta.label}</span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 leading-[1.4] bg-amber-50 text-amber-700 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Generating…
            </span>
          </div>
          <p className="text-sm text-text leading-relaxed">{idea.title || idea.topic || 'Untitled idea'}</p>
          <p className="text-[11px] text-text-tertiary mt-1">Writing the caption — this usually takes a few seconds.</p>
        </div>
      </div>
    </Card>
  )
}

function FailedCard({ idea, post, onRetry, retrying }) {
  const m = PLATFORM_META[idea.platform] || PLATFORM_META.instagram
  const platformMeta = { label: m.label, color: `${m.bg} ${m.text}` }
  return (
    <Card className="overflow-hidden border-red-200">
      <div className="flex">
        <div className="w-28 flex-shrink-0 bg-red-50 flex items-center justify-center" style={{ minHeight: '80px', maxHeight: '140px' }}>
          <svg className="w-7 h-7 text-red-300" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div className="flex-1 p-4 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] ${platformMeta.color}`}>{platformMeta.label}</span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 leading-[1.4] bg-red-50 text-red-600">✕ Generation failed</span>
          </div>
          <p className="text-sm text-text leading-relaxed">{idea.title || idea.topic || 'Untitled idea'}</p>
          <p className="text-[11px] text-red-600 mt-1 leading-relaxed">{idea.generation_error || 'Unknown error.'}</p>
          <Button size="xs" className="mt-2" onClick={() => onRetry(idea, post)} disabled={retrying}>
            {retrying ? <><Spinner size="sm" /> Retrying…</> : '↻ Retry'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

// ─── The queue's three buckets ────────────────────────────────────────────
// A plan no longer passes through a separate approval — its dates, times,
// pictures and captions were checked on the planner's captions step, and
// saving it books each post at Zernio. So this screen stopped asking
// "approve or reject?" and answers "what is going out, what went out, and
// what needs a person?". The buckets come from lib/postLock.js, so a post is
// read-only here for exactly the same reason it is read-only in the planner.
const TABS = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'upcoming',  label: 'Upcoming' },
  { key: 'published', label: 'Published' },
  { key: 'all',       label: 'All' },
]

// Why a post that is not booked is not booked, in words that say what to do.
function attentionReason(post, accounts, now) {
  if (post.publishStatus === 'failed') return post.publishError || 'Publishing failed.'
  if (isProtectedPlatform(post.platform)) return 'LinkedIn posts are drafts — nothing here posts to the page.'
  if (post.status === 'rejected') return 'Rejected.'
  if (post.platform === 'tiktok' && !post.platformOptions?.tiktok?.privacy_level) {
    return 'TikTok needs a privacy level and a per-post consent confirmation.'
  }
  if (!accountFor(post._raw, accounts)) {
    const count = accounts.filter(a => a.platform === post.platform && a.is_active !== false).length
    return count ? 'More than one account is connected — choose which one in the composer.' : `No ${PLATFORM_META[post.platform]?.label || post.platform} account is connected.`
  }
  if (post.plannedAt && post.plannedAt <= now) return 'Its planned time has passed — pick a new time.'
  return 'Not scheduled yet.'
}

// 'YYYY-MM-DDTHH:MM' in brand time, for a datetime-local input.
function wallInput(dateKey, time) {
  return dateKey ? `${dateKey}T${(time || '09:00').slice(0, 5)}` : ''
}

function PlatformChip({ platform }) {
  const m = PLATFORM_META[platform] || { label: platform, bg: 'bg-stone-100', text: 'text-stone-700' }
  return <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] ${m.bg} ${m.text}`}>{m.label}</span>
}

const btn = 'text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40'

// One post, whatever bucket it is in. The actions are the bucket's:
//   upcoming   edit (re-books at Zernio), reschedule, cancel the booking
//   attention  edit, schedule, post now — or the one place that can fix it
//   published  nothing but a link: it has gone out
function QueueCard({ post, bucket, accounts, now, busy, onOpen, onOpenMedia, onEdit, onBook, onReschedule, onCancel }) {
  const [expanded, setExpanded] = useState(false)
  const [picking, setPicking] = useState(false)
  const [when, setWhen] = useState('')
  const media = post.mediaUrls || []
  const thumb = post.imageUrl || media[0] || post.coverImageUrl || ''
  const text = [post.captionAr, post.captionEn].filter(Boolean)
  const caption = text.length ? text : [post.copy || '']
  const long = caption.join('\n').length > 220 || caption.join('\n').split('\n').length > 4
  const protectedPost = isProtectedPlatform(post.platform)
  const needsComposer = post.platform === 'tiktok' && !post.platformOptions?.tiktok?.privacy_level
  const account = accountFor(post._raw, accounts)
  const lock = postLock(post._raw, now)

  function startPicking() {
    const cur = post.scheduledPublishAt ? utcToBrandInputs(post.scheduledPublishAt) : { date: post.scheduledAt, time: post.publishTime }
    setWhen(wallInput(cur.date, cur.time))
    setPicking(true)
  }
  const future = when && brandWallToUtc(when.slice(0, 10), when.slice(11, 16))?.getTime() > now + 60 * 1000

  return (
    <Card className={`overflow-hidden ${bucket === 'attention' && post.publishStatus === 'failed' ? 'border-red-200' : ''}`}>
      <div className="flex items-start">
        <button type="button" onClick={() => (thumb || post.videoUrl) && onOpenMedia(post)}
          className="w-24 h-24 sm:w-28 sm:h-28 m-3 mr-0 flex-shrink-0 bg-surface-subtle border border-border hover:border-amber-400 overflow-hidden relative"
          title={thumb ? 'Open the picture' : undefined}>
          {thumb
            ? <PostImage src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />
            : <span className="absolute inset-0 flex items-center justify-center text-text-disabled text-lg">{post.videoUrl ? '🎬' : '¶'}</span>}
          {media.length > 1 && (
            <span className="absolute top-1 right-1 text-[9px] font-bold bg-black/65 text-white px-1.5 leading-[1.6]">{media.length}</span>
          )}
        </button>

        <div className="flex-1 p-4 min-w-0 space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <PlatformChip platform={post.platform} />
            {bucket === 'upcoming' && <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] bg-indigo-50 text-indigo-700">🗓 {formatBrandDateTime(post.scheduledPublishAt)}</span>}
            {bucket === 'published' && <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] bg-sage-50 text-sage-700">{lock.state === 'publishing' ? '↗ Publishing…' : '✓ Published'}</span>}
            {bucket === 'attention' && post.publishStatus === 'failed' && <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] bg-red-50 text-red-600">✕ Failed</span>}
            {protectedPost && <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] bg-sky-50 text-sky-800">Draft only</span>}
            {media.length > 1 && <span className="text-[10px] text-text-tertiary">Carousel · {media.length} slides</span>}
            {post.topic && <span className="text-[11px] text-text-tertiary truncate">· {post.topic}</span>}
          </div>

          <button type="button" onClick={() => onOpen(post)} className="block text-left w-full">
            {caption.map((c, i) => (
              <p key={i} dir={/[؀-ۿ]/.test(c) ? 'rtl' : 'ltr'}
                className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${i ? 'text-text-secondary mt-1' : 'text-text'} ${expanded ? '' : 'line-clamp-3'}`}>
                {c || 'No caption'}
              </p>
            ))}
          </button>
          {long && (
            <button onClick={() => setExpanded(v => !v)} className="text-[11px] font-semibold text-amber-700 hover:text-amber-800">
              {expanded ? 'Show less' : 'Show full caption'}
            </button>
          )}

          {bucket === 'published' && (
            <p className="text-[11px] text-text-tertiary flex items-center gap-2 flex-wrap">
              {post.publishedAt ? `Went out ${formatBrandDateTime(post.publishedAt)}` : post.scheduledPublishAt ? `Went out ${formatBrandDateTime(post.scheduledPublishAt)}` : 'Gone out'}
              {post.platformPostUrl && <a href={post.platformPostUrl} target="_blank" rel="noreferrer" className="font-semibold text-amber-700 hover:underline">View on {PLATFORM_META[post.platform]?.label || post.platform} ↗</a>}
              <span>· can’t be edited</span>
            </p>
          )}

          {bucket === 'attention' && (
            <p className={`text-[11px] leading-relaxed ${post.publishStatus === 'failed' ? 'text-red-600' : 'text-amber-800'}`}>
              {attentionReason(post, accounts, now)}
              {post.scheduledAt && post.publishStatus !== 'failed' && <span className="text-text-tertiary"> · planned for {formatDate(post.scheduledAt)}{post.publishTime ? ` ${formatBrandTime(post.publishTime)}` : ''}</span>}
            </p>
          )}

          {bucket !== 'published' && (
            <div className="flex items-center gap-2 flex-wrap pt-0.5">
              <button onClick={() => onEdit(post)} className={`${btn} border-border text-text-secondary hover:bg-surface-subtle`}>
                {needsComposer ? '↗ Finish in composer' : '✎ Edit'}
              </button>
              {bucket === 'upcoming' && !picking && (
                <>
                  <button onClick={startPicking} disabled={busy} className={`${btn} border-border text-text-secondary hover:bg-surface-subtle`}>🗓 Reschedule</button>
                  <button onClick={() => onCancel(post)} disabled={busy} className={`${btn} border-red-200 text-red-500 hover:bg-red-50`}>Cancel schedule</button>
                </>
              )}
              {bucket === 'attention' && !protectedPost && !needsComposer && account && !picking && (
                <>
                  <button onClick={startPicking} disabled={busy} className={`${btn} border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100`}>🗓 Schedule</button>
                  <button onClick={() => onBook(post, '')} disabled={busy} className={`${btn} border-border text-text-secondary hover:bg-surface-subtle`}>↗ Post now</button>
                </>
              )}
              {picking && (
                <>
                  <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} aria-label="New time"
                    className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white" />
                  <span className="text-[10px] font-semibold text-text-tertiary">{BRAND_TIMEZONE_LABEL}</span>
                  <button disabled={busy || !future}
                    onClick={async () => { const ok = bucket === 'upcoming' ? await onReschedule(post, when) : await onBook(post, when); if (ok) setPicking(false) }}
                    className={`${btn} border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100`}>
                    {busy ? 'Working…' : bucket === 'upcoming' ? 'Move' : 'Schedule'}
                  </button>
                  <button onClick={() => setPicking(false)} className="text-[11px] text-text-tertiary hover:text-text">Cancel</button>
                  {when && !future && <span className="text-[10px] text-red-600">Pick a time in the future.</span>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

// The order within a group: what goes out next first; what went out most
// recently first; what needs a person by the date it was meant for.
function sortItems(items, tab) {
  const at = x => x.post ? Date.parse(x.post.scheduledPublishAt || x.post.publishedAt || '') || x.post.plannedAt || 0 : 0
  return [...items].sort((a, b) => tab === 'published' ? at(b) - at(a) : at(a) - at(b))
}

export function Approvals() {
  const { state } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const { posts, ideas, plans, loading, loaded, fetchAll, setIdeas } = useApprovalPosts(accessToken, activeWorkspaceId)
  const { allAccounts: accounts } = useConnectedAccounts()
  const [tab,           setTab]           = useState(null)   // null until the first load picks one
  const [selectedPost,  setSelectedPost]  = useState(null)
  const [retryingId,    setRetryingId]    = useState(null)
  const [collapsed,     setCollapsed]     = useState({})
  const [busyId,        setBusyId]        = useState(null)
  const [cancelTarget,  setCancelTarget]  = useState(null)
  const [viewer,        setViewer]        = useState(null)
  // The post currently open in the composer, or null.
  const [composerPost,  setComposerPost]  = useState(null)
  const [notice,        setNotice]        = useState(null)   // { tone: 'error'|'ok', text }
  const [syncing,       setSyncing]       = useState(false)
  const [syncNote,      setSyncNote]      = useState('')

  useEffect(() => { fetchAll() }, [fetchAll])

  // Every ~4s while anything is generating or publishing, otherwise every 30s.
  const active = ideas.some(i => i.generation_status === 'processing') || posts.some(p => p.publishStatus === 'publishing')
  useEffect(() => {
    const interval = setInterval(fetchAll, active ? 4000 : 30000)
    return () => clearInterval(interval)
  }, [fetchAll, active])

  // `now` as state, ticked from an effect (React's purity rule forbids calling
  // Date.now() during render). Ticks every 30s so a booked post whose time
  // arrives moves to Published without a reload.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), active ? 4000 : 30000)
    return () => clearInterval(interval)
  }, [active])

  // One card per POST ROW. This used to be one card per plan idea, with the
  // idea's post looked up in a Map keyed by idea id — so an idea sent to two
  // platforms kept only one of its posts, and a plan showed fewer posts than it
  // had. Ideas still get a card of their own while they have no post yet
  // (writing, or failed to write).
  const items = useMemo(() => {
    const ideaHasPost = new Set(posts.map(p => p.planIdeaId).filter(Boolean))
    const ideaItems = ideas
      .filter(i => !ideaHasPost.has(i.id) && ['processing', 'failed'].includes(i.generation_status))
      .map(i => {
        let kind = i.generation_status
        let idea = i
        if (kind === 'processing' && i.generation_started_at && now - new Date(i.generation_started_at).getTime() > STALE_PROCESSING_MS) {
          kind = 'failed'
          idea = { ...i, generation_error: 'Taking longer than expected — the request may never have finished. Retry, or check the n8n workflow.' }
        }
        return { key: `idea_${i.id}`, type: kind, idea, bucket: 'attention', planId: i.plan_id }
      })
    const postItems = posts.map(p => ({
      key: `post_${p.platform}_${p.id}`, type: 'post', post: p, planId: p.planId || null,
      bucket: queueBucket(p._raw, now),
    }))
    return [...ideaItems, ...postItems]
  }, [ideas, posts, now])

  const counts = Object.fromEntries(TABS.map(t => [t.key, t.key === 'all' ? items.length : items.filter(x => x.bucket === t.key).length]))
  // Open on what needs a person when anything does, otherwise on what is next.
  const currentTab = tab || (counts.attention ? 'attention' : counts.upcoming ? 'upcoming' : 'all')
  const filtered = currentTab === 'all' ? items : items.filter(x => x.bucket === currentTab)

  // Group by plan (newest plan first, as fetched); posts from no plan last.
  const grouped = useMemo(() => {
    const byKey = new Map()
    for (const item of filtered) {
      const key = item.planId || 'manual'
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push(item)
    }
    const planGroups = plans
      .filter(p => byKey.has(p.id))
      .map(p => ({ key: p.id, title: p.name || `${p.month || ''} Content Plan`, items: sortItems(byKey.get(p.id), currentTab) }))
    // A plan id this workspace has no plan row for (deleted plan) still shows.
    const orphan = [...byKey.keys()].filter(k => k !== 'manual' && !plans.some(p => p.id === k))
      .map(k => ({ key: k, title: 'Deleted plan', items: sortItems(byKey.get(k), currentTab) }))
    const manualGroup = byKey.has('manual') ? [{ key: 'manual', title: 'Posts not from a plan', items: sortItems(byKey.get('manual'), currentTab) }] : []
    return [...planGroups, ...orphan, ...manualGroup]
  }, [filtered, plans, currentTab])

  // Every group opens expanded. Only the first used to, so a second month's
  // posts looked missing until someone thought to click its header.
  const isExpanded = key => !collapsed[key]
  const toggleExpanded = key => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  function openMedia(post) {
    const urls = post.mediaUrls?.length ? post.mediaUrls : [post.imageUrl].filter(Boolean)
    if (!urls.length && !post.videoUrl) return
    setViewer({ urls, videoUrl: post.videoUrl || '' })
  }

  // Refuses a post that has gone out, in case the list is a poll behind.
  function openComposer(post) {
    const lock = postLock(post._raw)
    if (lock.locked) { setNotice({ tone: 'error', text: lock.reason }); fetchAll(); return }
    setComposerPost(post)
  }

  // Schedule (`when` = 'YYYY-MM-DDTHH:MM', brand time) or post now (`when` = '').
  async function handleBook(post, when) {
    const account = accountFor(post._raw, accounts)
    if (!account) { openComposer(post); return false }
    setBusyId(post.id); setNotice(null)
    const res = await bookPost(post._raw, { account, workspaceId: activeWorkspaceId, scheduledFor: when })
    setBusyId(null)
    setNotice(res.error ? { tone: 'error', text: res.error } : { tone: 'ok', text: when ? `Scheduled for ${formatBrandDateTime(brandWallToUtc(when.slice(0, 10), when.slice(11, 16)))}.` : 'Sent to publish.' })
    fetchAll()
    return !res.error
  }

  async function handleReschedule(post, when) {
    setBusyId(post.id); setNotice(null)
    const res = await movePost({
      accessToken, post: post._raw, dateKey: when.slice(0, 10), time: when.slice(11, 16),
      webhooks: state.webhooks, workspaceId: activeWorkspaceId,
    })
    setBusyId(null)
    setNotice(res.error
      ? { tone: 'error', text: res.unscheduled ? `The old slot was cancelled but the new one could not be booked, so this post is not scheduled anywhere: ${res.error}` : res.error }
      : { tone: 'ok', text: `Moved to ${res.label || formatBrandDateTime(res.scheduledPublishAt)}.` })
    fetchAll()
    return !res.error
  }

  async function handleCancel(post) {
    setBusyId(post.id); setNotice(null)
    const res = await unschedulePost({ accessToken, post: post._raw, webhooks: state.webhooks, workspaceId: activeWorkspaceId })
    setBusyId(null)
    setNotice(res.error ? { tone: 'error', text: res.error } : { tone: 'ok', text: 'Schedule cancelled — the post is kept under Needs attention.' })
    fetchAll()
  }

  async function handleRetry(idea, post) {
    setRetryingId(idea.id)
    setIdeas(prev => prev.map(i => i.id === idea.id ? { ...i, generation_status: 'processing', generation_error: '' } : i))
    await markIdeaProcessing(accessToken, idea.id)
    const profile = await fetchBrandProfile(activeWorkspaceId, accessToken)
    // Same context path as the original generation. Built here rather than
    // flattened directly so a retry carries the brand's identity and learned
    // rules too — otherwise a retried post is written by a differently
    // briefed model than the one that wrote its siblings.
    const [schema, dirRows, memory] = await Promise.all([
      fetchBrandSchema(activeWorkspaceId, accessToken),
      fetchDirectoryRows(activeWorkspaceId, accessToken),
      fetchBrandMemory(activeWorkspaceId, accessToken),
    ])
    const rowsBySection = {}
    for (const r of dirRows) (rowsBySection[r.section_key] ||= []).push(r)
    const brandCtx = buildContext(profile, schema, { rowsBySection, assets: [] }, memory, {
      task: 'caption',
      matchText: [idea.topic, idea.title, idea.angle, idea.image_idea],
    })
    const instructions = brandCtx.instructions
    // If this idea already produced a post (an earlier attempt succeeded
    // and the reviewer may have edited its caption/image in Approvals
    // since), that post is the freshest truth. Sending the plan_ideas
    // draft instead would silently REVERT whatever they edited — the
    // engine now commits caption_ar/caption_en/preview_image_url as-is
    // when present (see Generate Post's hasSelectedCaption/hasSelectedImage),
    // so this has to be the real, current value, not the stale plan-time one.
    const draft = dbIdeaToDraft(idea)
    const ideaForRetry = post
      ? { ...draft,
          captionAr: post.captionAr || draft.captionAr,
          captionEn: post.captionEn || draft.captionEn,
          previewImageUrl: post.imageUrl || draft.previewImageUrl }
      : draft
    // Retry is now "make sure it has words, then write the row" — the two
    // things the retired Plan Generation workflow did in the background. If
    // the earlier attempt already produced a caption, ensureCaptions is a
    // no-op and this is purely a re-attempt at the row write.
    const captionLanguage = profile?.captionLanguage || 'both'
    const { ideas: [readyIdea], errors: captionErrors } = await ensureCaptions({
      draftCopyUrl: state.webhooks?.draftCopy,
      ideas: [ideaForRetry],
      accessToken,
      buildPayload: i => ({
        plan_idea_id: i.id, platform: i.platform, topic: i.topic, angle: i.angle || '',
        tone: i.tone || '', objective: i.objective || '', cta: i.cta || '',
        occasion: i.occasion || '', content_pillar: i.pillar || '',
        format: i.postFormat, aspect_ratio: i.aspectRatio, media_type: i.mediaType,
        wants_caption: i.wantsCaption, image_idea: i.imageIdea || '',
        caption_language: captionLanguage, instructions,
        brand_name: brandCtx.brandName, brand_descriptor: brandCtx.brandDescriptor,
      }),
    })

    const result = await publishIdeasAsPosts(activeWorkspaceId, accessToken, idea.plan_id, [readyIdea])
    setRetryingId(null)
    const failure = result.error || captionErrors[0] || (result.errors || [])[0]
    // Persisted, not just held in local state: generation_status lives on
    // plan_ideas precisely so a reload shows the truth, and the workflow that
    // used to write it is gone.
    await markIdeasGenerated(accessToken, [idea.id],
      failure ? { status: 'failed', error: failure } : {})
    if (failure) {
      setIdeas(prev => prev.map(i => i.id === idea.id ? { ...i, generation_status: 'failed', generation_error: failure } : i))
    } else {
      setIdeas(prev => prev.map(i => i.id === idea.id ? { ...i, generation_status: 'completed', generation_error: '' } : i))
      fetchAll()
    }
  }

  // Pull fresh accounts and metrics from Zernio on demand — the same workflow
  // the daily schedule runs, so there's one sync path, not two.
  async function handleSync() {
    setSyncing(true); setSyncNote('')
    const result = await syncZernio(state.webhooks?.zernioSync || defaultWebhookUrl('zernioSync'), activeWorkspaceId)
    setSyncing(false)
    setSyncNote(result.error
      ? result.error
      : result.analytics_skipped
        ? result.analytics_skipped
        : `Synced ${result.accounts_synced ?? 0} account(s), ${result.rows_written ?? 0} metric row(s).`)
    fetchAll()
  }

  // Instagram's PostDetail doesn't persist caption edits itself (unlike its
  // image regen, which does) — it hands the new text back via this callback
  // and expects the caller to write it. Must replicate that PATCH here or
  // caption edits silently vanish on close, exactly like the ReferencePicker
  // bug fixed earlier.
  // PostDetail hands back only the id, so the target table has to be resolved
  // from the post it was opened on — `handleDelete` below already does exactly
  // that via post._table. Writing to a hardcoded TABLES.instagram instead is
  // harmless only while Instagram is the sole platform; the moment a TikTok or
  // Snapchat post is editable it PATCHes a row id in the wrong table, which
  // either 404s silently or, worse, hits an unrelated row that happens to
  // share the id. Resolve, and refuse to guess if the ids don't line up.
  async function handleCaptionUpdated(postId, newCopy, originalCopy) {
    const target = (selectedPost && selectedPost.id === postId) ? selectedPost : null
    setSelectedPost(prev => (prev && prev.id === postId) ? { ...prev, copy: newCopy } : prev)
    if (!target?._table) return
    // Gone out: the words that went out stay the record of what went out.
    if (postLock(target._raw).locked) { setNotice({ tone: 'error', text: 'This post has already gone out, so its caption can’t be edited.' }); return }
    logEditFeedback(activeWorkspaceId, accessToken, { platform: target.platform, postId, field: 'caption', original: originalCopy, edited: newCopy })
    if (!accessToken) return
    await fetch(`${SUPABASE_URL}/rest/v1/${target._table}?id=eq.${postId}`, {
      method: 'PATCH',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ caption: newCopy, updated_at: new Date().toISOString() }),
    })
  }

  async function handleDelete(post) {
    if (postLock(post._raw).locked) { setNotice({ tone: 'error', text: 'This post has already gone out, so its record can’t be deleted.' }); return }
    if (accessToken) {
      await fetch(`${SUPABASE_URL}/rest/v1/${post._table}?id=eq.${post.id}`, {
        method: 'DELETE',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      })
    }
    setSelectedPost(null)
    fetchAll()
  }

  const selectedLocked = selectedPost ? postLock(selectedPost._raw, now).locked : false

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Post Queue"
        subtitle="Every post from your plans and the composer — what goes out next, what went out, and what needs you. Saved plans are scheduled automatically; reschedule, edit or cancel them here.">
        <div className="text-right">
          <Button size="sm" variant="secondary" onClick={handleSync} disabled={syncing}>
            {syncing ? <><Spinner size="sm" /> Syncing…</> : 'Sync from Zernio'}
          </Button>
          {syncNote && <p className="text-[10px] text-text-tertiary mt-1.5 max-w-[240px]">{syncNote}</p>}
        </div>
      </PageHeader>

      {notice && (
        <Card className={`p-3 flex items-start gap-3 ${notice.tone === 'error' ? 'border-red-200 bg-red-50' : 'border-sage-200 bg-sage-50'}`}>
          <p className={`text-xs flex-1 ${notice.tone === 'error' ? 'text-red-600' : 'text-sage-800'}`}>{notice.text}</p>
          <button onClick={() => setNotice(null)} className="text-xs text-text-tertiary hover:text-text" aria-label="Dismiss">✕</button>
        </Card>
      )}

      <div className="flex flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 border -ml-px first:ml-0 text-xs font-semibold transition-colors
              ${currentTab === t.key
                ? 'bg-amber-700 text-white border-amber-700 relative z-10'
                : 'bg-white border-border text-text-secondary hover:text-text hover:bg-surface-subtle'}`}>
            {t.label}{counts[t.key] > 0 && <span className={`ml-1.5 tabular-nums ${currentTab === t.key ? 'opacity-70' : 'text-text-tertiary'}`}>{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {(loading || !loaded) && items.length === 0 ? (
        <ApprovalsSkeleton />
      ) : grouped.length === 0 ? (
        <Card>
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>}
            title={
              currentTab === 'attention' ? 'Nothing needs you'
              : currentTab === 'upcoming' ? 'Nothing scheduled'
              : currentTab === 'published' ? 'Nothing published yet'
              : 'No posts yet'
            }
            description="Plan a month in Campaigns — saving the plan schedules its posts, and they show up here."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(group => {
            const expanded = isExpanded(group.key)
            return (
              <div key={group.key} className="border border-border bg-white overflow-hidden">
                <button onClick={() => toggleExpanded(group.key)} aria-expanded={expanded}
                  className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-surface-subtle transition-colors">
                  <svg className={`w-3.5 h-3.5 text-text-tertiary transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>
                  <span className="font-semibold text-text text-sm text-left">{group.title}</span>
                  <span className="text-[11px] text-text-tertiary">{group.items.length} post{group.items.length !== 1 ? 's' : ''}</span>
                </button>
                {expanded && (
                  <div className="grid grid-cols-1 gap-3 p-4 pt-0">
                    {group.items.map(item => {
                      if (item.type === 'processing') return <ProcessingCard key={item.key} idea={item.idea} />
                      if (item.type === 'failed') return <FailedCard key={item.key} idea={item.idea} post={null} onRetry={handleRetry} retrying={retryingId === item.idea.id} />
                      return <QueueCard key={item.key} post={item.post} bucket={item.bucket} accounts={accounts} now={now}
                        busy={busyId === item.post.id}
                        onOpen={setSelectedPost} onOpenMedia={openMedia} onEdit={openComposer}
                        onBook={handleBook} onReschedule={handleReschedule} onCancel={setCancelTarget} />
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog open={!!cancelTarget} onClose={() => setCancelTarget(null)}
        onConfirm={() => handleCancel(cancelTarget)} title="Cancel this schedule?"
        message="The post is taken off the schedule at Zernio and will not go out. It stays here under Needs attention, so you can schedule it again." danger />

      {viewer && <MediaViewer {...viewer} onClose={() => setViewer(null)} />}

      {/* Full view. A post that has gone out opens read-only: no caption
          edit, no image regeneration, no delete. */}
      {selectedPost && selectedPost.platform === 'instagram' && (
        <InstagramPostDetail
          post={selectedPost}
          state={state}
          webhookUrl=""
          regenWebhookUrl=""
          supabaseUrl={SUPABASE_URL}
          anonKey={accessToken || ''}
          locked={selectedLocked}
          onClose={() => setSelectedPost(null)}
          onStatusChange={() => {}}
          onPublish={post => { setSelectedPost(null); openComposer(post) }}
          onImageUpdated={() => {}}
          onCaptionUpdated={handleCaptionUpdated}
          onDelete={selectedLocked ? undefined : handleDelete}
        />
      )}

      {/* The composer, opened from a card. Keyed by post id so switching
          between two posts remounts rather than leaving the previous one's
          caption in the fields. Saving a booked post re-books it at Zernio
          (see ComposerHost). */}
      <ComposerHost
        key={composerPost?.id || 'none'}
        trigger={false}
        platform={composerPost?.platform || 'instagram'}
        campaigns={state.campaigns}
        openPost={composerPost?._raw || composerPost}
        onOpenPostHandled={() => setComposerPost(null)}
        onDone={fetchAll}
      />
    </div>
  )
}
