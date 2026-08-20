import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Modal, Spinner, Empty } from '../ui/index'
import { fetchMediaLibrary, uploadToMediaLibrary } from '../../lib/mediaLibrary'
import { mediaKindOf, toComposerMedia } from '../../lib/composerMedia'
import { useAuth } from '../../store/auth'

// ─── Choosing media for a post ─────────────────────────────────────────────
// This is where Hootsuite puts its Canva and Adobe Express buttons. We have
// neither, and wiring them would mean sending brand assets to a third party
// to get back something Creative Studio already makes — so the two entry
// points here are Creative Studio (make something new) and the Media Library
// (reuse something made earlier).
//
// Everything the library returns already lives in public Supabase Storage,
// which is why media is passed to the publisher by URL and never re-uploaded.

export function MediaPicker({ open, onClose, onSelect, multiple = false, kind = 'all' }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const navigate = useNavigate()
  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(false)
  const [chosen, setChosen]       = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setError]   = useState('')
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
    queueMicrotask(() => { if (!cancelled) { setLoading(true); setChosen([]) } })
    fetchMediaLibrary(activeWorkspaceId, accessToken, { kind })
      .then(res => {
        if (cancelled) return
        setItems(Array.isArray(res) ? res : (res?.items || []))
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, activeWorkspaceId, accessToken, kind])

  const toggle = (item) => {
    if (!multiple) { onSelect([toComposerMedia(item)]); onClose(); return }
    setChosen(prev => prev.some(c => c.url === item.url)
      ? prev.filter(c => c.url !== item.url)
      : [...prev, toComposerMedia(item)])
  }

  return (
    <Modal open={open} onClose={onClose} title="Add media" width="max-w-3xl">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <p className="text-sm text-text-secondary">
          {multiple ? 'Pick one or more. Order follows the order you pick them in.' : 'Pick one.'}
        </p>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" multiple className="hidden"
            accept={kind === 'video' ? 'video/*' : 'image/*,video/*'}
            onChange={e => handleFiles(e.target.files)} />
          <Button variant="primary" size="sm" disabled={uploading}
            onClick={() => fileRef.current?.click()}>
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/studio')}>
            Design in Studio
          </Button>
        </div>
      </div>

      {uploadError && <p className="text-sm text-red-600 mb-3">{uploadError}</p>}

      {loading && <div className="py-10 flex justify-center"><Spinner /></div>}

      {!loading && items.length === 0 && (
        <Empty
          title="Nothing in the media library yet"
          description="Upload a file, or generate one in Creative Studio — either way it lands here and is available to every post afterwards."
          action={
            <div className="flex gap-2 justify-center">
              <Button variant="primary" size="sm" disabled={uploading}
                onClick={() => fileRef.current?.click()}>
                {uploading ? 'Uploading…' : 'Upload a file'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/studio')}>
                Open Creative Studio
              </Button>
            </div>
          }
        />
      )}

      {!loading && items.length > 0 && (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-[50vh] overflow-y-auto">
          {items.map(item => {
            const isVideo = mediaKindOf(item) === 'video'
            const picked  = chosen.some(c => c.url === item.url)
            const order   = chosen.findIndex(c => c.url === item.url) + 1
            return (
              <button key={item.id || item.url} onClick={() => toggle(item)}
                className={`relative aspect-square overflow-hidden border-2 transition-colors ${picked ? 'border-amber-600' : 'border-border hover:border-text-tertiary'}`}>
                {isVideo
                  // #t=0.1 asks the browser to seek to a tenth of a second and
                  // paint THAT frame. Without it a preload="metadata" video
                  // renders as a blank white square, which is what the grid
                  // was showing — indistinguishable from a broken asset.
                  ? <video src={`${item.url}#t=0.1`} className="w-full h-full object-cover bg-stone-800"
                      muted playsInline preload="metadata" />
                  : <img src={item.url} alt={item.name || ''} className="w-full h-full object-cover" />}
                {isVideo && (
                  <>
                    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="w-7 h-7 rounded-full bg-black/55 text-white text-[11px] flex items-center justify-center">▶</span>
                    </span>
                    <span className="absolute bottom-1 left-1 text-[10px] font-bold uppercase bg-black/60 text-white px-1 leading-[1.4]">
                      Video
                    </span>
                  </>
                )}
                {picked && (
                  <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-amber-600 text-white text-[11px] font-bold flex items-center justify-center">
                    {multiple ? order : '✓'}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {multiple && (
        <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={chosen.length === 0}
            onClick={() => { onSelect(chosen); onClose() }}>
            Add {chosen.length || ''}
          </Button>
        </div>
      )}
    </Modal>
  )
}
