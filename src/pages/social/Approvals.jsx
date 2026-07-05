import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../store/appStore'
import { useAuth } from '../../store/AuthContext'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/supabaseClient'
import { Card, Button, Badge, Empty, Spinner, PostImage } from '../../components/ui/index'
import { formatDateTime } from '../../lib/utils'
import { logEditFeedback } from '../../lib/brandBrain'
import { InstagramPostDetail } from './InstagramPage'
import { LinkedInPostDetail } from './LinkedInPage'

// ─── Post Approvals ──────────────────────────────────────────────────────
// One place to review everything the Plan Generation workflows produce —
// Instagram and LinkedIn together, separated only by a filter, instead of
// two separate "Pending" tabs buried inside each platform's own Posts page.
// Reuses each platform's own PostDetail (regen/crop/tone-switch/approve) so
// there's exactly one review UI per platform, not a third copy.

const TABLES = {
  instagram: 'instagram_generated_posts',
  linkedin:  'linkedin_generated_posts',
}

function useApprovalPosts(accessToken) {
  const [posts,   setPosts]   = useState([])
  const [loading, setLoading] = useState(false)

  const fetchAll = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
    try {
      const [igRes, liRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/${TABLES.instagram}?select=*&order=created_at.desc&limit=200`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/${TABLES.linkedin}?select=*&order=created_at.desc&limit=200`, { headers }),
      ])
      const igRows = igRes.ok ? await igRes.json() : []
      const liRows = liRes.ok ? await liRes.json() : []

      const igPosts = igRows.map(r => ({
        id: r.id, platform: 'instagram', _table: TABLES.instagram,
        copy: r.caption, hashtags: r.hashtags, imageUrl: r.image_url, imagePrompt: r.image_prompt,
        style: r.style, topic: r.topic, aspectRatio: r.aspect_ratio,
        scheduledAt: r.scheduled_date || null, campaignId: r.campaign_id,
        mediaUrls: [r.image_url].filter(Boolean), status: r.status, source: r.source,
        generatedByWorkflow: true, contentRoute: 'scheduled', createdAt: r.created_at,
        _fromSupabase: true,
      }))
      const liPosts = liRows.map(r => ({
        id: r.id, platform: 'linkedin', _table: TABLES.linkedin,
        hook: r.hook, copy: r.hook ? `${r.hook}\n\n${r.body || ''}` : (r.body || ''), body: r.body,
        hashtags: r.hashtags, imageUrl: r.image_url, mediaUrls: [r.image_url].filter(Boolean),
        imagePrompt: r.image_prompt, postStrategy: r.post_strategy, topic: r.topic,
        postType: r.post_type, style: r.style, aspectRatio: r.aspect_ratio,
        includeImage: r.include_image !== false, contentRoute: r.content_route || 'scheduled',
        campaignId: r.campaign_id, status: r.status, source: r.source,
        scheduledAt: r.scheduled_date || null, createdAt: r.created_at,
        generatedByWorkflow: true, _fromSupabase: true,
      }))

      setPosts([...igPosts, ...liPosts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)))
    } finally {
      setLoading(false)
    }
  }, [accessToken])

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

  return { posts, loading, fetchAll, updateStatus }
}

export function Approvals() {
  const { state } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const { posts, loading, fetchAll, updateStatus } = useApprovalPosts(accessToken)
  const [platformFilter, setPlatformFilter] = useState('all')  // all | instagram | linkedin
  const [statusFilter,   setStatusFilter]   = useState('pending_review')
  const [selectedPost,   setSelectedPost]   = useState(null)

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 30000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const byPlatform = platformFilter === 'all' ? posts : posts.filter(p => p.platform === platformFilter)
  const filtered = statusFilter === 'all' ? byPlatform : byPlatform.filter(p => p.status === statusFilter)

  const STATUS_TABS = [
    { key: 'pending_review',  label: 'Pending review', count: byPlatform.filter(p => p.status === 'pending_review').length },
    { key: 'pending_publish', label: 'Approved',       count: byPlatform.filter(p => p.status === 'pending_publish').length },
    { key: 'rejected',        label: 'Rejected',       count: byPlatform.filter(p => p.status === 'rejected').length },
    { key: 'all',             label: 'All',            count: byPlatform.length },
  ]
  const PLATFORM_TABS = [
    { key: 'all',       label: 'All' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'linkedin',  label: 'LinkedIn' },
  ]

  async function handleApprove(post) { await updateStatus(post, 'pending_publish') }
  async function handleReject(post)  { await updateStatus(post, 'rejected') }

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
  // bug fixed earlier — LinkedIn's PostDetail persists its own edits, so it
  // doesn't need this.
  async function handleCaptionUpdated(postId, newCopy, originalCopy) {
    setSelectedPost(prev => (prev && prev.id === postId) ? { ...prev, copy: newCopy } : prev)
    logEditFeedback(activeWorkspaceId, accessToken, { platform: 'instagram', postId, field: 'caption', original: originalCopy, edited: newCopy })
    if (!accessToken) return
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.instagram}?id=eq.${postId}`, {
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
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-900">Post Approvals</h1>
        <p className="text-sm text-text-secondary mt-1">
          Every post the Plan Generation workflows produce — Instagram and LinkedIn together. Review the real caption + image, approve or reject, before it moves to scheduling.
        </p>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          {STATUS_TABS.map(t => (
            <button key={t.key} onClick={() => setStatusFilter(t.key)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${statusFilter === t.key ? 'bg-amber-600 text-white shadow-sm' : 'bg-white border border-border text-text-secondary hover:border-amber-300'}`}>
              {t.label}{t.count > 0 && <span className={`ml-1.5 ${statusFilter === t.key ? 'opacity-75' : 'text-text-tertiary'}`}>{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-surface-subtle border border-border rounded-xl p-1">
          {PLATFORM_TABS.map(t => (
            <button key={t.key} onClick={() => setPlatformFilter(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${platformFilter === t.key ? 'bg-white text-text shadow-sm border border-border' : 'text-text-secondary hover:text-text'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading && posts.length === 0 ? (
        <Card className="p-12 flex items-center justify-center"><Spinner /></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>}
            title={statusFilter === 'pending_review' ? 'Nothing to review' : `No ${STATUS_TABS.find(t => t.key === statusFilter)?.label.toLowerCase()} posts`}
            description="Approve a plan from Campaigns → Plan with AI and generated posts will show up here as they're ready."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map(p => {
            const platformMeta = p.platform === 'linkedin'
              ? { label: 'LinkedIn', color: 'bg-[#0A66C2]/10 text-[#0A66C2]' }
              : { label: 'Instagram', color: 'bg-pink-50 text-pink-600' }
            return (
              <Card key={`${p.platform}_${p.id}`}
                className="overflow-hidden cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-150"
                onClick={() => setSelectedPost(p)}>
                <div className="flex">
                  <div className="w-28 flex-shrink-0 bg-surface-subtle overflow-hidden relative"
                    style={{ aspectRatio: (p.aspectRatio || '1:1').replace(':', '/'), minHeight: '80px', maxHeight: '140px' }}>
                    {p.imageUrl
                      ? <PostImage src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center">
                          <svg className="w-7 h-7 text-border-strong" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        </div>}
                  </div>
                  <div className="flex-1 p-4 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${platformMeta.color}`}>{platformMeta.label}</span>
                        <Badge status={p.status} />
                        {p.source === 'plan' && <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">📋 From plan</span>}
                      </div>
                    </div>
                    <p className="text-sm text-text line-clamp-2 leading-relaxed mb-1.5">{p.copy || 'No caption'}</p>
                    {p.hashtags && <p className="text-xs text-text-tertiary line-clamp-1 mb-1.5">{p.hashtags}</p>}
                    <p className="text-[11px] text-text-tertiary">{formatDateTime(p.createdAt)}{p.topic && <span className="ml-1.5 opacity-70">· {p.topic}</span>}{p.scheduledAt && <span className="ml-1.5 opacity-70">· for {p.scheduledAt}</span>}</p>

                    {p.status === 'pending_review' ? (
                      <div className="flex items-center gap-2 mt-2">
                        <button onClick={e => { e.stopPropagation(); handleApprove(p) }}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-sage-200 text-sage-700 bg-sage-50 hover:bg-sage-100 transition-colors">✓ Approve</button>
                        <button onClick={e => { e.stopPropagation(); handleReject(p) }}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">✕ Reject</button>
                        <span className="text-[10px] text-text-tertiary ml-auto">Click card to edit / regenerate</span>
                      </div>
                    ) : (
                      <p className="text-[10px] text-text-tertiary mt-1 opacity-60">Click to open full view</p>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {selectedPost && selectedPost.platform === 'instagram' && (
        <InstagramPostDetail
          post={selectedPost}
          state={state}
          webhookUrl={state.webhooks?.instagram || ''}
          regenWebhookUrl={state.webhooks?.instagramScheduleRegen || ''}
          supabaseUrl={SUPABASE_URL}
          anonKey={accessToken || ''}
          onClose={() => setSelectedPost(null)}
          onStatusChange={handleStatusChange}
          onImageUpdated={() => {}}
          onCaptionUpdated={handleCaptionUpdated}
          onDelete={handleDelete}
        />
      )}
      {selectedPost && selectedPost.platform === 'linkedin' && (
        <LinkedInPostDetail
          post={selectedPost}
          state={state}
          webhookUrl={state.webhooks?.linkedin || ''}
          regenWebhookUrl={state.webhooks?.linkedinScheduleRegen || ''}
          supabaseUrl={SUPABASE_URL}
          anonKey={accessToken || ''}
          onClose={() => setSelectedPost(null)}
          onStatusChange={handleStatusChange}
          onImageUpdated={() => {}}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
