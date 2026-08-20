import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../store/app'
import { useAuth } from '../../store/auth'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/supabaseClient'
import { Card, Button, Badge, Empty, Spinner, PostImage, PageHeader } from '../../components/ui/index'
import { formatDateTime } from '../../lib/utils'
import { formatBrandDateTime, BRAND_TIMEZONE_LABEL } from '../../lib/brandTime'
import { logEditFeedback } from '../../lib/brandBrain'
import { fetchBrandProfile } from '../../lib/brandBrain'
import { buildContext, fetchBrandMemory } from '../../lib/brandContext'
import { fetchBrandSchema, fetchDirectoryRows } from '../../lib/brandSchema'
import { fetchApprovalsData, markIdeaProcessing, markIdeasGenerated } from '../../lib/contentPlans'
import { ensureCaptions } from '../../lib/campaignPlanner'
import { publishIdeasAsPosts } from '../../lib/studioBridge'
import { publishPost, syncMetaInsights } from '../../lib/meta'
import { publishPost as publishViaZernio } from '../../lib/zernio'
import { providerFor, PROVIDERS } from '../../lib/publishPost'
import { defaultWebhookUrl } from '../../lib/n8nWebhooks'
import { fetchScheduledPosts } from '../../lib/scheduledPosts'
import { dbIdeaToDraft } from '../../lib/campaignPlan'
import { InstagramPostDetail } from './InstagramPage'

// ─── Post Approvals ──────────────────────────────────────────────────────
// One place to review every post the app produces, grouped by the monthly
// plan it came from. Every approved idea has a durable generation_status
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
    scheduledAt: row.scheduled_date || null, campaignId: row.campaign_id,
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
  }
  return { ...base, copy: row.caption, contentRoute: 'scheduled' }
}

function useApprovalPosts(accessToken, workspaceId) {
  const [posts,   setPosts]   = useState([])
  const [ideas,   setIdeas]   = useState([])
  const [plans,   setPlans]   = useState([])
  const [loading, setLoading] = useState(false)

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

  return { posts, ideas, plans, loading, fetchAll, updateStatus, setIdeas }
}

// ─── Small card variants for in-flight/failed generation ──────────────────
function ProcessingCard({ idea }) {
  const platformMeta = { label: 'Instagram', color: 'bg-pink-50 text-pink-600' }
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
  const platformMeta = { label: 'Instagram', color: 'bg-pink-50 text-pink-600' }
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

// Publish state shown on an already-approved post. Deliberately separate
// from the review Badge: `status` is the human decision (approved), this is
// what the platform actually did with it — a post can be approved and still
// have failed to publish, and that's exactly what needs to be visible.
const PUBLISH_META = {
  scheduled:  { label: '🗓 Scheduled',  cls: 'bg-indigo-50 text-indigo-700' },
  publishing: { label: '↗ Publishing…', cls: 'bg-amber-50 text-amber-700' },
  published:  { label: '✓ Published',   cls: 'bg-sage-50 text-sage-700' },
  failed:     { label: '✕ Publish failed', cls: 'bg-red-50 text-red-600' },
}

function PublishBar({ post, onPublish, busy }) {
  const [when, setWhen] = useState('')
  const status = post.publishStatus || 'not_published'
  const meta = PUBLISH_META[status]

  // Already live (or on its way) — show state + the real permalink, not
  // controls that would double-post.
  if (status === 'published' || status === 'scheduled' || status === 'publishing') {
    return (
      <div className="flex items-center gap-2 mt-2 flex-wrap" onClick={e => e.stopPropagation()}>
        <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] ${meta.cls}`}>{meta.label}</span>
        {post.scheduledPublishAt && status === 'scheduled' && (
          <span className="text-[10px] text-text-tertiary">for {formatBrandDateTime(post.scheduledPublishAt)}</span>
        )}
        {post.platformPostUrl && (
          <a href={post.platformPostUrl} target="_blank" rel="noreferrer"
            className="text-[10px] font-semibold text-amber-700 hover:underline">View on {post.platform} ↗</a>
        )}
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-1.5" onClick={e => e.stopPropagation()}>
      {status === 'failed' && (
        <p className="text-[10px] text-red-600 leading-relaxed">{post.publishError || 'Publishing failed.'}</p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => onPublish(post, '')} disabled={busy}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 transition-colors disabled:opacity-50">
          {busy ? 'Working…' : status === 'failed' ? '↻ Retry publish' : '↗ Publish now'}
        </button>
        <span className="text-[10px] text-text-tertiary">or</span>
        <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
          className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white" />
        {/* The zone is not optional decoration. A bare datetime-local renders
            in whatever zone the machine is set to, so without this the same
            digits mean different moments to different people on the team. */}
        <span className="text-[10px] font-semibold text-text-tertiary">{BRAND_TIMEZONE_LABEL}</span>
        <button onClick={() => onPublish(post, when)} disabled={busy || !when}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-border text-text-secondary hover:bg-surface-subtle transition-colors disabled:opacity-40">
          🗓 Schedule
        </button>
      </div>
    </div>
  )
}

function PostCard({ post, onOpen, onApprove, onReject, onPublish, publishing }) {
  const platformMeta = { label: 'Instagram', color: 'bg-pink-50 text-pink-600' }
  return (
    <Card className="overflow-hidden cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-150" onClick={() => onOpen(post)}>
      <div className="flex">
        <div className="w-28 flex-shrink-0 bg-surface-subtle overflow-hidden relative"
          style={{ aspectRatio: (post.aspectRatio || '1:1').replace(':', '/'), minHeight: '80px', maxHeight: '140px' }}>
          {post.imageUrl
            ? <PostImage src={post.imageUrl} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center">
                <svg className="w-7 h-7 text-border-strong" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              </div>}
          {(post.mediaUrls?.length || 0) > 1 && (
            <span className="absolute top-1 right-1 text-[9px] font-bold bg-black/60 text-white px-1.5 py-0.5 leading-[1.4] flex items-center gap-0.5">
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M21 7v12a2 2 0 0 1-2 2H7"/></svg>
              {post.mediaUrls.length}
            </span>
          )}
        </div>
        <div className="flex-1 p-4 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] ${platformMeta.color}`}>{platformMeta.label}</span>
              <Badge status={post.status} />
              {post.source === 'plan' && <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 leading-[1.4] font-medium">📋 From plan</span>}
              {post.postKind && post.postKind !== 'caption_image' && <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 leading-[1.4] font-medium capitalize">{post.postKind.replace('_', ' ')}</span>}
            </div>
          </div>
          {post.captionAr && post.captionEn ? (
            <div className="mb-1.5 space-y-1">
              <p className="text-sm text-text line-clamp-2 leading-relaxed text-right" dir="rtl">{post.captionAr}</p>
              <p className="text-sm text-text-secondary line-clamp-2 leading-relaxed">{post.captionEn}</p>
            </div>
          ) : (
            <p className="text-sm text-text line-clamp-2 leading-relaxed mb-1.5" dir={post.captionAr && !post.captionEn ? 'rtl' : 'ltr'}>{post.copy || 'No caption'}</p>
          )}
          {post.hashtags && <p className="text-xs text-text-tertiary line-clamp-1 mb-1.5">{post.hashtags}</p>}
          <p className="text-[11px] text-text-tertiary">{formatDateTime(post.createdAt)}{post.topic && <span className="ml-1.5 opacity-70">· {post.topic}</span>}{post.scheduledAt && <span className="ml-1.5 opacity-70">· for {post.scheduledAt}</span>}</p>

          {post.status === 'pending_review' ? (
            <div className="flex items-center gap-2 mt-2">
              <button onClick={e => { e.stopPropagation(); onApprove(post) }}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-sage-200 text-sage-700 bg-sage-50 hover:bg-sage-100 transition-colors">✓ Approve</button>
              <button onClick={e => { e.stopPropagation(); onReject(post) }}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">✕ Reject</button>
              <span className="text-[10px] text-text-tertiary ml-auto">Click card to edit / regenerate</span>
            </div>
          ) : post.status === 'pending_publish' ? (
            // Approved — publishing is the next step, so the controls for it
            // live right here rather than behind opening the post.
            <PublishBar post={post} onPublish={onPublish} busy={publishing} />
          ) : (
            <p className="text-[10px] text-text-tertiary mt-1 opacity-60">Click to open full view</p>
          )}
        </div>
      </div>
    </Card>
  )
}

export function Approvals() {
  const { state } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const { posts, ideas, plans, loading, fetchAll, updateStatus, setIdeas } = useApprovalPosts(accessToken, activeWorkspaceId)
  const [platformFilter, setPlatformFilter] = useState('all')  // all | instagram
  const [statusFilter,   setStatusFilter]   = useState('pending_review')
  const [selectedPost,   setSelectedPost]   = useState(null)
  const [retryingId,     setRetryingId]     = useState(null)
  const [expandedKeys,   setExpandedKeys]   = useState({})
  const [publishingId,   setPublishingId]   = useState(null)
  const [publishError,   setPublishError]   = useState(null)
  const [syncing,        setSyncing]        = useState(false)
  const [syncNote,       setSyncNote]       = useState('')

  useEffect(() => { fetchAll() }, [fetchAll])

  // Smart polling: check every ~4s while anything is actively generating,
  // otherwise fall back to a slow 30s heartbeat.
  useEffect(() => {
    const hasProcessing = ideas.some(i => i.generation_status === 'processing')
    const interval = setInterval(fetchAll, hasProcessing ? 4000 : 30000)
    return () => clearInterval(interval)
  }, [fetchAll, ideas])

  // `now` as state, ticked from an effect (React's purity rule forbids
  // calling Date.now() during render) — only ticks while something is
  // actually processing, so a stuck idea's staleness gets picked up within
  // ~4s of crossing the threshold without an idle tab polling forever.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ideas.some(i => i.generation_status === 'processing')) return
    const interval = setInterval(() => setNow(Date.now()), 4000)
    return () => clearInterval(interval)
  }, [ideas])

  // One unified list: plan-linked ideas (processing/failed/completed) and
  // manual (non-plan) posts, so filtering/counting/grouping all work the
  // same way regardless of where an item came from.
  const items = useMemo(() => {
    const byIdeaId = new Map(posts.filter(p => p.planIdeaId).map(p => [p.planIdeaId, p]))
    const ideaItems = ideas
      .filter(i => i.generation_status && i.generation_status !== 'not_started')
      .map(i => {
        const post = byIdeaId.get(i.id) || null
        let effectiveStatus = i.generation_status === 'completed' && post ? post.status : i.generation_status
        let idea = i
        if (effectiveStatus === 'processing' && i.generation_started_at) {
          const staleMs = now - new Date(i.generation_started_at).getTime()
          if (staleMs > STALE_PROCESSING_MS) {
            effectiveStatus = 'failed'
            idea = { ...i, generation_error: 'Taking longer than expected — the request may never have reached n8n, or a step failed silently downstream. Retry, or check the n8n workflow.' }
          }
        }
        return { key: `idea_${i.id}`, type: 'idea', idea, post, effectiveStatus, platform: i.platform, planId: i.plan_id }
      })
      .filter(x => x.effectiveStatus) // drop the rare "completed but post vanished" case
    const manualItems = posts
      .filter(p => p.source !== 'plan')
      .map(p => ({ key: `manual_${p.platform}_${p.id}`, type: 'manual', post: p, effectiveStatus: p.status, platform: p.platform, planId: p.planId || null }))
    return [...ideaItems, ...manualItems]
  }, [ideas, posts, now])

  const byPlatform = platformFilter === 'all' ? items : items.filter(x => x.platform === platformFilter)
  const filtered = byPlatform.filter(x => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'pending_review') return ['processing', 'failed', 'pending_review'].includes(x.effectiveStatus)
    return x.effectiveStatus === statusFilter
  })

  const STATUS_TABS = [
    { key: 'pending_review',  label: 'Pending review', count: byPlatform.filter(x => ['processing', 'failed', 'pending_review'].includes(x.effectiveStatus)).length },
    { key: 'pending_publish', label: 'Approved',       count: byPlatform.filter(x => x.effectiveStatus === 'pending_publish').length },
    { key: 'rejected',        label: 'Rejected',       count: byPlatform.filter(x => x.effectiveStatus === 'rejected').length },
    { key: 'all',             label: 'All',            count: byPlatform.length },
  ]
  const PLATFORM_TABS = [
    { key: 'all',       label: 'All' },
    { key: 'instagram', label: 'Instagram' },
  ]

  // Group filtered items by plan (most-recent plan first, since `plans` is
  // already ordered newest-first from the fetch); non-plan posts land in a
  // "Manual posts" group at the end.
  const grouped = useMemo(() => {
    const byKey = new Map()
    for (const item of filtered) {
      const key = item.planId || 'manual'
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push(item)
    }
    const planGroups = plans
      .filter(p => byKey.has(p.id))
      .map(p => ({ key: p.id, title: p.name || `${p.month || ''} Content Plan`, items: byKey.get(p.id) }))
    const manualGroup = byKey.has('manual') ? [{ key: 'manual', title: 'Manual posts', items: byKey.get('manual') }] : []
    return [...planGroups, ...manualGroup]
  }, [filtered, plans])

  function isExpanded(key, index) {
    return key in expandedKeys ? expandedKeys[key] : index === 0
  }
  function toggleExpanded(key, index) {
    setExpandedKeys(prev => ({ ...prev, [key]: !isExpanded(key, index) }))
  }

  async function handleApprove(post) { await updateStatus(post, 'pending_publish') }
  async function handleReject(post)  { await updateStatus(post, 'rejected') }

  // Publish or schedule through Instagram's Graph API (via n8n — the access
  // token never reaches the browser). `when` is a datetime-local string
  // ('' = publish now).
  //
  // Scheduling does NOT hand the post to Instagram early: the Graph API has no
  // scheduling, so a future `when` books the slot in our own row and the
  // publish workflow's 5-minute cron sends it when it comes due.
  async function handlePublish(post, when) {
    // TikTok cannot be published from this screen, and that is the platform's
    // rule rather than a gap here. Every TikTok post needs a privacy level
    // drawn from the creator account's own allowed list, plus two consent
    // flags TikTok requires per post and which are deliberately never stored.
    // None of that can be collected from an approval card, so the composer on
    // the TikTok page is where it has to happen.
    //
    // Said here rather than letting the workflow refuse it: the workflow's
    // rejection is correct but arrives as "TikTok requires a privacy level",
    // which does not tell anyone where to go.
    if (post.platform === 'tiktok' && !post.platformOptions?.tiktok?.privacy_level) {
      setPublishError({
        id: post.id,
        message: 'TikTok posts need a privacy level and a per-post consent confirmation, ' +
                 'which TikTok requires every time. Open this post from the TikTok page to finish and publish it.',
      })
      return
    }

    setPublishingId(post.id)
    // Provider-aware rather than hardcoded to Meta. Meta reaches Instagram and
    // nothing else, so a TikTok post sent through the old call had no chance
    // of working. Zernio is primary now and serves all three; meta.js stays
    // wired behind providerFor() as the fallback.
    const provider   = providerFor(post.platform)
    const publishVia = provider === PROVIDERS.META ? publishPost : publishViaZernio
    const webhook    = provider === PROVIDERS.META
      ? (state.webhooks?.metaPublish || defaultWebhookUrl('metaPublish'))
      : (state.webhooks?.publishPost || defaultWebhookUrl('publishPost'))

    const result = await publishVia(webhook, {
      postId: post.id, postTable: post._table, workspaceId: activeWorkspaceId,
      platform: post.platform,
      accountId: post.zernioAccountId || undefined,
      // The em-dash separator (not a plain blank line) is what
      // isolateBilingual() in the Meta publish workflow looks for to apply
      // Unicode directional isolation per language — see CaptionStudio.jsx's
      // own `pick()`, which this mirrors. Without it, Arabic + English text
      // in one caption is sent unisolated and Instagram renders the RTL/LTR
      // boundary wrong (trailing punctuation and standalone digits/"+" jump
      // to the wrong side).
      //
      // The Zernio publish workflow applies the same isolation from the same
      // marker, so this holds whichever provider handles the post.
      caption: post.captionAr && post.captionEn
        ? [post.captionAr, post.captionEn].filter(Boolean).join('\n\n—\n\n')
        : (post.copy || post.captionEn || post.captionAr || ''),
      hashtags: post.hashtags || '',
      imageUrl: post.imageUrl || '',
      imageUrls: (post.mediaUrls || []).length > 1 ? post.mediaUrls : undefined,
      videoUrl: post.videoUrl || '',
      coverImageUrl: post.coverImageUrl || '',
      // Whatever was chosen last time this post passed through the composer.
      // Absent on a freshly generated post, which is correct — the defaults
      // then apply.
      platformSpecificData: post.platformOptions?.[post.platform] || undefined,
      // No timezone passed: publishPost applies the brand's. `when` is the raw
      // datetime-local value, which is a wall clock with no zone of its own —
      // and the label beside the input says KSA, so KSA is what it means.
      // This used to send the browser's zone, which quietly made the same
      // input mean a different moment depending on where you opened the app.
      scheduledFor: when || undefined,
    })
    setPublishingId(null)
    if (result.error) {
      // The workflow already wrote publish_status='failed' + the reason to
      // the row, so just refetch rather than duplicating the error into
      // local state and risking the two disagreeing.
      setPublishError({ id: post.id, message: result.error })
    } else {
      setPublishError(null)
    }
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

  // Pull fresh metrics from Instagram on demand — the same workflow the daily
  // schedule runs, so there's one sync path, not two.
  //
  // Not merely a cache refresh: Instagram reports lifetime totals and keeps no
  // history for us, so this call is what records today's point on every time
  // series the Analytics page draws.
  async function handleSync() {
    setSyncing(true); setSyncNote('')
    const result = await syncMetaInsights(state.webhooks?.metaSync, activeWorkspaceId)
    setSyncing(false)
    setSyncNote(result.error
      ? result.error
      : result.analytics_skipped
        ? result.analytics_skipped
        : `Synced ${result.accounts_synced ?? 0} account(s), ${result.rows_written ?? 0} metric row(s).`)
    fetchAll()
  }

  function handleStatusChange(post, newStatus) {
    updateStatus(post, newStatus)
    if (selectedPost && selectedPost.id === post.id && selectedPost.platform === post.platform) {
      setSelectedPost(prev => ({ ...prev, status: newStatus }))
    }
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
    logEditFeedback(activeWorkspaceId, accessToken, { platform: target.platform, postId, field: 'caption', original: originalCopy, edited: newCopy })
    if (!accessToken) return
    await fetch(`${SUPABASE_URL}/rest/v1/${target._table}?id=eq.${postId}`, {
      method: 'PATCH',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ caption: newCopy, updated_at: new Date().toISOString() }),
    })
  }

  async function handleDelete(post) {
    if (accessToken) {
      await fetch(`${SUPABASE_URL}/rest/v1/${post._table}?id=eq.${post.id}`, {
        method: 'DELETE',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      })
    }
    setSelectedPost(null)
    fetchAll()
  }

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Post Approvals"
        subtitle="Every post the Plan Generation workflows produce — grouped by the month they came from. Watch generation happen, review the real caption + image, approve, then publish or schedule.">
        <div className="text-right">
          <Button size="sm" variant="secondary" onClick={handleSync} disabled={syncing}>
            {syncing ? <><Spinner size="sm" /> Syncing…</> : 'Sync from Zernio'}
          </Button>
          {syncNote && <p className="text-[10px] text-text-tertiary mt-1.5 max-w-[240px]">{syncNote}</p>}
        </div>
      </PageHeader>

      {publishError && (
        <Card className="p-3 border-red-200 bg-red-50">
          <p className="text-xs text-red-600">
            <span className="font-semibold">Publish failed.</span> {publishError.message}
          </p>
        </Card>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Status tabs as one segmented bar. Separate bordered buttons with
            gaps made the selected one read as "a button that happens to be
            dark" rather than as the active segment of a control. */}
        <div className="flex flex-wrap">
          {STATUS_TABS.map(t => (
            <button key={t.key} onClick={() => setStatusFilter(t.key)}
              className={`px-3 py-1.5 border -ml-px first:ml-0 text-xs font-semibold transition-colors
                ${statusFilter === t.key
                  ? 'bg-amber-700 text-white border-amber-700 relative z-10'
                  : 'bg-white border-border text-text-secondary hover:text-text hover:bg-surface-subtle'}`}>
              {t.label}{t.count > 0 && <span className={`ml-1.5 tabular-nums ${statusFilter === t.key ? 'opacity-70' : 'text-text-tertiary'}`}>{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="flex">
          {PLATFORM_TABS.map(t => (
            <button key={t.key} onClick={() => setPlatformFilter(t.key)}
              className={`px-3 py-1.5 border -ml-px first:ml-0 text-xs font-semibold transition-colors ${platformFilter === t.key ? 'bg-amber-700 text-white border-amber-700 relative z-10' : 'bg-white text-text-secondary border-border hover:text-text hover:bg-surface-subtle'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <Card className="p-12 flex items-center justify-center"><Spinner /></Card>
      ) : grouped.length === 0 ? (
        <Card>
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>}
            title={statusFilter === 'pending_review' ? 'Nothing to review' : `No ${STATUS_TABS.find(t => t.key === statusFilter)?.label.toLowerCase()} posts`}
            description="Approve a plan from Campaigns → Plan with AI and generated posts will show up here as they're ready."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map((group, index) => {
            const expanded = isExpanded(group.key, index)
            return (
              <div key={group.key} className="rounded-2xl border border-border bg-white overflow-hidden">
                <button onClick={() => toggleExpanded(group.key, index)}
                  className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-surface-subtle transition-colors">
                  <svg className={`w-3.5 h-3.5 text-text-tertiary transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>
                  <span className="font-semibold text-text text-sm">{group.title}</span>
                  <span className="text-[11px] text-text-tertiary">{group.items.length} post{group.items.length !== 1 ? 's' : ''}</span>
                </button>
                {expanded && (
                  <div className="grid grid-cols-1 gap-3 p-4 pt-0">
                    {group.items.map(item => {
                      if (item.type === 'idea' && item.effectiveStatus === 'processing') return <ProcessingCard key={item.key} idea={item.idea} />
                      if (item.type === 'idea' && item.effectiveStatus === 'failed') return <FailedCard key={item.key} idea={item.idea} post={item.post} onRetry={handleRetry} retrying={retryingId === item.idea.id} />
                      return <PostCard key={item.key} post={item.post} onOpen={setSelectedPost}
                        onApprove={handleApprove} onReject={handleReject}
                        onPublish={handlePublish} publishing={publishingId === item.post.id} />
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* webhookUrl/regenWebhookUrl are empty by design: the Instagram
          generation workflows are retired, so no endpoint answers a regen.
          PostDetail already handles the empty case by pointing at Creative
          Studio rather than offering a button that can only error. */}
      {selectedPost && selectedPost.platform === 'instagram' && (
        <InstagramPostDetail
          post={selectedPost}
          state={state}
          webhookUrl=""
          regenWebhookUrl=""
          supabaseUrl={SUPABASE_URL}
          anonKey={accessToken || ''}
          onClose={() => setSelectedPost(null)}
          onStatusChange={handleStatusChange}
          onImageUpdated={() => {}}
          onCaptionUpdated={handleCaptionUpdated}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
