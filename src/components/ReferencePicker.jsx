import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../store/auth'
import { Modal, Button, Spinner, PostImage } from './ui/index'
import { fetchBrandAssets, ASSET_KINDS } from '../lib/brandAssets'
import { uploadReferenceImage } from '../lib/referenceImages'

// ─── Reference Picker ──────────────────────────────────────────────────────
// Shared modal for attaching reference images to a single post (used from the
// plan review step and the per-day schedule editors). A reference is just a
// public URL — either picked from the Brand Brain asset library or uploaded
// fresh. Returns the full ordered list of selected URLs via onSave.
//
// References GUIDE image generation (image-to-image); they are distinct from
// `uploaded_image_urls`, which is a finished image used AS the post.

// Only visual kinds make sense as image references — music can't guide a look.
const REFERENCE_KINDS = ASSET_KINDS.filter(k => k.value !== 'music')

// ── Optional image-mode support (used by the plan board) ──
// When `mode`/`onModeChange` are passed, the picker shows a choice between
// letting AI generate the image (references just guide it) and using the
// selected image(s) AS the post (no AI). `format` drives the count rule:
// "use my image(s)" + a single 'post' allows exactly one image; a carousel —
// or any AI generation — allows many. Callers that omit these props get the
// original unlimited reference-only behaviour, unchanged.
export function ReferencePicker({ value = [], onSave, onClose, mode, onModeChange, format = 'post' }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [tab,       setTab]       = useState('brain') // 'brain' | 'upload'
  const [assets,    setAssets]    = useState([])
  // Starts false with no workspace: there is nothing to fetch, so a spinner
  // would be a promise the component can't keep.
  const [loading,   setLoading]   = useState(!!activeWorkspaceId)
  const [kindFilter, setKindFilter] = useState('all')
  const [selected,  setSelected]  = useState(value)   // ordered array of URLs
  const [uploading, setUploading] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const fileRef = useRef(null)

  const modeEnabled = typeof onModeChange === 'function'
  const useImage    = mode === 'use_reference'
  // Single image only when using a real image AS a non-carousel post.
  const singleOnly  = useImage && format !== 'carousel'

  // Switching into single-image mode with several already picked — keep the
  // first. Adjusted during render rather than in an effect so the grid never
  // paints a frame with several images still selected in a mode that only
  // permits one.
  const [prevSingleOnly, setPrevSingleOnly] = useState(singleOnly)
  if (singleOnly !== prevSingleOnly) {
    setPrevSingleOnly(singleOnly)
    if (singleOnly && selected.length > 1) setSelected([selected[0]])
  }

  async function handleSave() {
    if (useImage && selected.length === 0) { setError('Add at least one image to use, or switch to “Generate with AI”.'); return }
    setSaving(true); setError('')
    const result = await onSave(selected)
    setSaving(false)
    // onSave callers close the modal themselves on success (they own the
    // `open` state); a returned { error } means it failed and stayed open,
    // so surface it instead of failing silently.
    if (result?.error) setError(result.error)
  }

  useEffect(() => {
    if (!activeWorkspaceId) return
    let alive = true
    fetchBrandAssets(activeWorkspaceId, accessToken).then(rows => {
      if (!alive) return
      // Only assets we can actually show/condition on — must have a URL and
      // not be an audio asset.
      setAssets((rows || []).filter(a => a.public_url && a.kind !== 'music'))
      setLoading(false)
    })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken])

  const isSelected = url => selected.includes(url)
  const toggle = url => setSelected(prev => {
    if (prev.includes(url)) return prev.filter(u => u !== url)
    return singleOnly ? [url] : [...prev, url]   // single mode replaces the current pick
  })
  const remove = url => setSelected(prev => prev.filter(u => u !== url))

  const kindsPresent = [...new Set(assets.map(a => a.kind))]
  const shownAssets = kindFilter === 'all' ? assets : assets.filter(a => a.kind === kindFilter)

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'))
    if (files.length === 0) return
    setUploading(true); setError('')
    const uploadedUrls = []
    for (const file of files) {
      const res = await uploadReferenceImage(activeWorkspaceId, accessToken, file)
      if (res.error) { setError(`Upload failed: ${res.error}`); setUploading(false); return }
      uploadedUrls.push(res.url)
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
    setSelected(prev => {
      const merged = [...prev, ...uploadedUrls.filter(u => !prev.includes(u))]
      return singleOnly ? merged.slice(-1) : merged   // single mode keeps only the last
    })
  }

  return (
    <Modal open onClose={onClose} title={modeEnabled ? 'Post image' : 'Reference images'} width="max-w-2xl">
      <div className="p-6 space-y-4">
        {/* Mode choice — AI generation vs. use the image directly (plan board only) */}
        {modeEnabled && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onModeChange('generate')}
              className={`text-left rounded-xl border p-3 transition-all ${!useImage ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-300' : 'border-border bg-white hover:border-amber-300'}`}>
              <p className="text-sm font-semibold text-text">🎨 Generate with AI</p>
              <p className="text-[11px] text-text-tertiary mt-0.5 leading-snug">AI creates the image. Any images below just guide the look (image-to-image).</p>
            </button>
            <button onClick={() => onModeChange('use_reference')}
              className={`text-left rounded-xl border p-3 transition-all ${useImage ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-300' : 'border-border bg-white hover:border-amber-300'}`}>
              <p className="text-sm font-semibold text-text">🖼 Use my image{format === 'carousel' ? 's' : ''}</p>
              <p className="text-[11px] text-text-tertiary mt-0.5 leading-snug">
                {format === 'carousel' ? 'Your images become the carousel slides — no AI.' : 'Your image is used as the post as-is — no AI.'}
              </p>
            </button>
          </div>
        )}

        <p className="text-xs text-text-secondary leading-relaxed">
          {!modeEnabled
            ? 'Attach images to guide this post\'s AI generation (image-to-image). Pick from your Brand Brain library or upload new ones.'
            : useImage
              ? (singleOnly ? 'Pick the one image to use as this post.' : 'Pick the images to use as the carousel slides (in order).')
              : 'Optionally attach images to guide the AI (image-to-image). Add as many as you like.'}
        </p>

        {/* Selected strip */}
        {selected.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-text-secondary mb-1.5">
              {selected.length} selected{singleOnly ? ' (max 1)' : ''}
            </p>
            <div className="flex gap-2 flex-wrap">
              {selected.map(url => (
                <div key={url} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border group">
                  <PostImage src={url} alt="Reference" className="w-full h-full object-cover" />
                  <button onClick={() => remove(url)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex">
          {[{ key: 'brain', label: '🧠 From Brand Brain' }, { key: 'upload', label: '⬆️ Upload new' }].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-1.5 border -ml-px first:ml-0 text-xs font-semibold transition-colors ${tab === t.key ? 'bg-amber-700 text-white border-amber-700 relative z-10' : 'bg-white text-text-secondary border-border hover:text-text hover:bg-surface-subtle'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'brain' && (
          <div className="space-y-3">
            {/* Kind filter chips */}
            {kindsPresent.length > 1 && (
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => setKindFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${kindFilter === 'all' ? 'bg-amber-600 text-white' : 'bg-white border border-border text-text-secondary hover:border-amber-300'}`}>
                  All
                </button>
                {REFERENCE_KINDS.filter(k => kindsPresent.includes(k.value)).map(k => (
                  <button key={k.value} onClick={() => setKindFilter(k.value)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${kindFilter === k.value ? 'bg-amber-600 text-white' : 'bg-white border border-border text-text-secondary hover:border-amber-300'}`}>
                    {k.label}
                  </button>
                ))}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-10 text-text-tertiary"><Spinner /></div>
            ) : shownAssets.length === 0 ? (
              <p className="text-xs text-text-tertiary text-center py-10">
                No brand assets yet. Add photos in Brand Brain → Asset Library, or upload references directly.
              </p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-y-auto pr-1">
                {shownAssets.map(a => (
                  <button key={a.id} onClick={() => toggle(a.public_url)}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${isSelected(a.public_url) ? 'border-amber-500 ring-2 ring-amber-300' : 'border-border hover:border-amber-300'}`}
                    title={a.title || a.kind}>
                    <PostImage src={a.public_url} alt={a.title || 'Asset'} className="w-full h-full object-cover" />
                    {isSelected(a.public_url) && (
                      <span className="absolute top-1 right-1 w-5 h-5 bg-amber-700 flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'upload' && (
          <div className="space-y-3">
            <label className="flex flex-col items-center justify-center gap-2 py-10 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-amber-400 hover:bg-surface-subtle transition-colors">
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} disabled={uploading} />
              {uploading ? (
                <><Spinner /><span className="text-xs text-text-tertiary">Uploading…</span></>
              ) : (
                <>
                  <svg className="w-6 h-6 text-text-tertiary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                  <span className="text-xs font-medium text-text-secondary">Click to upload reference images</span>
                  <span className="text-[11px] text-text-tertiary">PNG, JPG, WEBP — multiple allowed</span>
                </>
              )}
            </label>
            <p className="text-[11px] text-text-tertiary">Uploaded references are added to the selection above automatically.</p>
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-3 pt-1 border-t border-border">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Spinner size="sm" /> Saving…</> : `Save ${selected.length > 0 ? `(${selected.length})` : ''}`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
