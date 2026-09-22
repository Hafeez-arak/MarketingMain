import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Modal, Spinner } from '../ui/index'
import { fetchMediaLibrary, uploadToMediaLibrary } from '../../lib/mediaLibrary'
import { fetchBrandAssets } from '../../lib/brandAssets'
import { mediaKindOf, toComposerMedia } from '../../lib/composerMedia'
import { useAuth } from '../../store/auth'

// ─── Choosing media for a post ─────────────────────────────────────────────
// This is where Hootsuite puts its Canva and Adobe Express buttons. We have
// neither, and wiring them would mean sending brand assets to a third party
// to get back something Creative Studio already makes — so the two entry
// points here are Creative Studio (make something new) and something you
// already have — either the media library (posted or generated before) or
// the Brand Brain asset library (product/project photos, logo, reference
// material) — for reusing it.
//
// Everything the library returns already lives in public Supabase Storage,
// which is why media is passed to the publisher by URL and never re-uploaded.

// `onDesignInStudio`, when passed, replaces the generic `navigate('/studio')`
// — a caller editing a specific plan idea wants the Studio session tied back
// to THAT idea, not a blank one.
export function MediaPicker({ open, onClose, onSelect, multiple = false, kind = 'all', onDesignInStudio }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const navigate = useNavigate()
  const [source, setSource]       = useState('library') // 'library' | 'brain'
  const [items, setItems]         = useState([])
  const [brandAssets, setBrandAssets] = useState([])
  const [loading, setLoading]     = useState(false)
  const [chosen, setChosen]       = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setError]   = useState('')
  const [dragging, setDragging]   = useState(false)
  const [filter, setFilter]       = useState('all')
  const fileRef = useRef(null)

  // Upload straight from here. The library and Creative Studio are both
  // useful, but neither helps when the thing you want to post is a photo
  // taken ten minutes ago — and that is the common case this screen was
  // missing entirely.
  //
  // Newly uploaded assets are prepended rather than re-fetched: the list is
  // already in memory, and a refetch would put the new file wherever
  // created_at sorts it, which on a fast upload is indistinguishable from
  // nothing having happened.
  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length || !activeWorkspaceId) return
    setUploading(true)
    setError('')
    const added = []
    for (const file of files) {
      const res = await uploadToMediaLibrary(activeWorkspaceId, accessToken, file)
      if (res.error) { setError(res.error); break }
      if (res.asset) added.push(res.asset)
    }
    if (added.length) setItems(prev => [...added, ...prev])
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  useEffect(() => {
    if (!open || !activeWorkspaceId) return
    let cancelled = false
    // Deferred: setting state synchronously in an effect body is a cascading
    // render. Same deferral useConnectedAccounts uses for its first load.
    queueMicrotask(() => { if (!cancelled) { setLoading(true); setChosen([]); setSource('library') } })
    fetchMediaLibrary(activeWorkspaceId, accessToken, { kind })
      .then(res => {
        if (cancelled) return
        setItems(Array.isArray(res) ? res : (res?.items || []))
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, activeWorkspaceId, accessToken, kind])

  // Brand Brain has no video assets, so this is skipped entirely when only
  // video is wanted — fetching a list that can never show anything useful.
  // Normalised to the same {url, name, mime_type} shape the media library
  // returns, so the grid below reads either source identically.
  useEffect(() => {
    if (!open || !activeWorkspaceId || kind === 'video') return
    let cancelled = false
    fetchBrandAssets(activeWorkspaceId, accessToken).then(rows => {
      if (cancelled) return
      setBrandAssets((rows || [])
        .filter(a => a.public_url && a.kind !== 'music')
        .map(a => ({ id: a.id, url: a.public_url, name: a.title || a.kind, mime_type: '' })))
    })
    return () => { cancelled = true }
  }, [open, activeWorkspaceId, accessToken, kind])

  const toggle = (item) => {
    if (!multiple) { onSelect([toComposerMedia(item)]); onClose(); return }
    setChosen(prev => prev.some(c => c.url === item.url)
      ? prev.filter(c => c.url !== item.url)
      : [...prev, toComposerMedia(item)])
  }

  // Drag-and-drop as well as the button. Dropping a file onto a picker is the
  // gesture people try first, and a picker that ignores it reads as broken
  // rather than as not-supported.
  const onDrop = (e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer?.files) }

  const inBrain = source === 'brain' && kind !== 'video'
  const shown = inBrain
    ? brandAssets
    : (filter === 'all' ? items : items.filter(i => mediaKindOf(i) === filter))
  const counts = {
    all:   items.length,
    image: items.filter(i => mediaKindOf(i) === 'image').length,
    video: items.filter(i => mediaKindOf(i) === 'video').length,
  }

  return (
    <Modal open={open} onClose={onClose} title="Add media" width="max-w-2xl">
      <input ref={fileRef} type="file" multiple className="hidden"
        accept={kind === 'video' ? 'video/*' : 'image/*,video/*'}
        onChange={e => handleFiles(e.target.files)} />

      {/* Where the media comes from, chosen first — Brand Brain has no
          upload/filter row of its own, since it is a fixed library to
          browse rather than one you add to from here. */}
      {kind !== 'video' && (
        <div className="flex mb-3">
          {[['library', 'Media library'], ['brain', 'Brand Brain']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setSource(k)}
              className={`flex-1 py-1.5 border -ml-px first:ml-0 text-xs font-semibold transition-colors ${
                source === k ? 'bg-amber-700 text-white border-amber-700 relative z-10' : 'bg-white text-text-secondary border-border hover:bg-surface-subtle'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* One row: what to do on the left, where else to get media on the
          right. The previous layout put a four-word sentence at the far left
          and two buttons at the far right of a very wide dialog, so the eye
          had to cross an empty gap to connect them. */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        {inBrain ? <span /> : (
          <div className="flex items-center gap-1">
            {[['all', 'All'], ['image', 'Images'], ['video', 'Videos']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={`px-2.5 py-1 text-xs font-semibold border -ml-px first:ml-0 transition-colors ${
                  filter === k
                    ? 'bg-amber-700 text-white border-amber-700 relative z-10'
                    : 'bg-white text-text-secondary border-border hover:bg-surface-subtle'}`}>
                {label}{counts[k] ? ` ${counts[k]}` : ''}
              </button>
            ))}
          </div>
        )}
        <Button variant="outline" size="sm" onClick={() => onDesignInStudio ? onDesignInStudio() : navigate('/studio')}>
          Design in Studio
        </Button>
      </div>

      {uploadError && <p className="text-sm text-red-600 mb-3">{uploadError}</p>}

      <div
        onDragOver={e => { if (!inBrain) { e.preventDefault(); setDragging(true) } }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { if (!inBrain) onDrop(e) }}
        className={`border border-dashed p-3 transition-colors ${
          dragging ? 'border-amber-600 bg-amber-50' : 'border-border bg-surface-subtle/40'}`}>

        {!inBrain && loading && <div className="py-12 flex justify-center"><Spinner /></div>}

        {inBrain && shown.length === 0 && (
          <p className="py-10 text-center text-sm text-text-secondary max-w-sm mx-auto">
            No brand assets yet. Add photos in Brand Brain → Asset Library, or switch to the media library.
          </p>
        )}

        {!inBrain && !loading && items.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-text mb-1">Nothing here yet</p>
            <p className="text-sm text-text-secondary mb-4 max-w-sm mx-auto">
              Drop a file here, upload one, or generate it in Creative Studio — either
              way it lands in the media library and is available to every post after this.
            </p>
            <Button variant="primary" size="sm" disabled={uploading}
              onClick={() => fileRef.current?.click()}>
              {uploading ? 'Uploading…' : 'Choose a file'}
            </Button>
          </div>
        )}

        {!inBrain && !loading && items.length > 0 && shown.length === 0 && (
          <p className="py-10 text-center text-sm text-text-secondary">
            No {filter === 'video' ? 'videos' : 'images'} in the library.
          </p>
        )}

        {((inBrain && shown.length > 0) || (!inBrain && !loading && shown.length > 0)) && (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-[46vh] overflow-y-auto">
            {/* Upload sits as the FIRST tile rather than only in the toolbar,
                so the action is where the eye already is once there is a grid
                to look at. Brand Brain has no upload of its own — that grid is
                a library to browse, not one you add to from here. */}
            {!inBrain && (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                className="aspect-square border border-dashed border-border hover:border-amber-600 hover:bg-amber-50 transition-colors flex flex-col items-center justify-center gap-1 text-text-tertiary hover:text-amber-700 disabled:opacity-50">
                <span className="text-lg leading-none">{uploading ? '⋯' : '+'}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide">
                  {uploading ? 'Uploading' : 'Upload'}
                </span>
              </button>
            )}

            {shown.map(item => {
              const isVideo = mediaKindOf(item) === 'video'
              const picked  = chosen.some(c => c.url === item.url)
              const order   = chosen.findIndex(c => c.url === item.url) + 1
              return (
                <button key={item.id || item.url} type="button" onClick={() => toggle(item)}
                  title={item.name || ''}
                  className={`group relative aspect-square overflow-hidden border transition-all ${
                    picked ? 'border-amber-600 ring-2 ring-amber-600/30' : 'border-border hover:border-text-tertiary'}`}>
                  {isVideo
                    // #t=0.1 asks the browser to seek to a tenth of a second
                    // and paint THAT frame. Without it a preload="metadata"
                    // video renders as a blank square, indistinguishable from
                    // a broken asset — which is what the grid used to show.
                    ? <video src={`${item.url}#t=0.1`} className="w-full h-full object-cover bg-stone-800"
                        muted playsInline preload="metadata" />
                    : <img src={item.url} alt={item.name || ''} className="w-full h-full object-cover" />}

                  {isVideo && (
                    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="w-7 h-7 rounded-full bg-black/50 text-white text-[10px] flex items-center justify-center">▶</span>
                    </span>
                  )}

                  {/* Name on hover only. Always-on labels turned a grid of
                      pictures into a grid of filenames. */}
                  <span className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/75 to-transparent text-white text-[10px] truncate text-left opacity-0 group-hover:opacity-100 transition-opacity">
                    {item.name || (isVideo ? 'Video' : 'Image')}
                  </span>

                  {picked && (
                    <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-amber-600 text-white text-[11px] font-bold flex items-center justify-center">
                      {multiple ? order : '\u2713'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-border">
        <p className="text-xs text-text-tertiary">
          {multiple
            ? (chosen.length ? `${chosen.length} selected \u2014 they publish in the order picked.` : 'Pick one or more.')
            : 'Pick one, or drop a file anywhere above.'}
        </p>
        {multiple ? (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={chosen.length === 0}
              onClick={() => { onSelect(chosen); onClose() }}>
              Add {chosen.length || ''}
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        )}
      </div>
    </Modal>
  )
}
