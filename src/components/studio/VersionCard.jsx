import { Spinner } from '../ui/index'
import { labelFor } from './labels'

// ─── The pieces every studio lane is built from ────────────────────────────
// One version = one card. Shared between the two branch chats so a candidate,
// an AI edit, a text overlay and a video render all read as the same object at
// different points in its life.

// What the person asked for, as their own turn in the conversation.
export function PromptBubble({ text, note, referenceUrl }) {
  if (!text && !note && !referenceUrl) return null
  return (
    <div className="space-y-1.5">
      {text && (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-stone-800 text-white px-3.5 py-2">
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{text}</p>
            {note && <p className="text-[11px] text-stone-300 mt-1.5 leading-snug">On the reference: {note}</p>}
          </div>
        </div>
      )}
      {referenceUrl && (
        <div className="flex justify-end">
          <img src={referenceUrl} alt="Reference" className="w-14 h-14 object-cover rounded-xl border border-border" />
        </div>
      )}
    </div>
  )
}

export function VersionCard({ version, isBase, onClick, onDragStart, showLabel = true }) {
  const label = labelFor(version)

  if (version.status === 'pending') {
    return (
      <div className="rounded-2xl border border-border bg-surface-subtle/50 aspect-[4/5] flex flex-col items-center justify-center gap-2">
        <Spinner />
        <p className="text-[11px] text-text-tertiary">{label || 'Working'}…</p>
      </div>
    )
  }

  // Not the image's aspect ratio: a failure is one line of text, and reserving
  // a full portrait frame for it leaves half a screen of empty red between the
  // last good version and the chat box.
  if (version.status === 'failed') {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/60 flex flex-col items-center justify-center gap-1.5 px-4 py-5 text-center">
        <p className="text-[11px] font-semibold text-red-700">{label || 'That step'} failed</p>
        {/* The real provider message, not a generic apology — an exhausted
            balance and a rejected prompt need very different responses. */}
        <p className="text-[10px] text-red-600 leading-snug line-clamp-4">{version.error || 'No reason given.'}</p>
      </div>
    )
  }

  const isVideo = version.media_type === 'video' && version.video_url
  const url = version.video_url || version.image_url

  return (
    <div
      // Videos can't be dragged into another lane: nothing downstream accepts a
      // clip as input, so offering the gesture would only ever end in a refusal.
      draggable={!isVideo && !!url}
      onDragStart={e => onDragStart?.(e, version)}
      onClick={() => onClick?.(version)}
      className={`group relative rounded-2xl overflow-hidden border-2 transition-all ${
        onClick ? 'cursor-pointer' : ''
      } ${isBase ? 'border-amber-500 ring-2 ring-amber-300' : 'border-border hover:border-amber-300'}`}
    >
      {isVideo ? (
        <video src={version.video_url} controls playsInline className="w-full block bg-black" />
      ) : (
        // Native image drag would hand the browser its own URL payload and
        // fight ours, so the element itself is the drag source, not the img.
        <img src={version.image_url} alt="" draggable={false} className="w-full block" />
      )}

      {showLabel && label && (
        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur text-white text-[10px] font-semibold">
          {label}
        </span>
      )}
      {isBase && (
        <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-amber-500 text-white text-[10px] font-semibold">
          Editing this
        </span>
      )}
    </div>
  )
}
