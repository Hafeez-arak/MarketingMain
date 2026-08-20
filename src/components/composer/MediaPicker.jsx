import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Modal, Spinner, Empty } from '../ui/index'
import { fetchMediaLibrary } from '../../lib/mediaLibrary'
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
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(false)
  const [chosen, setChosen]   = useState([])

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
      <div className="flex items-center justify-between mb-4 gap-2">
        <p className="text-sm text-text-secondary">
          {multiple ? 'Pick one or more. Order follows the order you pick them in.' : 'Pick one.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => navigate('/studio')}>
          Design in Studio
        </Button>
      </div>

      {loading && <div className="py-10 flex justify-center"><Spinner /></div>}

      {!loading && items.length === 0 && (
        <Empty
          title="Nothing in the media library yet"
          description="Generate an image or video in Creative Studio and save it here, and it will be available to every post."
          action={<Button variant="primary" size="sm" onClick={() => navigate('/studio')}>Open Creative Studio</Button>}
        />
      )}

      {!loading && items.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[50vh] overflow-y-auto">
          {items.map(item => {
            const isVideo = mediaKindOf(item) === 'video'
            const picked  = chosen.some(c => c.url === item.url)
            const order   = chosen.findIndex(c => c.url === item.url) + 1
            return (
              <button key={item.id || item.url} onClick={() => toggle(item)}
                className={`relative aspect-square overflow-hidden border-2 transition-colors ${picked ? 'border-amber-600' : 'border-border hover:border-text-tertiary'}`}>
                {isVideo
                  ? <video src={item.url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                  : <img src={item.url} alt={item.name || ''} className="w-full h-full object-cover" />}
                {isVideo && (
                  <span className="absolute bottom-1 left-1 text-[10px] font-bold uppercase bg-black/60 text-white px-1 leading-[1.4]">
                    Video
                  </span>
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
