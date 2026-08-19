import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Card, Button, PageHeader, Spinner, PostImage } from '../../components/ui/index'
import {
  MONTH_LABELS, indexByDay, dayEntries, findCrowding,
  summarize, platformColor, publishState, addDays, startOfWeek, isPastSlot,
} from './calendarModel'
import { MonthGrid, DEFAULT_DROP_TIME } from './MonthGrid'
import { WeekGrid } from './WeekGrid'
import { TrayChip } from './PostChip'
import { useCalendarPosts } from './useCalendarPosts'
import {
  brandMonthRangeUTC, brandRangeUTC, brandTodayKey, formatBrandDateTime,
  formatBrandTime, utcToBrandParts, BRAND_TIMEZONE_LABEL,
} from '../../lib/brandTime'
import { moveKindFor } from '../../lib/scheduledPosts'

// ─── Content calendar ──────────────────────────────────────────────────────
// Reads the `scheduled_posts` view — one ordered query across all three post
// tables — so every platform appears, including the TikTok and Snapchat posts
// that a hand-written union kept invisible. Every date and hour on this page
// is BRAND time (Asia/Riyadh); see lib/brandTime.js for why that is a decision
// rather than a formatting detail.
//
// This page previously rendered `state.posts` and the two localStorage
// monthly-plan maps, which meant it showed planning artifacts and never showed
// a single real scheduled post.

const PLATFORM_FILTERS = ['all', 'instagram', 'tiktok', 'snapchat', 'facebook', 'x']

export function Schedule() {
  const { state } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const navigate = useNavigate()

  const today = brandTodayKey()
  const [view, setView]             = useState('month')      // 'month' | 'week'
  const [anchor, setAnchor]         = useState(today)        // any date inside the shown period
  const [platform, setPlatform]     = useState('all')
  const [selectedDay, setSelectedDay] = useState(null)
  const [dragging, setDragging]     = useState(null)
  const [notice, setNotice]         = useState(null)         // { tone, text }
  const [platformPicker, setPlatformPicker] = useState(false)

  const year  = Number(anchor.slice(0, 4))
  const month = Number(anchor.slice(5, 7)) - 1

  // The window to fetch. A week view still fetches its whole month: paging
  // week to week inside one month then costs no extra round-trips, and the
  // month is only a few hundred rows at the very most.
  const range = useMemo(() => {
    if (view === 'month') return brandMonthRangeUTC(year, month)
    const start = startOfWeek(anchor)
    // Padded a week either side so scrubbing across a month edge does not
    // briefly render an empty column while the next fetch lands.
    return brandRangeUTC(addDays(start, -7), addDays(start, 13))
  }, [view, year, month, anchor])

  const { posts, tray, loading, error, pendingId, move, unschedule } =
    useCalendarPosts({
      workspaceId: activeWorkspaceId, accessToken,
      from: range.from, to: range.to, webhooks: state.webhooks,
    })

  const shown = useMemo(
    () => (platform === 'all' ? posts : posts.filter(p => p.platform === platform)),
    [posts, platform])

  const index    = useMemo(() => indexByDay(shown), [shown])
  const crowded  = useMemo(() => findCrowding(shown), [shown])
  const counts   = useMemo(() => summarize(shown), [shown])
  const byId     = useMemo(() => new Map([...posts, ...tray].map(p => [p.id, p])), [posts, tray])

  // ── Moving a post ────────────────────────────────────────────────────────
  // A drop on a month cell carries no hour, so the post keeps its own; one
  // that has never been scheduled gets a sensible default rather than midnight.
  function resolveTime(post, time) {
    if (time) return time
    const existing = utcToBrandParts(post.scheduled_publish_at)
    return existing ? existing.time : DEFAULT_DROP_TIME
  }

  // Plain functions rather than useCallback: neither grid is memoised, so a
  // stable identity buys nothing, and threading runMove through a dependency
  // array only creates a way for the two to fall out of step.
  function handleDrop(postId, dateKey, time) {
    const post = byId.get(postId)
    if (!post) return
    const resolved = resolveTime(post, time)
    if (isPastSlot(dateKey, resolved)) {
      setNotice({ tone: 'error', text: 'That slot is in the past — pick a future time.' })
      return
    }
    const kind = moveKindFor(post).kind
    if (kind === 'blocked') {
      setNotice({ tone: 'error', text: moveKindFor(post).reason })
      return
    }
    // Every movable post now moves on the drop, including scheduled ones.
    // This used to stop and confirm, because under Zernio a scheduled move was
    // a real outward action — cancel the booked post at the platform, create a
    // new one — that could leave the post scheduled nowhere if the second half
    // failed. Instagram's Graph API cannot schedule, so we hold the slot
    // ourselves and a move is one claimed UPDATE: nothing leaves the building,
    // nothing can half-succeed, and an undo is just another drag. A dialog
    // warning about a cancel-and-rebook that no longer happens would be
    // teaching the wrong mental model, not adding safety.
    void runMove(post, dateKey, resolved)
  }

  async function runMove(post, dateKey, time) {
    setNotice(null)
    const res = await move(post, dateKey, time)
    if (res?.error) {
      setNotice({
        tone: 'error',
        text: res.unscheduled
          ? `${res.error}`
          : `Could not move that post: ${res.error}`,
      })
    } else if (res?.movedVia === 'workflow') {
      setNotice({ tone: 'ok', text: `Rescheduled for ${formatBrandDateTime(res.scheduledPublishAt)}.` })
    } else {
      setNotice({ tone: 'ok', text: `Moved to ${formatBrandDateTime(res.scheduledPublishAt)}.` })
    }
  }

  // ── Period navigation ────────────────────────────────────────────────────
  function step(delta) {
    if (view === 'month') {
      const m = month + delta
      const y = year + Math.floor(m / 12)
      const mm = ((m % 12) + 12) % 12
      setAnchor(`${y}-${String(mm + 1).padStart(2, '0')}-01`)
    } else {
      setAnchor(addDays(anchor, delta * 7))
    }
  }

  const periodLabel = view === 'month'
    ? `${MONTH_LABELS[month]} ${year}`
    : (() => {
        const s = startOfWeek(anchor), e = addDays(s, 6)
        const fmt = k => `${MONTH_LABELS[Number(k.slice(5, 7)) - 1].slice(0, 3)} ${Number(k.slice(8, 10))}`
        return `${fmt(s)} – ${fmt(e)}, ${e.slice(0, 4)}`
      })()

  return (
    <div className="max-w-7xl space-y-4">

      <PageHeader
        title="Content Calendar"
        subtitle={`Every scheduled post, across all platforms. Times are ${BRAND_TIMEZONE_LABEL} (Asia/Riyadh).`}>
        <div className="flex">
          {[{ key: 'month', label: 'Month' }, { key: 'week', label: 'Week' }].map(v => (
            <button key={v.key} onClick={() => setView(v.key)}
              className={`px-3 py-1.5 border -ml-px first:ml-0 text-xs font-semibold transition-colors
                ${view === v.key
                  ? 'bg-amber-700 text-white border-amber-700 relative z-10'
                  : 'bg-white text-text-secondary border-border hover:text-text hover:bg-surface-subtle'}`}>
              {v.label}
            </button>
          ))}
        </div>
        <Button onClick={() => setPlatformPicker(true)}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          New post
        </Button>
      </PageHeader>

      {/* Result of the last move, and any load failure. */}
      {(notice || error) && (
        <div className={`px-4 py-2.5 border text-xs flex items-start gap-2
          ${notice?.tone === 'ok'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-700'}`}>
          <span className="flex-1">{error || notice.text}</span>
          {notice && (
            <button onClick={() => setNotice(null)} className="font-bold opacity-60 hover:opacity-100">×</button>
          )}
        </div>
      )}

      {/* Counts, for what is actually in view — filter included, so the numbers
          always describe the grid below them. */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {[
            { label: 'Scheduled', value: counts.scheduled },
            { label: 'Published', value: counts.published },
            { label: 'Publishing', value: counts.publishing },
            { label: 'Failed',    value: counts.failed },
            { label: 'Unscheduled', value: tray.length },
          ].map(s => (
            <div key={s.label} className="p-4">
              <p className="eyebrow mb-2">{s.label}</p>
              <p className="text-2xl font-bold text-text leading-none tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Staging tray — posts that exist and are ready but have no slot. This
          is what makes the calendar an editor rather than a report: drag one
          onto a day (or, in week view, onto an hour) to schedule it. */}
      {tray.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-surface-subtle flex items-center gap-2">
            <p className="eyebrow text-text-tertiary">Not scheduled yet</p>
            <span className="text-[10px] text-text-tertiary">
              {tray.length} post{tray.length !== 1 ? 's' : ''} · drag onto the calendar to book a slot
            </span>
          </div>
          <div className="p-3 flex gap-2 overflow-x-auto">
            {tray.map(post => (
              <TrayChip key={post.id} post={post}
                pending={pendingId === post.id}
                onDragStart={setDragging}
                onDragEnd={() => setDragging(null)}
                onOpen={() => setSelectedDay(null)} />
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {/* Period bar */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border bg-surface-subtle">
          <div className="flex items-center gap-1">
            <button onClick={() => step(-1)} aria-label="Previous"
              className="w-7 h-7 border border-border bg-white flex items-center justify-center text-text-secondary hover:text-text hover:border-stone-400 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button onClick={() => step(1)} aria-label="Next"
              className="w-7 h-7 border border-border -ml-px bg-white flex items-center justify-center text-text-secondary hover:text-text hover:border-stone-400 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
            </button>
            <h3 className="font-semibold text-sm text-text ml-3 tabular-nums">{periodLabel}</h3>
            {loading && <span className="ml-2"><Spinner size="sm" /></span>}
          </div>

          <div className="flex items-center gap-3">
            <select value={platform} onChange={e => setPlatform(e.target.value)}
              className="text-xs border border-border bg-white px-2 py-1.5 text-text-secondary">
              {PLATFORM_FILTERS.map(p => (
                <option key={p} value={p}>{p === 'all' ? 'All platforms' : platformColor(p).label}</option>
              ))}
            </select>
            <button onClick={() => setAnchor(today)}
              className="px-3 py-1.5 border border-border bg-white text-xs font-semibold text-text-secondary hover:text-amber-800 hover:border-amber-700 transition-colors">
              Today
            </button>
          </div>
        </div>

        {view === 'month' ? (
          <MonthGrid
            year={year} month={month} index={index} crowded={crowded}
            pendingId={pendingId} selectedDay={selectedDay} draggingPost={dragging}
            onSelectDay={setSelectedDay} onDropPost={handleDrop}
            onOpenPost={p => setSelectedDay(utcToBrandParts(p.scheduled_publish_at)?.dateKey || null)} />
        ) : (
          <WeekGrid
            anchorDate={anchor} index={index} crowded={crowded}
            pendingId={pendingId} draggingPost={dragging}
            onSelectDay={setSelectedDay} onDropPost={handleDrop}
            onOpenPost={p => setSelectedDay(utcToBrandParts(p.scheduled_publish_at)?.dateKey || null)} />
        )}
      </Card>

      {!loading && shown.length === 0 && (
        <Card className="p-12 text-center">
          <p className="font-semibold text-text text-sm mb-1">Nothing scheduled in this period</p>
          <p className="text-sm text-text-secondary">
            Approve posts in Approvals, then drag them here from the tray above — or schedule them directly.
          </p>
        </Card>
      )}

      {selectedDay && (
        <DayPanel
          dateKey={selectedDay} entries={dayEntries(index, selectedDay)}
          crowded={crowded} pendingId={pendingId}
          onClose={() => setSelectedDay(null)}
          onMove={(post, dateKey, time) => handleDrop(post.id, dateKey, time)}
          onUnschedule={async post => {
            const res = await unschedule(post)
            setNotice(res?.error
              ? { tone: 'error', text: res.error }
              : { tone: 'ok', text: 'Slot cleared — the post is back in the tray.' })
          }} />
      )}

      {platformPicker && (
        <PlatformPicker
          onClose={() => setPlatformPicker(false)}
          onPick={key => { setPlatformPicker(false); navigate(`/social/${key}`) }} />
      )}
    </div>
  )
}

// ─── Day panel ─────────────────────────────────────────────────────────────
// Everything on one brand day, with the time each post goes out and a way to
// change it that does not require a drag — a keyboard user has to be able to
// reschedule too, and a 15-minute snap is not a precise enough instrument for
// "make it exactly 19:05".
function DayPanel({ dateKey, entries, crowded, pendingId, onClose, onMove, onUnschedule }) {
  const [editing, setEditing] = useState(null)   // post id
  const [draftTime, setDraftTime] = useState('')
  const label = new Date(`${dateKey}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(28,35,33,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width: '720px', maxHeight: '82vh' }}
        className="bg-white border border-border shadow-dropdown flex flex-col overflow-hidden animate-fade-scale">

        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0 border-b border-border bg-surface-subtle">
          <div>
            <p className="eyebrow text-text-tertiary mb-1.5">Content calendar · {BRAND_TIMEZONE_LABEL}</p>
            <h3 className="font-semibold text-sm text-text">{label}</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              {entries.length === 0 ? 'Nothing scheduled' : `${entries.length} post${entries.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-text-tertiary hover:bg-stone-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 divide-y divide-border">
          {entries.length === 0 && (
            <p className="py-14 text-center text-sm text-text-secondary">
              Nothing goes out on this day.
            </p>
          )}
          {entries.map(({ post, time }) => {
            const pc = platformColor(post.platform)
            const st = publishState(post.publish_status)
            const plan = moveKindFor(post)
            const isEditing = editing === post.id
            return (
              <div key={post.id} className="p-4 flex gap-3">
                <div className="w-1 self-stretch flex-shrink-0" style={{ background: pc.dot }} />
                {post.image_url
                  ? <PostImage src={post.image_url} alt="" className="w-14 h-14 object-cover flex-shrink-0 border border-border" />
                  : <div className="w-14 h-14 flex items-center justify-center flex-shrink-0 border border-border text-lg"
                      style={{ background: pc.light }}>{post.video_url ? '🎬' : '📋'}</div>}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: pc.dot }}>{pc.label}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 ${st.cls}`}>{st.label}</span>
                    <span className="text-[11px] font-semibold tabular-nums text-text-secondary">{formatBrandTime(time)}</span>
                    {crowded.has(post.id) && (
                      <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5">
                        within an hour of another {pc.label} post
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text leading-relaxed line-clamp-2">
                    {post.caption || post.topic || 'No caption yet'}
                  </p>
                  {post.publish_error && (
                    <p className="text-[11px] text-red-600 mt-1.5 leading-relaxed">{post.publish_error}</p>
                  )}

                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {isEditing ? (
                      <>
                        <input type="time" value={draftTime} onChange={e => setDraftTime(e.target.value)}
                          className="text-xs border border-border px-2 py-1" />
                        <span className="text-[10px] text-text-tertiary">{BRAND_TIMEZONE_LABEL}</span>
                        <button
                          onClick={() => { setEditing(null); onMove(post, dateKey, draftTime) }}
                          disabled={!draftTime}
                          className="text-[11px] font-semibold px-2 py-1 border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-40">
                          Save time
                        </button>
                        <button onClick={() => setEditing(null)}
                          className="text-[11px] px-2 py-1 border border-border text-text-secondary hover:bg-surface-subtle">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => { setEditing(post.id); setDraftTime(time) }}
                          disabled={plan.kind === 'blocked' || pendingId === post.id}
                          title={plan.kind === 'blocked' ? plan.reason : ''}
                          className="text-[11px] font-semibold px-2 py-1 border border-border text-text-secondary hover:bg-surface-subtle disabled:opacity-40">
                          Change time
                        </button>
                        <button
                          onClick={() => onUnschedule(post)}
                          disabled={plan.kind === 'blocked' || pendingId === post.id}
                          title={plan.kind === 'blocked' ? plan.reason : ''}
                          className="text-[11px] px-2 py-1 border border-border text-text-secondary hover:bg-surface-subtle disabled:opacity-40">
                          Unschedule
                        </button>
                        {plan.kind === 'remote' && (
                          <span className="text-[10px] text-text-tertiary">Queued to publish at this time</span>
                        )}
                        {plan.kind === 'blocked' && (
                          <span className="text-[10px] text-text-tertiary">{plan.reason}</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}


// ─── Platform picker ───────────────────────────────────────────────────────
const NEW_POST_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', abbr: 'IG', bg: '#E1306C', desc: 'Posts, Reels, Stories' },
  { key: 'tiktok',    label: 'TikTok',    abbr: 'TT', bg: '#010101', desc: 'Videos' },
  { key: 'snapchat',  label: 'Snapchat',  abbr: 'SC', bg: '#B8A400', desc: 'Spotlight, Stories' },
]

function PlatformPicker({ onClose, onPick }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(28,35,33,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white border border-border shadow-dropdown w-full max-w-md overflow-hidden animate-fade-scale">
        <div className="px-5 py-4 flex items-center justify-between border-b border-border bg-surface-subtle">
          <div>
            <p className="eyebrow text-amber-600 mb-1">New post</p>
            <h3 className="font-semibold text-sm text-text">Choose a platform</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-text-tertiary hover:bg-stone-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="p-5">
          {NEW_POST_PLATFORMS.map(p => (
            <button key={p.key} onClick={() => onPick(p.key)}
              className="flex items-center gap-3 p-4 border border-border -mt-px first:mt-0 hover:bg-surface-subtle hover:border-stone-400 transition-colors text-left group w-full">
              <div className="w-10 h-10 flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ background: p.bg }}>{p.abbr}</div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text group-hover:text-amber-700 transition-colors">{p.label}</p>
                <p className="text-[10px] text-text-tertiary">{p.desc}</p>
              </div>
              <svg className="w-4 h-4 text-text-disabled ml-auto flex-shrink-0 group-hover:text-amber-600 transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
