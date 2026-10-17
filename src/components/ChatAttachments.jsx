import { useRef } from 'react'
import { ACCEPT } from '../lib/chatAttachments'

// ─── Attaching a picture or a PDF to a question ────────────────────────────
// Shared by the drawer and the /agent page for the same reason AskInput is:
// they are one conversation, and a composer that attaches on one surface and
// not the other is two bug reports.
//
// Four pieces, so each surface lays them out its own way:
//   useChatAttachments()  the state — pending files, errors, add / remove
//                         (src/lib/useChatAttachments.js; a hook cannot
//                         share a file with components under fast refresh)
//   <AttachButton>        the paperclip and its hidden file input
//   <AttachmentTray>      the pending files above the composer, removable
//   <TurnAttachments>     the thumbnails on a sent message
//
// Paste works too: the hook's onPaste goes on the textarea, and a screenshot
// on the clipboard becomes an attachment instead of nothing.

export function AttachButton({ onFiles, disabled }) {
  const input = useRef(null)
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled}
        title="Attach an image or PDF"
        aria-label="Attach an image or PDF"
        className="h-9 w-9 shrink-0 flex items-center justify-center border border-border bg-white text-text-secondary
                   hover:text-text hover:border-stone-400 disabled:opacity-50 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={e => { onFiles(e.target.files); e.target.value = '' }}
      />
    </>
  )
}

function Thumb({ a, size = 'h-14 w-14' }) {
  return a.kind === 'pdf' || !a.thumb ? (
    <div className={`${size} flex flex-col items-center justify-center bg-surface-muted text-[10px] text-text-secondary px-1 text-center overflow-hidden`}>
      <span className="font-semibold">{a.kind === 'pdf' ? 'PDF' : 'File'}</span>
      <span className="truncate w-full">{a.name}</span>
    </div>
  ) : (
    <img src={a.thumb} alt={a.name} title={a.name} className={`${size} object-cover border border-border-light`} />
  )
}

export function AttachmentTray({ items, error, preparing, onRemove }) {
  if (!items.length && !error && !preparing) return null
  return (
    <div className="mb-2 w-full">
      {items.length ? (
        <div className="flex flex-wrap gap-2">
          {items.map(a => (
            <div key={a.id} className="relative">
              <Thumb a={a} />
              <button
                type="button"
                onClick={() => onRemove(a.id)}
                aria-label={`Remove ${a.name}`}
                className="absolute -top-1.5 -right-1.5 h-5 w-5 flex items-center justify-center bg-white border border-border
                           text-text-secondary hover:text-text text-xs leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {preparing ? <div className="mt-1 text-xs text-text-tertiary">Preparing…</div> : null}
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </div>
  )
}

/** The files a sent message carried, as small thumbnails above its text. */
export function TurnAttachments({ items, align = 'right' }) {
  if (!items?.length) return null
  return (
    <div className={`mb-1 flex flex-wrap gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>
      {items.map((a, i) => <Thumb key={`${a.name}-${i}`} a={a} size="h-16 w-16" />)}
    </div>
  )
}
