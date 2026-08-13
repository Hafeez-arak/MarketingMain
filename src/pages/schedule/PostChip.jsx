import { platformColor, publishState, chipDraggable, DRAG_MIME } from './calendarModel'
import { formatBrandTime } from '../../lib/brandTime'
import { moveKindFor } from '../../lib/scheduledPosts'

// ─── One post, as it appears on the calendar ───────────────────────────────
// The drag source for both views. Native HTML5 drag-and-drop rather than a
// library: the whole interaction is "pick up a chip, drop it on a cell", and a
// dependency for that would be more code than the four handlers below.

export function PostChip({
  post, time, onOpen, onDragStart, onDragEnd, pending, crowded, compact = false,
}) {
  const pc = platformColor(post.platform)
  const st = publishState(post.publish_status)
  const draggable = chipDraggable(post)
  const blockedReason = draggable ? '' : moveKindFor(post).reason
  const text = (post.caption || post.topic || post.hook || '').replace(/\s+/g, ' ').trim()

  return (
    <div
      draggable={draggable}
      onDragStart={e => {
        if (!draggable) { e.preventDefault(); return }
        // The id is the payload; the post itself is looked up by the drop
        // handler from state it already has. Stuffing a whole row into
        // dataTransfer would serialise media urls and captions on every drag.
        e.dataTransfer.setData(DRAG_MIME, post.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.(post)
      }}
      onDragEnd={() => onDragEnd?.()}
      onClick={e => { e.stopPropagation(); onOpen?.(post) }}
      title={blockedReason || `${pc.label} · ${st.label}${time ? ` · ${formatBrandTime(time)}` : ''}${text ? `\n${text}` : ''}`}
      className={`group/chip w-full text-left flex items-center gap-1.5 pl-1.5 pr-1 py-1 border-l-2 bg-surface-subtle
        transition-colors overflow-hidden
        ${draggable ? 'cursor-grab active:cursor-grabbing hover:bg-white' : 'cursor-default opacity-75'}
        ${pending ? 'opacity-50 animate-pulse' : ''}`}
      style={{ borderLeftColor: pc.dot }}>

      {time && (
        <span className="text-[9px] font-bold tabular-nums text-text-tertiary flex-shrink-0">
          {formatBrandTime(time).replace(':00', '')}
        </span>
      )}

      {/* Crowding marker — another post to the SAME platform sits within an
          hour of this one. Not an error, so it must not look like one; it is a
          nudge, and the tooltip carries the detail. */}
      {crowded && (
        <span title="Another post to this platform is scheduled within an hour"
          className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
      )}

      <span className="text-[10px] text-text-secondary truncate flex-1 min-w-0">
        {text || pc.label}
      </span>

      {!compact && post.publish_status === 'failed' && (
        <span className="text-[9px] font-bold text-red-600 flex-shrink-0">!</span>
      )}
    </div>
  )
}

// The tray chip is a bit taller and always shows the platform, because without
// a cell around it there is no other context for what it is.
export function TrayChip({ post, onOpen, onDragStart, onDragEnd, pending }) {
  const pc = platformColor(post.platform)
  const draggable = chipDraggable(post)
  const text = (post.caption || post.topic || post.hook || '').replace(/\s+/g, ' ').trim()

  return (
    <div
      draggable={draggable}
      onDragStart={e => {
        if (!draggable) { e.preventDefault(); return }
        e.dataTransfer.setData(DRAG_MIME, post.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.(post)
      }}
      onDragEnd={() => onDragEnd?.()}
      onClick={() => onOpen?.(post)}
      className={`flex items-start gap-2 p-2 border border-border bg-white hover:border-stone-400
        transition-colors w-56 flex-shrink-0
        ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default opacity-60'}
        ${pending ? 'opacity-50 animate-pulse' : ''}`}>
      <div className="w-1 self-stretch flex-shrink-0" style={{ background: pc.dot }} />
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: pc.dot }}>
          {pc.label}
        </p>
        <p className="text-[11px] text-text-secondary line-clamp-2 leading-snug">
          {text || 'No caption yet'}
        </p>
      </div>
    </div>
  )
}
