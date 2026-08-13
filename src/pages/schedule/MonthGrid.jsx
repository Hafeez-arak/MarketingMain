import { useState } from 'react'
import { DAY_LABELS, monthGrid, dayEntries, isToday, isPastSlot, DRAG_MIME } from './calendarModel'
import { PostChip } from './PostChip'

// ─── Month view ────────────────────────────────────────────────────────────
// Cells are BRAND-time days (see calendarModel). Dropping on a cell keeps the
// post's existing time of day and only changes the date — a month grid has no
// vertical time axis, so inventing one from the drop position would be
// guessing. Use the week view to change the hour.

const MAX_VISIBLE = 3
const DEFAULT_DROP_TIME = '10:00'

export function MonthGrid({
  year, month, index, crowded, pendingId, selectedDay,
  onSelectDay, onOpenPost, onDropPost, draggingPost,
}) {
  const [hoverKey, setHoverKey] = useState('')
  const cells = monthGrid(year, month)

  function handleDrop(e, dateKey) {
    e.preventDefault()
    setHoverKey('')
    const id = e.dataTransfer.getData(DRAG_MIME)
    if (!id) return
    onDropPost?.(id, dateKey, null)   // null time = keep the post's own hour
  }

  return (
    <div className="grid grid-cols-7">
      {DAY_LABELS.map(d => (
        <div key={d} className="py-2 text-center border-b border-border bg-surface-subtle">
          <span className="eyebrow text-text-tertiary">{d}</span>
        </div>
      ))}

      {cells.map(cell => {
        const entries  = dayEntries(index, cell.key)
        const today    = isToday(cell.key)
        const selected = selectedDay === cell.key
        const isHover  = hoverKey === cell.key
        // A day wholly in the past cannot take a drop — the platforms reject a
        // backdated schedule, so accepting it here would only fail later, at
        // the point where it is least recoverable.
        const past = isPastSlot(cell.key, '23:59')
        const canDrop = !!draggingPost && !past

        return (
          <div key={cell.key}
            onClick={() => onSelectDay?.(cell.key)}
            onDragOver={e => { if (canDrop) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setHoverKey(cell.key) } }}
            onDragLeave={() => setHoverKey(h => (h === cell.key ? '' : h))}
            onDrop={e => { if (canDrop) handleDrop(e, cell.key) }}
            className={`min-h-[112px] p-1.5 relative group border-r border-b border-border transition-colors
              [&:nth-child(7n)]:border-r-0
              ${cell.outside ? 'bg-surface-muted' : 'cursor-pointer'}
              ${isHover && canDrop ? 'bg-amber-100 ring-1 ring-inset ring-amber-500'
                : selected ? 'bg-amber-50'
                : !cell.outside ? 'hover:bg-surface-subtle' : ''}
              ${draggingPost && past ? 'opacity-40' : ''}`}>

            <div className="flex items-start justify-between mb-1.5">
              <span className={`text-[11px] font-bold w-5 h-5 flex items-center justify-center tabular-nums
                ${today ? 'bg-amber-700 text-white'
                  : cell.outside ? 'text-text-disabled'
                  : selected ? 'text-amber-800' : 'text-text-secondary'}`}>
                {Number(cell.key.slice(8, 10))}
              </span>
              {entries.length > 0 && (
                <span className="text-[10px] font-bold text-text-tertiary tabular-nums pr-0.5">
                  {entries.length}
                </span>
              )}
            </div>

            <div className="space-y-1">
              {entries.slice(0, MAX_VISIBLE).map(entry => (
                <PostChip key={entry.post.id}
                  post={entry.post} time={entry.time}
                  crowded={crowded.has(entry.post.id)}
                  pending={pendingId === entry.post.id}
                  onOpen={onOpenPost}
                  compact />
              ))}
              {entries.length > MAX_VISIBLE && (
                <button onClick={e => { e.stopPropagation(); onSelectDay?.(cell.key) }}
                  className="text-[10px] text-text-tertiary pl-1.5 hover:text-amber-700 transition-colors">
                  +{entries.length - MAX_VISIBLE} more
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export { DEFAULT_DROP_TIME }
