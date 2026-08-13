import { useState, useRef, useEffect } from 'react'
import {
  DAY_LABELS, weekGrid, dayEntries, isToday, isPastSlot,
  laneRange, laneLabel, lanePosition, dropToTime, platformColor, DRAG_MIME,
  layoutDayColumn,
} from './calendarModel'
import { PostChip } from './PostChip'
import { formatBrandTime, BRAND_TIMEZONE_LABEL, utcToBrandParts } from '../../lib/brandTime'

// ─── Week view ─────────────────────────────────────────────────────────────
// The view the month grid cannot be: a vertical time axis, so you can see that
// three posts are stacked at 7 PM and nothing goes out before noon. Dropping
// here sets the DATE and the TIME, read off the drop's position within the
// day column and snapped to a quarter hour.
//
// Lanes are brand-time hours. The band is 6am–11pm by default and widens to
// include anything actually scheduled outside it, so an unusual 2 AM slot is
// never simply invisible.

const ROW_PX = 46
const SNAP_MINUTES = 15

// Current time, as state that advances on its own. Lazily initialised so the
// clock is read once at mount rather than on every render.
function useNowMs(intervalMs = 60_000) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return nowMs
}

export function WeekGrid({
  anchorDate, index, crowded, pendingId,
  onOpenPost, onDropPost, draggingPost, onSelectDay,
}) {
  const [hover, setHover] = useState(null)   // { key, time }
  const columnRefs = useRef({})
  const nowMs = useNowMs()

  const cells = weekGrid(anchorDate)
  const visible = cells.flatMap(c => dayEntries(index, c.key))
  const { start, end } = laneRange(visible)
  const hours = Array.from({ length: end - start }, (_, i) => start + i)
  const bandPx = hours.length * ROW_PX

  // Where in the day column did the pointer land, as a 0..1 fraction?
  function fractionFor(e, key) {
    const el = columnRefs.current[key]
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return (e.clientY - rect.top) / rect.height
  }

  // The "now" line has to be state, not a Date.now() read during render.
  // Reading the clock while rendering is impure — the value would only change
  // when something unrelated re-rendered the grid, so the line would sit
  // frozen at whatever time the page happened to load. A minute tick is the
  // right resolution for a band whose rows are an hour tall.
  const nowParts = utcToBrandParts(nowMs)
  const nowKey = nowParts?.dateKey
  const nowOffset = nowParts && nowParts.hourFloat >= start && nowParts.hourFloat <= end
    ? lanePosition(nowParts.hourFloat, start, end) * bandPx
    : null

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[820px]">

        {/* Day headers */}
        <div className="grid border-b border-border bg-surface-subtle"
          style={{ gridTemplateColumns: `56px repeat(7, minmax(0, 1fr))` }}>
          <div className="py-2 px-1.5 flex items-end justify-end">
            <span className="text-[9px] font-bold uppercase tracking-wider text-text-disabled">
              {BRAND_TIMEZONE_LABEL}
            </span>
          </div>
          {cells.map(c => {
            const today = isToday(c.key)
            const count = dayEntries(index, c.key).length
            return (
              <button key={c.key} onClick={() => onSelectDay?.(c.key)}
                className="py-2 text-center border-l border-border hover:bg-white transition-colors">
                <p className="eyebrow text-text-tertiary">{DAY_LABELS[new Date(`${c.key}T00:00:00Z`).getUTCDay()]}</p>
                <p className={`text-sm font-bold tabular-nums mt-0.5 inline-flex items-center justify-center w-6 h-6
                  ${today ? 'bg-amber-700 text-white' : 'text-text'}`}>
                  {Number(c.key.slice(8, 10))}
                </p>
                {count > 0 && (
                  <p className="text-[9px] text-text-tertiary tabular-nums">{count}</p>
                )}
              </button>
            )
          })}
        </div>

        {/* Time band */}
        <div className="grid relative" style={{ gridTemplateColumns: `56px repeat(7, minmax(0, 1fr))` }}>

          {/* Hour gutter */}
          <div className="relative" style={{ height: bandPx }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-text-tertiary"
                style={{ top: i * ROW_PX }}>
                {laneLabel(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {cells.map(c => {
            const entries = dayEntries(index, c.key)
            const canDropHere = !!draggingPost
            const isHoverCol = hover?.key === c.key

            return (
              <div key={c.key}
                ref={el => { columnRefs.current[c.key] = el }}
                className="relative border-l border-border"
                style={{ height: bandPx }}
                onDragOver={e => {
                  if (!canDropHere) return
                  e.preventDefault()
                  const time = dropToTime(fractionFor(e, c.key), start, end, SNAP_MINUTES)
                  // Refuse a past slot at hover time, so the cursor tells you
                  // before you let go rather than after.
                  if (isPastSlot(c.key, time)) { e.dataTransfer.dropEffect = 'none'; setHover({ key: c.key, time, past: true }); return }
                  e.dataTransfer.dropEffect = 'move'
                  setHover({ key: c.key, time, past: false })
                }}
                onDragLeave={() => setHover(h => (h?.key === c.key ? null : h))}
                onDrop={e => {
                  if (!canDropHere) return
                  e.preventDefault()
                  const time = dropToTime(fractionFor(e, c.key), start, end, SNAP_MINUTES)
                  setHover(null)
                  if (isPastSlot(c.key, time)) return
                  const id = e.dataTransfer.getData(DRAG_MIME)
                  if (id) onDropPost?.(id, c.key, time)
                }}>

                {/* Hour rules */}
                {hours.map((h, i) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-border/60"
                    style={{ top: i * ROW_PX }} />
                ))}

                {/* Now line — only on today's column. */}
                {c.key === nowKey && nowOffset !== null && (
                  <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: nowOffset }}>
                    <div className="h-px bg-red-500" />
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 -mt-[3px] -ml-[3px]" />
                  </div>
                )}

                {/* Drop preview */}
                {isHoverCol && (
                  <div className="absolute left-0 right-0 z-30 pointer-events-none"
                    style={{ top: lanePosition(toHourFloat(hover.time), start, end) * bandPx }}>
                    <div className={`h-0.5 ${hover.past ? 'bg-red-400' : 'bg-amber-600'}`} />
                    <span className={`absolute left-1 top-1 text-[9px] font-bold px-1 py-0.5 text-white
                      ${hover.past ? 'bg-red-500' : 'bg-amber-600'}`}>
                      {hover.past ? 'in the past' : formatBrandTime(hover.time)}
                    </span>
                  </div>
                )}

                {/* Scheduled posts, split across sub-columns where they would
                    otherwise overlap. */}
                {layoutDayColumn(entries).map(entry => {
                  const pc = platformColor(entry.post.platform)
                  const width = 100 / entry.lanes
                  return (
                    <div key={entry.post.id}
                      className="absolute z-10 px-0.5"
                      style={{
                        top: lanePosition(entry.hourFloat, start, end) * bandPx,
                        left: `${entry.lane * width}%`,
                        width: `${width}%`,
                      }}>
                      <div className="shadow-sm" style={{ background: pc.light }}>
                        <PostChip
                          post={entry.post} time={entry.time}
                          crowded={crowded.has(entry.post.id)}
                          pending={pendingId === entry.post.id}
                          onOpen={onOpenPost}
                          compact={entry.lanes > 1} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const toHourFloat = time => {
  const [h, m] = String(time || '0:0').split(':').map(Number)
  return h + m / 60
}
