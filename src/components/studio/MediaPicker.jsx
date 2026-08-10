import { useEffect, useRef, useState } from 'react'
import { Modal, Spinner, Empty } from '../ui/index'
import { fetchMediaLibrary } from '../../lib/mediaLibrary'

// ─── Pick a reference ──────────────────────────────────────────────────────
// Two ways to supply one, in one place: upload a file, or take something
// already in the Media Library. The library half is the point — the team's
// own product shots and past approved assets are the references they actually
// reach for, and before this the only route was to re-upload a file they'd
// already put in the app once.

export function MediaPicker({
  open, onClose, onPick,
  kind = 'image',            // 'image' | 'video' | 'all' — filters the library grid
  title = 'Add a reference',
  accessToken,
  onUpload,                  // async (file) => ({ url } | { error })
}) {
  const [tab, setTab] = useState('library')
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setError(''); setTab('library'); setLoading(true)
    fetchMediaLibrary(accessToken, { kind }).then(rows => { setAssets(rows); setLoading(false) })
  }, [open, accessToken, kind])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    const res = await onUpload(file)
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
    if (res?.error) { setError(res.error); return }
    onPick({ url: res.url, name: file.name })
    onClose()
  }

  const accept = kind === 'video' ? 'video/*' : kind === 'all' ? 'image/*,video/*' : 'image/*'

  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-3xl">
      <div className="p-5 space-y-4">
        <div className="flex gap-1 p-1 rounded-xl bg-surface-subtle w-fit">
          {[['library', 'Media Library'], ['upload', 'Upload new']].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                tab === id ? 'bg-white text-text font-semibold shadow-sm' : 'text-text-tertiary hover:text-text-secondary'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {tab === 'library' ? (
          loading ? (
            <div className="py-12 flex justify-center"><Spinner /></div>
          ) : assets.length === 0 ? (
            <Empty
              title="Nothing in the library yet"
              description="Upload a file here, or save assets from the Studio and they'll show up."
            />
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[52vh] overflow-y-auto pr-1">
              {assets.map(a => (
                <button key={a.id} type="button"
                  onClick={() => { onPick({ url: a.url, name: a.name }); onClose() }}
                  className="group text-left rounded-xl border border-border overflow-hidden hover:border-amber-400 transition-colors">
                  <div className="aspect-square bg-surface-subtle overflow-hidden">
                    {(a.mime_type || '').startsWith('video/') ? (
                      <video src={a.url} className="w-full h-full object-cover" muted />
                    ) : (
                      <img src={a.url} alt="" loading="lazy" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <p className="text-[10px] text-text-secondary truncate px-2 py-1.5">{a.name || 'Untitled'}</p>
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="py-8 flex flex-col items-center gap-3">
            <input ref={fileRef} type="file" accept={accept} onChange={handleFile}
              className="text-xs file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border file:bg-white file:text-xs" />
            {uploading && <span className="text-xs text-text-tertiary flex items-center gap-1.5"><Spinner size="sm" /> Uploading…</span>}
            <p className="text-[11px] text-text-tertiary text-center max-w-sm leading-snug">
              The AI takes inspiration from a reference — it won't copy it. You can say what to keep
              or change after adding it.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

// The chip that stands in for an attached file once it's chosen, with the
// slot it fills named on it — on the video tab three different things can be
// attached and a bare thumbnail wouldn't say which is which.
export function AttachmentChip({ label, url, note, onNote, onRemove, notePlaceholder }) {
  const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(url || '')
  return (
    <div className="rounded-xl border border-border bg-white p-2 space-y-2">
      <div className="flex items-center gap-2">
        {isVideo
          ? <video src={url} className="w-10 h-10 rounded-lg object-cover border border-border" muted />
          : <img src={url} alt="" className="w-10 h-10 rounded-lg object-cover border border-border" />}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-text leading-tight">{label}</p>
          <p className="text-[10px] text-text-tertiary truncate">{url?.split('/').pop()}</p>
        </div>
        <button type="button" onClick={onRemove} title="Remove"
          className="text-text-tertiary hover:text-red-500 text-sm leading-none px-1">×</button>
      </div>
      {onNote && (
        <input value={note || ''} onChange={e => onNote(e.target.value)}
          placeholder={notePlaceholder || 'What should it take from this? (optional)'}
          className="w-full text-[11px] bg-surface-subtle/50 border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400" />
      )}
    </div>
  )
}
