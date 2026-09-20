import { platformColor, chipDraggable, stageStyle, DRAG_MIME, DAY_LABELS, addDays } from './calendarModel'
import { formatBrandTime, formatBrandDateTime, utcToBrandParts, brandTodayKey } from '../../lib/brandTime'
import { moveKindFor } from '../../lib/scheduledPosts'
import { scheduleStage, pendingReason } from '../../lib/postStage'

// ─── One post, as it appears on the calendar ───────────────────────────────
// Colour carries the STATE, not the platform: blue is booked, amber is in
// flight, green is published and therefore untouchable, red never left. The
// platform keeps a dot, because two posts at the same hour on two platforms is
// the normal case and the difference has to be visible without reading.
//
// Clicking opens the post. It used to open the post's DAY — a panel listing
// everything on that date — which is why "I can't view the post when I click
// on it in the calendar" was a fair description of a click that did something.

export function PostChip({
  post, time, onOpen, onDragStart, onDragEnd, pending, crowded, unseen = false, compact = false,
}) {
  const pc = platformColor(post.platform)
  const stage = scheduleStage(post)
  const sty = stageStyle(stage)
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
      title={`${pc.label} · ${sty.label}${time ? ` · ${formatBrandTime(time)}` : ''}`
        + (blockedReason ? `\n${blockedReason}` : '')
        + (text ? `\n${text}` : '')}
      // Always clickable, even when it cannot be dragged: a published post is
      // exactly the one you most want to open and read, and `cursor-default`
      // on it said the opposite.
      className={`group/chip w-full text-left flex items-center gap-1.5 pl-1.5 pr-1 py-1 border-l-2
        transition-colors overflow-hidden cursor-pointer
        ${draggable ? 'active:cursor-grabbing' : ''}
        ${pending ? 'opacity-50 animate-pulse' : ''}`}
      style={{
        borderLeftColor: sty.ring,
        // The darker wash is the "you have not looked at this yet" state the
        // bell's notification points at. It is the same chip, not a different
        // one — opening it clears the flag and it settles to its normal fill.
        background: unseen ? sty.ring : sty.fill,
        color: unseen ? '#fff' : undefined,
      }}>

      {time && (
        <span className={`text-[9px] font-bold tabular-nums flex-shrink-0 ${unseen ? '' : 'text-text-tertiary'}`}>
          {formatBrandTime(time).replace(':00', '')}
        </span>
      )}

      {/* Platform, as a dot. The chip's own colour is spoken for by the state,
          so this is the only thing left saying where the post goes. */}
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 ring-1 ring-white/50"
        title={pc.label} style={{ background: pc.dot }} />

      {/* Crowding marker — another post to the SAME platform sits within an
          hour of this one. Not an error, so it must not look like one; it is a
          nudge, and the tooltip carries the detail. */}
      {crowded && (
        <span title="Another post to this platform is scheduled within an hour"
          className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0 ring-1 ring-white/50" />
      )}

      <span className={`text-[10px] truncate flex-1 min-w-0 ${unseen ? 'font-semibold' : 'text-text-secondary'}`}>
        {text || pc.label}
      </span>

      {!compact && post.publish_status === 'failed' && (
        <span className={`text-[9px] font-bold flex-shrink-0 ${unseen ? '' : 'text-red-600'}`}>!</span>
      )}
    </div>
  )
}

// ─── The strip ─────────────────────────────────────────────────────────────
// An approved post that nothing is going to publish. Not a drag source any
// more: these are posts waiting on a decision, and the decision is "when",
// which is a date and a time — not a guess at which square the cursor was over.
// Clicking opens it, and the panel is where the slot gets chosen.
export function TrayChip({ post, onOpen, pending }) {
  const pc = platformColor(post.platform)
  const failed = post.publish_status === 'failed'
  const text = (post.caption || post.topic || post.hook || '').replace(/\s+/g, ' ').trim()

  return (
    <button type="button"
      onClick={() => onOpen?.(post)}
      title={pendingReason(post)}
      className={`flex items-start gap-2 p-2 border bg-white hover:border-stone-400 hover:bg-surface-subtle
        transition-colors w-56 flex-shrink-0 text-left
        ${failed ? 'border-red-300' : 'border-border'}
        ${pending ? 'opacity-50 animate-pulse' : ''}`}>
      <div className="w-1 self-stretch flex-shrink-0" style={{ background: pc.dot }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: pc.dot }}>
            {pc.label}
          </p>
          {failed && <span className="text-[9px] font-bold uppercase tracking-wider text-red-600">Failed</span>}
        </div>
        <p className="text-[11px] text-text-secondary line-clamp-2 leading-snug">
          {text || 'No caption yet'}
        </p>
        <p className="text-[10px] text-text-tertiary mt-1 truncate">{pendingReason(post)}</p>
      </div>
    </button>
  )
}

// ─── The "going out next" strip ────────────────────────────────────────────
// A booked post, as a card that leads with WHEN. The calendar answers "what
// is on the 21st"; this answers "what is coming", which is the question you
// actually arrive at the page with and the one a month grid is worst at — the
// next post can be three rows down, or on a month you are not looking at.
//
// Same click target as a chip on the grid: it opens the post, with the same
// view / reschedule / cancel / edit controls. There is one post panel, and
// every route to it behaves identically.
export function UpcomingChip({ post, onOpen, pending, unseen = false }) {
  const pc = platformColor(post.platform)
  const stage = scheduleStage(post)
  const sty = stageStyle(stage)
  const parts = utcToBrandParts(post.scheduled_publish_at)
  const text = (post.caption || post.topic || post.hook || '').replace(/\s+/g, ' ').trim()

  return (
    <button type="button"
      onClick={() => onOpen?.(post)}
      title={`${pc.label} · ${sty.label} · ${formatBrandDateTime(post.scheduled_publish_at)}${text ? `\n${text}` : ''}`}
      className={`flex flex-col gap-1 p-2.5 border-l-2 border-y border-r border-border bg-white
        hover:border-stone-400 hover:bg-surface-subtle transition-colors
        w-52 flex-shrink-0 text-left
        ${pending ? 'opacity-50 animate-pulse' : ''}`}
      style={{ borderLeftColor: sty.ring }}>

      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: pc.dot }} />
        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: pc.dot }}>
          {pc.label}
        </span>
        {/* Only when it is not the plain expected state. A row of chips all
            saying "Scheduled" is a row of noise; "Publishing" is news. */}
        {stage !== 'booked' && (
          <span className={`text-[9px] font-bold uppercase tracking-wider ${sty.text}`}>{sty.label}</span>
        )}
        {unseen && <span className="w-1.5 h-1.5 rounded-full bg-green-600 flex-shrink-0 ml-auto" />}
      </div>

      {/* The day and the time, in brand time, as the card's headline. */}
      <p className="text-[11px] font-semibold text-text tabular-nums">
        {parts ? `${relativeDay(parts.dateKey)} · ${formatBrandTime(parts.time)}` : 'No time'}
      </p>

      <p className="text-[11px] text-text-secondary line-clamp-2 leading-snug">
        {text || 'No caption yet'}
      </p>
    </button>
  )
}

// 'Today' / 'Tomorrow' / 'Mon 29' — a date you can read without counting.
// Brand-time keys throughout, so this never disagrees with the grid cell the
// same post sits in.
function relativeDay(dateKey) {
  const today = brandTodayKey()
  if (dateKey === today) return 'Today'
  if (dateKey === addDays(today, 1)) return 'Tomorrow'
  const [y, m, d] = dateKey.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  return `${DAY_LABELS[at.getUTCDay()]} ${d}`
}
