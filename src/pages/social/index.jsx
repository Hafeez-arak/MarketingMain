import { useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp, actions } from '../../store/appStore'
import { Card, Button, Badge, PlatformPill, Input, Textarea, Select, Empty, PostImage } from '../../components/ui/index'
import { uid, PLATFORM_META, formatDateTime } from '../../lib/utils'

// ─── Social Overview ──────────────────────────────────────────────────────
export function SocialOverview() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()

  const platforms = Object.entries(PLATFORM_META)

  return (
    <div className="max-w-5xl space-y-5">
      {/* Connected accounts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {platforms.map(([key, meta]) => {
          const connected = state.connectedAccounts[key]
          const posts     = state.posts.filter(p => p.platform === key)
          return (
            <Card key={key} className="overflow-hidden">
              <div className="h-1" style={{ background: meta.color }} />
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${meta.bg} ${meta.text}`}>{meta.abbr}</span>
                    <span className="font-semibold text-text">{meta.label}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${connected ? 'bg-green-50 text-green-700' : 'bg-surface-subtle text-text-tertiary'}`}>
                    {connected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <p className="text-sm text-text-secondary mb-4">
                  {posts.length === 0 ? 'No posts created yet.' : `${posts.length} post${posts.length===1?'':'s'} created`}
                </p>
                <div className="flex gap-2">
                  {connected ? (
                    <>
                      <Button variant="secondary" size="sm" className="flex-1 justify-center" onClick={() => navigate(`/social/${key}`)}>View</Button>
                      <Button size="sm" className="flex-1 justify-center" onClick={() => navigate(`/social/${key}/new`)}>New post</Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" className="flex-1 justify-center" onClick={() => { dispatch(actions.connectAccount(key)); dispatch(actions.addNotification({ id: uid(), message: `${meta.label} account connected.`, createdAt: new Date().toISOString() })) }}>
                      Connect {meta.label}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ─── Single Platform Page ─────────────────────────────────────────────────
export function SocialPlatform() {
  const { platform } = useParams()
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const meta = PLATFORM_META[platform]
  const connected = state.connectedAccounts[platform]
  const posts = state.posts.filter(p => p.platform === platform)
  const [filter, setFilter] = useState('all')

  if (!meta) return <p className="text-text-secondary">Platform not found.</p>

  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter)

  return (
    <div className="max-w-4xl space-y-5">
      {/* Header card */}
      <Card className="overflow-hidden">
        <div className="h-1" style={{ background: meta.color }} />
        <div className="p-5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${meta.bg} ${meta.text}`}>{meta.abbr}</span>
            <div>
              <h2 className="font-semibold text-text">{meta.label}</h2>
              <p className="text-xs text-text-secondary">{posts.length} post{posts.length===1?'':'s'} · {connected ? 'Connected' : 'Not connected'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {!connected && (
              <Button variant="outline" size="sm" onClick={() => { dispatch(actions.connectAccount(platform)); dispatch(actions.addNotification({ id: uid(), message: `${meta.label} connected.`, createdAt: new Date().toISOString() })) }}>
                Connect account
              </Button>
            )}
            {connected && (
              <Button variant="ghost" size="sm" onClick={() => dispatch(actions.disconnectAccount(platform))}>Disconnect</Button>
            )}
            <Button size="sm" onClick={() => navigate(`/social/${platform}/new`)}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
              New post
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
          <div className="p-4 text-center"><p className="font-semibold text-text">{posts.length}</p><p className="text-xs text-text-secondary">Total posts</p></div>
          <div className="p-4 text-center"><p className="font-semibold text-text">{posts.filter(p=>p.status==='scheduled').length}</p><p className="text-xs text-text-secondary">Scheduled</p></div>
          <div className="p-4 text-center"><p className="font-semibold text-text">{posts.filter(p=>p.status==='published').length}</p><p className="text-xs text-text-secondary">Published</p></div>
        </div>
      </Card>

      {/* Posts list */}
      <div className="flex gap-1 bg-white border border-border rounded-xl p-1 w-fit">
        {['all','scheduled','published','draft'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${filter===f?'bg-brand-600 text-white':'text-text-secondary hover:text-text hover:bg-surface-subtle'}`}>
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
            title={`No ${filter === 'all' ? '' : filter + ' '}posts for ${meta.label}`}
            description="Create your first post and schedule or publish it."
            action={<Button onClick={() => navigate(`/social/${platform}/new`)}>Create post</Button>}
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
                      {campaign && <span className="text-xs bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full">{campaign.name}</span>}
                      {p.scheduledAt && <span className="text-xs text-text-tertiary">{formatDateTime(p.scheduledAt)}</span>}
                    </div>
                    <p className="text-sm text-text whitespace-pre-line line-clamp-3">{p.copy || 'No caption'}</p>
                    {p.hashtags && <p className="text-xs text-brand-500 mt-1">{p.hashtags}</p>}
                    {p.mediaUrls?.length > 0 && (
                      <div className="flex gap-2 mt-3">
                        {p.mediaUrls.map((url,i) => <PostImage key={i} src={url} alt="" className="w-16 h-16 rounded-xl object-cover border border-border"/>)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button variant="ghost" size="xs" onClick={() => dispatch(actions.deletePost(p.id))}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
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

// ─── New Post Composer ────────────────────────────────────────────────────
export function NewPost() {
  const { platform } = useParams()
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const meta = PLATFORM_META[platform]

  const [form, setForm] = useState({ copy: '', hashtags: '', scheduledAt: '', scheduledTime: '', campaignId: '', status: 'draft' })
  const [errors, setErrors] = useState({})
  const [mediaUrls, setMediaUrls] = useState([])
  const fileRef = useRef(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const charCount = form.copy.length
  const overLimit = charCount > (meta?.maxChars || 9999)

  function handleFiles(files) {
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = e => setMediaUrls(urls => [...urls, e.target.result])
      reader.readAsDataURL(file)
    })
  }

  function validate() {
    const e = {}
    if (!form.copy.trim()) e.copy = 'Post copy is required'
    if (overLimit) e.copy = `Exceeds ${meta?.maxChars} character limit`
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function save(status) {
    if (!validate()) return
    let scheduledAt = null
    if (form.scheduledAt && form.scheduledTime) {
      scheduledAt = new Date(`${form.scheduledAt}T${form.scheduledTime}`).toISOString()
    }
    dispatch(actions.addPost({
      id: uid(),
      platform,
      copy: form.copy,
      hashtags: form.hashtags,
      scheduledAt,
      campaignId: form.campaignId || null,
      mediaUrls,
      status: status === 'schedule' ? 'scheduled' : status === 'publish' ? 'published' : 'draft',
      createdAt: new Date().toISOString(),
    }))
    dispatch(actions.addNotification({ id: uid(), message: `Post ${status === 'schedule' ? 'scheduled' : status === 'publish' ? 'published' : 'saved as draft'} on ${meta?.label}.`, createdAt: new Date().toISOString() }))
    // add to approval queue
    dispatch(actions.addApproval({ id: uid(), title: `${meta?.label} post: ${form.copy.slice(0,40)}...`, platform, status: 'pending', createdAt: new Date().toISOString() }))
    navigate(`/social/${platform}`)
  }

  if (!meta) return <p className="text-text-secondary">Unknown platform.</p>

  return (
    <div className="max-w-xl space-y-4">
      <Card className="overflow-hidden">
        <div className="h-1" style={{ background: meta.color }} />
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${meta.bg} ${meta.text}`}>{meta.abbr}</span>
          <span className="font-semibold text-text">New {meta.label} post</span>
        </div>

        <div className="p-5 space-y-4">
          {/* Copy */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-text-secondary">Caption / copy *</label>
              <span className={`text-xs ${overLimit ? 'text-red-500 font-medium' : 'text-text-tertiary'}`}>{charCount} / {meta.maxChars}</span>
            </div>
            <Textarea
              placeholder={`Write your ${meta.label} caption here...`}
              value={form.copy}
              onChange={e => set('copy', e.target.value)}
              rows={5}
              error={errors.copy}
            />
          </div>

          {/* Hashtags */}
          <Input label="Hashtags" placeholder="#marketing #brand #growth" value={form.hashtags} onChange={e => set('hashtags', e.target.value)} hint="Separate with spaces" />

          {/* Media */}
          <div>
            <p className="text-xs font-medium text-text-secondary mb-1.5">Media</p>
            {mediaUrls.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-2">
                {mediaUrls.map((url,i) => (
                  <div key={i} className="relative">
                    <PostImage src={url} alt="" className="w-16 h-16 rounded-xl object-cover border border-border"/>
                    <button onClick={() => setMediaUrls(u => u.filter((_,j)=>j!==i))} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px]">×</button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-border hover:border-brand-400 rounded-xl py-3 text-xs text-text-secondary hover:text-brand-600 transition-colors flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Add image
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
          </div>

          {/* Campaign */}
          <Select label="Attach to campaign" value={form.campaignId} onChange={e => set('campaignId', e.target.value)}>
            <option value="">No campaign</option>
            {state.campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>

          {/* Schedule */}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Schedule date" type="date" value={form.scheduledAt} onChange={e => set('scheduledAt', e.target.value)} />
            <Input label="Schedule time" type="time" value={form.scheduledTime} onChange={e => set('scheduledTime', e.target.value)} />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" onClick={() => navigate(`/social/${platform}`)}>Cancel</Button>
            <Button variant="outline" onClick={() => save('draft')}>Save draft</Button>
            {form.scheduledAt ? (
              <Button className="flex-1 justify-center" onClick={() => save('schedule')}>Schedule post</Button>
            ) : (
              <Button className="flex-1 justify-center" onClick={() => save('publish')}>Publish now</Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}

