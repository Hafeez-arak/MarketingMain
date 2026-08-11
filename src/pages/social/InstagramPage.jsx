import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/app'
import { useAuth } from '../../store/auth'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/supabaseClient'
import { Card, Button, Badge, Textarea, Spinner, PostImage } from '../../components/ui/index'
import { uid, formatDateTime } from '../../lib/utils'
import { buildInstructionsString, isBrandProfileEmpty, useBrandProfileSync, logEditFeedback } from '../../lib/brandBrain'
import { ReferencePicker } from '../../components/ReferencePicker'
import { CaptionStudio } from '../../components/CaptionStudio'
import { QuickCreatePanel } from '../../components/QuickCreatePanel'

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

const ASPECT_RATIOS = [
  { value: '1:1',    label: 'Square',       subdesc: 'Feed Post',       dims: '1080×1080', fluxRatio: '1:1',  shape: [1,1] },
  { value: '4:5',    label: 'Portrait',     subdesc: 'Feed Portrait',   dims: '1080×1350', fluxRatio: '4:5',  shape: [4,5] },
  { value: '9:16',   label: 'Story / Reel', subdesc: 'Story & Cover',   dims: '1080×1920', fluxRatio: '9:16', shape: [9,16] },
  { value: '16:9',   label: 'Landscape',    subdesc: 'IGTV / Banner',   dims: '1920×1080', fluxRatio: '16:9', shape: [16,9] },
  { value: '1.91:1', label: 'Carousel',     subdesc: 'Slide / Wide',    dims: '1080×566',  fluxRatio: '3:2',  shape: [191,100] },
]

// ─── Aspect Ratio Selector ──────────────────────────────────────────────────
function AspectRatioSelector({ value, onChange }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {ASPECT_RATIOS.map(r => {
        const isSelected = value === r.value
        const [w, h] = r.shape
        const maxW = 36
        const maxH = 36
        const scale = Math.min(maxW / w, maxH / h)
        const boxW = Math.round(w * scale)
        const boxH = Math.round(h * scale)
        return (
          <button type="button" key={r.value} onClick={() => onChange(r.value)}
            className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border transition-all duration-200 min-w-[72px] ${
              isSelected
                ? 'border-amber-400 bg-amber-50 shadow-sm'
                : 'border-border bg-white hover:border-stone-300 hover:bg-surface-subtle'
            }`}>
            {/* Visual shape preview */}
            <div className="flex items-center justify-center" style={{ width: maxW, height: maxH }}>
              <div
                className={`rounded-sm transition-colors ${isSelected ? 'bg-amber-400' : 'bg-stone-300'}`}
                style={{ width: boxW, height: boxH }} />
            </div>
            <div className="text-center">
              <p className={`text-[11px] font-semibold leading-none ${isSelected ? 'text-amber-700' : 'text-text'}`}>
                {r.label}
              </p>
              <p className="text-[10px] text-text-tertiary mt-0.5">{r.subdesc}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Visual Selector ────────────────────────────────────────────────────────
function VisualSelector({ mode, onModeChange, selectedStyle, onStyleChange, customType, onCustomTypeChange }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-surface-subtle border border-border rounded-xl p-1">
        {[
          { key: null,       label: '✨ Auto' },
          { key: 'lighting', label: '💡 Lighting' },
          { key: 'custom',   label: '🎨 Custom' },
        ].map(m => (
          <button key={String(m.key)} onClick={() => onModeChange(m.key)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
              mode === m.key ? 'bg-white text-text shadow-sm border border-border' : 'text-text-secondary hover:text-text'
            }`}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === null && (
        <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
          <p className="text-xs text-amber-700">Claude will analyze your brief and choose the most appropriate visual style automatically.</p>
        </div>
      )}
      {mode === 'lighting' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {LIGHTING_STYLES.map(s => (
            <button key={s.value} onClick={() => onStyleChange(s.value)}
              className={`relative text-left rounded-xl border px-3 py-2.5 transition-all ${selectedStyle === s.value ? 'border-amber-500 bg-amber-100 shadow-amber ring-1 ring-amber-400' : 'border-border bg-white hover:border-border-strong hover:bg-surface-subtle'}`}>
              {selectedStyle === s.value && (
                <span className="absolute top-2 right-2 w-4 h-4 bg-amber-700 flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
              )}
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-base leading-none">{s.icon}</span>
                <span className={`text-xs font-semibold ${selectedStyle === s.value ? 'text-amber-700' : 'text-text'}`}>{s.label}</span>
              </div>
              <p className="text-[11px] text-text-tertiary leading-tight">{s.desc}</p>
            </button>
          ))}
        </div>
      )}
      {mode === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          {CUSTOM_POST_TYPES.map(t => (
            <button key={t.value} onClick={() => onCustomTypeChange(t.value)}
              className={`relative text-left rounded-xl border px-3 py-2.5 transition-all ${customType === t.value ? 'border-amber-500 bg-amber-100 shadow-amber ring-1 ring-amber-400' : 'border-border bg-white hover:border-border-strong hover:bg-surface-subtle'}`}>
              {customType === t.value && (
                <span className="absolute top-2 right-2 w-4 h-4 bg-amber-700 flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
              )}
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-base leading-none">{t.icon}</span>
                <span className={`text-xs font-semibold ${customType === t.value ? 'text-amber-700' : 'text-text'}`}>{t.label}</span>
              </div>
              <p className="text-[11px] text-text-tertiary leading-tight">{t.desc}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────
// ─── Supabase generated posts hook ────────────────────────────────────────
function useSupabasePosts(supabaseUrl, anonKey) {
  const [remotePosts,   setRemotePosts]   = useState([])
  const [loadingPosts,  setLoadingPosts]  = useState(false)
  const [lastFetchedAt, setLastFetchedAt] = useState(null)

  async function fetchRemotePosts() {
    if (!supabaseUrl || !anonKey) return
    setLoadingPosts(true)
    try {
      const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${anonKey}` }
      const [schedRes, manualRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/instagram_generated_posts?select=*&order=created_at.desc&limit=100`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/instagram_manual_posts?select=*&order=created_at.desc&limit=100`, { headers }),
      ])
      const schedRows  = schedRes.ok  ? await schedRes.json()  : []
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
        generatedByWorkflow: true,
        contentRoute:        source === 'manual' ? 'manual' : 'scheduled',
        createdAt:           r.created_at,
        _fromSupabase:       true,
        _table:              source === 'manual' ? 'instagram_manual_posts' : 'instagram_generated_posts',
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

  async function updatePostStatus(postId, status, table = 'instagram_generated_posts') {
    if (!supabaseUrl || !anonKey) return
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
  const webhookUrl  = state.webhooks?.instagram || ''
  const supabaseUrl = SUPABASE_URL
  const anonKey     = accessToken || ''

  const { remotePosts, loadingPosts, lastFetchedAt, fetchRemotePosts, updatePostStatus } =
    useSupabasePosts(supabaseUrl, anonKey)

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
      <div className="flex gap-1 bg-surface-subtle border border-border rounded-xl p-1 w-fit">
        {[{ key: 'posts', label: 'Posts' }, { key: 'create', label: 'Create Post' }, { key: 'reels', label: '🎬 Reels' }, { key: 'schedule', label: '📅 Monthly Schedule' }].map(t => (
          <button key={t.key} onClick={() => setScreen(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${screen === t.key ? 'bg-white text-text shadow-sm border border-border' : 'text-text-secondary hover:text-text hover:bg-white/60'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {screen === 'posts'    && <PostsList posts={mergedPosts} dispatch={dispatch} state={state} onCreateClick={() => setScreen('create')} updatePostStatus={updatePostStatus} webhookUrl={webhookUrl} regenWebhookUrl={state.webhooks?.instagramScheduleRegen || ''} />}
      {screen === 'create'   && (
        <div className="space-y-4 max-w-2xl">
          <QuickCreatePanel platform="instagram" tones={TONES} workspaceId={activeWorkspaceId} accessToken={accessToken}
            webhooks={state.webhooks} instructions={buildInstructionsString(state.brandProfile, state.instagramInstructions)}
            captionLanguage={state.brandProfile?.captionLanguage || 'both'}
            onDone={() => { setScreen('posts'); fetchRemotePosts() }} />
          <InstructionsAccordion state={state} />
        </div>
      )}
      {screen === 'reels'    && <ReelsPanel state={state} dispatch={dispatch} />}
      {screen === 'schedule' && <MonthlySchedule state={state} dispatch={dispatch} instructions={buildInstructionsString(state.brandProfile, state.instagramInstructions)} />}
    </div>
  )
}

// ─── Supabase helpers ──────────────────────────────────────────────────────
function useSupabaseSchedule(supabaseUrl, anonKey, workspaceId) {
  const headers = {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${anonKey}`,
    'Prefer':        'resolution=merge-duplicates',
  }

  async function upsertEntry(dateKey, entry) {
    if (!supabaseUrl || !anonKey) return { error: 'Supabase not configured. Go to Settings → Integrations.' }
    const body = {
      workspace_id:         workspaceId,
      webapp_id:            entry._id || null,
      scheduled_date:       dateKey,
      topic:                entry.topic,
      tone:                 entry.tone              || 'professional',
      visual_mode:          entry.visualMode        ?? null,
      style:                entry.style             || 'photorealistic',
      custom_type:          entry.customType        || null,
      aspect_ratio:         entry.aspectRatio       || '1:1',
      notes:                entry.notes             || null,
      instructions:         entry.instructions      || null,
      campaign_id:          entry.campaignId        || null,
      upload_type:          entry.uploadType        || 'generate',
      uploaded_image_urls:  entry.uploadedImageUrls || null,
      reference_image_urls: entry.referenceImageUrls || [],
      publish_time:         entry.publishTime       || null,
      status:               'pending',
    }
    // Use webapp_id as the upsert key — allows multiple posts per day
    const url = entry._id
      ? `${supabaseUrl}/rest/v1/instagram_schedule?webapp_id=eq.${entry._id}`
      : `${supabaseUrl}/rest/v1/instagram_schedule`
    const method = entry._id ? 'PATCH' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { ...headers, 'Prefer': 'return=representation' },
      body: JSON.stringify(method === 'POST' ? body : (() => { const b = { ...body }; delete b.webapp_id; return b })()), 
    })
    if (!res.ok) { const err = await res.text(); return { error: err } }
    return { ok: true }
  }

  async function uploadToStorage(file, dateKey, index) {
    if (!supabaseUrl || !anonKey) return { error: 'Supabase not configured.' }
    const ext  = file.name.split('.').pop()
    const path = `instagram/${dateKey}/${Date.now()}_${index}.${ext}`
    const res  = await fetch(`${supabaseUrl}/storage/v1/object/schedule-uploads/${path}`, {
      method:  'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': file.type },
      body:    file,
    })
    if (!res.ok) { const err = await res.text(); return { error: err } }
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/schedule-uploads/${path}`
    return { url: publicUrl }
  }

  async function deleteEntry(dateKey, entry) {
    if (!supabaseUrl || !anonKey) return { error: 'Supabase not configured.' }
    // Delete by webapp_id if available, otherwise by date (legacy fallback)
    const url = entry?._id
      ? `${supabaseUrl}/rest/v1/instagram_schedule?webapp_id=eq.${entry._id}`
      : `${supabaseUrl}/rest/v1/instagram_schedule?scheduled_date=eq.${dateKey}`
    const res = await fetch(url, { method: 'DELETE', headers })
    if (!res.ok) { const err = await res.text(); return { error: err } }
    return { ok: true }
  }

  async function fetchMonth(year, month) {
    if (!supabaseUrl || !anonKey) return { data: null, error: 'Supabase not configured.' }
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const to   = `${year}-${String(month + 1).padStart(2, '0')}-31`
    const res = await fetch(
      `${supabaseUrl}/rest/v1/instagram_schedule?scheduled_date=gte.${from}&scheduled_date=lte.${to}&select=*&order=publish_time.asc`,
      { headers }
    )
    if (!res.ok) { const err = await res.text(); return { data: null, error: err } }
    const rows = await res.json()
    // Convert array → { 'YYYY-MM-DD': [ ...entries ] } — multiple posts per day
    const map = {}
    rows.forEach(r => {
      const entry = {
        _id:                r.webapp_id || r.id,
        topic:              r.topic,
        tone:               r.tone,
        visualMode:         r.visual_mode,
        style:              r.style,
        customType:         r.custom_type,
        aspectRatio:        r.aspect_ratio,
        notes:              r.notes,
        instructions:       r.instructions,
        campaignId:         r.campaign_id,
        status:             r.status,
        uploadType:         r.upload_type         || 'generate',
        uploadedImageUrls:  r.uploaded_image_urls || null,
        referenceImageUrls: r.reference_image_urls || [],
        publishTime:        r.publish_time        || null,
      }
      if (!map[r.scheduled_date]) map[r.scheduled_date] = []
      map[r.scheduled_date].push(entry)
    })
    return { data: map, error: null }
  }

  return { upsertEntry, deleteEntry, fetchMonth, uploadToStorage }
}

// ─── Monthly Schedule ──────────────────────────────────────────────────────
const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Hoisted out of the component: Date.now() is impure, and inside a function
// defined during render the compiler can't prove it only ever runs from a
// click handler. At module scope there is nothing to prove.
function mediaFileName(topic) {
  return `${(topic || 'post').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.webp`
}

function MonthlySchedule({ state, dispatch, instructions }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const supabaseUrl = SUPABASE_URL
  const anonKey     = accessToken || ''
  const { upsertEntry, deleteEntry, fetchMonth, uploadToStorage } = useSupabaseSchedule(supabaseUrl, anonKey, activeWorkspaceId)

  const today = new Date()
  const [year,    setYear]    = useState(today.getFullYear())
  const [month,   setMonth]   = useState(today.getMonth())
  const [editDay,    setEditDay]    = useState(null)  // dateKey string
  const [editIndex,  setEditIndex]  = useState(null)  // index within day array, null = new
  const [viewDay,    setViewDay]    = useState(null)  // dateKey for overview panel
  // remoteSchedule: rows fetched from Supabase for current month view
  const [remoteSchedule, setRemoteSchedule] = useState({})
  const [loadingMonth,   setLoadingMonth]   = useState(false)
  const [loadError,      setLoadError]      = useState('')

  // Local state still mirrors Supabase so calendar renders instantly after save
  const localSchedule = state.instagramSchedule || {}

  // Merge: remote is authoritative, local fills in unsaved changes
  const schedule = { ...localSchedule, ...remoteSchedule }

  // Normalize a day's value → always an array
  function dayEntries(key) {
    const val = schedule[key]
    if (!val) return []
    return Array.isArray(val) ? val : [val]
  }

  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  function dateKey(d) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  function prevMonth() { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  function nextMonth() { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1) }

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const filledCount = Object.keys(schedule).filter(k => k.startsWith(`${year}-${String(month + 1).padStart(2,'0')}`)).length
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

  const [lastFetched, setLastFetched] = useState('')
  const monthKey = `${year}-${month}`

  if (supabaseUrl && anonKey && monthKey !== lastFetched && !loadingMonth) {
    setLoadingMonth(true)
    setLastFetched(monthKey)
    fetchMonth(year, month).then(({ data, error }) => {
      setLoadingMonth(false)
      if (error) { setLoadError(error) }
      else { setRemoteSchedule(data || {}); setLoadError('') }
    })
  }

  // Save a post to a day (add new or update existing at index)
  async function handleSave(data) {
    const existing = dayEntries(editDay)
    let updated
    if (editIndex === null) {
      // new post
      updated = [...existing, { ...data, _id: uid() }]
    } else {
      // edit existing
      updated = existing.map((e, i) => i === editIndex ? { ...e, ...data } : e)
    }
    const newSchedule = { ...localSchedule, [editDay]: updated }
    dispatch({ type: 'SET_INSTAGRAM_SCHEDULE', payload: newSchedule })
    setRemoteSchedule(prev => ({ ...prev, [editDay]: updated }))
    setEditDay(null); setEditIndex(null)
    // return to day overview
    setViewDay(editDay)

    const result = await upsertEntry(editDay, { ...data, instructions })
    if (result.error) {
      dispatch(actions.addNotification({ id: uid(), message: `Schedule saved locally but Supabase sync failed: ${result.error}`, createdAt: new Date().toISOString() }))
    } else { setLastFetched('') }
  }

  // Delete a single post from a day
  async function handleDeletePost(key, index) {
    const existing = dayEntries(key)
    const entryToDelete = existing[index]
    const updated = existing.filter((_, i) => i !== index)
    const newSchedule = { ...localSchedule }
    if (updated.length === 0) {
      delete newSchedule[key]
    } else {
      newSchedule[key] = updated
    }
    dispatch({ type: 'SET_INSTAGRAM_SCHEDULE', payload: newSchedule })
    setRemoteSchedule(prev => {
      const n = { ...prev }
      if (updated.length === 0) delete n[key]
      else n[key] = updated
      return n
    })
    if (updated.length === 0) setViewDay(null)
    // Delete from Supabase by webapp_id
    await deleteEntry(key, entryToDelete)
  }

  const isConfigured = !!(supabaseUrl && anonKey)

  // ── Shared type/upload labels ──────────────────────────────────────────────
  function entryLabel(e) {
    if (e.uploadType === 'reel')   return { icon: '🎬', text: 'Reel',   color: 'text-purple-600' }
    if (e.uploadType === 'upload') return { icon: '🖼️', text: 'Upload', color: 'text-amber-600' }
    return { icon: '✦',  text: 'Generate', color: 'text-amber-700' }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-text">Monthly Content Schedule</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Plan your posts day by day. n8n generates each one automatically at 8am on its date.
            {filledCount > 0 && <span className="ml-2 text-amber-600 font-medium">{filledCount} day{filledCount !== 1 ? 's' : ''} planned this month</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loadingMonth && <div className="flex items-center gap-1.5 text-xs text-text-tertiary"><Spinner size="sm" /> Syncing…</div>}
          <button onClick={prevMonth} className="w-8 h-8 flex items-center justify-center rounded-xl border border-border hover:bg-surface-subtle transition-colors">
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <span className="text-sm font-semibold text-text min-w-[120px] text-center">{MONTH_NAMES[month]} {year}</span>
          <button onClick={nextMonth} className="w-8 h-8 flex items-center justify-center rounded-xl border border-border hover:bg-surface-subtle transition-colors">
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>

      {/* Supabase not configured warning */}
      {!isConfigured && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3">
          <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div>
            <p className="text-xs font-semibold text-amber-700">Supabase not configured</p>
            <p className="text-xs text-amber-600 mt-0.5">Go to <strong>Settings → Integrations → Supabase</strong> and enter your Project URL and anon key.</p>
          </div>
        </div>
      )}

      {loadError && (
        <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Supabase sync error: {loadError}
        </div>
      )}

      {/* Today's status banner */}
      {(() => {
        const todayEntries = dayEntries(todayKey)
        if (todayEntries.length === 0) return (
          <div className="rounded-xl border border-border bg-surface-subtle px-4 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-text-tertiary flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <p className="text-xs text-text-tertiary">No post planned for today ({todayKey}). Click the date on the calendar to add one.</p>
          </div>
        )
        return (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 flex-wrap">
            <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-stone-800">{todayEntries.length} post{todayEntries.length !== 1 ? 's' : ''} planned for today</p>
              <p className="text-xs text-stone-600 mt-0.5">n8n will generate each one automatically at 8am</p>
            </div>
            <button onClick={() => setViewDay(todayKey)} className="text-xs font-semibold text-amber-700 hover:text-amber-800">View →</button>
          </div>
        )
      })()}

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1">
        {DAYS_OF_WEEK.map(d => (
          <div key={d} className="text-center text-[11px] font-semibold text-text-tertiary uppercase tracking-wide py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} />
          const key     = dateKey(day)
          const entries = dayEntries(key)
          const count   = entries.length
          const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
          const isPast  = new Date(year, month, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate())
          const hasGenerated = entries.some(e => e.status === 'generated')
          return (
            <button key={key} onClick={() => setViewDay(key)}
              className={`
                relative rounded-xl border transition-all duration-150 text-left overflow-hidden
                min-h-[72px] p-2 flex flex-col gap-0.5
                ${isToday ? 'border-amber-400 ring-2 ring-amber-200' : 'border-border'}
                ${hasGenerated ? 'bg-green-50 hover:bg-green-100' : count > 0 ? 'bg-amber-50 hover:bg-amber-100' : isPast ? 'bg-surface-subtle hover:bg-surface-subtle' : 'bg-white hover:bg-surface-subtle'}
              `}>
              <div className="flex items-center justify-between mb-0.5">
                <span className={`text-xs font-bold leading-none ${isToday ? 'text-amber-600' : isPast ? 'text-text-disabled' : 'text-text-secondary'}`}>
                  {day}
                </span>
                {count > 0 && (
                  <span className="text-[9px] font-bold bg-amber-700 text-white w-4 h-4 flex items-center justify-center flex-shrink-0">{count}</span>
                )}
              </div>
              {count > 0 ? (
                <div className="flex-1 min-w-0 space-y-0.5">
                  {entries.slice(0, 2).map((e, idx) => {
                    const lbl = entryLabel(e)
                    return (
                      <p key={idx} className={`text-[9px] font-semibold leading-tight truncate ${lbl.color}`}>
                        {lbl.icon} {e.topic?.slice(0, 16) || lbl.text}
                      </p>
                    )
                  })}
                  {count > 2 && <p className="text-[9px] text-text-tertiary">+{count - 2} more</p>}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                  <svg className="w-3 h-3 text-text-disabled" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[11px] text-text-tertiary flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-amber-100 border border-amber-300 inline-block"/><span>Planned</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-green-100 border border-green-300 inline-block"/><span>Generated</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-white border border-border inline-block"/><span>Empty</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded border-2 border-amber-400 inline-block"/><span>Today</span></span>
      </div>

      {/* ── Day Overview Modal ─────────────────────────────────────────────── */}
      {viewDay && !editDay && (() => {
        const entries = dayEntries(viewDay)
        const dateObj = new Date(viewDay + 'T12:00:00')
        const label   = dateObj.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })
        return (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ background:'rgba(28,35,33,0.45)' }}
            onClick={e => { if (e.target === e.currentTarget) setViewDay(null) }}>
            <div className="bg-white rounded-3xl  w-full max-w-lg flex flex-col overflow-hidden animate-fade-scale" style={{ maxHeight:'85vh' }}>

              {/* Header */}
              <div className="px-6 py-5 flex-shrink-0" style={{ background:'#f3f5f4', borderBottom:'1px solid rgba(232,217,190,0.5)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-1">Instagram · Schedule</p>
                    <h3 className="font-semibold text-sm text-text">{label}</h3>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      {entries.length === 0 ? 'Nothing planned' : `${entries.length} post${entries.length !== 1 ? 's' : ''} planned`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => { setEditDay(viewDay); setEditIndex(null) }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white transition-all"
                      style={{ background:'#E1306C' }}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                      Add Post
                    </button>
                    <button onClick={() => setViewDay(null)} className="w-8 h-8 rounded-xl flex items-center justify-center text-text-tertiary hover:bg-stone-100 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="overflow-y-auto flex-1 p-5">
                {entries.length === 0 ? (
                  <div className="py-12 text-center">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background:'#E1306C' }}>
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    </div>
                    <p className="font-semibold text-text mb-1">Nothing scheduled</p>
                    <p className="text-sm text-text-secondary mb-4">Add your first post for this day.</p>
                    <button onClick={() => { setEditDay(viewDay); setEditIndex(null) }}
                      className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
                      style={{ background:'#E1306C' }}>
                      + Add Post
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {entries.map((entry, idx) => {
                      const lbl = entryLabel(entry)
                      const statusColors = { planned:'bg-stone-100 text-stone-600', generated:'bg-green-50 text-green-700', pending:'bg-amber-50 text-amber-700' }
                      return (
                        <div key={idx} className="rounded-2xl border overflow-hidden" style={{ borderColor:'rgba(232,217,190,0.6)' }}>
                          <div className="h-1" style={{ background:'#E1306C' }} />
                          <div className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm">{lbl.icon}</span>
                                <span className={`text-xs font-semibold ${lbl.color}`}>{lbl.text}</span>
                                {entry.tone && <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 leading-[1.4] capitalize">{entry.tone}</span>}
                                {entry.aspectRatio && <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 leading-[1.4]">{entry.aspectRatio}</span>}
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <button onClick={() => { setEditDay(viewDay); setEditIndex(idx) }}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-[11px] font-semibold text-text-secondary hover:text-text hover:bg-surface-subtle transition-all">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                  Edit
                                </button>
                                <button onClick={() => handleDeletePost(viewDay, idx)}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                                </button>
                              </div>
                            </div>
                            <p className="text-sm text-text mt-2 leading-relaxed line-clamp-2">{entry.topic || '—'}</p>
                            {entry.notes && <p className="text-xs text-text-tertiary mt-1 line-clamp-1">📝 {entry.notes}</p>}
                            <div className="flex items-center justify-between mt-3">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 leading-[1.4] ${statusColors[entry.status] || 'bg-stone-100 text-stone-500'}`}>
                                {entry.status || 'planned'}
                              </span>
                              <div className="flex items-center gap-2">
                                {entry.publishTime && (
                                  <span className="text-[10px] text-text-tertiary flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                    {entry.publishTime}
                                  </span>
                                )}
                                <span className="text-[10px] text-text-disabled">Post {idx + 1} of {entries.length}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Day Editor Modal ───────────────────────────────────────────────── */}
      {editDay && (
        <DayEditor
          key={`${editDay}-${editIndex}`}
          dateKey={editDay}
          entry={editIndex !== null ? dayEntries(editDay)[editIndex] : null}
          campaigns={state.campaigns || []}
          supabaseUrl={supabaseUrl}
          anonKey={anonKey}
          uploadToStorage={uploadToStorage}
          onSave={handleSave}
          onClear={() => { setEditDay(null); setEditIndex(null) }}
          onDelete={async () => {
            if (editIndex !== null) {
              await handleDeletePost(editDay, editIndex)
            }
            setEditDay(null); setEditIndex(null)
          }}
          onClose={() => { setEditDay(null); setEditIndex(null); }}
        />
      )}
    </div>
  )
}

// ─── Day Editor (inline modal overlay) ─────────────────────────────────────
function DayEditor({ dateKey, entry, campaigns, uploadToStorage, onSave, onDelete, onClose }) {
  // Tab state
  const initTab = entry?.uploadType === 'reel' ? 'reel' : entry?.uploadType === 'upload' ? 'upload' : 'generate'
  const [tab, setTab] = useState(initTab)

  // Publish time
  const [publishTime, setPublishTime] = useState(entry?.publishTime || '10:00')

  // Reel tab state
  const [reelFormat,    setReelFormat]    = useState(entry?.reelFormat    || 'product_reel')
  const [reelDuration,  setReelDuration]  = useState(entry?.reelDuration  || '30s')
  const [reelHook,      setReelHook]      = useState(entry?.reelHook      || '')
  const [reelBrief,     setReelBrief]     = useState(entry?.reelBrief     || '')
  const [reelMusic,     setReelMusic]     = useState(entry?.reelMusic     || '')
  const [reelCta,       setReelCta]       = useState(entry?.reelCta       || '')

  // Generate tab state
  const [topic,       setTopic]       = useState(entry?.topic || '')
  const [tone,        setTone]        = useState(entry?.tone || 'professional')
  const [visualMode,  setVisualMode]  = useState(entry?.visualMode ?? null)
  const [style,       setStyle]       = useState(entry?.style || 'photorealistic')
  const [customType,  setCustomType]  = useState(entry?.customType || 'product_showcase')
  const [aspectRatio, setAspectRatio] = useState(entry?.aspectRatio || '1:1')
  const [campaignId,  setCampaignId]  = useState(entry?.campaignId || '')
  const [notes,       setNotes]       = useState(entry?.notes || '')
  const [references,  setReferences]  = useState(entry?.referenceImageUrls || []) // image-to-image guides
  const [pickingRefs, setPickingRefs] = useState(false)

  // Upload tab state
  const [uploadTopic,    setUploadTopic]    = useState(entry?.uploadType === 'upload' ? (entry?.topic || '') : '')
  const [uploadNotes,    setUploadNotes]    = useState(entry?.uploadType === 'upload' ? (entry?.notes || '') : '')
  const [uploadAR,       setUploadAR]       = useState(entry?.aspectRatio || '4:5')
  const [uploadCampaign, setUploadCampaign] = useState(entry?.campaignId || '')
  const [files,          setFiles]          = useState([])           // File objects (new)
  const [existingUrls,   setExistingUrls]   = useState(entry?.uploadedImageUrls || []) // already uploaded
  const [uploading,      setUploading]      = useState(false)
  const [uploadError,    setUploadError]    = useState('')

  const [confirmDelete, setConfirmDelete] = useState(false)

  const [y, m, d] = dateKey.split('-').map(Number)
  const dateLabel  = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  // ── Generate save ──────────────────────────────────────────────────────────
  function handleSaveGenerate() {
    if (!topic.trim()) return
    onSave({ topic: topic.trim(), tone, visualMode, style, customType, aspectRatio, campaignId, notes: notes.trim(), uploadType: 'generate', uploadedImageUrls: null, referenceImageUrls: references, publishTime, updatedAt: new Date().toISOString() })
  }

  // ── Upload save ────────────────────────────────────────────────────────────
  async function handleSaveUpload() {
    if (!uploadTopic.trim()) return
    if (files.length === 0 && existingUrls.length === 0) { setUploadError('Please select at least one image.'); return }
    setUploading(true); setUploadError('')
    try {
      let allUrls = [...existingUrls]
      // Upload new files to Supabase Storage
      for (let i = 0; i < files.length; i++) {
        const result = await uploadToStorage(files[i], dateKey, existingUrls.length + i)
        if (result.error) { setUploadError(`Upload failed: ${result.error}`); setUploading(false); return }
        allUrls.push(result.url)
      }
      onSave({
        topic:              uploadTopic.trim(),
        tone:               'professional',
        visualMode:         null,
        style:              null,
        customType:         null,
        aspectRatio:        uploadAR,
        campaignId:         uploadCampaign,
        notes:              uploadNotes.trim(),
        uploadType:         'upload',
        uploadedImageUrls:  allUrls,
        publishTime,
        updatedAt:          new Date().toISOString(),
      })
    } catch (err) {
      setUploadError(`Unexpected error: ${err.message}`)
    } finally {
      setUploading(false)
    }
  }

  function handleSaveReel() {
    if (!reelBrief.trim()) return
    onSave({
      topic:            reelBrief.trim(),
      tone:             'professional',
      visualMode:       null,
      style:            null,
      customType:       null,
      aspectRatio:      '9:16',
      campaignId:       '',
      notes:            reelHook ? `Hook: ${reelHook}` : '',
      uploadType:       'reel',
      uploadedImageUrls: null,
      reelFormat, reelDuration, reelHook, reelBrief, reelMusic, reelCta,
      publishTime,
      updatedAt:        new Date().toISOString(),
    })
  }

  function handleFileChange(e) {
    const selected = Array.from(e.target.files).filter(f => f.type.startsWith('image/'))
    const total = existingUrls.length + files.length + selected.length
    if (total > 10) { setUploadError('Maximum 10 images per post.'); return }
    setFiles(prev => [...prev, ...selected])
    setUploadError('')
  }

  function removeNewFile(idx) { setFiles(prev => prev.filter((_, i) => i !== idx)) }
  function removeExistingUrl(idx) { setExistingUrls(prev => prev.filter((_, i) => i !== idx)) }

  const totalImages = existingUrls.length + files.length
  const isCarousel  = totalImages > 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)', padding: '24px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>

      <div className="bg-white rounded-3xl  flex flex-col overflow-hidden"
        style={{ width: '100%', maxWidth: '860px', height: '90vh' }}>

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between px-8 py-6 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-bold text-text text-base tracking-tight leading-tight">Plan post for</h2>
            <p className="text-base text-amber-600 font-semibold mt-0.5">{dateLabel}</p>
            <p className="text-xs text-text-tertiary mt-1">n8n will process this post automatically at 8am on this date</p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-text-tertiary hover:bg-stone-100 hover:text-text transition-colors mt-0.5 flex-shrink-0 ml-4">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <div className="flex px-8 pt-5 gap-1 flex-shrink-0">
          <button onClick={() => setTab('generate')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === 'generate'
              ? 'text-white' : 'text-text-secondary bg-surface-subtle hover:bg-stone-100'}`}
            style={tab === 'generate' ? { background: '#E1306C' } : {}}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            Generate
          </button>
          <button onClick={() => setTab('upload')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === 'upload'
              ? 'text-white' : 'text-text-secondary bg-surface-subtle hover:bg-stone-100'}`}
            style={tab === 'upload' ? { background: '#4c5e61' } : {}}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload Images
          </button>
          <button onClick={() => setTab('reel')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === 'reel'
              ? 'text-white' : 'text-text-secondary bg-surface-subtle hover:bg-stone-100'}`}
            style={tab === 'reel' ? { background: '#E1306C' } : {}}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Reel
          </button>
        </div>

        {/* ── Publish Time Picker ────────────────────────────────────────── */}
        <div className="px-8 py-4 flex-shrink-0 border-b border-border" style={{ background:'#f3f5f4' }}>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span className="text-sm font-bold text-text">Publish Time</span>
              <span className="text-[10px] text-text-tertiary">· KSA time</span>
            </div>
            {/* Manual time input */}
            <input type="time" value={publishTime} onChange={e => setPublishTime(e.target.value)}
              className="text-sm font-semibold border-2 border-amber-300 rounded-xl px-3 py-2 bg-white text-text focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer" />
            {/* Quick-pick slots */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { label: '8 AM',   val: '08:00' },
                { label: '10 AM',  val: '10:00' },
                { label: '12 PM',  val: '12:00' },
                { label: '1 PM',   val: '13:00' },
                { label: '3 PM',   val: '15:00' },
                { label: '6 PM',   val: '18:00' },
                { label: '7 PM',   val: '19:00' },
                { label: '9 PM',   val: '21:00' },
              ].map(slot => (
                <button key={slot.val} type="button"
                  onClick={() => setPublishTime(slot.val)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${publishTime === slot.val ? 'bg-amber-500 text-white border-amber-500 shadow-sm' : 'bg-white text-text-secondary border-border hover:border-amber-300 hover:text-amber-700'}`}>
                  {slot.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-text-tertiary mt-2">n8n will post this to Instagram at the selected time on the scheduled date.</p>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">

          {/* ════ GENERATE TAB ════ */}
          {tab === 'generate' && (<>

            <div>
              <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Topic / Brief <span className="text-red-400 normal-case font-normal">required</span></p>
              <Textarea placeholder="e.g. Showcase the Stellar pendant collection, focus on bedroom ambience and warm tones..." value={topic} onChange={e => setTopic(e.target.value)} rows={4} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Tone</p>
                <select value={tone} onChange={e => setTone(e.target.value)} className="w-full rounded-xl border border-border bg-white text-text text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer">
                  {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Campaign</p>
                <select value={campaignId} onChange={e => setCampaignId(e.target.value)} className="w-full rounded-xl border border-border bg-white text-text text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer">
                  <option value="">No campaign</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Visual / Image Type</p>
              <VisualSelector mode={visualMode} onModeChange={setVisualMode} selectedStyle={style} onStyleChange={setStyle} customType={customType} onCustomTypeChange={setCustomType} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">Format / Aspect Ratio</p>
                <span className="text-[11px] text-text-tertiary font-medium">{ASPECT_RATIOS.find(r => r.value === aspectRatio)?.dims}</span>
              </div>
              <AspectRatioSelector value={aspectRatio} onChange={setAspectRatio} />
            </div>

            <div>
              <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Additional Notes <span className="normal-case font-normal text-text-tertiary">(optional)</span></p>
              <Textarea placeholder="Hashtag ideas, references, things to avoid, specific products to mention..." value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>

            {/* Reference images — guide the AI image generation (image-to-image) */}
            <div>
              <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Reference Images <span className="normal-case font-normal text-text-tertiary">(optional — guides the generated visual)</span></p>
              <div className="flex items-center gap-2 flex-wrap">
                {references.map(url => (
                  <div key={url} className="relative w-14 h-14 rounded-lg overflow-hidden border border-border group">
                    <PostImage src={url} alt="Reference" className="w-full h-full object-cover" />
                    <button onClick={() => setReferences(refs => refs.filter(u => u !== url))}
                      className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="Remove">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                ))}
                <button onClick={() => setPickingRefs(true)}
                  className="w-14 h-14 rounded-lg border-2 border-dashed border-border hover:border-amber-400 hover:bg-surface-subtle flex items-center justify-center text-text-tertiary transition-colors" title="Add references">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                </button>
              </div>
            </div>

            <div className="rounded-2xl bg-stone-50 border border-stone-200 px-5 py-4">
              <p className="text-[11px] font-bold text-text-secondary uppercase tracking-wider mb-3">Sent to workflow on this date</p>
              <div className="space-y-1.5">
                {[
                  { label: 'scheduled_date', value: dateKey },
                  { label: 'topic',          value: topic.trim() || '—' },
                  { label: 'tone',           value: tone },
                  { label: 'visual_mode',    value: visualMode ?? 'auto' },
                  { label: 'aspect_ratio',   value: aspectRatio },
                  { label: 'upload_type',    value: 'generate' },
                  { label: 'reference_images', value: references.length ? `${references.length} attached` : '—' },
                  { label: 'notes',          value: notes.trim() || '—' },
                ].map(row => (
                  <div key={row.label} className="flex items-center gap-3 text-xs">
                    <span className="font-mono text-text-tertiary w-32 flex-shrink-0">{row.label}</span>
                    <span className="text-text truncate">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>

          </>)}

          {/* ════ UPLOAD TAB ════ */}
          {tab === 'upload' && (<>

            {/* Info banner */}
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3">
              <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <div className="text-xs text-amber-700 leading-relaxed">
                <p className="font-semibold mb-0.5">Caption-only generation</p>
                <p>Upload your images — n8n will skip image generation and only write the caption. 1 image = single post. 2–10 images = carousel post.</p>
              </div>
            </div>

            {/* Topic */}
            <div>
              <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Topic / Brief <span className="text-red-400 normal-case font-normal">required</span></p>
              <Textarea placeholder="Describe what these images show — e.g. New Stellar pendant collection in a luxury bedroom setting..." value={uploadTopic} onChange={e => setUploadTopic(e.target.value)} rows={3} />
            </div>

            {/* Image uploader */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">Images {totalImages > 0 && <span className="normal-case font-normal text-text-tertiary">({totalImages}/10{isCarousel ? ' · Carousel' : ' · Single post'})</span>}</p>
              </div>

              {/* Existing uploaded images */}
              {existingUrls.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {existingUrls.map((url, i) => (
                    <div key={i} className="relative group w-20 h-20 rounded-xl overflow-hidden border border-border">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      <button onClick={() => removeExistingUrl(i)}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                      {i === 0 && <span className="absolute bottom-1 left-1 text-[9px] bg-black/60 text-white px-1 rounded font-bold">1st</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* New file previews */}
              {files.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {files.map((file, i) => (
                    <div key={i} className="relative group w-20 h-20 rounded-xl overflow-hidden border border-amber-300">
                      <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
                      <button onClick={() => removeNewFile(i)}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                      <span className="absolute bottom-1 right-1 text-[9px] bg-amber-500 text-white px-1 rounded font-bold">NEW</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Drop zone */}
              {totalImages < 10 && (
                <label className="flex flex-col items-center justify-center gap-2 w-full rounded-2xl border-2 border-dashed border-stone-300 hover:border-amber-400 bg-stone-50 hover:bg-amber-50/30 transition-all cursor-pointer py-8 px-4">
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
                  <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                    <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  </div>
                  <p className="text-sm font-medium text-text-secondary text-center">Click to select images<br/><span className="text-xs text-text-tertiary font-normal">JPG, PNG, WebP · max 10 images</span></p>
                </label>
              )}
              {uploadError && <p className="text-xs text-red-500 mt-2">{uploadError}</p>}
            </div>

            {/* Aspect ratio */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">Format / Aspect Ratio</p>
                <span className="text-[11px] text-text-tertiary font-medium">{ASPECT_RATIOS.find(r => r.value === uploadAR)?.dims}</span>
              </div>
              <AspectRatioSelector value={uploadAR} onChange={setUploadAR} />
            </div>

            {/* Tone + Campaign row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Campaign</p>
                <select value={uploadCampaign} onChange={e => setUploadCampaign(e.target.value)} className="w-full rounded-xl border border-border bg-white text-text text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer">
                  <option value="">No campaign</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Additional Notes <span className="normal-case font-normal text-text-tertiary">(opt.)</span></p>
                <input value={uploadNotes} onChange={e => setUploadNotes(e.target.value)} placeholder="e.g. use warm tone" className="w-full rounded-xl border border-border bg-white text-text text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
            </div>

            {/* Payload preview */}
            {uploadTopic && (
              <div className="rounded-2xl bg-stone-50 border border-stone-200 px-5 py-4">
                <p className="text-[11px] font-bold text-text-secondary uppercase tracking-wider mb-3">Sent to workflow on this date</p>
                <div className="space-y-1.5">
                  {[
                    { label: 'scheduled_date',      value: dateKey },
                    { label: 'topic',               value: uploadTopic.trim() },
                    { label: 'upload_type',         value: 'upload' },
                    { label: 'uploaded_image_urls', value: totalImages > 0 ? `${totalImages} image${totalImages > 1 ? 's' : ''} (${isCarousel ? 'carousel' : 'single'})` : '—' },
                    { label: 'aspect_ratio',        value: uploadAR },
                  ].map(row => (
                    <div key={row.label} className="flex items-center gap-3 text-xs">
                      <span className="font-mono text-text-tertiary w-36 flex-shrink-0">{row.label}</span>
                      <span className="text-text truncate">{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </>)}

          {/* ════ REEL TAB ════ */}
          {tab === 'reel' && (<>

            <div className="rounded-xl border border-purple-100 bg-purple-50/50 px-4 py-3 flex items-start gap-3">
              <svg className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <p className="text-xs text-purple-700 leading-relaxed">Plan a <strong>Reel brief</strong> for this day. n8n will receive the brief and can trigger your video production workflow.</p>
            </div>

            {/* Reel Format */}
            <div>
              <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Reel Format</p>
              <div className="grid grid-cols-2 gap-1.5">
                {REEL_FORMATS.map(f => (
                  <button key={f.value} onClick={() => setReelFormat(f.value)}
                    className={`text-left rounded-xl border px-3 py-2 transition-all ${reelFormat === f.value ? 'border-purple-400 bg-purple-50' : 'border-border bg-white hover:border-border-strong'}`}>
                    <p className={`text-xs font-semibold flex items-center gap-1 ${reelFormat === f.value ? 'text-purple-700' : 'text-text'}`}>
                      <span>{f.icon}</span>{f.label}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div>
              <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Duration</p>
              <div className="flex gap-2 flex-wrap">
                {REEL_DURATIONS.map(d => (
                  <button key={d.value} onClick={() => setReelDuration(d.value)}
                    className={`px-4 py-2 rounded-xl border text-xs font-semibold transition-all ${reelDuration === d.value ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-border text-text-secondary hover:border-border-strong'}`}>
                    {d.label} <span className="font-normal opacity-60">· {d.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Opening Hook */}
            <div>
              <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Opening Hook</p>
              <input value={reelHook} onChange={e => setReelHook(e.target.value)}
                placeholder="First 3 seconds that stop the scroll…"
                className="w-full text-sm border border-border rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-300" />
            </div>

            {/* Brief */}
            <div>
              <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Content Brief <span className="text-red-400 normal-case font-normal">required</span></p>
              <Textarea placeholder={"Describe the reel:\n• Visuals/clips to use\n• Key message\n• Text overlays or voiceover notes"}
                value={reelBrief} onChange={e => setReelBrief(e.target.value)} rows={4} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Music / Sound</p>
                <input value={reelMusic} onChange={e => setReelMusic(e.target.value)}
                  placeholder="e.g. Cinematic, no lyrics"
                  className="w-full text-sm border border-border rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-300" />
              </div>
              <div>
                <p className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Call to Action</p>
                <input value={reelCta} onChange={e => setReelCta(e.target.value)}
                  placeholder="e.g. DM us, link in bio"
                  className="w-full text-sm border border-border rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-300" />
              </div>
            </div>

            {reelBrief.trim() && (
              <div className="rounded-2xl bg-stone-50 border border-stone-200 px-5 py-4">
                <p className="text-[11px] font-bold text-text-secondary uppercase tracking-wider mb-3">Sent to workflow on this date</p>
                <div className="space-y-1.5">
                  {[
                    { label: 'scheduled_date', value: dateKey },
                    { label: 'upload_type',    value: 'reel' },
                    { label: 'reel_format',    value: reelFormat },
                    { label: 'reel_duration',  value: reelDuration },
                    { label: 'hook',           value: reelHook || '—' },
                    { label: 'brief',          value: reelBrief.trim() },
                    { label: 'music',          value: reelMusic || '—' },
                    { label: 'cta',            value: reelCta || '—' },
                  ].map(row => (
                    <div key={row.label} className="flex items-center gap-3 text-xs">
                      <span className="font-mono text-text-tertiary w-32 flex-shrink-0">{row.label}</span>
                      <span className="text-text truncate">{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </>)}

          {/* ── Delete confirmation (both tabs) ─────────────────────────── */}
          {confirmDelete && (
            <div className="rounded-2xl bg-red-50 border border-red-200 px-5 py-4">
              <p className="text-sm font-semibold text-red-700 mb-1">Delete this scheduled post?</p>
              <p className="text-xs text-red-600 mb-3">This will remove it from Supabase permanently.</p>
              <div className="flex gap-2">
                <button onClick={() => { setConfirmDelete(false); onDelete() }} className="flex-1 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors">Yes, delete it</button>
                <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2 rounded-xl border border-border text-sm font-medium text-text-secondary hover:bg-surface-subtle transition-colors">Cancel</button>
              </div>
            </div>
          )}

        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="px-8 py-5 border-t border-border bg-stone-50/60 flex gap-3 flex-shrink-0">
          {entry && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
              Delete
            </button>
          )}
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-text-secondary hover:bg-surface-subtle transition-colors">Cancel</button>

          {tab === 'generate' && (
            <button onClick={handleSaveGenerate} disabled={!topic.trim()}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all active:scale-95"
              style={{ background: topic.trim() ? '#E1306C' : '#9ca3af' }}>
              Save Post Plan
            </button>
          )}

          {tab === 'upload' && (
            <button onClick={handleSaveUpload} disabled={!uploadTopic.trim() || totalImages === 0 || uploading}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{ background: (!uploadTopic.trim() || totalImages === 0 || uploading) ? '#9ca3af' : '#4c5e61' }}>
              {uploading ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Uploading…</> : 'Save & Upload Images'}
            </button>
          )}

          {tab === 'reel' && (
            <button onClick={handleSaveReel} disabled={!reelBrief.trim()}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all active:scale-95"
              style={{ background: reelBrief.trim() ? '#E1306C' : '#9ca3af' }}>
              Save Reel Plan
            </button>
          )}
        </div>
      </div>

      {pickingRefs && (
        <ReferencePicker value={references}
          onSave={urls => { setReferences(urls); setPickingRefs(false) }}
          onClose={() => setPickingRefs(false)} />
      )}
    </div>
  )
}

// ─── Post Detail Modal ─────────────────────────────────────────────────────
function PostDetail({ post, state, webhookUrl, regenWebhookUrl, supabaseUrl, anonKey, onClose, onStatusChange, onImageUpdated, onCaptionUpdated, onDelete }) {
  const { activeWorkspaceId } = useAuth()
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
      setRegenError(post._fromSupabase
        ? 'Configure the Schedule Regen webhook in Settings → Integrations.'
        : 'Configure the Instagram webhook in Settings → Integrations.')
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

      <div className="bg-white rounded-3xl  overflow-hidden flex flex-col"
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
                  DESIGN-SYSTEM EXCEPTION — see the note in LinkedInPage: this
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
          context={{ topic: post.topic || '', angle: post.angle || '', tone: post.tone || '', objective: post.objective || '', cta: post.cta || '', instructions: buildInstructionsString(state.brandProfile) || '' }}
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
      await updatePostStatus(post.id, newStatus)
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
          <p className="text-sm text-text-secondary mb-4">Generate your first AI-powered post for Arak Lighting.</p>
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

// ─── Reels Panel ───────────────────────────────────────────────────────────
const REEL_FORMATS = [
  { value: 'product_reel',   label: 'Product Showcase',   icon: '💡', desc: 'Feature a lighting fixture with smooth transitions' },
  { value: 'project_tour',   label: 'Project Walkthrough', icon: '🏛️', desc: 'Tour a completed lighting installation' },
  { value: 'behind_scenes',  label: 'Behind the Scenes',  icon: '🎥', desc: 'Team, installation process, factory footage' },
  { value: 'tip_tutorial',   label: 'Tips & Tutorial',    icon: '📚', desc: 'How-to guide, lighting advice, quick tips' },
  { value: 'brand_story',    label: 'Brand Story',        icon: '✨', desc: 'Legacy, milestones, values — storytelling reel' },
  { value: 'event_recap',    label: 'Event / Expo Recap', icon: '🎪', desc: 'Highlight reel from an expo or event' },
]

const REEL_DURATIONS = [
  { value: '5s',  label: '5 sec',  desc: 'Test / draft' },
  { value: '8s',  label: '8 sec',  desc: 'Quick test' },
  { value: '15s', label: '15 sec', desc: 'Quick hook' },
  { value: '30s', label: '30 sec', desc: 'Sweet spot' },
  { value: '60s', label: '60 sec', desc: 'Full story' },
  { value: '90s', label: '90 sec', desc: 'Deep dive' },
]

const REEL_HOOKS = [
  'Did you know most lighting projects fail because of THIS one mistake?',
  'Transforming a hotel lobby in just 48 hours 👀',
  'The lighting fixture that changed everything →',
  '45 years of illuminating Saudi Arabia — here\'s our story',
  'Watch this space go from dark to iconic ✨',
  'The secret behind award-winning architectural lighting',
]

const STATUS_COLORS_REEL = {
  planned:   'bg-stone-100 text-stone-600',
  generating:'bg-purple-50 text-purple-600',
  filming:   'bg-blue-50 text-blue-600',
  editing:   'bg-amber-50 text-amber-600',
  ready:     'bg-green-50 text-green-700',
  published: 'bg-green-100 text-green-800',
  error:     'bg-red-50 text-red-600',
}

function ReelsPanel({ state, dispatch }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const webhookUrl = state.webhooks?.instagramReels || ''
  const [subView,    setSubView]    = useState('planner')
  const [format,     setFormat]     = useState('product_reel')
  const [duration,   setDuration]   = useState('5s')
  const [brief,      setBrief]      = useState('')
  const [hook,       setHook]       = useState('')
  const [showHooks,  setShowHooks]  = useState(false)
  const [musicNote,  setMusicNote]  = useState('')
  const [cta,        setCta]        = useState('')
  const [tone,       setTone]       = useState('professional')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [approval,   setApproval]   = useState(null) // reel pending approval

  const [reels, setReels] = useState(() => {
    try { return JSON.parse(localStorage.getItem('arak_reels_ig') || '[]') } catch { return [] }
  })

  // ── Generate reel via n8n webhook ────────────────────────────────────────
  async function handleGenerate() {
    if (!brief.trim()) { setError('Please enter a content brief.'); return }
    if (!webhookUrl)   { setError('No Reels Webhook configured. Go to Settings → Integrations → Instagram Reels Webhook.'); return }

    const supabaseUrl  = SUPABASE_URL
    const supabaseKey  = accessToken || SUPABASE_ANON_KEY
    if (!activeWorkspaceId) {
      setError('No active workspace. Try signing out and back in.')
      return
    }

    setError(''); setLoading(true); setApproval(null)

    // ── Fire webhook without waiting for response (avoids browser timeout) ──
    // The workflow takes 2-4 min — browser fetch times out before it finishes.
    // Instead: fire-and-forget, then poll Supabase every 8s for the new row.
    const firedAt = Date.now()
    try {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: activeWorkspaceId, // NOTE: n8n's workflow still needs
          // updating to read this and stamp it on the row it inserts — until
          // then, every reel lands in the legacy Arak workspace regardless of
          // who triggered it, since n8n authenticates with the shared anon key.
          reelFormat:   format,
          reelDuration: duration,
          reelBrief:    brief.trim(),
          reelHook:     hook.trim(),
          reelMusic:    musicNote.trim(),
          reelCta:      cta.trim(),
          tone,
          instructions: buildInstructionsString(state.brandProfile, state.instagramInstructions) || '',
        }),
      }).catch(() => {}) // swallow network errors — we poll instead
    } catch {
      // Building or firing the request can throw synchronously (a malformed
      // URL, a blocked request). Polling is what actually reports success, so
      // there is nothing useful to do here but let it run.
    }

    // ── Poll Supabase for the new row (max 6 min) ─────────────────────────
    const MAX_WAIT   = 6 * 60 * 1000  // 6 minutes
    const POLL_MS    = 8000            // every 8 seconds

    const poll = async () => {
      try {
        const r = await fetch(
          `${supabaseUrl}/rest/v1/instagram_reels?select=*&order=created_at.desc&limit=1`,
          { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${supabaseKey}` } }
        )
        const rows = await r.json()
        const row  = rows?.[0]

        // Check if this row was created after we fired the webhook
        if (row?.video_url && row?.status === 'ready' &&
            new Date(row.created_at).getTime() > firedAt) {
          setLoading(false)
          setApproval({
            video_url:       row.video_url,
            cover_image_url: row.cover_image_url || '',
            caption:         row.caption || '',
            hashtags:        row.hashtags || '',
            motion_prompt:   row.motion_prompt || '',
            reel_strategy:   '',
            format, duration, brief, hook, musicNote, cta, tone,
          })
          return // done
        }
      } catch {
        // A failed poll is not a failed generation — the row may simply not
        // exist yet, or one request timed out. Fall through and try again;
        // the wall-clock check below is what eventually gives up.
      }

      // Keep polling or give up
      if (Date.now() - firedAt < MAX_WAIT) {
        setTimeout(poll, POLL_MS)
      } else {
        setLoading(false)
        setError('Generation timed out after 6 minutes. Check n8n for errors, or try again.')
      }
    }

    // Start polling after 30s (minimum time for workflow to complete)
    setTimeout(poll, 30000)
  }

  // ── Approve — save to library ─────────────────────────────────────────────
  function handleApprove(finalData) {
    const newReel = {
      id: uid(), format, duration,
      brief:      finalData.brief      || brief,
      hook, musicNote, cta, tone,
      status:     'ready',
      videoUrl:   finalData.video_url,
      coverUrl:   finalData.cover_image_url,
      caption:    finalData.caption,
      hashtags:   finalData.hashtags,
      createdAt:  new Date().toISOString(),
    }
    const updated = [newReel, ...reels]
    setReels(updated)
    localStorage.setItem('arak_reels_ig', JSON.stringify(updated))
    dispatch(actions.addNotification({ id: newReel.id, message: `Reel approved and saved to library.`, createdAt: new Date().toISOString() }))
    setApproval(null)
    setBrief(''); setHook(''); setMusicNote(''); setCta('')
    setSubView('library')
  }

  // ── Discard ────────────────────────────────────────────────────────────────
  function handleDiscard() {
    setApproval(null)
  }

  // ── Save as brief only (no generation) ───────────────────────────────────
  function saveBrief() {
    if (!brief.trim()) return
    const newReel = {
      id: uid(), format, duration, brief, hook, musicNote, cta, tone,
      status: 'planned', videoUrl: '', coverUrl: '', caption: '', hashtags: '',
      createdAt: new Date().toISOString(),
    }
    const updated = [newReel, ...reels]
    setReels(updated)
    localStorage.setItem('arak_reels_ig', JSON.stringify(updated))
    dispatch(actions.addNotification({ id: newReel.id, message: `Reel brief saved.`, createdAt: new Date().toISOString() }))
    setBrief(''); setHook(''); setMusicNote(''); setCta('')
    setSubView('library')
  }

  function deleteReel(id) {
    const updated = reels.filter(r => r.id !== id)
    setReels(updated)
    localStorage.setItem('arak_reels_ig', JSON.stringify(updated))
  }

  function cycleStatus(id) {
    const cycle = { planned:'filming', filming:'editing', editing:'ready', ready:'published', published:'planned', error:'planned' }
    const updated = reels.map(r => r.id === id ? { ...r, status: cycle[r.status] || 'planned' } : r)
    setReels(updated)
    localStorage.setItem('arak_reels_ig', JSON.stringify(updated))
  }


  // ── Show approval screen ───────────────────────────────────────────────────
  if (approval) {
    return (
      <ReelApprovalScreen
        data={approval}
        onApprove={handleApprove}
        onDiscard={handleDiscard}
      />
    )
  }

  return (
    <div className="space-y-4 max-w-6xl">

      {/* Header strip */}
      <div className="rounded-2xl overflow-hidden border border-border"
        style={{ background: '#1c2321' }}>
        <div className="p-5 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
              style={{ background: '#E1306C' }}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            </div>
            <div>
              <p className="font-semibold text-white text-sm">Reels Studio</p>
              <p className="text-xs text-white/60">
                {webhookUrl ? 'n8n connected · AI generation enabled' : 'Configure webhook to enable AI generation'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-white/10 rounded-xl p-1">
            {[{ key:'planner', label:'+ New Reel' }, { key:'library', label:`Library (${reels.length})` }].map(v => (
              <button key={v.key} onClick={() => setSubView(v.key)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${subView === v.key ? 'bg-white text-stone-900' : 'text-white/70 hover:text-white'}`}>
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="flex gap-4 px-5 pb-4">
          {[
            { label:'Total',      val: reels.length },
            { label:'Planned',    val: reels.filter(r => r.status === 'planned').length },
            { label:'Ready',      val: reels.filter(r => r.status === 'ready').length },
            { label:'Published',  val: reels.filter(r => r.status === 'published').length },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className="text-xl font-bold text-white">{s.val}</p>
              <p className="text-[10px] text-white/50 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Webhook not configured warning */}
      {!webhookUrl && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3">
          <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div>
            <p className="text-xs font-semibold text-amber-700">Reels webhook not configured</p>
            <p className="text-xs text-amber-600 mt-0.5">Go to <strong>Settings → Integrations</strong> and paste your n8n Instagram Reels Webhook URL to enable AI video generation. You can still save briefs manually.</p>
          </div>
        </div>
      )}

      {/* ── Planner ── */}
      {subView === 'planner' && (
        <div className="space-y-4">

          {/* Format picker */}
          <Card className="p-5 space-y-3">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Reel Format</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {REEL_FORMATS.map(f => (
                <button key={f.value} onClick={() => setFormat(f.value)}
                  className={`relative text-left rounded-xl border px-3 py-2.5 transition-all ${format === f.value ? 'border-pink-400 bg-pink-50 shadow-sm ring-1 ring-pink-300' : 'border-border bg-white hover:border-border-strong hover:bg-surface-subtle'}`}>
                  {format === f.value && (
                    <span className="absolute top-2 right-2 w-4 h-4 flex items-center justify-center"
                      style={{ background:'#E1306C' }}>
                      <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                    </span>
                  )}
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-base leading-none">{f.icon}</span>
                    <span className={`text-xs font-semibold ${format === f.value ? 'text-pink-700' : 'text-text'}`}>{f.label}</span>
                  </div>
                  <p className="text-[11px] text-text-tertiary leading-tight">{f.desc}</p>
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-5 space-y-4">

            {/* Duration */}
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-2">Duration</p>
              <div className="flex gap-2 flex-wrap">
                {REEL_DURATIONS.map(d => (
                  <button key={d.value} onClick={() => setDuration(d.value)}
                    className={`relative flex flex-col items-center px-4 py-2 rounded-xl border text-xs font-medium transition-all ${duration === d.value ? 'border-pink-400 bg-pink-50 text-pink-700' : 'border-border text-text-secondary hover:border-border-strong'}`}>
                    {(d.value === '5s' || d.value === '8s') && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold px-1.5 py-0.5 leading-[1.4] bg-amber-400 text-amber-900 whitespace-nowrap">test</span>
                    )}
                    <span className="font-bold">{d.label}</span>
                    <span className="text-[10px] opacity-70">{d.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Tone */}
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-2">Tone</p>
              <div className="flex flex-wrap gap-1.5">
                {['professional','inspirational','educational','casual','promotional'].map(t => (
                  <button key={t} onClick={() => setTone(t)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-medium capitalize transition-all ${tone === t ? 'border-pink-400 bg-pink-50 text-pink-700' : 'border-border text-text-secondary hover:border-border-strong'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Hook */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-semibold text-text-secondary">Opening Hook</p>
                <button onClick={() => setShowHooks(v => !v)}
                  className="text-[11px] text-pink-600 hover:text-pink-700 font-medium flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                  {showHooks ? 'Hide' : 'Inspiration'}
                </button>
              </div>
              <input value={hook} onChange={e => setHook(e.target.value)}
                placeholder="First 3 seconds that stop the scroll…"
                className="w-full text-sm border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-300" />
              {showHooks && (
                <div className="mt-2 space-y-1">
                  {REEL_HOOKS.map(h => (
                    <button key={h} onClick={() => { setHook(h); setShowHooks(false) }}
                      className="w-full text-left text-xs px-3 py-2 rounded-xl border border-border hover:border-pink-300 hover:bg-pink-50 hover:text-pink-700 transition-all">
                      {h}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Brief */}
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">
                Content Brief <span className="text-red-400">*</span>
              </p>
              <Textarea placeholder={`Describe the reel:\n• What visuals/clips to use\n• Key message to convey\n• Scenes or moments to capture`}
                value={brief} onChange={e => { setBrief(e.target.value); setError('') }} rows={4} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold text-text-secondary mb-1.5">Music / Sound</p>
                <input value={musicNote} onChange={e => setMusicNote(e.target.value)}
                  placeholder="e.g. Cinematic, no lyrics"
                  className="w-full text-sm border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-300" />
              </div>
              <div>
                <p className="text-xs font-semibold text-text-secondary mb-1.5">Call to Action</p>
                <input value={cta} onChange={e => setCta(e.target.value)}
                  placeholder="e.g. DM us, visit arak-sa.com"
                  className="w-full text-sm border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-300" />
              </div>
            </div>

            {/* Brand instructions indicator */}
            <div className={`rounded-xl px-4 py-3 border ${state.brandProfile && !isBrandProfileEmpty(state.brandProfile) ? 'bg-purple-50 border-purple-100' : 'bg-stone-50 border-stone-200'}`}>
              {state.brandProfile && !isBrandProfileEmpty(state.brandProfile)
                ? <p className="text-xs text-purple-700"><span className="font-semibold">✓ Brand Brain profile included</span> — Claude will use your saved voice and guidelines.</p>
                : <p className="text-xs text-text-tertiary">No Brand Brain profile set yet. Set it once in Brand Brain to give every platform — including Reels — your brand voice.</p>}
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 flex items-start gap-2">
                <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              {/* Save Brief only */}
              <button onClick={saveBrief} disabled={!brief.trim() || loading}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:bg-surface-subtle disabled:opacity-40 transition-all">
                Save Brief
              </button>

              {/* Generate via webhook */}
              <button onClick={handleGenerate} disabled={!brief.trim() || loading}
                className="flex-[2] py-2.5 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ background: (loading || !brief.trim()) ? '#9ca3af' : '#E1306C' }}>
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Generating Reel… (2–3 min)
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    {webhookUrl ? 'Generate Reel' : 'Generate (webhook needed)'}
                  </>
                )}
              </button>
            </div>

            {/* Loading state info */}
            {loading && (
              <div className="rounded-xl bg-purple-50 border border-purple-100 px-4 py-3 text-xs text-purple-700 space-y-1">
                <p className="font-semibold flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                  Generating reel — polling for result…
                </p>
                <p>1. Webhook fired → Claude is writing your script</p>
                <p>2. FLUX will generate the cover image</p>
                <p>3. Wan 2.5 I2V will animate the image into video</p>
                <p>4. Checking Supabase every 8s for the completed reel</p>
                <p className="text-purple-500 mt-1">This takes 2–4 minutes. You can keep this tab open.</p>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Library ── */}
      {subView === 'library' && (
        <div className="space-y-3">
          {reels.length === 0 ? (
            <Card className="py-16 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background:'#E1306C' }}>
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-text">No reels yet</p>
                <p className="text-xs text-text-secondary mt-0.5">Generate your first reel or save a brief</p>
              </div>
              <button onClick={() => setSubView('planner')}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background:'#E1306C' }}>
                Create a Reel
              </button>
            </Card>
          ) : (
            reels.map(reel => {
              const fmt = REEL_FORMATS.find(f => f.value === reel.format)
              return (
                <Card key={reel.id} className="overflow-hidden">
                  <div className="h-0.5" style={{ background:'#E1306C' }} />
                  <div className="p-4">
                    <div className="flex items-start gap-3">

                      {/* Video thumbnail or placeholder */}
                      {reel.coverUrl ? (
                        <img src={reel.coverUrl} alt="cover"
                          className="w-16 h-24 object-cover rounded-xl flex-shrink-0 border border-border" />
                      ) : reel.videoUrl ? (
                        <video src={reel.videoUrl} className="w-16 h-24 object-cover rounded-xl flex-shrink-0 border border-border" muted />
                      ) : (
                        <div className="w-16 h-24 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl bg-stone-100 border border-border">
                          {fmt?.icon || '🎬'}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-sm font-semibold text-text">{fmt?.icon} {fmt?.label}</span>
                              <span className="text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 leading-[1.4] font-medium">{reel.duration}</span>
                              <button onClick={() => cycleStatus(reel.id)}
                                className={`text-[10px] px-1.5 py-0.5 leading-[1.4] font-bold uppercase tracking-[0.08em] cursor-pointer transition-opacity hover:opacity-80 ${STATUS_COLORS_REEL[reel.status] || 'bg-stone-100 text-stone-600'}`}>
                                {reel.status === 'generating' ? '⏳ Generating…' : reel.status.charAt(0).toUpperCase() + reel.status.slice(1)}
                              </button>
                            </div>
                            <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{reel.brief}</p>
                            {reel.hook && <p className="text-xs text-pink-500 italic mt-1 line-clamp-1">"{reel.hook}"</p>}
                          </div>
                          <button onClick={() => deleteReel(reel.id)}
                            className="text-text-tertiary hover:text-red-500 transition-colors flex-shrink-0">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                          </button>
                        </div>

                        {/* Caption preview if generated */}
                        {reel.caption && (
                          <p className="text-xs text-text-tertiary mt-2 line-clamp-2 border-t border-border pt-2">
                            📝 {reel.caption.slice(0, 100)}{reel.caption.length > 100 ? '…' : ''}
                          </p>
                        )}

                        {/* Video play link */}
                        {reel.videoUrl && (
                          <a href={reel.videoUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-pink-600 hover:text-pink-700 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            Play video
                          </a>
                        )}

                        <div className="flex items-center gap-3 mt-2">
                          {reel.musicNote && <span className="text-[11px] text-text-tertiary">🎵 {reel.musicNote}</span>}
                          {reel.cta && <span className="text-[11px] text-text-tertiary">→ {reel.cta}</span>}
                          <span className="text-[11px] text-text-disabled ml-auto">
                            {new Date(reel.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}
                          </span>
                        </div>
                        {reel.status === 'planned' && (
                          <p className="text-[10px] text-text-disabled mt-1">Click status to advance · or Generate to create video</p>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}


// ─── Reel Approval Screen ──────────────────────────────────────────────────
function ReelApprovalScreen({ data, onApprove, onDiscard }) {
  const videoRef = useRef(null)
  const [playing,      setPlaying]      = useState(false)
  const [progress,     setProgress]     = useState(0)
  const [dur,          setDur]          = useState(0)
  const [muted,        setMuted]        = useState(false)
  const [editCaption,  setEditCaption]  = useState(false)
  const [captionDraft, setCaptionDraft] = useState(data.caption || '')
  const [hashtagDraft, setHashtagDraft] = useState(data.hashtags || '')

  function togglePlay() {
    const v = videoRef.current; if (!v) return
    if (v.paused) { v.play(); setPlaying(true) }
    else          { v.pause(); setPlaying(false) }
  }
  function handleTimeUpdate()    { const v = videoRef.current; if (v) setProgress(v.currentTime) }
  function handleLoadedMetadata(){ const v = videoRef.current; if (v) setDur(v.duration) }
  function handleEnded()         { setPlaying(false); if (videoRef.current) videoRef.current.currentTime = 0; setProgress(0) }
  function seek(e) {
    const v = videoRef.current; if (!v || !dur) return
    const rect = e.currentTarget.getBoundingClientRect()
    v.currentTime = ((e.clientX - rect.left) / rect.width) * dur
  }
  function toggleMute() {
    const v = videoRef.current; if (!v) return
    v.muted = !muted; setMuted(!muted)
  }
  function restart() {
    const v = videoRef.current; if (!v) return
    v.currentTime = 0; v.play(); setPlaying(true)
  }
  function fmt(s) {
    if (!s || isNaN(s)) return '0:00'
    return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`
  }
  const pct = dur > 0 ? (progress / dur) * 100 : 0
  const fmtLabel = REEL_FORMATS.find(f => f.value === data.format)

  return (
    <div className="space-y-5 max-w-7xl">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ background:'#E1306C' }}>
              <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary">Reel Review</p>
          </div>
          <h2 className="font-semibold text-sm text-text">Looks good?</h2>
          <p className="text-xs text-text-secondary mt-0.5">Watch your reel, edit the caption if needed, then save it to your library.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onDiscard}
            className="px-4 py-2 rounded-xl border border-border text-sm font-medium text-text-secondary hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all">
            Discard
          </button>
          <button onClick={() => onApprove({ ...data, caption: captionDraft, hashtags: hashtagDraft })}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm transition-all hover:opacity-90"
            style={{ background:'#E1306C' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            Approve & Save
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">

        {/* ── Left: Phone mockup with video ── */}
        <div className="flex flex-col items-center gap-3">

          {/* Phone frame */}
          <div className="relative w-full max-w-[300px] mx-auto">
            {/* Phone shell. Also an exception: this draws a physical handset,
                and real handsets have rounded corners. */}
            <div className="rounded-[32px] overflow-hidden border-[6px] border-stone-200 bg-stone-100"
              style={{ aspectRatio:'9/16' }}>

              {data.video_url ? (
                <div className="relative w-full h-full bg-stone-900">
                  <video
                    ref={videoRef}
                    src={data.video_url}
                    className="w-full h-full object-cover"
                    playsInline
                    loop
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={handleEnded}
                    onClick={togglePlay}
                  />

                  {/* Play overlay */}
                  {!playing && (
                    <button onClick={togglePlay}
                      className="absolute inset-0 flex items-center justify-center">
                      <div className="w-14 h-14 rounded-full flex items-center justify-center"
                        style={{ background:'rgba(0,0,0,0.62)' }}>
                        <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                          <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                      </div>
                    </button>
                  )}

                  {/* IG-style UI overlay */}
                  <div className="absolute bottom-0 left-0 right-0 p-3"
                    style={{ background:'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)' }}>
                    <p className="text-white text-[11px] font-semibold line-clamp-2 mb-2">
                      {captionDraft.split('\n')[0]}
                    </p>
                    {/* Progress bar */}
                    <div className="w-full h-0.5 bg-white/30 cursor-pointer mb-1" onClick={seek}>
                      <div className="h-full bg-white transition-all" style={{ width:`${pct}%` }}/>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/60 text-[10px] font-mono">{fmt(progress)} / {fmt(dur)}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={restart} className="text-white/70 hover:text-white transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
                        </button>
                        <button onClick={togglePlay} className="text-white/70 hover:text-white transition-colors">
                          {playing
                            ? <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                            : <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
                        </button>
                        <button onClick={toggleMute} className="text-white/70 hover:text-white transition-colors">
                          {muted
                            ? <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                            : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Badges top */}
                  <div className="absolute top-3 left-3 flex gap-1.5">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 leading-[1.4] text-white"
                      style={{ background:'rgba(0,0,0,0.62)' }}>
                      {data.duration}
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 leading-[1.4] text-white"
                      style={{ background:'rgba(0,0,0,0.62)' }}>
                      720p
                    </span>
                  </div>
                </div>
              ) : data.cover_image_url ? (
                <img src={data.cover_image_url} alt="cover" className="w-full h-full object-cover"/>
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-stone-100">
                  <p className="text-stone-400 text-sm">No preview</p>
                </div>
              )}
            </div>

            {/* Phone notch */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-16 h-1.5 bg-stone-300"/>
          </div>

          {/* Format + AI note below phone */}
          <div className="w-full max-w-[300px] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-tertiary">{fmtLabel?.icon} {fmtLabel?.label}</span>
              <span className="text-text-tertiary capitalize">{data.tone}</span>
            </div>
            {data.reel_strategy && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500 mb-1">Strategy</p>
                <p className="text-[11px] text-amber-800 leading-relaxed">{data.reel_strategy}</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Caption + details ── */}
        <div className="space-y-4">

          {/* Caption */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <p className="text-sm font-semibold text-text">Caption</p>
              <button onClick={() => setEditCaption(e => !e)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${editCaption ? 'bg-amber-500 text-white' : 'text-amber-600 hover:bg-amber-50 border border-amber-200'}`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                {editCaption ? 'Done' : 'Edit'}
              </button>
            </div>
            <div className="p-5">
              {editCaption ? (
                <textarea value={captionDraft} onChange={e => setCaptionDraft(e.target.value)} rows={8}
                  className="w-full text-sm border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none leading-relaxed bg-surface-subtle" />
              ) : (
                <p className="text-sm text-text leading-relaxed whitespace-pre-line">{captionDraft || '—'}</p>
              )}
            </div>
          </Card>

          {/* Hashtags */}
          <Card className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border">
              <p className="text-sm font-semibold text-text">Hashtags</p>
            </div>
            <div className="p-5">
              <textarea value={hashtagDraft} onChange={e => setHashtagDraft(e.target.value)} rows={2}
                className="w-full text-sm border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pink-300 resize-none"
                style={{ color:'#bc1888' }} />
            </div>
          </Card>

          {/* Reel details grid */}
          <Card className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-3">Reel Details</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label:'Format',   value: fmtLabel?.label || data.format },
                { label:'Duration', value: data.duration },
                { label:'Tone',     value: data.tone },
                { label:'Hook',     value: data.hook || '—' },
                { label:'Music',    value: data.musicNote || '—' },
                { label:'CTA',      value: data.cta || '—' },
              ].map(r => (
                <div key={r.label} className="rounded-xl bg-surface-subtle px-3 py-2.5 border border-border">
                  <p className="text-[10px] text-text-disabled uppercase tracking-wider mb-0.5">{r.label}</p>
                  <p className="text-xs font-medium text-text capitalize truncate">{r.value}</p>
                </div>
              ))}
            </div>
            {data.motion_prompt && (
              <div className="mt-3 rounded-xl bg-purple-50 border border-purple-100 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-purple-400 mb-1">Motion Prompt</p>
                <p className="text-xs text-purple-700 leading-relaxed">{data.motion_prompt}</p>
              </div>
            )}
          </Card>

          {/* Bottom actions */}
          <div className="flex gap-3 pt-1">
            <button onClick={onDiscard}
              className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:bg-surface-subtle hover:text-red-500 hover:border-red-200 transition-all">
              Discard
            </button>
            <button onClick={() => onApprove({ ...data, caption: captionDraft, hashtags: hashtagDraft })}
              className="flex-[2] py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 hover:opacity-90 transition-all"
              style={{ background:'#E1306C' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              Approve & Save to Library
            </button>
          </div>
        </div>
      </div>
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
            Use this field only for things specific to Instagram, e.g. Reels-style hooks or emoji usage that wouldn't apply on LinkedIn.
          </p>
          <Textarea
            placeholder={"Examples:\n• Lean into emoji more here than on LinkedIn\n• Reels hooks should be punchy, under 6 words\n• Carousel posts: keep each slide to one idea"}
            value={instructions} onChange={e => setInstructions(e.target.value)} rows={5} />
          <Button onClick={handleSave} variant={saved ? 'secondary' : 'primary'} className="w-full justify-center">
            {saved ? '✓ Saved' : 'Save Instagram Notes'}
          </Button>
        </div>
      )}
    </Card>
  )
}
