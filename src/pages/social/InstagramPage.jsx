import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/app'
import { useAuth } from '../../store/auth'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/supabaseClient'
import { Card, Button, Badge, Textarea, Spinner, PostImage } from '../../components/ui/index'
import { formatDateTime } from '../../lib/utils'
import { buildInstructionsString, useBrandProfileSync, logEditFeedback } from '../../lib/brandBrain'
import { useBrandContext } from '../../lib/brandContext'
import { CaptionStudio } from '../../components/CaptionStudio'
import { QuickCreatePanel } from '../../components/QuickCreatePanel'
import { fetchScheduledPosts } from '../../lib/scheduledPosts'

// ─── Constants ─────────────────────────────────────────────────────────────
const LIGHTING_STYLES = [
  { value: 'photorealistic',   label: 'Photorealistic',    icon: '📷', desc: 'Natural, camera-like renders' },
  { value: 'dramatic',         label: 'Dramatic / Moody',  icon: '🎬', desc: 'Cinematic shadows & god rays' },
  { value: 'minimalist',       label: 'Minimalist',        icon: '◻️', desc: 'Clean lines, soft diffused light' },
  { value: 'warm_residential', label: 'Warm Residential',  icon: '🏠', desc: 'Golden tones, cozy interiors' },
  { value: 'cool_commercial',  label: 'Cool Commercial',   icon: '🏢', desc: 'Crisp white light, modern spaces' },
  { value: 'facade_exterior',  label: 'Facade / Exterior', icon: '🌃', desc: 'Night exterior, facade lighting' },
]

const CUSTOM_POST_TYPES = [
  { value: 'event_poster',      label: 'Event / Expo Poster',     icon: '🎪', desc: 'Bold poster with date, title & CTA' },
  { value: 'hiring_poster',     label: 'We Are Hiring',           icon: '👥', desc: 'Recruitment post, professional feel' },
  { value: 'product_showcase',  label: 'Product / Fixture',       icon: '💡', desc: 'Hero shot of a lighting product' },
  { value: 'project_highlight', label: 'Project Highlight',       icon: '🏛️', desc: 'Showcase a completed project' },
  { value: 'quote_card',        label: 'Quote / Tip Card',        icon: '💬', desc: 'Elegant card with quote or tip' },
  { value: 'suppliers_collab',  label: 'Brand / Supplier Collab', icon: '🤝', desc: 'Partnership announcement' },
  { value: 'behind_scenes',     label: 'Behind the Scenes',       icon: '🎥', desc: 'Installation or team at work' },
  { value: 'ai_decides',        label: 'Let AI Decide',           icon: '✨', desc: 'Claude picks the best visual' },
]

const IMAGE_STYLES = LIGHTING_STYLES

const TONES = [
  { value: 'professional',  label: 'Professional' },
  { value: 'inspirational', label: 'Inspirational' },
  { value: 'educational',   label: 'Educational' },
  { value: 'casual',        label: 'Casual & Friendly' },
  { value: 'promotional',   label: 'Promotional' },
]


// ─── Main Page ─────────────────────────────────────────────────────────────
// ─── Supabase generated posts hook ────────────────────────────────────────
function useSupabasePosts(supabaseUrl, anonKey, workspaceId) {
  const [remotePosts,   setRemotePosts]   = useState([])
  const [loadingPosts,  setLoadingPosts]  = useState(false)
  const [lastFetchedAt, setLastFetchedAt] = useState(null)

  async function fetchRemotePosts() {
    if (!supabaseUrl || !anonKey || !workspaceId) return
    setLoadingPosts(true)
    try {
      const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${anonKey}` }
      // Scoped to the company, and scoped BEFORE the limit — which is the
      // half that's easy to miss. Unfiltered, the 100 newest rows are drawn
      // from every company at once, so a busy brand pushes another brand's
      // posts off the end. That reads as "my posts are missing", not as a
      // leak, which is what made it survive this long.
      const scope = `workspace_id=eq.${workspaceId}`
      // Generated posts come through the scheduled_posts VIEW rather than
      // straight off instagram_generated_posts. That table is frozen history
      // now — new Instagram posts are written to generated_posts — so reading
      // it directly would show the 21 old rows and silently omit everything
      // made since, including posts created from this page's own Create tab.
      // The view unions both and is security_invoker, so RLS still applies.
      const [schedRows, manualRes] = await Promise.all([
        fetchScheduledPosts(workspaceId, anonKey, { platform: 'instagram', limit: 100 }),
        fetch(`${supabaseUrl}/rest/v1/instagram_manual_posts?${scope}&select=*&order=created_at.desc&limit=100`, { headers }),
      ])
      const manualRows = manualRes.ok ? await manualRes.json() : []

      const normalize = (r, source) => ({
        id:                  r.id,
        platform:            'instagram',
        copy:                r.caption,
        hashtags:            r.hashtags,
        imageUrl:            r.image_url,
        imagePrompt:         r.image_prompt,
        style:               r.style,
        topic:               r.topic,
        aspectRatio:         r.aspect_ratio,
        scheduledAt:         r.scheduled_date || null,
        campaignId:          r.campaign_id,
        mediaUrls:           (r.image_urls && r.image_urls.length > 0) ? r.image_urls : [r.image_url].filter(Boolean),
        status:              r.status,
        source:              r.source || source,
        // Drives the "✦ AI Generated" badge, so it has to be a fact rather
        // than an assumption. A post written by hand (copy_mode='own' on the
        // plan idea, source='manual' on the row) has never been near a model,
        // and badging it AI misattributes the operator's own words.
        generatedByWorkflow: (r.source || source) !== 'manual',
        contentRoute:        source === 'manual' ? 'manual' : 'scheduled',
        createdAt:           r.created_at,
        _fromSupabase:       true,
        // From the view this is the row's real table, which is the only way
        // an edit or delete reaches the right one now that generated posts
        // are split across two.
        _table:              r.post_table || (source === 'manual' ? 'instagram_manual_posts' : 'generated_posts'),
      })

      setRemotePosts([
        ...schedRows.map(r => normalize(r, 'scheduled')),
        ...manualRows.map(r => normalize(r, 'manual')),
      ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)))
      setLastFetchedAt(new Date())
    } catch {
      // Fail silently — the locally-held posts still render, so a fetch that
      // didn't land is a stale list rather than an empty screen.
    } finally {
      setLoadingPosts(false)
    }
  }

  async function updatePostStatus(postId, status, table) {
    if (!supabaseUrl || !anonKey || !table) return
    await fetch(
      `${supabaseUrl}/rest/v1/${table}?id=eq.${postId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${anonKey}`,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
      }
    )
  }

  return { remotePosts, loadingPosts, lastFetchedAt, fetchRemotePosts, updatePostStatus }
}

export function InstagramPage() {
  const { state, dispatch } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  useBrandProfileSync(state, dispatch)
  const localPosts  = state.posts.filter(p => p.platform === 'instagram')
  const supabaseUrl = SUPABASE_URL
  const anonKey     = accessToken || ''

  const { remotePosts, loadingPosts, lastFetchedAt, fetchRemotePosts, updatePostStatus } =
    useSupabasePosts(supabaseUrl, anonKey, activeWorkspaceId)

  // Merge: remote posts first (newest), deduplicate by id against local
  const localIds   = new Set(localPosts.map(p => p.id))
  const mergedPosts = [
    ...remotePosts.filter(p => !localIds.has(p.id)),
    ...localPosts,
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  // Auto-fetch on mount + re-fetch every 30s to pick up n8n-generated posts
  // A ref rather than state: "have I done the first fetch" is bookkeeping the
  // UI never reads, and as state it cost an extra render on mount.
  const fetchedOnce = useRef(false)
  useEffect(() => {
    if (!supabaseUrl || !anonKey) return
    if (!fetchedOnce.current) {
      fetchedOnce.current = true
      // Deferred a tick so the first render commits before the fetch flips
      // the loading flag — the poll below is what keeps it current anyway.
      queueMicrotask(fetchRemotePosts)
    }
    const interval = setInterval(fetchRemotePosts, 30000)
    return () => clearInterval(interval)
  }, [supabaseUrl, anonKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const [screen,   setScreen]   = useState('posts')

  return (
    <div className="max-w-7xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm"
            style={{ background: '#E1306C' }}>
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <rect x="2" y="2" width="20" height="20" rx="5"/>
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-text text-base tracking-tight">Instagram</h2>
            <p className="text-xs text-text-secondary">{mergedPosts.length} post{mergedPosts.length !== 1 ? 's' : ''} · AI content generation</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {supabaseUrl && anonKey && (
            <button onClick={fetchRemotePosts} disabled={loadingPosts}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs text-text-secondary hover:text-text hover:bg-surface-subtle transition-colors disabled:opacity-50">
              {loadingPosts
                ? <Spinner size="sm" />
                : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.27-4.93"/></svg>}
              {lastFetchedAt ? `Synced ${lastFetchedAt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}` : 'Sync'}
            </button>
          )}
          <Button onClick={() => setScreen('create')}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            Create Post
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total',     value: mergedPosts.length },
          { label: 'Pending',   value: mergedPosts.filter(p => p.status === 'pending_publish').length },
          { label: 'Scheduled', value: mergedPosts.filter(p => p.status === 'scheduled').length },
          { label: 'Published', value: mergedPosts.filter(p => p.status === 'published').length },
        ].map(s => (
          <Card key={s.label} className="p-4 text-center">
            <p className="text-2xl font-bold text-text">{s.value}</p>
            <p className="text-xs text-text-secondary mt-0.5">{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex w-fit">
        {[{ key: 'posts', label: 'Posts' }, { key: 'create', label: 'Create Post' }].map(t => (
          <button key={t.key} onClick={() => setScreen(t.key)}
            /* Active uses Instagram's own magenta, matching this page's other
               primary affordances rather than the app accent. */
            className={`px-3 py-1.5 border -ml-px first:ml-0 text-xs font-semibold transition-colors ${screen === t.key ? 'bg-[#E1306C] text-white border-[#E1306C] relative z-10' : 'bg-white text-text-secondary border-border hover:text-text hover:bg-surface-subtle'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {screen === 'posts'    && <PostsList posts={mergedPosts} dispatch={dispatch} state={state} onCreateClick={() => setScreen('create')} updatePostStatus={updatePostStatus} webhookUrl="" regenWebhookUrl="" />}
      {screen === 'create'   && (
        <div className="space-y-4 max-w-2xl">
          <QuickCreatePanel platform="instagram" tones={TONES} workspaceId={activeWorkspaceId} accessToken={accessToken}
            webhooks={state.webhooks} instructions={buildInstructionsString(state.brandProfile, state.instagramInstructions)}
            captionLanguage={state.brandProfile?.captionLanguage || 'both'}
            onDone={() => { setScreen('posts'); fetchRemotePosts() }} />
          <InstructionsAccordion state={state} />
        </div>
      )}
    </div>
  )
}


// Hoisted out of the component: Date.now() is impure, and inside a function
// defined during render the compiler can't prove it only ever runs from a
// click handler. At module scope there is nothing to prove.
function mediaFileName(topic) {
  return `${(topic || 'post').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.webp`
}


// ─── Post Detail Modal ─────────────────────────────────────────────────────
function PostDetail({ post, state, webhookUrl, regenWebhookUrl, supabaseUrl, anonKey, onClose, onStatusChange, onImageUpdated, onCaptionUpdated, onDelete }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  // The rewrite panel used to be handed buildInstructionsString(profile) —
  // the flattened profile and nothing else, with no brand identity line, no
  // task scoping and none of the brand's learned rules. Same builder as every
  // other AI call on the app now, so a caption rewritten here is briefed the
  // same way as the caption it is replacing.
  const brandContextFor = useBrandContext(activeWorkspaceId, accessToken, state.brandProfile)
  const [regenLoading,   setRegenLoading]   = useState(false)
  const [regenError,     setRegenError]     = useState('')
  // currentImage = the saved/committed image shown in the card list
  const [currentImage,   setCurrentImage]   = useState(post.imageUrl || post.mediaUrls?.[0] || '')
  // stagedImage = newly generated image waiting for user to Save or Discard
  const [stagedImage,    setStagedImage]    = useState(null)
  const [approved,       setApproved]       = useState(post.status === 'published')

  // Sync currentImage when the parent updates post.imageUrl (e.g. after a
  // save/regen). Adjusted during render rather than in an effect so the card
  // never paints one frame of the previous image before correcting itself.
  const [renderedImageUrl, setRenderedImageUrl] = useState(post.imageUrl)
  if (post.imageUrl !== renderedImageUrl) {
    setRenderedImageUrl(post.imageUrl)
    if (!stagedImage) setCurrentImage(post.imageUrl || post.mediaUrls?.[0] || '')
  }
  const [savedToMedia,   setSavedToMedia]   = useState(false)
  const [showFullCaption, setShowFullCaption] = useState(false)

  async function handleSaveToMedia() {
    const imageToSave = allImages ? allImages[carouselIdx] : displayImage
    if (!imageToSave) return
    const fileName = mediaFileName(post.topic)
    // Save to Supabase media_library
    if (supabaseUrl && anonKey) {
      await fetch(`${supabaseUrl}/rest/v1/media_library`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ workspace_id: activeWorkspaceId, name: fileName, url: imageToSave, platform: 'instagram', topic: post.topic, source: 'generated', mime_type: 'image/webp', size_bytes: 0 }),
      })
    }
    setSavedToMedia(true)
    setTimeout(() => setSavedToMedia(false), 3000)
  }
  // Caption editing
  const [editingCaption, setEditingCaption] = useState(false)
  const [captionDraft,   setCaptionDraft]   = useState(post.copy || '')
  const [studioOpen,     setStudioOpen]     = useState(false)

  // Apply a Caption Studio result into the existing editable caption box —
  // reviewer then hits the normal Save (handleSaveCaption) to persist. IG
  // captions carry their hashtags inline, so we fold them into the caption.
  function applyStudio({ caption, hashtags }) {
    const combined = hashtags ? `${caption}\n\n${hashtags}` : caption
    setCaptionDraft(combined)
    setEditingCaption(true)
  }

  // Keep captionDraft in sync when the parent updates post.copy after a save,
  // for the same reason and in the same way as the image above. Guarded on
  // `editingCaption` so it can never overwrite what someone is mid-way through
  // typing.
  const [renderedCopy, setRenderedCopy] = useState(post.copy)
  if (post.copy !== renderedCopy) {
    setRenderedCopy(post.copy)
    if (!editingCaption) setCaptionDraft(post.copy || '')
  }

  const campaign  = (state.campaigns || []).find(c => c.id === post.campaignId)
  const styleMeta = IMAGE_STYLES.find(s => s.value === post.style)
  const activeRegenUrl = post._fromSupabase ? regenWebhookUrl : webhookUrl

  // Carousel support for upload posts
  const allImages    = (post.mediaUrls && post.mediaUrls.length > 1) ? post.mediaUrls : null
  const [carouselIdx, setCarouselIdx] = useState(0)

  // The image shown in the viewer: staged (preview) if present, else committed
  // For carousel posts use the indexed image unless there's a staged preview
  const baseImage    = allImages ? (allImages[carouselIdx] || allImages[0]) : currentImage
  const displayImage = stagedImage || baseImage

  async function handleRegenImage() {
    if (!activeRegenUrl) {
      setRegenError('Configure the Instagram webhook in Settings → Integrations.')
      return
    }
    setRegenLoading(true); setRegenError(''); setStagedImage(null)
    try {
      const body = post._fromSupabase
        ? { post_id: post.id, image_prompt: post.imagePrompt || post.topic || '', style: post.style || 'photorealistic', aspect_ratio: post.aspectRatio || '1:1', topic: post.topic || '' }
        : { route_type: 'image_regen', image_prompt: post.imagePrompt || post.topic || '', style: post.style || 'photorealistic', aspect_ratio: post.aspectRatio || '1:1', topic: post.topic || '' }
      const res  = await fetch(activeRegenUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
      // Stage the new image — don't commit yet
      setStagedImage(data.image_url)
    } catch (err) {
      setRegenError(`Failed: ${err.message}`)
    } finally { setRegenLoading(false) }
  }

  async function handleSaveImage() {
    const newUrl = stagedImage
    setCurrentImage(newUrl)
    setStagedImage(null)
    onImageUpdated(post.id, newUrl)
    // Persist to Supabase
    if (supabaseUrl && anonKey && post._fromSupabase) {
      const table = post._table || 'instagram_generated_posts'
      await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${post.id}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ image_url: newUrl, updated_at: new Date().toISOString() }),
      })
    }
  }

  function handleDiscardImage() {
    setStagedImage(null)
    setRegenError('')
  }

  function handleSaveCaption() {
    onCaptionUpdated(post.id, captionDraft, post.copy)
    setEditingCaption(false)
  }

  function handleCancelCaption() {
    setCaptionDraft(post.copy || '')
    setEditingCaption(false)
  }

  const arParts     = (post.aspectRatio || '1:1').split(':').map(Number)
  const arCss       = `${arParts[0]}/${arParts[1]}`
  const isPortrait  = arParts[1] > arParts[0]
  const isSquare    = arParts[0] === arParts[1]

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.82)', padding: '24px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>

      <div className="bg-white border border-border shadow-dropdown overflow-hidden flex flex-col"
        style={{ width: '100%', maxWidth: '1200px', maxHeight: '94vh' }}>

        {/* ── Top bar ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={`text-xs font-bold px-2.5 py-1 leading-[1.4] tracking-wide ${
              post.status === 'pending_publish' ? 'bg-amber-100 text-amber-700' :
              post.status === 'published'       ? 'bg-green-100 text-green-700' :
                                                  'bg-blue-100 text-blue-700'}`}>
              {post.status === 'pending_publish' ? '● Pending Review' : post.status === 'published' ? '✓ Published' : '⏰ Scheduled'}
            </span>
            {post._fromSupabase      && <span className="text-xs bg-emerald-50 text-emerald-600 border border-emerald-200 px-1.5 py-0.5 leading-[1.4] font-medium">📅 Monthly Schedule</span>}
            {post.generatedByWorkflow && <span className="text-xs bg-purple-50 text-purple-600 border border-purple-200 px-1.5 py-0.5 leading-[1.4] font-medium">✦ AI Generated</span>}
            {styleMeta && <span className="text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 leading-[1.4]">{styleMeta.icon} {styleMeta.label}</span>}
            {campaign  && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 leading-[1.4] font-medium">{campaign.name}</span>}
          </div>
          <button onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-text-tertiary hover:bg-stone-100 hover:text-text transition-colors ml-4 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>

          {/* Left — Image column */}
          <div className="flex-shrink-0 flex flex-col overflow-y-auto"
            style={{ background: '#f3f5f4', width: isPortrait ? '420px' : isSquare ? '500px' : '560px' }}>

            {/* Image */}
            <div className="flex-1 flex items-center justify-center p-6">
              <div style={{ width: '100%', position: 'relative' }}>
                <div style={{ width: '100%', aspectRatio: arCss, borderRadius: '16px', overflow: 'hidden', position: 'relative' }}>
                  {displayImage
                    ? <PostImage src={displayImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : <div style={{ width: '100%', height: '100%', background: '#f5d0e8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg style={{ width: 48, height: 48, color: '#d4699c' }} fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
                          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                        </svg>
                      </div>}

                  {/* Staged preview badge */}
                  {stagedImage && (
                    <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(125,152,161,0.92)', borderRadius: 8, padding: '4px 10px' }}>
                      <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}>PREVIEW</span>
                    </div>
                  )}

                  {/* Carousel nav arrows */}
                  {allImages && allImages.length > 1 && !stagedImage && (<>
                    <button
                      onClick={() => setCarouselIdx(i => Math.max(0, i - 1))}
                      disabled={carouselIdx === 0}
                      style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.85)', border: 'none', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: carouselIdx === 0 ? 0.3 : 1, transition: 'opacity 0.15s' }}>
                      <svg width="16" height="16" fill="none" stroke="#1a1410" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
                    </button>
                    <button
                      onClick={() => setCarouselIdx(i => Math.min(allImages.length - 1, i + 1))}
                      disabled={carouselIdx === allImages.length - 1}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.85)', border: 'none', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: carouselIdx === allImages.length - 1 ? 0.3 : 1, transition: 'opacity 0.15s' }}>
                      <svg width="16" height="16" fill="none" stroke="#1a1410" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                    </button>

                    {/* Index badge */}
                    <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.5)', borderRadius: 8, padding: '3px 8px' }}>
                      <span style={{ color: '#fff', fontSize: 11, fontWeight: 600 }}>{carouselIdx + 1} / {allImages.length}</span>
                    </div>
                  </>)}
                </div>

                {/* Dot indicators */}
                {allImages && allImages.length > 1 && !stagedImage && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 10 }}>
                    {allImages.map((_, i) => (
                      <button key={i} onClick={() => setCarouselIdx(i)}
                        style={{ width: i === carouselIdx ? 20 : 7, height: 7, borderRadius: 4, border: 'none', cursor: 'pointer', transition: 'all 0.2s', background: i === carouselIdx ? '#E1306C' : 'rgba(188,24,136,0.25)' }} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Regen section */}
            <div className="px-6 pb-6 flex flex-col gap-3">

              {/* Staged image: Save / Discard */}
              {stagedImage ? (
                <div className="flex gap-2">
                  <button onClick={handleSaveImage}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold text-white transition-all active:scale-95"
                    style={{ background: '#16a34a' }}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                    Save Image
                  </button>
                  <button onClick={handleDiscardImage}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold transition-all active:scale-95 border-2 text-[#b34d7a] hover:bg-pink-100" style={{ borderColor: '#e8a0bf' }}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    Discard
                  </button>
                </div>
              ) : !activeRegenUrl ? (
                /* No workflow answers the regen path for a plan-generated
                   post — the slot it used was never deployed. Creative Studio
                   is where a picture actually gets remade, so say that rather
                   than offering a button whose only outcome is an error. */
                <p className="text-xs text-center text-[#b34d7a] leading-relaxed px-2">
                  To change this picture, open it in Creative Studio — that's where images are made and edited.
                </p>
              ) : (
                <button onClick={handleRegenImage} disabled={regenLoading}
                  className="w-full flex items-center justify-center gap-2.5 py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-50 transition-all active:scale-95"
                  style={{ background: regenLoading ? '#e8b4cc' : '#E1306C' }}>
                  {regenLoading
                    ? <><Spinner size="sm" /><span>Generating new image…</span></>
                    : <><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.27-4.93"/></svg><span>Regenerate Image</span></>}
                </button>
              )}

              {regenError && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600 text-center">{regenError}</div>
              )}

              {post.imagePrompt && (
                <div className="rounded-xl border px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.7)', borderColor: '#f0b8d4' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#b05080' }}>Image Prompt</p>
                  <p className="text-[11px] leading-relaxed line-clamp-4" style={{ color: '#7a3a5a' }}>{post.imagePrompt}</p>
                </div>
              )}

              {/* Aspect ratio + date chips */}
              <div className="flex gap-2 flex-wrap">
                {post.aspectRatio && (
                  <span className="text-[11px] px-2.5 py-1 rounded-lg font-mono" style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid #f0b8d4', color: '#a0456e' }}>
                    {post.aspectRatio}
                  </span>
                )}
                {post.scheduledAt && (
                  <span className="text-[11px] px-2.5 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid #f0b8d4', color: '#a0456e' }}>
                    📅 {post.scheduledAt}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right — Instagram preview + content */}
          <div className="flex-1 flex flex-col overflow-y-auto min-w-0 bg-[#fafafa]">
            <div className="flex-1 p-6 space-y-4">

              {/* Instagram post card preview.
                  DESIGN-SYSTEM EXCEPTION: this
                  mimics Instagram's own post chrome (rounded card, round
                  avatar) on purpose, so it stays rounded while the rest of the
                  app is square. */}
              <div className="bg-white rounded-[8px] border border-stone-200 overflow-hidden max-w-[468px] mx-auto">
                {/* Post header */}
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center"
                    style={{ background: '#E1306C' }}>
                    <span className="text-white text-xs font-bold">A</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-stone-900 leading-tight">araklighting</p>
                    <p className="text-[11px] text-stone-400">Saudi Arabia · Sponsored</p>
                  </div>
                  <svg className="w-5 h-5 text-stone-400" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                </div>

                {/* Post image */}
                {displayImage && (
                  <div style={{ aspectRatio: arCss, overflow: 'hidden', background: '#f5f5f5' }}>
                    <PostImage src={displayImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                )}

                {/* Action row */}
                <div className="px-4 pt-3 pb-1 flex items-center gap-4">
                  <svg className="w-6 h-6 text-stone-800 hover:text-red-500 cursor-pointer transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                  <svg className="w-6 h-6 text-stone-800 hover:text-stone-500 cursor-pointer transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  <svg className="w-6 h-6 text-stone-800 hover:text-stone-500 cursor-pointer transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  <div className="flex-1" />
                  <svg className="w-6 h-6 text-stone-800 hover:text-stone-500 cursor-pointer transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                </div>

                {/* Caption */}
                <div className="px-4 pb-4">
                  <p className="text-sm text-stone-900 leading-relaxed">
                    <span className="font-semibold">araklighting</span>{' '}
                    {showFullCaption
                      ? <span className="whitespace-pre-line">{post.copy || ''}</span>
                      : <span className="line-clamp-3">{post.copy || ''}</span>}
                  </p>
                  {!showFullCaption && post.copy && post.copy.length > 120 && (
                    <button onClick={() => setShowFullCaption(true)}
                      className="text-xs text-stone-400 hover:text-stone-600 mt-0.5 transition-colors">
                      ...more
                    </button>
                  )}
                  {post.hashtags && (showFullCaption || post.copy?.length <= 120) && (
                    <p className="text-sm mt-1 leading-relaxed" style={{ color: '#00376b' }}>
                      {showFullCaption
                        ? post.hashtags
                        : post.hashtags.split(' ').slice(0,5).join(' ') + (post.hashtags.split(' ').length > 5 ? ' …' : '')}
                    </p>
                  )}
                  {showFullCaption && (
                    <button onClick={() => setShowFullCaption(false)}
                      className="text-xs text-stone-400 hover:text-stone-600 mt-0.5 transition-colors">
                      show less
                    </button>
                  )}
                  <p className="text-[11px] text-stone-400 mt-1.5 uppercase tracking-wide">{formatDateTime(post.createdAt)}</p>
                </div>
              </div>

              {/* Caption edit + hashtags + meta */}
              <div className="max-w-[468px] mx-auto space-y-4 bg-white rounded-2xl border border-stone-200 p-5">

                {post.topic && (
                  <div>
                    <p className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest mb-1">Topic</p>
                    <p className="text-sm text-text font-medium">{post.topic}</p>
                  </div>
                )}

                {/* Caption edit */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest">Caption</p>
                    {!editingCaption ? (
                      <div className="flex gap-1.5">
                        <button onClick={() => setStudioOpen(true)}
                          className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-semibold px-2.5 py-1 rounded-lg hover:bg-violet-50 transition-colors">
                          ✨ Rewrite
                        </button>
                        <button onClick={() => { setCaptionDraft(post.copy || ''); setEditingCaption(true) }}
                          className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-semibold px-2.5 py-1 rounded-lg hover:bg-amber-50 transition-colors">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          Edit
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        <button onClick={handleCancelCaption} className="text-xs text-text-tertiary hover:text-text px-2.5 py-1 rounded-lg hover:bg-surface-subtle transition-colors">Cancel</button>
                        <button onClick={handleSaveCaption}
                          className="flex items-center gap-1 text-xs text-white font-semibold px-3 py-1 rounded-lg transition-colors"
                          style={{ background: '#16a34a' }}>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                          Save
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl bg-stone-50 border border-stone-200 overflow-hidden">
                    {editingCaption
                      ? <textarea value={captionDraft} onChange={e => setCaptionDraft(e.target.value)}
                          autoFocus rows={8}
                          className="w-full text-sm text-text leading-loose p-4 resize-none focus:outline-none bg-transparent border-2 border-amber-400 rounded-xl"
                          style={{ minHeight: '140px' }} />
                      : <div className="p-4 overflow-y-auto" style={{ maxHeight: '220px' }}>
                          <p className="text-sm text-text leading-loose whitespace-pre-line">{post.copy || 'No caption'}</p>
                        </div>}
                  </div>
                </div>

                {/* Hashtags */}
                {post.hashtags && (
                  <div>
                    <p className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest mb-2">Hashtags</p>
                    <div className="flex flex-wrap gap-1.5">
                      {post.hashtags.split(' ').filter(Boolean).map((tag, i) => (
                        <span key={i} className="text-xs bg-pink-50 text-pink-600 border border-pink-100 px-1.5 py-0.5 leading-[1.4] font-medium">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Meta */}
                <div className="flex items-center gap-4 text-[11px] text-text-tertiary pt-2 border-t border-border flex-wrap">
                  <span>🕐 {formatDateTime(post.createdAt)}</span>
                  {styleMeta && <span>{styleMeta.icon} {styleMeta.label}</span>}
                </div>
              </div>
            </div>

            {/* ── Action bar ─────────────────────────────────────────── */}
            <div className="px-8 py-6 border-t border-border bg-stone-50/60 flex gap-3 flex-shrink-0">
              {post.status !== 'published' && (
                <button
                  onClick={() => { onStatusChange(post, 'published'); setApproved(true) }}
                  className="flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-2xl text-sm font-bold text-white transition-all active:scale-95"
                  style={{
                    background: approved ? '#16a34a' : '#E1306C',
                  }}>
                  {approved
                    ? <><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Approved!</>
                    : <><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Approve & Publish</>}
                </button>
              )}
              {post.status === 'published' && (
                <div className="flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-2xl text-sm font-bold bg-green-50 text-green-700 border-2 border-green-200">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                  Published
                </div>
              )}
              {post.status !== 'scheduled' && post.status !== 'published' && (
                <button onClick={() => onStatusChange(post, 'scheduled')}
                  className="px-6 py-3.5 rounded-2xl text-sm font-semibold border-2 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">
                  Schedule
                </button>
              )}
              {onDelete && (
                <button onClick={() => { onDelete(post); onClose() }}
                  className="px-6 py-3.5 rounded-2xl text-sm font-semibold border-2 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                  Delete
                </button>
              )}
              {displayImage && (
                <button onClick={handleSaveToMedia}
                  title="Save image to Media Library"
                  className={`px-4 py-3.5 rounded-2xl text-sm font-semibold border-2 transition-all flex items-center gap-2 ${savedToMedia ? 'border-green-300 bg-green-50 text-green-700' : 'border-stone-200 bg-white text-text-secondary hover:bg-stone-50 hover:border-stone-300'}`}>
                  {savedToMedia
                    ? <><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Saved!</>
                    : <><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save to Library</>}
                </button>
              )}
              <button onClick={onClose}
                className="px-6 py-3.5 rounded-2xl text-sm font-semibold border-2 border-border text-text-secondary hover:bg-stone-100 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
      {studioOpen && (
        <CaptionStudio
          open={studioOpen}
          onClose={() => setStudioOpen(false)}
          webhookUrl={state.webhooks?.captionStudio || ''}
          platform="instagram"
          language={state.brandProfile?.captionLanguage || 'both'}
          context={{ topic: post.topic || '', angle: post.angle || '', tone: post.tone || '', objective: post.objective || '', cta: post.cta || '' }}
          brandContextFor={options => brandContextFor('caption', options)}
          current={{ caption: post.copy || '', hashtags: post.hashtags || '' }}
          onApply={applyStudio}
        />
      )}
    </div>,
    document.body
  )
}

// Exported so the cross-platform Approvals page can reuse this exact review
// UI (regen/crop/tone-switch/approve) instead of duplicating it.
export { PostDetail as InstagramPostDetail }

// ─── Posts List ────────────────────────────────────────────────────────────
function PostsList({ posts, dispatch, state, onCreateClick, updatePostStatus, webhookUrl, regenWebhookUrl }) {
  const [filter,       setFilter]       = useState('all')
  const [selectedPost, setSelectedPost] = useState(null)

  const { activeWorkspaceId, accessToken } = useAuth()
  const supabaseUrl = SUPABASE_URL
  const anonKey     = accessToken || ''

  const filtered = filter === 'all' ? posts : posts.filter(p =>
    filter === 'pending_publish' ? p.status === 'pending_publish' :
    filter === 'published'       ? p.status === 'published' :
    p.status === filter
  )

  async function handleStatusChange(post, newStatus) {
    if (post._fromSupabase && updatePostStatus) {
      // post._table, not the default: generated posts are split across
      // generated_posts and the frozen instagram_generated_posts, so letting
      // this fall back would PATCH a row id in whichever table the default
      // names — a silent no-op at best, someone else's row at worst.
      await updatePostStatus(post.id, newStatus, post._table)
    } else {
      dispatch({ type: 'UPDATE_POST', payload: { id: post.id, status: newStatus } })
    }
    if (selectedPost?.id === post.id) {
      setSelectedPost(prev => ({ ...prev, status: newStatus }))
    }
  }

  function handleImageUpdated(postId, newImageUrl) {
    dispatch({ type: 'UPDATE_POST', payload: { id: postId, imageUrl: newImageUrl, mediaUrls: [newImageUrl] } })
    if (selectedPost?.id === postId) {
      setSelectedPost(prev => ({ ...prev, imageUrl: newImageUrl, mediaUrls: [newImageUrl] }))
    }
  }

  async function handleCaptionUpdated(postId, newCopy, originalCopy) {
    dispatch({ type: 'UPDATE_POST', payload: { id: postId, copy: newCopy } })
    if (selectedPost?.id === postId) {
      setSelectedPost(prev => ({ ...prev, copy: newCopy }))
    }
    // Feedback signal for Brand Brain — captures what humans changed before
    // approving, so future prompt refinement has real data to learn from.
    logEditFeedback(activeWorkspaceId, accessToken, { platform: 'instagram', postId, field: 'caption', original: originalCopy, edited: newCopy })
    // Persist to Supabase for scheduled posts
    if (supabaseUrl && anonKey) {
      const post = [...(state.posts || []), ...(selectedPost ? [selectedPost] : [])].find(p => p.id === postId)
      if (post?._fromSupabase) {
        const table = post._table || 'instagram_generated_posts'
        const field = table === 'instagram_manual_posts' ? 'caption' : 'caption'
        await fetch(
          `${supabaseUrl}/rest/v1/${table}?id=eq.${postId}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${anonKey}`,
              'Content-Type': 'application/json', 'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ [field]: newCopy, updated_at: new Date().toISOString() }),
          }
        )
      }
    }
  }

  async function handleDelete(post) {
    if (post._fromSupabase) {
      if (supabaseUrl && anonKey) {
        const table = post._table || 'instagram_generated_posts'
        await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${post.id}`, {
          method: 'DELETE',
          headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${anonKey}` },
        })
      }
    }
    dispatch(actions.deletePost(post.id))
    if (selectedPost?.id === post.id) setSelectedPost(null)
  }

  const FILTERS = [
    { key: 'all',             label: 'All',       count: posts.length },
    { key: 'pending_publish', label: 'Pending',   count: posts.filter(p => p.status === 'pending_publish').length },
    { key: 'scheduled',       label: 'Scheduled', count: posts.filter(p => p.status === 'scheduled').length },
    { key: 'published',       label: 'Published', count: posts.filter(p => p.status === 'published').length },
  ]

  return (
    <div className="space-y-4">
      {/* Filter tabs — glowing active state */}
      <div className="flex gap-2 flex-wrap items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`relative px-4 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                filter === f.key
                  ? 'text-white  scale-105'
                  : 'text-text-secondary bg-white border border-border hover:border-stone-300 hover:text-text'
              }`}
              style={filter === f.key ? {
                background: '#E1306C',
                
              } : {}}>
              {f.label}
              {f.count > 0 && (
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 leading-[1.4] font-bold ${
                  filter === f.key ? 'bg-white/25 text-white' : 'bg-surface-subtle text-text-tertiary'
                }`}>{f.count}</span>
              )}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-text-tertiary">{filtered.length} post{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: '#E1306C' }}>
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
            </svg>
          </div>
          <p className="font-medium text-text mb-1">No {filter !== 'all' ? FILTERS.find(f=>f.key===filter)?.label.toLowerCase()+' ' : ''}posts yet</p>
          {/* Named the wrong company on every workspace but the original one.
              Falls back to no name rather than a placeholder: an empty state
              that names nobody reads fine, one that names the wrong brand
              does not. */}
          <p className="text-sm text-text-secondary mb-4">
            Generate your first AI-powered post{state.brandProfile?.customFields?.brand_name ? ` for ${state.brandProfile.customFields.brand_name}` : ''}.
          </p>
          <Button onClick={onCreateClick}>Create Post</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map(p => {
            const campaign   = (state.campaigns || []).find(c => c.id === p.campaignId)
            const styleMeta  = IMAGE_STYLES.find(s => s.value === p.style)
            const imgSrc     = p.imageUrl || p.mediaUrls?.[0]
            const customMeta = CUSTOM_POST_TYPES.find(t => t.value === p.customType)
            return (
              <Card key={p.id}
                className="overflow-hidden cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-150"
                onClick={() => setSelectedPost(p)}>
                <div className="flex">
                  {/* Thumbnail */}
                  <div className="w-28 flex-shrink-0 bg-surface-subtle overflow-hidden relative"
                    style={{ aspectRatio: (p.aspectRatio || '1:1').replace(':','/'), minHeight: '80px', maxHeight: '140px' }}>
                    {imgSrc
                      ? <PostImage src={imgSrc} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center">
                          <svg className="w-7 h-7 text-border-strong" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        </div>}
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                      <svg className="w-6 h-6 text-white drop-shadow" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 3h6v6M14 10l7-7M9 21H3v-6M10 14l-7 7"/></svg>
                    </div>
                  </div>

                  <div className="flex-1 p-4 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge status={p.status === 'pending_publish' ? 'pending' : p.status} />
                        {p.generatedByWorkflow && <span className="text-[10px] bg-purple-50 text-purple-600 px-1.5 py-0.5 leading-[1.4] font-medium">AI</span>}
                        {p._fromSupabase && <span className="text-[10px] bg-green-50 text-green-600 px-1.5 py-0.5 leading-[1.4] font-medium">📅 Scheduled</span>}
                        {customMeta && <span className="text-[10px] bg-surface-subtle text-text-secondary px-1.5 py-0.5 leading-[1.4]">{customMeta.icon} {customMeta.label}</span>}
                        {!customMeta && styleMeta && <span className="text-[10px] bg-surface-subtle text-text-secondary px-1.5 py-0.5 leading-[1.4]">{styleMeta.icon} {styleMeta.label}</span>}
                        {campaign && <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 leading-[1.4] font-medium">{campaign.name}</span>}
                      </div>
                      <button onClick={e => { e.stopPropagation(); handleDelete(p) }}
                        className="text-text-tertiary hover:text-red-500 transition-colors flex-shrink-0 p-1 -m-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                      </button>
                    </div>
                    <p className="text-sm text-text line-clamp-2 leading-relaxed mb-1.5">{p.copy || 'No caption'}</p>
                    {p.hashtags && <p className="text-xs text-pink-500 line-clamp-1 mb-1.5">{p.hashtags}</p>}
                    <p className="text-[11px] text-text-tertiary">{formatDateTime(p.createdAt)}{p.topic && <span className="ml-1.5 opacity-70">· {p.topic}</span>}</p>
                    <p className="text-[10px] text-text-tertiary mt-1 opacity-60">Click to open full view</p>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Full-screen post detail modal */}
      {selectedPost && (
        <PostDetail
          post={selectedPost}
          state={state}
          webhookUrl={webhookUrl}
          regenWebhookUrl={regenWebhookUrl}
          supabaseUrl={supabaseUrl}
          anonKey={anonKey}
          onClose={() => setSelectedPost(null)}
          onStatusChange={handleStatusChange}
          onImageUpdated={handleImageUpdated}
          onCaptionUpdated={handleCaptionUpdated}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}


// ─── Instructions Accordion ────────────────────────────────────────────────
function InstructionsAccordion({ state }) {
  const { dispatch } = useApp()
  const navigate = useNavigate()
  const [open,         setOpen]         = useState(false)
  const [instructions, setInstructions] = useState(state.instagramInstructions || '')
  const [saved,        setSaved]        = useState(false)
  function handleSave() {
    dispatch({ type: 'SET_INSTAGRAM_INSTRUCTIONS', payload: instructions })
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-surface-subtle transition-colors">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-purple-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-text">Instagram-Specific Notes</p>
            <p className="text-xs text-text-secondary">{state.instagramInstructions ? '✓ Notes saved' : 'Optional — layers on top of your Brand Brain profile'}</p>
          </div>
        </div>
        <svg className={`w-4 h-4 text-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-3 fade-up">
          <p className="text-xs text-text-tertiary">
            Your core brand voice, dos/don'ts, and audience now live in one place —{' '}
            <button type="button" onClick={() => navigate('/brand-brain')} className="text-purple-600 hover:text-purple-700 underline font-medium">Brand Brain</button>.
            Use this field only for things specific to Instagram, e.g. Reels-style hooks or emoji usage.
          </p>
          <Textarea
            placeholder={"Examples:\n• Reels hooks should be punchy, under 6 words\n• Carousel posts: keep each slide to one idea"}
            value={instructions} onChange={e => setInstructions(e.target.value)} rows={5} />
          <Button onClick={handleSave} variant={saved ? 'secondary' : 'primary'} className="w-full justify-center">
            {saved ? '✓ Saved' : 'Save Instagram Notes'}
          </Button>
        </div>
      )}
    </Card>
  )
}
