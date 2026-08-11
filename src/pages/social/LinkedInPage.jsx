import { useState, useCallback, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/app'
import { useAuth } from '../../store/auth'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/supabaseClient'
import { Card, Button, Badge, Textarea, Spinner, PostImage } from '../../components/ui/index'
import { uid, formatDateTime } from '../../lib/utils'
import { buildInstructionsString, useBrandProfileSync, logEditFeedback } from '../../lib/brandBrain'
import { ReferencePicker } from '../../components/ReferencePicker'
import { CaptionStudio } from '../../components/CaptionStudio'
import { QuickCreatePanel } from '../../components/QuickCreatePanel'

// ─── Constants ──────────────────────────────────────────────────────────────
const POST_TYPES = [
  { value: 'thought_leadership', label: 'Thought Leadership', icon: '💡', desc: 'Big idea, industry insight, contrarian take' },
  { value: 'project_case_study', label: 'Project Case Study', icon: '🏛️', desc: 'Completed project, measurable impact' },
  { value: 'team_spotlight',     label: 'Team Spotlight',     icon: '👥', desc: 'People, culture, behind the scenes' },
  { value: 'industry_insight',   label: 'Industry Insight',   icon: '📊', desc: 'Data, research, market observation' },
  { value: 'milestone_award',    label: 'Milestone / Award',  icon: '🏆', desc: 'Achievement, anniversary, recognition' },
  { value: 'job_opening',        label: 'Job Opening',        icon: '🎯', desc: 'Recruitment with culture story' },
  { value: 'product_launch',     label: 'Product / Innovation', icon: '🔦', desc: 'New product, feature, technical innovation' },
]

const TONES = [
  { value: 'thought_leader',   label: 'Thought Leader',   desc: 'Authoritative, forward-looking' },
  { value: 'executive',        label: 'Executive',        desc: 'Formal, strategic, C-suite' },
  { value: 'technical_expert', label: 'Technical Expert', desc: 'Precise, data-driven, specs' },
  { value: 'warm_human',       label: 'Warm & Human',     desc: 'Storytelling, personal, authentic' },
  { value: 'promotional',      label: 'Promotional',      desc: 'Achievement-focused, milestones' },
]

const IMAGE_STYLES = [
  { value: 'photorealistic',  label: 'Photorealistic',  icon: '📷', desc: 'Professional architectural photo' },
  { value: 'dramatic',        label: 'Dramatic',        icon: '🎬', desc: 'Cinematic, high contrast' },
  { value: 'minimalist',      label: 'Minimalist',      icon: '◻️', desc: 'Clean, white space, elegant' },
  { value: 'warm_interior',   label: 'Warm Interior',   icon: '🏠', desc: 'Golden tones, luxury spaces' },
  { value: 'cool_commercial', label: 'Cool Commercial', icon: '🏢', desc: 'Crisp, modern, glass & steel' },
  { value: 'facade_exterior', label: 'Facade Exterior', icon: '🌃', desc: 'Night exterior, facade lighting' },
]

const ASPECT_RATIOS = [
  { value: '1.91:1', label: 'Landscape', subdesc: 'Feed (default)', dims: '1200×628',  shape: [191,100] },
  { value: '1:1',    label: 'Square',    subdesc: 'Feed Square',    dims: '1080×1080', shape: [1,1] },
  { value: '4:5',    label: 'Portrait',  subdesc: 'Feed Portrait',  dims: '1080×1350', shape: [4,5] },
]

const DAYS_OF_WEEK = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function AspectRatioSelector({ value, onChange }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {ASPECT_RATIOS.map(r => {
        const isSelected = value === r.value
        const [w, h] = r.shape
        const maxSz = 32, scale = Math.min(maxSz / w, maxSz / h)
        const bw = Math.round(w * scale), bh = Math.round(h * scale)
        return (
          <button key={r.value} onClick={() => onChange(r.value)}
            className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border transition-all min-w-[72px] ${isSelected ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-border bg-white hover:border-stone-300 hover:bg-surface-subtle'}`}>
            <div className="flex items-center justify-center" style={{ width: maxSz, height: maxSz }}>
              <div className={`rounded-sm transition-colors ${isSelected ? 'bg-blue-500' : 'bg-stone-300'}`} style={{ width: bw, height: bh }} />
            </div>
            <div className="text-center">
              <p className={`text-[11px] font-semibold leading-none ${isSelected ? 'text-blue-700' : 'text-text'}`}>{r.label}</p>
              <p className="text-[10px] text-text-tertiary mt-0.5">{r.subdesc}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Supabase hooks ──────────────────────────────────────────────────────────
function useSupabaseLinkedInSchedule(supabaseUrl, anonKey, workspaceId) {
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  }

  async function upsertEntry(dateKey, entry) {
    if (!supabaseUrl || !anonKey) return { error: 'Supabase not configured.' }
    const body = {
      workspace_id:         workspaceId,
      scheduled_date:       dateKey,
      topic:                entry.topic              || '',
      tone:                 entry.tone               || 'thought_leader',
      post_type:            entry.postType           || 'thought_leadership',
      content_route:        entry.contentRoute       || 'instructions',
      include_image:        entry.includeImage !== false,
      style:                entry.style              || 'photorealistic',
      aspect_ratio:         entry.aspectRatio        || '1.91:1',
      notes:                entry.notes              || '',
      instructions:         entry.instructions       || '',
      campaign_id:          entry.campaignId         || null,
      upload_type:          entry.uploadType         || 'generate',
      uploaded_image_urls:  entry.uploadedImageUrls  || null,
      reference_image_urls: entry.referenceImageUrls || [],
      status:               'pending',
    }
    const res = await fetch(`${supabaseUrl}/rest/v1/linkedin_schedule`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const err = await res.text(); return { error: err } }
    return { ok: true }
  }

  async function deleteEntry(dateKey) {
    if (!supabaseUrl || !anonKey) return { error: 'Supabase not configured.' }
    const res = await fetch(`${supabaseUrl}/rest/v1/linkedin_schedule?scheduled_date=eq.${dateKey}`, {
      method: 'DELETE', headers,
    })
    if (!res.ok) { const err = await res.text(); return { error: err } }
    return { ok: true }
  }

  async function fetchMonth(year, month) {
    if (!supabaseUrl || !anonKey) return { data: null, error: 'Supabase not configured.' }
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const to   = `${year}-${String(month + 1).padStart(2, '0')}-31`
    const res  = await fetch(
      `${supabaseUrl}/rest/v1/linkedin_schedule?scheduled_date=gte.${from}&scheduled_date=lte.${to}&select=*`,
      { headers }
    )
    if (!res.ok) { const err = await res.text(); return { data: null, error: err } }
    const rows = await res.json()
    const map  = {}
    rows.forEach(r => {
      map[r.scheduled_date] = {
        topic:              r.topic,
        tone:               r.tone,
        postType:           r.post_type,
        contentRoute:       r.content_route,
        includeImage:       r.include_image,
        style:              r.style,
        aspectRatio:        r.aspect_ratio,
        notes:              r.notes,
        instructions:       r.instructions,
        campaignId:         r.campaign_id,
        status:             r.status,
        uploadType:         r.upload_type         || 'generate',
        uploadedImageUrls:  r.uploaded_image_urls || null,
        referenceImageUrls: r.reference_image_urls || [],
      }
    })
    return { data: map, error: null }
  }

  async function uploadToStorage(file, dateKey, index) {
    if (!supabaseUrl || !anonKey) return { error: 'Supabase not configured.' }
    const ext  = file.name.split('.').pop()
    const path = `linkedin/${dateKey}/${Date.now()}_${index}.${ext}`
    const res  = await fetch(`${supabaseUrl}/storage/v1/object/schedule-uploads/${path}`, {
      method:  'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': file.type },
      body:    file,
    })
    if (!res.ok) { const err = await res.text(); return { error: err } }
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/schedule-uploads/${path}`
    return { url: publicUrl }
  }

  return { upsertEntry, deleteEntry, fetchMonth, uploadToStorage }
}

function useSupabaseLinkedInPosts(supabaseUrl, anonKey) {
  const [remotePosts,   setRemotePosts]   = useState([])
  const [loadingPosts,  setLoadingPosts]  = useState(false)
  const [lastFetchedAt, setLastFetchedAt] = useState('')

  const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${anonKey}` }

  const fetchRemotePosts = useCallback(async () => {
    if (!supabaseUrl || !anonKey) return
    setLoadingPosts(true)
    try {
      const [schedRes, manualRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/linkedin_generated_posts?select=*&order=created_at.desc&limit=100`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/linkedin_manual_posts?select=*&order=created_at.desc&limit=100`, { headers }),
      ])
      const schedRows  = schedRes.ok  ? await schedRes.json()  : []
      const manualRows = manualRes.ok ? await manualRes.json() : []

      const normalize = (r, src) => ({
        id:                  r.id,
        platform:            'linkedin',
        hook:                r.hook,
        copy:                r.hook ? `${r.hook}\n\n${r.body || ''}` : (r.body || ''),
        body:                r.body,
        hashtags:            r.hashtags,
        imageUrl:            r.image_url,
        mediaUrls:           (r.image_urls && r.image_urls.length > 0) ? r.image_urls : (r.image_url ? [r.image_url] : []),
        imagePrompt:         r.image_prompt,
        postStrategy:        r.post_strategy,
        trendingAngle:       r.trending_angle,
        topic:               r.topic,
        tone:                r.tone,
        postType:            r.post_type,
        style:               r.style,
        aspectRatio:         r.aspect_ratio,
        includeImage:        r.include_image !== false,
        contentRoute:        r.content_route || src,
        campaignId:          r.campaign_id,
        status:              r.status,
        source:              r.source || src,
        scheduledAt:         r.scheduled_date || null,
        createdAt:           r.created_at,
        generatedByWorkflow: true,
        _fromSupabase:       true,
        _table:              src === 'manual' ? 'linkedin_manual_posts' : 'linkedin_generated_posts',
      })

      setRemotePosts([
        ...schedRows.map(r => normalize(r, 'scheduled')),
        ...manualRows.map(r => normalize(r, 'manual')),
      ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)))
      setLastFetchedAt(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
    } finally { setLoadingPosts(false) }
  }, [supabaseUrl, anonKey])

  async function updatePostStatus(postId, newStatus) {
    if (!supabaseUrl || !anonKey) return
    await fetch(`${supabaseUrl}/rest/v1/linkedin_generated_posts?id=eq.${postId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ status: newStatus, updated_at: new Date().toISOString() }),
    })
  }

  return { remotePosts, loadingPosts, lastFetchedAt, fetchRemotePosts, updatePostStatus }
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export function LinkedInPage() {
  const { state, dispatch } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  useBrandProfileSync(state, dispatch)
  const localPosts  = state.posts.filter(p => p.platform === 'linkedin')
  const webhookUrl      = state.webhooks?.linkedin || ''
  const regenWebhookUrl = state.webhooks?.linkedinScheduleRegen || ''
  const supabaseUrl = SUPABASE_URL
  const anonKey     = accessToken || ''

  const { remotePosts, loadingPosts, lastFetchedAt, fetchRemotePosts, updatePostStatus } =
    useSupabaseLinkedInPosts(supabaseUrl, anonKey)

  const localIds   = useMemo(() => new Set(localPosts.map(p => p.id)), [localPosts])
  const mergedPosts = useMemo(() => [
    ...localPosts,
    ...remotePosts.filter(p => !localIds.has(p.id)),
  ], [localPosts, remotePosts])

  const [screen,   setScreen]   = useState('posts')

  // auto-fetch on mount
  const [fetched, setFetched] = useState(false)
  if (supabaseUrl && anonKey && !fetched && !loadingPosts) {
    setFetched(true)
    fetchRemotePosts()
  }

  const totalPosts = mergedPosts.length

  return (
    <div className="max-w-7xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm bg-[#0A66C2]">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-text text-base tracking-tight">LinkedIn</h2>
            <p className="text-xs text-text-secondary">{totalPosts} post{totalPosts !== 1 ? 's' : ''} · AI content generation</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {supabaseUrl && anonKey && (
            <button onClick={fetchRemotePosts} disabled={loadingPosts}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-white text-xs text-text-secondary hover:text-text hover:bg-surface-subtle transition-colors disabled:opacity-50">
              <svg className={`w-3.5 h-3.5 ${loadingPosts ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.27-4.93"/></svg>
              {lastFetchedAt ? `Synced ${lastFetchedAt}` : 'Sync Posts'}
            </button>
          )}
          <Button onClick={() => setScreen('create')} className="!bg-[#0A66C2] !hover:bg-[#004182] text-white">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            Create Post
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total',     value: totalPosts },
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
        {[{ key: 'posts', label: 'Posts' }, { key: 'create', label: 'Create Post' }, { key: 'video', label: '🎬 Video' }, { key: 'schedule', label: '📅 Monthly Schedule' }].map(t => (
          <button key={t.key} onClick={() => setScreen(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${screen === t.key ? 'bg-white text-text shadow-sm border border-border' : 'text-text-secondary hover:text-text hover:bg-white/60'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {screen === 'posts'    && <PostsList posts={mergedPosts} dispatch={dispatch} state={state} onCreateClick={() => setScreen('create')} updatePostStatus={updatePostStatus} webhookUrl={webhookUrl} regenWebhookUrl={regenWebhookUrl} />}
      {screen === 'create'   && (
        <div className="space-y-4 max-w-2xl">
          <QuickCreatePanel platform="linkedin" tones={TONES} workspaceId={activeWorkspaceId} accessToken={accessToken}
            webhooks={state.webhooks} instructions={buildInstructionsString(state.brandProfile, state.linkedinInstructions)}
            captionLanguage={state.brandProfile?.captionLanguage || 'both'}
            onDone={() => { setScreen('posts'); fetchRemotePosts() }} />
          <InstructionsAccordion state={state} />
        </div>
      )}
      {screen === 'video'    && <LinkedInVideoPanel state={state} dispatch={dispatch} />}
      {screen === 'schedule' && <MonthlySchedule state={state} dispatch={dispatch} instructions={buildInstructionsString(state.brandProfile, state.linkedinInstructions)} />}
    </div>
  )
}

// ─── Monthly Schedule ────────────────────────────────────────────────────────
function MonthlySchedule({ state, dispatch, instructions }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const supabaseUrl = SUPABASE_URL
  const anonKey     = accessToken || ''
  const { upsertEntry, deleteEntry, fetchMonth, uploadToStorage } = useSupabaseLinkedInSchedule(supabaseUrl, anonKey, activeWorkspaceId)

  const today    = new Date()
  const [viewDate,       setViewDate]       = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [editDay,        setEditDay]        = useState(null)   // dateKey for editor
  const [editIndex,      setEditIndex]      = useState(null)   // index in day array, null = new
  const [viewDay,        setViewDay]        = useState(null)   // dateKey for overview
  const [localSchedule,  setLocalSchedule]  = useState(state.linkedinSchedule || {})
  const [remoteSchedule, setRemoteSchedule] = useState({})
  const [loadedMonthKey, setLoadedMonthKey] = useState(null)
  const [lastFetched,    setLastFetched]    = useState('')
  const [saveError,      setSaveError]      = useState('')

  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const schedule    = { ...localSchedule, ...remoteSchedule }
  const filledCount = Object.keys(schedule).filter(k => k.startsWith(`${year}-${String(month + 1).padStart(2,'0')}`)).length
  const isConfigured = !!(supabaseUrl && anonKey)

  // Normalize a day's value → always an array
  function dayEntries(key) {
    const val = schedule[key]
    if (!val) return []
    return Array.isArray(val) ? val : [val]
  }

  const calDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const prevDays = new Date(year, month, 0).getDate()
    const cells = []
    for (let i = firstDay - 1; i >= 0; i--) cells.push({ date: new Date(year, month - 1, prevDays - i), overflow: 'prev' })
    for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(year, month, d), overflow: null })
    let next = 1
    while (cells.length % 7 !== 0) cells.push({ date: new Date(year, month + 1, next++), overflow: 'next' })
    return cells
  }, [year, month])

  const [fetchTick, setFetchTick] = useState(0)
  // The spinner is derived from whether the month on screen is the month we
  // last finished loading, rather than a flag flipped inside the effect. Same
  // behaviour, and a response for a month you've already paged past can no
  // longer land on top of the one you're looking at.
  const monthKey = `${year}-${month}-${fetchTick}`
  const loadingMonth = isConfigured && loadedMonthKey !== monthKey

  useEffect(() => {
    if (!isConfigured) return
    let alive = true
    fetchMonth(year, month).then(({ data }) => {
      if (!alive) return
      if (data) { setRemoteSchedule(data); setLastFetched(new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})) }
      setLoadedMonthKey(monthKey)
    })
    return () => { alive = false }
  }, [year, month, fetchTick, isConfigured]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(dateKey, entry) {
    setSaveError('')
    const existing = dayEntries(dateKey)
    let updatedArr
    if (editIndex === null) {
      updatedArr = [...existing, { ...entry, _id: uid() }]
    } else {
      updatedArr = existing.map((e, i) => i === editIndex ? { ...e, ...entry } : e)
    }
    const updated = { ...localSchedule, [dateKey]: updatedArr }
    setLocalSchedule(updated)
    dispatch({ type: 'SET_LINKEDIN_SCHEDULE', payload: updated })
    setRemoteSchedule(prev => ({ ...prev, [dateKey]: updatedArr }))
    setEditDay(null); setEditIndex(null)
    setViewDay(dateKey)  // return to day overview

    if (isConfigured) {
      const result = await upsertEntry(dateKey, { ...entry, instructions })
      if (result.error) setSaveError(`Saved locally. Supabase sync failed: ${result.error}`)
      else setFetchTick(t => t + 1)
    }
  }

  async function handleDeletePost(key, index) {
    const existing = dayEntries(key)
    const updatedArr = existing.filter((_, i) => i !== index)
    const updated = { ...localSchedule }
    if (updatedArr.length === 0) {
      delete updated[key]
    } else {
      updated[key] = updatedArr
    }
    setLocalSchedule(updated)
    dispatch({ type: 'SET_LINKEDIN_SCHEDULE', payload: updated })
    setRemoteSchedule(prev => {
      const n = { ...prev }
      if (updatedArr.length === 0) delete n[key]
      else n[key] = updatedArr
      return n
    })
    if (updatedArr.length === 0) {
      setViewDay(null)
      if (isConfigured) await deleteEntry(key)
    }
  }

  function isToday(date) { return date.toDateString() === today.toDateString() }
  function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` }

  function entryLabel(e) {
    if (e.uploadType === 'video')  return { icon: '🎬', text: 'Video',    color: 'text-purple-600' }
    if (e.uploadType === 'upload') return { icon: '🖼️', text: 'Upload',   color: 'text-blue-600' }
    return { icon: '✦',  text: 'Generate', color: 'text-blue-700' }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-text">Monthly Content Schedule</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Plan your posts day by day. n8n generates each one automatically at 8am on its date.
            {filledCount > 0 && <span className="ml-2 text-blue-600 font-medium">{filledCount} day{filledCount !== 1 ? 's' : ''} planned this month</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loadingMonth && <div className="flex items-center gap-1.5 text-xs text-text-tertiary"><div className="w-3 h-3 border border-stone-300 border-t-blue-500 rounded-full animate-spin" /> Loading…</div>}
          {lastFetched && !loadingMonth && <span className="text-[11px] text-text-tertiary">Synced {lastFetched}</span>}
          {isConfigured && !loadingMonth && (
            <button onClick={() => setFetchTick(t => t + 1)} className="text-xs text-text-tertiary hover:text-text px-2.5 py-1 rounded-lg hover:bg-surface-subtle transition-colors border border-border">Refresh</button>
          )}
        </div>
      </div>

      {!isConfigured && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
          <span className="font-semibold">Supabase not configured.</span> Go to <strong>Settings → Integrations → Supabase</strong> and enter your Project URL and anon key.
        </div>
      )}

      {saveError && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-600">{saveError}</div>}

      {/* Month nav */}
      <div className="flex items-center justify-between">
        <button onClick={() => setViewDate(new Date(year, month - 1, 1))} className="w-8 h-8 rounded-xl border border-border bg-white hover:bg-surface-subtle flex items-center justify-center transition-colors">
          <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h4 className="font-semibold text-text">{MONTHS[month]} {year}</h4>
        <button onClick={() => setViewDate(new Date(year, month + 1, 1))} className="w-8 h-8 rounded-xl border border-border bg-white hover:bg-surface-subtle flex items-center justify-center transition-colors">
          <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      {/* Calendar */}
      <div className="rounded-2xl border border-border bg-white overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border">
          {DAYS_OF_WEEK.map(d => (
            <div key={d} className="py-2 text-center text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {calDays.map((cell, i) => {
            const key          = dateKey(cell.date)
            const entries      = dayEntries(key)
            const count        = entries.length
            const isCurrentMonth = cell.overflow === null

            return (
              <button key={i} onClick={() => { if (isCurrentMonth) setViewDay(key) }}
                disabled={!isCurrentMonth}
                className={`relative min-h-[64px] p-2 border-b border-r border-border text-left transition-all
                  ${!isCurrentMonth ? 'opacity-25 cursor-default bg-surface-muted' : 'hover:bg-blue-50/50 cursor-pointer'}
                  ${isToday(cell.date) ? 'ring-2 ring-inset ring-blue-400' : ''}
                  ${count > 0 && isCurrentMonth ? 'bg-blue-50/30' : ''}
                `}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`text-xs font-semibold ${isToday(cell.date) ? 'text-blue-600' : isCurrentMonth ? 'text-text' : 'text-text-disabled'}`}>
                    {cell.date.getDate()}
                  </span>
                  {count > 0 && isCurrentMonth && (
                    <span className="text-[9px] font-bold bg-[#0A66C2] text-white w-4 h-4 flex items-center justify-center">{count}</span>
                  )}
                </div>
                {count > 0 && isCurrentMonth && (
                  <div className="space-y-0.5">
                    {entries.slice(0, 2).map((e, idx) => {
                      const lbl = entryLabel(e)
                      return (
                        <p key={idx} className={`text-[9px] font-semibold truncate leading-tight ${lbl.color}`}>
                          {lbl.icon} {e.topic?.slice(0, 16) || lbl.text}
                        </p>
                      )
                    })}
                    {count > 2 && <p className="text-[9px] text-text-tertiary">+{count - 2} more</p>}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 text-[11px] text-text-tertiary flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-blue-100 border border-blue-300 inline-block"/>Planned</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-green-100 border border-green-300 inline-block"/>Generated</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-white border border-border inline-block"/>Empty</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded border-2 border-blue-400 inline-block"/>Today</span>
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
              <div className="px-6 py-5 flex-shrink-0" style={{ background:'#f3f5f4', borderBottom:'1px solid #dde3e2' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#0A66C2] mb-1">LinkedIn · Schedule</p>
                    <h3 className="font-semibold text-sm text-text">{label}</h3>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      {entries.length === 0 ? 'Nothing planned' : `${entries.length} post${entries.length !== 1 ? 's' : ''} planned`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => { setEditDay(viewDay); setEditIndex(null) }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-[#0A66C2] hover:bg-[#004182] transition-colors">
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
                    <div className="w-12 h-12 rounded-2xl bg-[#0A66C2] flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    </div>
                    <p className="font-semibold text-text mb-1">Nothing scheduled</p>
                    <p className="text-sm text-text-secondary mb-4">Add your first post for this day.</p>
                    <button onClick={() => { setEditDay(viewDay); setEditIndex(null) }}
                      className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#0A66C2] hover:bg-[#004182] transition-colors">
                      + Add Post
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {entries.map((entry, idx) => {
                      const lbl = entryLabel(entry)
                      const statusColors = { planned:'bg-stone-100 text-stone-600', generated:'bg-green-50 text-green-700', pending:'bg-blue-50 text-blue-700' }
                      const postType = POST_TYPES.find(t => t.value === entry.postType)
                      return (
                        <div key={idx} className="rounded-2xl border overflow-hidden" style={{ borderColor:'rgba(10,102,194,0.15)' }}>
                          <div className="h-1 bg-[#0A66C2]" />
                          <div className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm">{lbl.icon}</span>
                                <span className={`text-xs font-semibold ${lbl.color}`}>{lbl.text}</span>
                                {postType && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 leading-[1.4]">{postType.icon} {postType.label}</span>}
                                {entry.tone && <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 leading-[1.4] capitalize">{entry.tone?.replace('_',' ')}</span>}
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
          onClear={() => { setEditDay(null); setEditIndex(null); setViewDay(editDay) }}
          onClose={() => { setEditDay(null); setEditIndex(null); setViewDay(editDay) }}
        />
      )}
    </div>
  )
}

// ─── Day Editor ──────────────────────────────────────────────────────────────
function DayEditor({ dateKey, entry, campaigns, uploadToStorage, onSave, onClear, onClose }) {
  const initTab = entry?.uploadType === 'video' ? 'video' : entry?.uploadType === 'upload' ? 'upload' : 'generate'
  const [tab, setTab] = useState(initTab)

  // Publish time
  const [publishTime, setPublishTime] = useState(entry?.publishTime || '10:00')

  // Video tab state
  const [videoType,   setVideoType]   = useState(entry?.videoType   || 'thought_leadership')
  const [videoLength, setVideoLength] = useState(entry?.videoLength || '1m-3m')
  const [videoAudience, setVideoAudience] = useState(entry?.videoAudience || 'architects')
  const [videoTitle,  setVideoTitle]  = useState(entry?.videoTitle  || '')
  const [videoBrief,  setVideoBrief]  = useState(entry?.videoBrief  || '')
  const [videoPoints, setVideoPoints] = useState(entry?.videoPoints || '')
  const [videoCta,    setVideoCta]    = useState(entry?.videoCta    || '')

  // Generate tab
  const [topic,        setTopic]        = useState(entry?.uploadType !== 'upload' ? (entry?.topic || '') : '')
  const [tone,         setTone]         = useState(entry?.tone || 'thought_leader')
  const [postType,     setPostType]     = useState(entry?.postType || 'thought_leadership')
  const [includeImage, setIncludeImage] = useState(entry?.includeImage !== false)
  const [style,        setStyle]        = useState(entry?.style || 'photorealistic')
  const [aspectRatio,  setAspectRatio]  = useState(entry?.aspectRatio || '1.91:1')
  const [notes,        setNotes]        = useState(entry?.uploadType !== 'upload' ? (entry?.notes || '') : '')
  const [campaignId,   setCampaign]     = useState(entry?.campaignId || '')
  const [references,   setReferences]   = useState(entry?.referenceImageUrls || []) // image-to-image guides
  const [pickingRefs,  setPickingRefs]  = useState(false)

  // Upload tab
  const [uploadTopic,    setUploadTopic]    = useState(entry?.uploadType === 'upload' ? (entry?.topic || '') : '')
  const [uploadNotes,    setUploadNotes]    = useState(entry?.uploadType === 'upload' ? (entry?.notes || '') : '')
  const [uploadAR,       setUploadAR]       = useState(entry?.aspectRatio || '1.91:1')
  const [uploadCampaign, setUploadCampaign] = useState(entry?.campaignId || '')
  const [files,          setFiles]          = useState([])
  const [existingUrls,   setExistingUrls]   = useState(entry?.uploadedImageUrls || [])
  const [uploading,      setUploading]      = useState(false)
  const [uploadError,    setUploadError]    = useState('')

  const [confirmDelete, setConfirmDelete] = useState(false)

  const dateObj   = new Date(dateKey + 'T12:00:00')
  const dateLabel = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  // ── Generate save ──────────────────────────────────────────────────────────
  function handleSaveGenerate() {
    if (!topic.trim()) return
    onSave(dateKey, { topic, tone, postType, contentRoute: 'instructions', includeImage, style, aspectRatio, notes, campaignId, uploadType: 'generate', uploadedImageUrls: null, referenceImageUrls: references, publishTime })
  }

  // ── Upload save ────────────────────────────────────────────────────────────
  async function handleSaveUpload() {
    if (!uploadTopic.trim()) return
    if (files.length === 0 && existingUrls.length === 0) { setUploadError('Please select at least one image.'); return }
    setUploading(true); setUploadError('')
    try {
      let allUrls = [...existingUrls]
      for (let i = 0; i < files.length; i++) {
        const result = await uploadToStorage(files[i], dateKey, existingUrls.length + i)
        if (result.error) { setUploadError(`Upload failed: ${result.error}`); setUploading(false); return }
        allUrls.push(result.url)
      }
      onSave(dateKey, {
        topic:              uploadTopic.trim(),
        tone:               'thought_leader',
        postType:           'thought_leadership',
        contentRoute:       'instructions',
        includeImage:       true,
        style:              null,
        aspectRatio:        uploadAR,
        notes:              uploadNotes.trim(),
        campaignId:         uploadCampaign,
        uploadType:         'upload',
        uploadedImageUrls:  allUrls,
        publishTime,
      })
    } catch (err) {
      setUploadError(`Unexpected error: ${err.message}`)
    } finally {
      setUploading(false)
    }
  }

  function handleSaveVideo() {
    if (!videoTitle.trim() || !videoBrief.trim()) return
    onSave(dateKey, {
      topic:        videoTitle.trim(),
      tone:         'thought_leader',
      postType:     videoType,
      contentRoute: 'instructions',
      includeImage: false,
      style:        null, aspectRatio: '16:9',
      notes:        videoPoints.trim(),
      campaignId:   '',
      uploadType:   'video',
      uploadedImageUrls: null,
      videoType, videoLength, videoAudience, videoTitle, videoBrief, videoPoints, videoCta,
      publishTime,
    })
  }

  function handleFileChange(e) {
    const selected = Array.from(e.target.files).filter(f => f.type.startsWith('image/'))
    const total = existingUrls.length + files.length + selected.length
    if (total > 10) { setUploadError('Maximum 10 images per post.'); return }
    setFiles(prev => [...prev, ...selected])
    setUploadError('')
  }

  function removeNewFile(idx) { setFiles(prev => prev.filter((_,i) => i !== idx)) }
  function removeExistingUrl(idx) { setExistingUrls(prev => prev.filter((_,i) => i !== idx)) }

  const totalImages = existingUrls.length + files.length
  const isCarousel  = totalImages > 1

  const content = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-3xl  w-full flex flex-col overflow-hidden" style={{ maxWidth:'860px', height:'90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <p className="font-semibold text-text text-sm">Plan post for</p>
            <p className="text-xs font-bold text-blue-600 mt-0.5">{dateLabel}</p>
            <p className="text-[11px] text-text-tertiary">n8n will process this post automatically at 8am on this date</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-text-tertiary hover:bg-surface-subtle transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4 flex-shrink-0">
          <div className="flex gap-1 bg-surface-subtle border border-border rounded-xl p-1">
            <button onClick={() => setTab('generate')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${tab === 'generate' ? 'bg-[#0A66C2] text-white shadow-sm' : 'text-text-secondary hover:text-text hover:bg-white/60'}`}>
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              Generate
            </button>
            <button onClick={() => setTab('upload')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${tab === 'upload' ? 'bg-[#0A66C2] text-white shadow-sm' : 'text-text-secondary hover:text-text hover:bg-white/60'}`}>
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload
            </button>
            <button onClick={() => setTab('video')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${tab === 'video' ? 'bg-[#0A66C2] text-white shadow-sm' : 'text-text-secondary hover:text-text hover:bg-white/60'}`}>
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Video
            </button>
          </div>
        </div>

        {/* Publish Time Picker */}
        <div className="px-6 py-4 flex-shrink-0 border-b border-border" style={{ background:'#f3f5f4' }}>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-[#0A66C2] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span className="text-sm font-bold text-text">Publish Time</span>
              <span className="text-[10px] text-text-tertiary">· KSA time</span>
            </div>
            {/* Manual time input */}
            <input type="time" value={publishTime} onChange={e => setPublishTime(e.target.value)}
              className="text-sm font-semibold border-2 border-[#0A66C2]/40 rounded-xl px-3 py-2 bg-white text-text focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer" />
            {/* Quick-pick slots */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { label: '7 AM',   val: '07:00' },
                { label: '9 AM',   val: '09:00' },
                { label: '12 PM',  val: '12:00' },
                { label: '1 PM',   val: '13:00' },
                { label: '3 PM',   val: '15:00' },
                { label: '5 PM',   val: '17:00' },
                { label: '7 PM',   val: '19:00' },
                { label: '9 PM',   val: '21:00' },
              ].map(slot => (
                <button key={slot.val} type="button"
                  onClick={() => setPublishTime(slot.val)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${publishTime === slot.val ? 'bg-[#0A66C2] text-white border-[#0A66C2] shadow-sm' : 'bg-white text-text-secondary border-border hover:border-[#0A66C2]/40 hover:text-[#0A66C2]'}`}>
                  {slot.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-text-tertiary mt-2">n8n will post this to LinkedIn at the selected time on the scheduled date.</p>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-4">

          {/* ════ GENERATE TAB ════ */}
          {tab === 'generate' && (<>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Topic / Brief <span className="text-red-400">*</span></label>
              <Textarea placeholder="e.g. Completed lighting for NEOM hotel..." value={topic} onChange={e => setTopic(e.target.value)} rows={3} />
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Post Type</label>
              <div className="grid grid-cols-2 gap-1.5">
                {POST_TYPES.map(t => (
                  <button key={t.value} onClick={() => setPostType(t.value)}
                    className={`text-left rounded-xl border px-3 py-2 transition-all ${postType === t.value ? 'border-blue-500 bg-blue-50' : 'border-border bg-white hover:border-border-strong'}`}>
                    <p className={`text-xs font-semibold flex items-center gap-1 ${postType === t.value ? 'text-blue-700' : 'text-text'}`}><span>{t.icon}</span>{t.label}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Tone</label>
              <div className="flex flex-wrap gap-1.5">
                {TONES.map(t => (
                  <button key={t.value} onClick={() => setTone(t.value)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${tone === t.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-border text-text-secondary hover:border-stone-300'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Image</label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setIncludeImage(true)} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${includeImage ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-border text-text-secondary hover:border-stone-300'}`}>🖼️ With Image</button>
                <button onClick={() => setIncludeImage(false)} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${!includeImage ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-border text-text-secondary hover:border-stone-300'}`}>📝 Text Only</button>
              </div>
            </div>

            {includeImage && (
              <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/30 p-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Image Style</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {IMAGE_STYLES.map(s => (
                      <button key={s.value} onClick={() => setStyle(s.value)}
                        className={`text-left rounded-xl border px-2 py-2 transition-all ${style === s.value ? 'border-blue-500 bg-white shadow-sm' : 'border-stone-200 bg-white hover:border-stone-300'}`}>
                        <p className={`text-[11px] font-semibold flex items-center gap-1 ${style === s.value ? 'text-blue-700' : 'text-text'}`}><span>{s.icon}</span>{s.label}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Aspect Ratio</label>
                  <AspectRatioSelector value={aspectRatio} onChange={setAspectRatio} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Campaign (optional)</label>
                <select value={campaignId} onChange={e => setCampaign(e.target.value)} className="w-full rounded-xl border border-border bg-white text-text text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">No campaign</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Additional Notes (optional)</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. mention NEOM project" className="w-full rounded-xl border border-border bg-white text-text text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>

            {/* Reference images — guide the AI image generation (image-to-image) */}
            {includeImage && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Reference Images <span className="text-text-tertiary">(optional — guides the generated visual)</span></label>
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
                    className="w-14 h-14 rounded-lg border-2 border-dashed border-border hover:border-blue-400 hover:bg-surface-subtle flex items-center justify-center text-text-tertiary transition-colors" title="Add references">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                </div>
              </div>
            )}

            {topic && (
              <div className="rounded-xl bg-stone-50 border border-border p-3 space-y-1.5">
                <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Sent to workflow on this date</p>
                {[
                  { k: 'scheduled_date', v: dateKey },
                  { k: 'topic',          v: topic },
                  { k: 'tone',           v: tone },
                  { k: 'post_type',      v: postType },
                  { k: 'include_image',  v: String(includeImage) },
                  { k: 'upload_type',    v: 'generate' },
                  ...(includeImage ? [{ k: 'style', v: style }] : []),
                  ...(includeImage && references.length ? [{ k: 'reference_images', v: `${references.length} attached` }] : []),
                ].map(row => (
                  <div key={row.k} className="flex items-start gap-3 text-[11px]">
                    <span className="text-text-tertiary font-mono w-28 flex-shrink-0">{row.k}</span>
                    <span className="text-text truncate">{row.v}</span>
                  </div>
                ))}
              </div>
            )}
          </>)}

          {/* ════ UPLOAD TAB ════ */}
          {tab === 'upload' && (<>
            <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 flex items-start gap-3">
              <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <div className="text-xs text-blue-700 leading-relaxed">
                <p className="font-semibold mb-0.5">Caption-only generation</p>
                <p>Upload your images — n8n will skip image generation and write the caption only. 1 image = single post. 2–10 = document/carousel.</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Topic / Brief <span className="text-red-400">*</span></label>
              <Textarea placeholder="Describe what these images show..." value={uploadTopic} onChange={e => setUploadTopic(e.target.value)} rows={3} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-medium text-text-secondary">Images {totalImages > 0 && <span className="text-text-tertiary">({totalImages}/10{isCarousel ? ' · Carousel/Doc' : ' · Single'})</span>}</label>
              </div>

              {existingUrls.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {existingUrls.map((url,i) => (
                    <div key={i} className="relative group w-16 h-16 rounded-xl overflow-hidden border border-border">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      <button onClick={() => removeExistingUrl(i)} className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {files.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {files.map((file,i) => (
                    <div key={i} className="relative group w-16 h-16 rounded-xl overflow-hidden border border-blue-300">
                      <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
                      <button onClick={() => removeNewFile(i)} className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                      <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-blue-500 text-white px-1 rounded font-bold">NEW</span>
                    </div>
                  ))}
                </div>
              )}

              {totalImages < 10 && (
                <label className="flex flex-col items-center justify-center gap-2 w-full rounded-2xl border-2 border-dashed border-stone-300 hover:border-blue-400 bg-stone-50 hover:bg-blue-50/30 transition-all cursor-pointer py-6 px-4">
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
                  <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  </div>
                  <p className="text-sm font-medium text-text-secondary text-center">Click to select images<br/><span className="text-xs text-text-tertiary font-normal">JPG, PNG, WebP · max 10</span></p>
                </label>
              )}
              {uploadError && <p className="text-xs text-red-500 mt-2">{uploadError}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Campaign (optional)</label>
                <select value={uploadCampaign} onChange={e => setUploadCampaign(e.target.value)} className="w-full rounded-xl border border-border bg-white text-text text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">No campaign</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Notes (optional)</label>
                <input value={uploadNotes} onChange={e => setUploadNotes(e.target.value)} placeholder="e.g. use warm tone" className="w-full rounded-xl border border-border bg-white text-text text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-text-secondary">Aspect Ratio</label>
              </div>
              <AspectRatioSelector value={uploadAR} onChange={setUploadAR} />
            </div>
          </>)}

          {/* ════ VIDEO TAB ════ */}
          {tab === 'video' && (<>

            <div className="rounded-xl border border-purple-100 bg-purple-50/50 px-4 py-3 flex items-start gap-3">
              <svg className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <p className="text-xs text-purple-700 leading-relaxed">Plan a <strong>Video brief</strong> for this day. n8n will receive the brief and trigger your video production workflow at 8am.</p>
            </div>

            {/* Video Type */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Video Type</label>
              <div className="grid grid-cols-2 gap-1.5">
                {LI_VIDEO_TYPES.map(t => (
                  <button key={t.value} onClick={() => setVideoType(t.value)}
                    className={`text-left rounded-xl border px-3 py-2 transition-all ${videoType === t.value ? 'border-purple-500 bg-purple-50' : 'border-border bg-white hover:border-border-strong'}`}>
                    <p className={`text-xs font-semibold flex items-center gap-1 ${videoType === t.value ? 'text-purple-700' : 'text-text'}`}>
                      <span>{t.icon}</span>{t.label}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Length */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Length</label>
                <div className="flex flex-col gap-1">
                  {LI_VIDEO_LENGTHS.map(l => (
                    <button key={l.value} onClick={() => setVideoLength(l.value)}
                      className={`text-left px-3 py-2 rounded-xl border text-xs transition-all ${videoLength === l.value ? 'border-purple-500 bg-purple-50 text-purple-700 font-semibold' : 'border-border text-text-secondary hover:border-border-strong'}`}>
                      {l.label} <span className="opacity-60">· {l.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Audience */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Target Audience</label>
                <div className="flex flex-col gap-1">
                  {LI_AUDIENCES.map(a => (
                    <button key={a.value} onClick={() => setVideoAudience(a.value)}
                      className={`text-left px-3 py-2 rounded-xl border text-xs transition-all ${videoAudience === a.value ? 'border-purple-500 bg-purple-50 text-purple-700 font-semibold' : 'border-border text-text-secondary hover:border-border-strong'}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Working Title <span className="text-red-400">*</span></label>
              <input value={videoTitle} onChange={e => setVideoTitle(e.target.value)}
                placeholder="e.g. How We Lit the Riyadh Metro Stations"
                className="w-full text-sm border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-300" />
            </div>

            {/* Brief */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Content Brief <span className="text-red-400">*</span></label>
              <Textarea placeholder={"What is this video about?\nWho's speaking? What visuals/b-roll needed?"} value={videoBrief} onChange={e => setVideoBrief(e.target.value)} rows={3} />
            </div>

            {/* Key Points */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Key Points / Script Notes</label>
              <Textarea placeholder={"• Point 1\n• Point 2\n• Point 3"} value={videoPoints} onChange={e => setVideoPoints(e.target.value)} rows={3} />
            </div>

            {/* CTA */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Call to Action</label>
              <input value={videoCta} onChange={e => setVideoCta(e.target.value)}
                placeholder="e.g. Comment below, visit arak-sa.com"
                className="w-full text-sm border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-300" />
            </div>

            {videoTitle.trim() && videoBrief.trim() && (
              <div className="rounded-xl bg-stone-50 border border-border p-3 space-y-1.5">
                <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Sent to workflow on this date</p>
                {[
                  { k: 'scheduled_date', v: dateKey },
                  { k: 'upload_type',    v: 'video' },
                  { k: 'video_type',     v: videoType },
                  { k: 'video_length',   v: videoLength },
                  { k: 'audience',       v: videoAudience },
                  { k: 'title',          v: videoTitle },
                  { k: 'brief',          v: videoBrief.slice(0, 60) + (videoBrief.length > 60 ? '…' : '') },
                ].map(row => (
                  <div key={row.k} className="flex items-start gap-3 text-[11px]">
                    <span className="text-text-tertiary font-mono w-28 flex-shrink-0">{row.k}</span>
                    <span className="text-text truncate">{row.v}</span>
                  </div>
                ))}
              </div>
            )}

          </>)}

          {/* Delete confirm */}
          {confirmDelete && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-4">
              <p className="text-sm font-semibold text-red-700 mb-1">Delete this scheduled post?</p>
              <p className="text-xs text-red-600 mb-3">This removes the plan from both the calendar and Supabase.</p>
              <div className="flex gap-2">
                <button onClick={() => { setConfirmDelete(false); onClear() }} className="flex-1 py-2 rounded-xl bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors">Yes, delete it</button>
                <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2 rounded-xl border border-border text-xs font-medium text-text-secondary hover:bg-surface-subtle transition-colors">Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-3 flex-shrink-0">
          {entry && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
              Delete
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-text-secondary hover:bg-surface-subtle transition-colors">Cancel</button>

          {tab === 'generate' && (
            <button onClick={handleSaveGenerate} disabled={!topic.trim()}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#0A66C2] hover:bg-[#004182] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              Save Post Plan
            </button>
          )}
          {tab === 'upload' && (
            <button onClick={handleSaveUpload} disabled={!uploadTopic.trim() || totalImages === 0 || uploading}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#0A66C2] hover:bg-[#004182] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
              {uploading ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Uploading…</> : 'Save & Upload Images'}
            </button>
          )}
          {tab === 'video' && (
            <button onClick={handleSaveVideo} disabled={!videoTitle.trim() || !videoBrief.trim()}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{ background: videoTitle.trim() && videoBrief.trim() ? '#4c5e61' : '#9ca3af' }}>
              Save Video Plan
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

  return createPortal(content, document.body)
}

// ─── Posts List ──────────────────────────────────────────────────────────────
function PostsList({ posts, dispatch, state, onCreateClick, updatePostStatus, webhookUrl, regenWebhookUrl }) {
  const [filter,       setFilter]       = useState('all')
  const [selectedPost, setSelectedPost] = useState(null)

  const { accessToken } = useAuth()
  const supabaseUrl = SUPABASE_URL
  const anonKey     = accessToken || ''

  const filtered = filter === 'all' ? posts : posts.filter(p =>
    filter === 'pending_publish' ? p.status === 'pending_publish' :
    filter === 'published'       ? p.status === 'published' :
    p.status === filter
  )

  async function handleStatusChange(post, newStatus) {
    if (post._fromSupabase && updatePostStatus) await updatePostStatus(post.id, newStatus)
    else dispatch({ type: 'UPDATE_POST', payload: { id: post.id, status: newStatus } })
    if (selectedPost?.id === post.id) setSelectedPost(prev => ({ ...prev, status: newStatus }))
  }

  async function handleDelete(post) {
    if (post._fromSupabase && supabaseUrl && anonKey) {
      const table = post._table || 'linkedin_generated_posts'
      await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${post.id}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${anonKey}` },
      })
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
      <div className="flex gap-2 flex-wrap items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`relative px-4 py-1.5 rounded-xl text-xs font-semibold transition-all ${filter === f.key ? 'bg-[#0A66C2] text-white shadow-md' : 'text-text-secondary bg-white border border-border hover:border-stone-300 hover:text-text'}`}>
              {f.label}
              {f.count > 0 && (
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 leading-[1.4] font-bold ${filter === f.key ? 'bg-white/25 text-white' : 'bg-surface-subtle text-text-tertiary'}`}>{f.count}</span>
              )}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-text-tertiary">{filtered.length} post{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-[#0A66C2]">
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
          </div>
          <p className="font-medium text-text mb-1">No {filter !== 'all' ? FILTERS.find(f2=>f2.key===filter)?.label.toLowerCase()+' ' : ''}posts yet</p>
          <p className="text-sm text-text-secondary mb-4">Generate your first AI-powered LinkedIn post for Arak Lighting.</p>
          <Button onClick={onCreateClick}>Create Post</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map(p => {
            const campaign = (state.campaigns || []).find(c => c.id === p.campaignId)
            const typeMeta = POST_TYPES.find(t => t.value === p.postType)
            const imgSrc   = p.includeImage === true ? (p.imageUrl || p.mediaUrls?.[0]) : null
            const hookLine = p.hook || p.copy?.split('\n')[0] || ''
            return (
              <Card key={p.id} className="overflow-hidden cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-150"
                onClick={() => setSelectedPost(p)}>
                <div className="flex">
                  {imgSrc && (
                    <div className="w-32 flex-shrink-0 bg-surface-subtle overflow-hidden"
                      style={{ aspectRatio: (p.aspectRatio || '1.91:1').replace(':','/'), minHeight: '70px', maxHeight: '120px' }}>
                      <PostImage src={imgSrc} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="flex-1 p-4 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge status={p.status === 'pending_publish' ? 'pending' : p.status} />
                        {p.generatedByWorkflow && <span className="text-[10px] bg-purple-50 text-purple-600 px-1.5 py-0.5 leading-[1.4] font-medium">AI</span>}
                        {p._fromSupabase && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 leading-[1.4] font-medium">📅 Scheduled</span>}
                        {typeMeta && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 leading-[1.4]">{typeMeta.icon} {typeMeta.label}</span>}
                        {!imgSrc && <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 leading-[1.4]">📝 Text only</span>}
                        {campaign && <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 leading-[1.4] font-medium">{campaign.name}</span>}
                      </div>
                      <button onClick={e => { e.stopPropagation(); handleDelete(p) }} className="text-text-tertiary hover:text-red-500 transition-colors flex-shrink-0 p-1 -m-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                      </button>
                    </div>
                    {hookLine && <p className="text-sm font-semibold text-text leading-tight mb-1">{hookLine}</p>}
                    <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed mb-1.5">{p.copy?.replace(hookLine, '').trim()}</p>
                    {p.hashtags && <p className="text-xs text-blue-500 line-clamp-1 mb-1.5">{p.hashtags}</p>}
                    <p className="text-[11px] text-text-tertiary">{formatDateTime(p.createdAt)}{p.topic && <span className="ml-1.5 opacity-70">· {p.topic}</span>}</p>
                    <p className="text-[10px] text-text-tertiary mt-1 opacity-60">Click to open full view</p>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {selectedPost && createPortal(
        <PostDetail
          post={selectedPost}
          state={state}
          webhookUrl={webhookUrl}
          regenWebhookUrl={regenWebhookUrl}
          onClose={() => setSelectedPost(null)}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onImageUpdated={(postId, newUrl) => {
            dispatch({ type: 'UPDATE_POST', payload: { id: postId, imageUrl: newUrl, mediaUrls: [newUrl] } })
            setSelectedPost(prev => prev?.id === postId ? { ...prev, imageUrl: newUrl, mediaUrls: [newUrl] } : prev)
          }}
          onPostUpdated={(updatedPost) => {
            dispatch({ type: 'UPDATE_POST', payload: updatedPost })
            setSelectedPost(prev => ({ ...prev, ...updatedPost }))
          }}
          supabaseUrl={supabaseUrl}
          anonKey={anonKey}
        />,
        document.body
      )}
    </div>
  )
}

// ─── Post Detail Modal ───────────────────────────────────────────────────────
function PostDetail({ post, state, webhookUrl, regenWebhookUrl, onClose, onStatusChange, onDelete, onPostUpdated, onImageUpdated, supabaseUrl, anonKey }) {
  const { dispatch } = useApp()
  const { activeWorkspaceId } = useAuth()
  const [regenLoading, setRegenLoading] = useState(false)
  const [regenError,   setRegenError]   = useState('')
  const [currentImage, setCurrentImage] = useState(post.imageUrl || post.mediaUrls?.[0] || '')
  const [stagedImage,  setStagedImage]  = useState(null)
  const allImages    = (post.mediaUrls && post.mediaUrls.length > 1) ? post.mediaUrls : null
  const [carouselIdx, setCarouselIdx]   = useState(0)
  const displayImage = stagedImage || (allImages ? (allImages[carouselIdx] || allImages[0]) : currentImage)
  const [approved,     setApproved]     = useState(post.status === 'published')
  const [savedToMedia, setSavedToMedia] = useState(false)

  function handleSaveToMedia() {
    const imageToSave = allImages ? (allImages[carouselIdx] || allImages[0]) : currentImage
    if (!imageToSave) return
    const fileName = `${(post.topic || 'post').replace(/[^a-z0-9]/gi,'_').toLowerCase()}_${Date.now()}.webp`
    dispatch(actions.addMedia({
      id:        Date.now().toString(36),
      name:      fileName,
      type:      'image/webp',
      size:      0,
      dataUrl:   imageToSave,
      sourceUrl: imageToSave,
      platform:  'linkedin',
      topic:     post.topic,
      createdAt: new Date().toISOString(),
    }))
    setSavedToMedia(true)
    setTimeout(() => setSavedToMedia(false), 3000)
  }
  const [expanded,     setExpanded]     = useState(false)
  const [editing,      setEditing]      = useState(false)
  const [editHook,     setEditHook]     = useState(post.hook || '')
  const [editBody,     setEditBody]     = useState(post.body || post.copy?.replace((post.hook || '') + '\n\n', '') || '')
  const [editHashtags, setEditHashtags] = useState(post.hashtags || '')
  const [saveLoading,  setSaveLoading]  = useState(false)
  const [saveError,    setSaveError]    = useState('')
  const [saveSuccess,  setSaveSuccess]  = useState(false)
  const [studioOpen,   setStudioOpen]   = useState(false)

  // Apply a Caption Studio result into the existing hook/body/hashtags edit
  // fields — reviewer then hits the normal Save Changes to persist.
  function applyStudio({ hook, body, hashtags }) {
    setEditHook(hook || '')
    setEditBody(body || '')
    setEditHashtags(hashtags || '')
    setEditing(true)
  }

  async function handleSaveEdit() {
    setSaveLoading(true); setSaveError(''); setSaveSuccess(false)
    const updated = {
      ...post,
      hook:     editHook,
      body:     editBody,
      hashtags: editHashtags,
      copy:     editHook ? `${editHook}\n\n${editBody}` : editBody,
    }
    // Update local store
    if (onPostUpdated) onPostUpdated(updated)
    // Feedback signal for Brand Brain — same idea as Instagram's caption
    // diff logging, captures what humans changed before approving.
    logEditFeedback(activeWorkspaceId, anonKey, {
      platform: 'linkedin', postId: post.id, field: 'hook_body',
      original: `${post.hook || ''}\n\n${post.body || ''}`,
      edited:   `${editHook}\n\n${editBody}`,
    })
    // Sync to Supabase if it's a remote post
    if (post._fromSupabase && supabaseUrl && anonKey) {
      try {
        const res = await fetch(`${supabaseUrl}/rest/v1/linkedin_generated_posts?id=eq.${post.id}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${anonKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            hook:       editHook,
            body:       editBody,
            hashtags:   editHashtags,
            updated_at: new Date().toISOString(),
          }),
        })
        if (!res.ok) { const err = await res.text(); setSaveError(`Supabase sync failed: ${err}`); setSaveLoading(false); return }
      } catch (err) { setSaveError(`Sync error: ${err.message}`); setSaveLoading(false); return }
    }
    setSaveLoading(false); setSaveSuccess(true); setEditing(false)
    setTimeout(() => setSaveSuccess(false), 2000)
  }

  const typeMeta  = POST_TYPES.find(t => t.value === post.postType)
  const styleMeta = IMAGE_STYLES.find(s => s.value === post.style)
  const hasImage  = !!(currentImage || stagedImage) && post.includeImage !== false

  async function handleSaveRegenImage() {
    if (!stagedImage) return
    setCurrentImage(stagedImage)
    setStagedImage(null)
    onImageUpdated(post.id, stagedImage)
    // Update Supabase
    if (supabaseUrl && anonKey && post._fromSupabase) {
      const table = post._table || 'linkedin_generated_posts'
      await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${post.id}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ image_url: stagedImage, updated_at: new Date().toISOString() }),
      })
    }
  }

  function handleDiscardRegenImage() { setStagedImage(null) }

  const activeRegenUrl = post._fromSupabase ? (regenWebhookUrl || webhookUrl) : webhookUrl

  async function handleRegenImage() {
    if (!activeRegenUrl) { setRegenError(post._fromSupabase ? 'Configure the LinkedIn Schedule Regen webhook in Settings → Integrations.' : 'Configure the LinkedIn webhook in Settings → Integrations.'); return }
    setRegenLoading(true); setRegenError('')
    try {
      const body = post._fromSupabase
        ? { post_id: post.id, image_prompt: post.imagePrompt || post.topic || '', style: post.style || 'photorealistic', aspect_ratio: post.aspectRatio || '1.91:1', topic: post.topic || '' }
        : { route_type: 'image_only', image_prompt: post.imagePrompt || post.topic || '', style: post.style || 'photorealistic', aspect_ratio: post.aspectRatio || '1.91:1', topic: post.topic || '' }
      const res  = await fetch(activeRegenUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
      setStagedImage(data.image_url)
    } catch (err) { setRegenError(`Failed: ${err.message}`) }
    finally { setRegenLoading(false) }
  }

  const arParts    = (post.aspectRatio || '1.91:1').split(':').map(Number)
  const arCss      = `${arParts[0]}/${arParts[1]}`
  const isPortrait = arParts[1] > arParts[0]
  const fullText   = post.hook ? `${post.hook}

${post.body || ''}` : (post.body || post.copy || '')
  const preview    = post.hook || fullText.slice(0, 180)

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.82)', padding: '24px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-3xl  overflow-hidden flex flex-col"
        style={{ width: '100%', maxWidth: hasImage ? '1100px' : '700px', maxHeight: '94vh' }}>

        {/* Top bar */}
        <div className="flex items-center justify-between px-7 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-2.5 py-1 leading-[1.4] tracking-wide ${post.status === 'pending_publish' ? 'bg-amber-100 text-amber-700' : post.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
              {post.status === 'pending_publish' ? '● Pending Review' : post.status === 'published' ? '✓ Published' : '⏰ Scheduled'}
            </span>
            {post._fromSupabase       && <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 leading-[1.4] font-medium">📅 Monthly Schedule</span>}
            {post.generatedByWorkflow && <span className="text-xs bg-purple-50 text-purple-600 border border-purple-200 px-1.5 py-0.5 leading-[1.4] font-medium">✦ AI Generated</span>}
            {typeMeta  && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 leading-[1.4]">{typeMeta.icon} {typeMeta.label}</span>}
            {!hasImage && <span className="text-xs bg-stone-100 text-stone-500 px-1.5 py-0.5 leading-[1.4]">📝 Text only</span>}
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-text-tertiary hover:bg-stone-100 hover:text-text transition-colors ml-3 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>

          {/* Left — image panel (only when image exists) */}
          {hasImage && (
            <div className="flex-shrink-0 flex flex-col overflow-y-auto"
              style={{ background: '#f3f5f4', width: isPortrait ? '360px' : '460px' }}>
              <div className="flex-1 flex items-center justify-center p-5">
                <div style={{ width: '100%', position: 'relative' }}>
                  <div style={{ width: '100%', aspectRatio: arCss, borderRadius: '14px', overflow: 'hidden', position: 'relative' }}>
                    <PostImage src={displayImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />

                    {/* Carousel nav arrows */}
                    {allImages && allImages.length > 1 && (<>
                      <button onClick={() => setCarouselIdx(i => Math.max(0, i - 1))} disabled={carouselIdx === 0}
                        style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.85)', border: 'none', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: carouselIdx === 0 ? 0.3 : 1, transition: 'opacity 0.15s' }}>
                        <svg width="16" height="16" fill="none" stroke="#1a1410" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
                      </button>
                      <button onClick={() => setCarouselIdx(i => Math.min(allImages.length - 1, i + 1))} disabled={carouselIdx === allImages.length - 1}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.85)', border: 'none', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: carouselIdx === allImages.length - 1 ? 0.3 : 1, transition: 'opacity 0.15s' }}>
                        <svg width="16" height="16" fill="none" stroke="#1a1410" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                      </button>
                      <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.5)', borderRadius: 8, padding: '3px 8px' }}>
                        <span style={{ color: '#fff', fontSize: 11, fontWeight: 600 }}>{carouselIdx + 1} / {allImages.length}</span>
                      </div>
                    </>)}
                  </div>

                  {/* Dot indicators */}
                  {allImages && allImages.length > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 10 }}>
                      {allImages.map((_, i) => (
                        <button key={i} onClick={() => setCarouselIdx(i)}
                          style={{ width: i === carouselIdx ? 20 : 7, height: 7, borderRadius: 4, border: 'none', cursor: 'pointer', transition: 'all 0.2s', background: i === carouselIdx ? '#0A66C2' : 'rgba(10,102,194,0.25)' }} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="px-5 pb-5 flex flex-col gap-2.5">
                {/* Preview badge */}
                {stagedImage && (
                  <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(10,102,194,0.9)', borderRadius: 8, padding: '3px 10px', pointerEvents: 'none' }}>
                    <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}>PREVIEW</span>
                  </div>
                )}

                {/* Save / Discard staged image */}
                {stagedImage ? (
                  <div className="flex gap-2">
                    <button onClick={handleSaveRegenImage}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-bold text-white transition-all active:scale-95"
                      style={{ background: '#0A66C2' }}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                      Save Image
                    </button>
                    <button onClick={handleDiscardRegenImage}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-bold text-white/80 hover:text-white transition-all active:scale-95"
                      style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.2)' }}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      Discard
                    </button>
                  </div>
                ) : (
                  <button onClick={handleRegenImage} disabled={regenLoading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-bold text-white disabled:opacity-50 transition-all active:scale-95 bg-[#0A66C2] hover:bg-[#004182]">
                    {regenLoading ? <><Spinner size="sm" /><span>Generating…</span></> : <><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.27-4.93"/></svg><span>Regenerate Image</span></>}
                  </button>
                )}
                {regenError && <div className="rounded-xl bg-red-900/40 border border-red-800 px-3 py-2 text-xs text-red-300 text-center">{regenError}</div>}
                {post.imagePrompt && (
                  <div className="rounded-xl border px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.75)', borderColor: '#aac8e8' }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#4a7aaa' }}>Image Prompt</p>
                    <p className="text-[11px] text-stone-400 leading-relaxed line-clamp-3">{post.imagePrompt}</p>
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  {post.aspectRatio && <span className="text-[11px] px-2.5 py-1 rounded-lg font-mono" style={{ background: 'rgba(255,255,255,0.75)', border: '1px solid #aac8e8', color: '#2a6098' }}>{post.aspectRatio}</span>}
                  {post.scheduledAt && <span className="text-[11px] px-2.5 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.75)', border: '1px solid #aac8e8', color: '#2a6098' }}>📅 {post.scheduledAt}</span>}
                </div>
              </div>
            </div>
          )}

          {/* Right — LinkedIn post preview */}
          <div className="flex-1 flex flex-col overflow-y-auto min-w-0 bg-[#f3f2ef]">
            <div className="flex-1 p-6 space-y-4">

              {/* LinkedIn post card */}
                {/* DESIGN-SYSTEM EXCEPTION. Everything below renders a facsimile of
                    the real platform's post UI, so it deliberately keeps that
                    platform's rounded corners and round avatar instead of this
                    app's square language. Its job is to answer "what will this
                    look like once it's live", and a preview restyled to match
                    our chrome answers a different question. Do not flatten. */}
              <div className="bg-white rounded-[8px] border border-stone-200 overflow-hidden">
                {/* Post header */}
                <div className="px-4 pt-4 pb-3 flex items-start gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-700 to-blue-900 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <span className="text-white text-sm font-bold">AL</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-stone-900 text-sm leading-tight">Arak Lighting</p>
                    <p className="text-[12px] text-stone-500 leading-tight mt-0.5">Saudi Arabia's Leading Architectural Lighting Company</p>
                    <p className="text-[11px] text-stone-400 mt-0.5 flex items-center gap-1">
                      {post.scheduledAt ? `📅 Scheduled · ${post.scheduledAt}` : formatDateTime(post.createdAt)} · 
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                    </p>
                  </div>
                  <button className="text-stone-400 hover:text-stone-600 transition-colors flex-shrink-0">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                  </button>
                </div>

                {/* Post text — view or edit */}
                <div className="px-4 pb-3">
                  {editing ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-1">Hook (first line)</p>
                        <input value={editHook} onChange={e => setEditHook(e.target.value)}
                          className="w-full text-sm font-semibold text-stone-900 border border-blue-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-blue-50/30" />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-1">Body</p>
                        <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={8}
                          className="w-full text-sm text-stone-800 leading-relaxed border border-stone-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-1">Hashtags</p>
                        <input value={editHashtags} onChange={e => setEditHashtags(e.target.value)}
                          className="w-full text-sm text-[#0A66C2] border border-stone-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      </div>
                      {saveError && <p className="text-xs text-red-500">{saveError}</p>}
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-stone-800 leading-relaxed whitespace-pre-line">
                        {expanded ? fullText : preview}
                        {!expanded && fullText.length > preview.length && (
                          <button onClick={() => setExpanded(true)} className="text-stone-500 font-medium ml-1 hover:text-stone-700 hover:underline">…see more</button>
                        )}
                        {expanded && (
                          <button onClick={() => setExpanded(false)} className="text-stone-500 font-medium ml-2 hover:underline text-xs">show less</button>
                        )}
                      </p>
                      {post.hashtags && (
                        <p className="text-sm text-[#0A66C2] mt-2 leading-relaxed">{editHashtags || post.hashtags}</p>
                      )}
                    </>
                  )}
                </div>

                {/* Image inside post card (when exists) — smaller thumbnail */}
                {hasImage && (
                  <div className="mx-4 mb-3 rounded-xl overflow-hidden border border-stone-100"
                    style={{ aspectRatio: arCss }}>
                    <PostImage src={currentImage} alt="" className="w-full h-full object-cover" />
                  </div>
                )}

                {/* Engagement mock */}
                <div className="px-4 py-2 border-t border-stone-100">
                  <div className="flex items-center gap-1 mb-2">
                    <div className="flex -space-x-1">
                      <span className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center text-[8px]">👍</span>
                      <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-[8px]">💡</span>
                    </div>
                    <span className="text-[11px] text-stone-400 ml-1">Be the first to react</span>
                  </div>
                  <div className="flex items-center gap-1 pt-1 border-t border-stone-100">
                    {[
                      { icon: '👍', label: 'Like' },
                      { icon: '💬', label: 'Comment' },
                      { icon: '🔁', label: 'Repost' },
                      { icon: '📤', label: 'Send' },
                    ].map(a => (
                      <button key={a.label} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-[12px] font-medium text-stone-500 hover:bg-stone-50 transition-colors">
                        <span>{a.icon}</span><span className="hidden sm:block">{a.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Meta / strategy card */}
              {(post.trendingAngle || post.postStrategy || post.topic) && (
                <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-2.5">
                  {post.topic && (
                    <div>
                      <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-0.5">Topic</p>
                      <p className="text-xs text-stone-700 leading-relaxed">{post.topic}</p>
                    </div>
                  )}
                  {(post.trendingAngle || post.postStrategy) && (
                    <div>
                      <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-0.5">{post.trendingAngle ? 'Trend Angle' : 'Post Strategy'}</p>
                      <p className="text-xs text-stone-600 leading-relaxed">{post.trendingAngle || post.postStrategy}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-[11px] text-stone-400 pt-1 border-t border-stone-100 flex-wrap">
                    <span>🕐 {formatDateTime(post.createdAt)}</span>
                    {typeMeta && <span>{typeMeta.icon} {typeMeta.label}</span>}
                    {styleMeta && <span>{styleMeta.icon} {styleMeta.label}</span>}
                  </div>
                </div>
              )}

              {/* Text-only regen error */}
              {!hasImage && regenError && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-600">{regenError}</div>
              )}
            </div>

            {/* Action bar */}
            <div className="px-6 py-5 border-t border-stone-200 bg-white flex gap-3 flex-shrink-0">
              {post.status !== 'published' && (
                <button onClick={() => { onStatusChange(post, 'published'); setApproved(true) }}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold text-white transition-all active:scale-95"
                  style={{ background: approved ? '#16a34a' : '#0A66C2' }}>
                  {approved
                    ? <><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Approved!</>
                    : <><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Approve & Publish</>}
                </button>
              )}
              {post.status === 'published' && (
                <div className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold bg-green-50 text-green-700 border-2 border-green-200">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Published
                </div>
              )}
              {post.status !== 'scheduled' && post.status !== 'published' && (
                <button onClick={() => onStatusChange(post, 'scheduled')} className="px-5 py-3 rounded-2xl text-sm font-semibold border-2 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">
                  Schedule
                </button>
              )}
              {!editing && (
                <button onClick={() => setStudioOpen(true)}
                  className="px-5 py-3 rounded-2xl text-sm font-semibold border-2 border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors flex items-center gap-1.5">
                  ✨ Rewrite
                </button>
              )}
              {!editing && (
                <button onClick={() => { setEditHook(post.hook || ''); setEditBody(post.body || post.copy?.replace((post.hook||'')+'\n\n','') || ''); setEditHashtags(post.hashtags || ''); setEditing(true) }}
                  className="px-5 py-3 rounded-2xl text-sm font-semibold border-2 border-stone-300 bg-white text-stone-600 hover:bg-stone-50 transition-colors flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit
                </button>
              )}
              {editing && (
                <>
                  <button onClick={() => { setEditing(false); setSaveError('') }}
                    className="px-5 py-3 rounded-2xl text-sm font-semibold border-2 border-border text-text-secondary hover:bg-stone-100 transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleSaveEdit} disabled={saveLoading}
                    className={`px-5 py-3 rounded-2xl text-sm font-semibold text-white transition-colors disabled:opacity-50 flex items-center gap-1.5 ${saveSuccess ? 'bg-green-500' : 'bg-[#0A66C2] hover:bg-[#004182]'}`}>
                    {saveLoading ? <><Spinner size="sm" />Saving…</> : saveSuccess ? '✓ Saved' : 'Save Changes'}
                  </button>
                </>
              )}
              {!editing && onDelete && (
                <button onClick={() => { onDelete(post); onClose() }} className="px-5 py-3 rounded-2xl text-sm font-semibold border-2 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                  Delete
                </button>
              )}
              {!editing && currentImage && (
                <button onClick={handleSaveToMedia}
                  title="Save image to Media Library"
                  className={`px-4 py-3 rounded-2xl text-sm font-semibold border-2 transition-all flex items-center gap-1.5 ${savedToMedia ? 'border-green-300 bg-green-50 text-green-700' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}>
                  {savedToMedia
                    ? <><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Saved!</>
                    : <><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save to Library</>}
                </button>
              )}
              {!editing && (
                <button onClick={onClose} className="px-5 py-3 rounded-2xl text-sm font-semibold border-2 border-border text-text-secondary hover:bg-stone-100 transition-colors">
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {studioOpen && (
        <CaptionStudio
          open={studioOpen}
          onClose={() => setStudioOpen(false)}
          webhookUrl={state.webhooks?.captionStudio || ''}
          platform="linkedin"
          language={state.brandProfile?.captionLanguage || 'both'}
          context={{ topic: post.topic || '', angle: post.angle || post.trending_angle || '', tone: post.tone || '', objective: post.objective || '', cta: post.cta || '', instructions: buildInstructionsString(state.brandProfile) || '' }}
          current={{ hook: post.hook || '', body: post.body || '', hashtags: post.hashtags || '' }}
          onApply={applyStudio}
        />
      )}
    </div>,
    document.body
  )
}

// Exported so the cross-platform Approvals page can reuse this exact review
// UI (regen/crop/tone-switch/approve) instead of duplicating it.
export { PostDetail as LinkedInPostDetail }

// ─── LinkedIn Video Panel ─────────────────────────────────────────────────
const LI_VIDEO_TYPES = [
  { value: 'thought_leadership', label: 'Thought Leadership', icon: '🧠', desc: 'Expert opinion, industry POV, speaking to camera' },
  { value: 'case_study',         label: 'Case Study / Project', icon: '🏛️', desc: 'Showcase a completed project with results' },
  { value: 'product_demo',       label: 'Product Demo',       icon: '💡', desc: 'Walk through a lighting fixture or system' },
  { value: 'company_culture',    label: 'Company Culture',    icon: '🤝', desc: 'Team, values, milestones, anniversary' },
  { value: 'event_highlight',    label: 'Event Highlight',    icon: '🎪', desc: 'Expo, conference, trade show coverage' },
  { value: 'tutorial',           label: 'How-To / Tutorial',  icon: '📐', desc: 'Technical tips, installation guides, lighting specs' },
]

const LI_VIDEO_LENGTHS = [
  { value: '30s-1m',  label: '30s – 1 min',  desc: 'Native video sweet spot' },
  { value: '1m-3m',   label: '1 – 3 min',    desc: 'Document / story format' },
  { value: '3m-10m',  label: '3 – 10 min',   desc: 'Deep-dive / case study' },
]

const LI_AUDIENCES = [
  { value: 'architects',    label: 'Architects & Designers' },
  { value: 'developers',    label: 'Real Estate Developers' },
  { value: 'contractors',   label: 'MEP Contractors' },
  { value: 'consultants',   label: 'Lighting Consultants' },
  { value: 'hospitality',   label: 'Hospitality Procurement' },
  { value: 'general_b2b',   label: 'General B2B' },
]

const LI_VIDEO_STATUS_COLORS = {
  planned:   'bg-stone-100 text-stone-600',
  scripting: 'bg-indigo-50 text-indigo-600',
  filming:   'bg-blue-50 text-blue-600',
  editing:   'bg-amber-50 text-amber-700',
  review:    'bg-purple-50 text-purple-600',
  published: 'bg-green-50 text-green-700',
}

function LinkedInVideoPanel({ dispatch }) {
  const [subView,    setSubView]    = useState('planner')
  const [videoType,  setVideoType]  = useState('thought_leadership')
  const [length,     setLength]     = useState('1m-3m')
  const [audience,   setAudience]   = useState('architects')
  const [title,      setTitle]      = useState('')
  const [brief,      setBrief]      = useState('')
  const [keyPoints,  setKeyPoints]  = useState('')
  const [cta,        setCta]        = useState('')
  const [videos, setVideos] = useState(() => {
    try { return JSON.parse(localStorage.getItem('arak_videos_li') || '[]') } catch { return [] }
  })

  function saveVideo() {
    if (!title.trim() || !brief.trim()) return
    const newVideo = {
      id: Date.now().toString(36),
      videoType, length, audience, title, brief, keyPoints, cta,
      status: 'planned',
      createdAt: new Date().toISOString(),
    }
    const updated = [newVideo, ...videos]
    setVideos(updated)
    localStorage.setItem('arak_videos_li', JSON.stringify(updated))
    dispatch(actions.addNotification({ id: newVideo.id, message: `LinkedIn video "${title.slice(0,40)}" brief saved.`, createdAt: new Date().toISOString() }))
    setTitle(''); setBrief(''); setKeyPoints(''); setCta('')
    setSubView('library')
  }

  function deleteVideo(id) {
    const updated = videos.filter(v => v.id !== id)
    setVideos(updated)
    localStorage.setItem('arak_videos_li', JSON.stringify(updated))
  }

  function cycleStatus(id) {
    const cycle = { planned: 'scripting', scripting: 'filming', filming: 'editing', editing: 'review', review: 'published', published: 'planned' }
    const updated = videos.map(v => v.id === id ? { ...v, status: cycle[v.status] || 'planned' } : v)
    setVideos(updated)
    localStorage.setItem('arak_videos_li', JSON.stringify(updated))
  }

  const selectedType = LI_VIDEO_TYPES.find(t => t.value === videoType)

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header strip */}
      <div className="rounded-2xl overflow-hidden border border-[#0A66C2]/30"
        style={{ background: '#0A66C2' }}>
        <div className="p-5 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            </div>
            <div>
              <p className="font-semibold text-white text-sm">LinkedIn Video Studio</p>
              <p className="text-xs text-white/60">Plan & track professional video content</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-white/15 rounded-xl p-1">
            {[{ key: 'planner', label: '+ New Video' }, { key: 'library', label: `Library (${videos.length})` }].map(v => (
              <button key={v.key} onClick={() => setSubView(v.key)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${subView === v.key ? 'bg-white text-[#0A66C2]' : 'text-white/70 hover:text-white'}`}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-5 px-5 pb-4">
          {[
            { label: 'Total',     val: videos.length },
            { label: 'In Progress', val: videos.filter(v => ['scripting','filming','editing','review'].includes(v.status)).length },
            { label: 'Published', val: videos.filter(v => v.status === 'published').length },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className="text-xl font-bold text-white">{s.val}</p>
              <p className="text-[10px] text-white/50 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Planner */}
      {subView === 'planner' && (
        <div className="space-y-4">
          {/* Video type */}
          <Card className="p-5 space-y-3">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Video Type</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {LI_VIDEO_TYPES.map(t => (
                <button key={t.value} onClick={() => setVideoType(t.value)}
                  className={`relative text-left rounded-xl border px-3 py-2.5 transition-all ${videoType === t.value ? 'border-[#0A66C2] bg-blue-50 shadow-sm ring-1 ring-[#0A66C2]/30' : 'border-border bg-white hover:border-border-strong hover:bg-surface-subtle'}`}>
                  {videoType === t.value && (
                    <span className="absolute top-2 right-2 w-4 h-4 bg-[#0A66C2] flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                    </span>
                  )}
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-base leading-none">{t.icon}</span>
                    <span className={`text-xs font-semibold ${videoType === t.value ? 'text-[#0A66C2]' : 'text-text'}`}>{t.label}</span>
                  </div>
                  <p className="text-[11px] text-text-tertiary leading-tight">{t.desc}</p>
                </button>
              ))}
            </div>
          </Card>

          {/* Length + Audience */}
          <Card className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-text-secondary mb-2">Video Length</p>
                <div className="flex flex-col gap-1.5">
                  {LI_VIDEO_LENGTHS.map(l => (
                    <button key={l.value} onClick={() => setLength(l.value)}
                      className={`text-left px-3 py-2 rounded-xl border text-xs transition-all ${length === l.value ? 'border-[#0A66C2] bg-blue-50 text-[#0A66C2] font-semibold' : 'border-border text-text-secondary hover:border-border-strong'}`}>
                      <span className="font-bold block">{l.label}</span>
                      <span className="text-[10px] opacity-70">{l.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-text-secondary mb-2">Target Audience</p>
                <div className="flex flex-col gap-1.5">
                  {LI_AUDIENCES.map(a => (
                    <button key={a.value} onClick={() => setAudience(a.value)}
                      className={`text-left px-3 py-2 rounded-xl border text-xs transition-all ${audience === a.value ? 'border-[#0A66C2] bg-blue-50 text-[#0A66C2] font-semibold' : 'border-border text-text-secondary hover:border-border-strong'}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Title */}
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Video Title / Working Title <span className="text-red-400">*</span></p>
              <input
                value={title} onChange={e => setTitle(e.target.value)}
                placeholder="e.g. How We Lit the Riyadh Metro Stations"
                className="w-full text-sm border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>

            {/* Brief */}
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Content Brief <span className="text-red-400">*</span></p>
              <Textarea
                placeholder={`What is this video about? What's the core message?\nWho's speaking? What visuals/b-roll do you need?`}
                value={brief} onChange={e => setBrief(e.target.value)} rows={3}
              />
            </div>

            {/* Key Points */}
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Key Points / Script Notes</p>
              <Textarea
                placeholder={"• Point 1: The challenge\n• Point 2: Our approach\n• Point 3: The outcome / result"}
                value={keyPoints} onChange={e => setKeyPoints(e.target.value)} rows={3}
              />
            </div>

            {/* CTA */}
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Call to Action</p>
              <input
                value={cta} onChange={e => setCta(e.target.value)}
                placeholder="e.g. Comment your thoughts, visit arak-sa.com, DM for consultation"
                className="w-full text-sm border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>

            {/* Preview */}
            {title.trim() && brief.trim() && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0A66C2]/60">Brief Preview</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-[#0A66C2]">{selectedType?.icon} {selectedType?.label}</span>
                  <span className="text-xs text-blue-400">·</span>
                  <span className="text-xs text-blue-600">{length}</span>
                  <span className="text-xs text-blue-400">·</span>
                  <span className="text-xs text-blue-600">{LI_AUDIENCES.find(a => a.value === audience)?.label}</span>
                </div>
                <p className="text-sm font-semibold text-stone-800">{title}</p>
                <p className="text-xs text-stone-600 leading-relaxed">{brief.slice(0,100)}{brief.length > 100 ? '…' : ''}</p>
              </div>
            )}

            <button onClick={saveVideo} disabled={!title.trim() || !brief.trim()}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-[#0A66C2] hover:bg-[#004182]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
              Save Video Brief
            </button>
          </Card>
        </div>
      )}

      {/* Library */}
      {subView === 'library' && (
        <div className="space-y-3">
          {videos.length === 0 ? (
            <Card className="py-16 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#0A66C2] flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-text">No video briefs yet</p>
                <p className="text-xs text-text-secondary mt-0.5">Plan your first LinkedIn video to get started</p>
              </div>
              <button onClick={() => setSubView('planner')}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#0A66C2] hover:bg-[#004182] transition-colors">
                Plan a Video
              </button>
            </Card>
          ) : (
            videos.map(video => {
              const vt = LI_VIDEO_TYPES.find(t => t.value === video.videoType)
              const aud = LI_AUDIENCES.find(a => a.value === video.audience)
              return (
                <Card key={video.id} className="overflow-hidden">
                  <div className="h-0.5 bg-[#0A66C2]" />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <p className="font-semibold text-text text-sm">{video.title}</p>
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          <span className="text-xs text-text-secondary">{vt?.icon} {vt?.label}</span>
                          <span className="text-[10px] bg-stone-100 text-stone-600 px-1.5 py-0.5 leading-[1.4]">{video.length}</span>
                          {aud && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 leading-[1.4]">{aud.label}</span>}
                          <button onClick={() => cycleStatus(video.id)}
                            className={`text-[10px] px-1.5 py-0.5 leading-[1.4] font-bold uppercase tracking-[0.08em] cursor-pointer transition-opacity hover:opacity-80 ${LI_VIDEO_STATUS_COLORS[video.status]}`}>
                            {video.status.charAt(0).toUpperCase() + video.status.slice(1)}
                          </button>
                        </div>
                      </div>
                      <button onClick={() => deleteVideo(video.id)}
                        className="text-text-tertiary hover:text-red-500 transition-colors flex-shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                      </button>
                    </div>
                    <p className="text-sm text-text-secondary leading-relaxed line-clamp-2">{video.brief}</p>
                    {video.keyPoints && (
                      <p className="text-xs text-text-tertiary mt-1.5 line-clamp-1">📝 {video.keyPoints.split('\n')[0]}</p>
                    )}
                    {video.cta && (
                      <p className="text-xs text-[#0A66C2] mt-1">→ {video.cta}</p>
                    )}
                    <p className="text-[10px] text-text-disabled mt-2">
                      {new Date(video.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} · Click status to advance workflow
                    </p>
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

// ─── Instructions Accordion ──────────────────────────────────────────────────
function InstructionsAccordion({ state }) {
  const { dispatch } = useApp()
  const navigate = useNavigate()
  const [open,         setOpen]         = useState(false)
  const [instructions, setInstructions] = useState(state.linkedinInstructions || '')
  const [saved,        setSaved]        = useState(false)

  function handleSave() {
    dispatch({ type: 'SET_LINKEDIN_INSTRUCTIONS', payload: instructions })
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-surface-subtle transition-colors">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div>
            <p className="text-sm font-medium text-text">LinkedIn-Specific Notes</p>
            <p className="text-xs text-text-secondary">{state.linkedinInstructions ? '✓ Notes saved' : 'Optional — layers on top of your Brand Brain profile'}</p>
          </div>
        </div>
        <svg className={`w-4 h-4 text-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-3">
          <p className="text-xs text-text-tertiary">
            Your core brand voice, dos/don'ts, and audience now live in one place —{' '}
            <button type="button" onClick={() => navigate('/brand-brain')} className="text-blue-600 hover:text-blue-700 underline font-medium">Brand Brain</button>.
            Use this field only for things specific to LinkedIn, e.g. hashtag limits or hook style that wouldn't apply elsewhere.
          </p>
          <Textarea
            placeholder={"Examples:\n• Hashtag limit: 4-5 max. Always include #ArakLighting\n• Hooks should work as a standalone line before \"see more\" truncates\n• Native video posts can run longer-form than the IG equivalent"}
            value={instructions} onChange={e => setInstructions(e.target.value)} rows={5}
          />
          <Button onClick={handleSave} variant={saved ? 'secondary' : 'primary'} className="w-full justify-center">
            {saved ? '✓ Saved' : 'Save LinkedIn Notes'}
          </Button>
        </div>
      )}
    </Card>
  )
}
