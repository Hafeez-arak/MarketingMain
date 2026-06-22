import { useRef, useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../store/AuthContext'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/supabaseClient'
import { Card, Button, Empty, ConfirmDialog } from '../../components/ui/index'
import { uid } from '../../lib/utils'

function humanSize(bytes) {
  if (!bytes || bytes === 0) return 'AI generated'
  if (bytes < 1024)    return bytes + ' B'
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB'
  return (bytes/1048576).toFixed(1) + ' MB'
}

// Convert ugly filenames into clean readable labels
function displayName(name) {
  if (!name) return 'Untitled'
  return name
    .replace(/\.[^.]+$/, '')           // strip extension
    .replace(/_+\d{10,}$/, '')         // strip trailing timestamp
    .replace(/-+\d{10,}$/, '')         // strip trailing timestamp with dash
    .replace(/[_-]+/g, ' ')            // underscores/dashes → spaces
    .replace(/\s+/g, ' ')              // collapse spaces
    .trim()
    .replace(/^\w/, c => c.toUpperCase())
}

export function MediaLibrary() {
  const { activeWorkspaceId, accessToken } = useAuth()
  const supabaseUrl = SUPABASE_URL

  const [assets,      setAssets]      = useState([])
  const [loading,     setLoading]     = useState(false)
  const [deleteId,    setDeleteId]    = useState(null)
  const [fullscreen,  setFullscreen]  = useState(null)  // { url, name }
  const [view,        setView]        = useState('grid')
  const [filter,      setFilter]      = useState('all')
  const inputRef = useRef(null)

  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }

  const fetchAssets = useCallback(async () => {
    if (!activeWorkspaceId) return
    setLoading(true)
    try {
      // No explicit workspace_id filter needed — RLS already scopes this
      // to rows the signed-in user's workspace owns.
      const res = await fetch(
        `${supabaseUrl}/rest/v1/media_library?select=*&order=created_at.desc&limit=200`,
        { headers }
      )
      if (res.ok) setAssets(await res.json())
    } catch(e) { /* silent */ }
    finally { setLoading(false) }
  }, [activeWorkspaceId, accessToken])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  async function saveToSupabase(item) {
    if (!activeWorkspaceId) return null
    const res = await fetch(`${supabaseUrl}/rest/v1/media_library`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({
        workspace_id: activeWorkspaceId,
        name:       item.name,
        url:        item.url,
        platform:   item.platform  || null,
        topic:      item.topic     || null,
        source:     item.source    || 'manual',
        mime_type:  item.mimeType  || 'image/webp',
        size_bytes: item.size      || 0,
      }),
    })
    if (res.ok) {
      const [row] = await res.json()
      setAssets(prev => [row, ...prev])
      return row
    }
    return null
  }

  async function deleteAsset(id) {
    if (!activeWorkspaceId) return
    await fetch(`${supabaseUrl}/rest/v1/media_library?id=eq.${id}`, {
      method: 'DELETE',
      headers,
    })
    setAssets(prev => prev.filter(a => a.id !== id))
    setDeleteId(null)
  }

  async function handleFiles(files) {
    for (const file of Array.from(files)) {
      const reader = new FileReader()
      reader.onload = async e => {
        await saveToSupabase({
          name:     file.name,
          url:      e.target.result,   // base64 for local uploads
          platform: null,
          source:   'upload',
          mimeType: file.type,
          size:     file.size,
        })
      }
      reader.readAsDataURL(file)
    }
  }

  function onDrop(e) { e.preventDefault(); handleFiles(e.dataTransfer.files) }

  const filtered = assets.filter(a => {
    if (filter === 'images') return (a.mime_type || '').startsWith('image/')
    if (filter === 'videos') return (a.mime_type || '').startsWith('video/')
    if (filter === 'docs')   return !(a.mime_type || '').startsWith('image/') && !(a.mime_type || '').startsWith('video/')
    return true
  })

  return (
    <div className="max-w-7xl space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-stone-200 border border-stone-300 rounded-xl p-1 shadow-sm">
          {['all','images','videos','docs'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize transition-all ${
                filter === f
                  ? 'bg-white text-text shadow-sm border border-stone-200'
                  : 'text-stone-500 hover:text-text hover:bg-stone-100'
              }`}>
              {f === 'all' ? `All (${assets.length})` : f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setView('grid')} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${view==='grid'?'bg-amber-50 text-amber-600':'text-text-secondary hover:bg-surface-subtle'}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          </button>
          <button onClick={() => setView('list')} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${view==='list'?'bg-amber-50 text-amber-600':'text-text-secondary hover:bg-surface-subtle'}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          </button>
          <button onClick={fetchAssets} disabled={loading} className="w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-subtle transition-colors disabled:opacity-40">
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <Button onClick={() => inputRef.current?.click()}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload
          </Button>
          <input ref={inputRef} type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx" className="hidden" onChange={e => handleFiles(e.target.files)} />
        </div>
      </div>

      {!activeWorkspaceId && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
          No active workspace — try signing out and back in.
        </div>
      )}

      {/* Drop zone */}
      <div onDrop={onDrop} onDragOver={e => e.preventDefault()}
        className="border-2 border-dashed border-border hover:border-amber-400 rounded-2xl p-6 text-center transition-colors cursor-pointer bg-white"
        onClick={() => inputRef.current?.click()}>
        <div className="flex flex-col items-center gap-2 text-text-secondary">
          <svg className="w-8 h-8 text-text-tertiary" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <p className="text-sm font-medium">Drop files here or <span className="text-amber-600">browse</span></p>
          <p className="text-xs text-text-tertiary">Images, videos, PDFs and documents</p>
        </div>
      </div>

      {/* Files */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-text-tertiary text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
            title="No assets yet"
            description="Upload images or save generated posts to your media library."
          />
        </Card>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map(asset => (
            <Card key={asset.id} className="overflow-hidden group cursor-zoom-in" onClick={() => asset.url && setFullscreen({ url: asset.url, name: asset.name })}>
              <div className="aspect-square bg-surface-subtle flex items-center justify-center overflow-hidden relative">
                {asset.url ? (
                  <img src={asset.url} alt={asset.name}
                    className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-8 h-8 text-text-tertiary" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 gap-2">
                  {asset.url && (
                    <a href={asset.url} download={asset.name} target="_blank" rel="noreferrer"
                      className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center text-blue-600 hover:bg-white transition-colors"
                      onClick={e => e.stopPropagation()}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </a>
                  )}
                  <button onClick={e => { e.stopPropagation(); setDeleteId(asset.id) }} className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center text-red-500 hover:bg-white transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                  </button>
                </div>
              </div>
              <div className="p-2">
                <p className="text-xs font-medium text-text truncate">{displayName(asset.name)}</p>
                <div className="flex items-center justify-between gap-1 mt-0.5">
                  <p className="text-[10px] text-text-tertiary">{humanSize(asset.size_bytes)}</p>
                  {asset.platform && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${asset.platform === 'instagram' ? 'bg-pink-100 text-pink-600' : asset.platform === 'linkedin' ? 'bg-blue-100 text-blue-600' : 'bg-stone-100 text-stone-500'}`}>
                      {asset.platform === 'instagram' ? 'IG' : asset.platform === 'linkedin' ? 'LI' : asset.platform.toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-surface-muted">
              {['Name','Platform','Source','Size','Saved',''].map(h=><th key={h} className="text-left px-5 py-3 text-xs font-medium text-text-secondary">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {filtered.map(a=>(
                <tr key={a.id} className="hover:bg-surface-muted transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {a.url ? <img src={a.url} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0"/> : <div className="w-8 h-8 rounded-lg bg-surface-subtle flex-shrink-0"/>}
                      <span className="font-medium text-text truncate max-w-xs">{displayName(a.name)}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-text-secondary text-xs capitalize">{a.platform || '—'}</td>
                  <td className="px-5 py-3 text-text-secondary text-xs capitalize">{a.source || '—'}</td>
                  <td className="px-5 py-3 text-text-secondary text-xs">{humanSize(a.size_bytes)}</td>
                  <td className="px-5 py-3 text-text-secondary text-xs">{new Date(a.created_at).toLocaleDateString()}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {a.url && <a href={a.url} download={a.name} target="_blank" rel="noreferrer"><Button variant="ghost" size="xs">Download</Button></a>}
                      <Button variant="ghost" size="xs" onClick={()=>setDeleteId(a.id)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ConfirmDialog open={!!deleteId} onClose={()=>setDeleteId(null)} onConfirm={()=>deleteAsset(deleteId)} title="Delete asset" message="This will permanently remove this asset from your media library." danger />

      {/* Fullscreen overlay — portalled to body to avoid overflow clipping */}
      {fullscreen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(8px)' }}
          onClick={() => setFullscreen(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <img src={fullscreen.url} alt={fullscreen.name}
              className="max-w-[90vw] max-h-[88vh] rounded-2xl object-contain shadow-2xl" />
            <div className="absolute top-3 right-3 flex gap-2">
              <a href={fullscreen.url} download={fullscreen.name} target="_blank" rel="noreferrer"
                className="w-9 h-9 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur flex items-center justify-center text-white transition-colors"
                title="Download" onClick={e => e.stopPropagation()}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </a>
              <button onClick={() => setFullscreen(null)}
                className="w-9 h-9 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur flex items-center justify-center text-white transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// Export saveToMediaLibrary for use from other components
export async function saveToMediaLibrary({ workspaceId, accessToken, name, url, platform, topic, source, mimeType, size }) {
  if (!workspaceId) return null
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  }
  await fetch(`${SUPABASE_URL}/rest/v1/media_library`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ workspace_id: workspaceId, name, url, platform: platform||null, topic: topic||null, source: source||'generated', mime_type: mimeType||'image/webp', size_bytes: size||0 }),
  })
}
