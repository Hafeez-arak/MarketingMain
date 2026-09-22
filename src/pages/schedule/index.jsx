import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Card, Button, PageHeader, Spinner, Skeleton } from '../../components/ui/index'
import {
  MONTH_LABELS, indexByDay, dayEntries, findCrowding,
  platformColor, addDays, startOfWeek, isPastSlot,
} from './calendarModel'
import { MonthGrid, DEFAULT_DROP_TIME } from './MonthGrid'
import { WeekGrid } from './WeekGrid'
import { TrayChip, PostChip, UpcomingChip } from './PostChip'
import { PostPanel } from './PostPanel'
import { useCalendarPosts } from './useCalendarPosts'
import { ComposerHost } from '../../components/composer/ComposerHost'
import { useConnectedAccounts } from '../../lib/useConnectedAccounts'
import { useUnseenPublished, markSeen, markAllSeen } from '../../lib/publishSeen'
import { scheduleStage } from '../../lib/postStage'
import { LIVE_PLATFORMS, PLATFORM_META } from '../../lib/utils'
import {
  brandMonthRangeUTC, brandRangeUTC, brandTodayKey, formatBrandDateTime,
  utcToBrandParts, BRAND_TIMEZONE_LABEL,
} from '../../lib/brandTime'

// ─── Content calendar ──────────────────────────────────────────────────────
// What this page is FOR: everything that is going out, when it goes out, and
// the short list of approved posts that nothing is going to send.
//
// Approving a post in the monthly planner IS scheduling it — saving a plan
// books every approved post at Zernio for the moment it was planned (see
// lib/planScheduling). So this page draws no review distinction at all. It
// draws the only one that matters afterwards:
//
//   on the calendar   booked, in flight, or published. Blue, amber, green.
//   in the strip      approved, but unbooked or failed. Red. Needs a person.
//
// Colour carries the state, so the grid is readable without hovering anything,
// and a green chip is always in the past because a post only turns green by
// having gone out.
//
// It used to show every publish state on the grid with the platform as the
// only colour, and staged every unscheduled post — drafts and rejects included
// — in a drag-me-somewhere tray. Neither surface answered a question anyone
// had, and clicking a post opened its DAY rather than the post.

const PLATFORM_FILTERS = ['all', ...LIVE_PLATFORMS]

export function Schedule() {
  const { state } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const navigate = useNavigate()
  // Every connected account, across platforms — booking a post needs to know
  // which account it goes out as, and that answer is not per-platform here.
  const { allAccounts } = useConnectedAccounts()

  const today = brandTodayKey()
  const [view, setView]             = useState('month')      // 'month' | 'week'
  const [anchor, setAnchor]         = useState(today)        // any date inside the shown period
  const [platform, setPlatform]     = useState('all')
  const [selectedDay, setSelectedDay] = useState(null)       // highlighted cell
  const [dayList, setDayList]       = useState(null)         // day panel, if open
  const [openPost, setOpenPost]     = useState(null)         // the post panel
  const [editing, setEditing]       = useState(null)         // handed to the composer
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

  const { posts, pending, upcoming, loading, error, pendingId, book, cancel, reload } =
    useCalendarPosts({
      workspaceId: activeWorkspaceId, accessToken,
      from: range.from, to: range.to, webhooks: state.webhooks,
      accounts: allAccounts,
    })

  // Posts published since you last looked. The bell names them; here they are
  // drawn darker until opened, so "it published" and "which one" are the same
  // piece of information rather than two.
  const unseen = useUnseenPublished(activeWorkspaceId)

  const shown = useMemo(
    () => (platform === 'all' ? posts : posts.filter(p => p.platform === platform)),
    [posts, platform])
  const shownPending = useMemo(
    () => (platform === 'all' ? pending : pending.filter(p => p.platform === platform)),
    [pending, platform])
  const shownUpcoming = useMemo(
    () => (platform === 'all' ? upcoming : upcoming.filter(p => p.platform === platform)),
    [upcoming, platform])

  const index   = useMemo(() => indexByDay(shown), [shown])
  const crowded = useMemo(() => findCrowding(shown), [shown])
  // Every post the page is holding, from all three queries. `upcoming` is in
  // here because a post booked for next month is reachable from the strip
  // while sitting outside the visible range — without it the open panel would
  // keep rendering the stale copy it was opened with after a reschedule.
  const byId = useMemo(
    () => new Map([...posts, ...pending, ...upcoming].map(p => [p.id, p])),
    [posts, pending, upcoming])

  // Counts describe what is on the grid, filter included, so the numbers
  // always match what is underneath them.
  const counts = useMemo(() => {
    const out = { booked: 0, sending: 0, published: 0, sent: 0 }
    for (const p of shown) {
      const s = scheduleStage(p)
      if (s in out) out[s]++
    }
    return out
  }, [shown])

  // Does the period on screen contain today? Drives the Today button's own
  // state — the button worked before, it just had no way of saying so when you
  // were already looking at today, which is indistinguishable from broken.
  const showingToday = view === 'month'
    ? today.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)
    : (() => { const s = startOfWeek(anchor); return today >= s && today <= addDays(s, 6) })()

  function goToToday() {
    setAnchor(today)
    // Visible feedback, always: the cell is highlighted whether or not the
    // period changed, so pressing this never looks like nothing happened.
    setSelectedDay(today)
  }

  // ── Opening a post ───────────────────────────────────────────────────────
  function open(post) {
    setOpenPost(post)
    setDayList(null)
    // Opening it IS seeing it. Clearing on open rather than on close means the
    // dot goes away when you look, not when you tidy up.
    if (activeWorkspaceId) markSeen(activeWorkspaceId, post.id)
  }

  // ── Moving a post ────────────────────────────────────────────────────────
  // A drop on a month cell carries no hour, so the post keeps its own; one
  // that has never been scheduled gets a sensible default rather than midnight.
  function resolveTime(post, time) {
    if (time) return time
    const existing = utcToBrandParts(post.scheduled_publish_at)
    return existing ? existing.time : DEFAULT_DROP_TIME
  }

  function handleDrop(postId, dateKey, time) {
    const post = byId.get(postId)
    if (!post) return
    const resolved = resolveTime(post, time)
    if (isPastSlot(dateKey, resolved)) {
      setNotice({ tone: 'error', text: 'That slot is in the past — pick a future time.' })
      return
    }
    void runBook(post, dateKey, resolved)
  }

  async function runBook(post, dateKey, time) {
    setNotice(null)
    const res = await book(post, dateKey, time)
    if (res?.error) {
      setNotice({
        tone: 'error',
        text: res.unscheduled
          // The workflow cancelled the old slot and could not book the new
          // one. The post is booked NOWHERE, and saying only "could not move"
          // would leave it looking unchanged.
          ? `${res.error} It is no longer booked at all — it is in the strip above.`
          : `Could not schedule that post: ${res.error}`,
      })
      return
    }
    setOpenPost(null)
    setNotice({
      tone: 'ok',
      text: res?.rebooked
        ? `Moved to ${formatBrandDateTime(res.scheduledPublishAt)}.`
        : `Booked for ${formatBrandDateTime(res.scheduledPublishAt)}.`,
    })
  }

  async function runCancel(post) {
    setNotice(null)
    const res = await cancel(post)
    setOpenPost(null)
    setNotice(res?.error
      ? { tone: 'error', text: res.error }
      : { tone: 'ok', text: 'Taken off the schedule — it is waiting in the strip above.' })
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

  const unseenCount = unseen.length

  return (
    <div className="max-w-7xl space-y-4">

      <PageHeader
        title="Content Calendar"
        subtitle={`Everything booked to go out, and what still needs a time. Times are ${BRAND_TIMEZONE_LABEL} (Asia/Riyadh).`}>
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

      {/* Result of the last action, and any load failure. */}
      {(notice || error) && (
        <div className={`px-4 py-2.5 border text-xs flex items-start gap-2
          ${notice?.tone === 'ok'
            ? 'bg-sage-50 border-sage-200 text-sage-800'
            : 'bg-red-50 border-red-200 text-red-700'}`}>
          <span className="flex-1">{error || notice.text}</span>
          {notice && (
            <button onClick={() => setNotice(null)} className="font-bold opacity-60 hover:opacity-100">×</button>
          )}
        </div>
      )}

      {/* Newly published, since you last looked. The bell says it happened;
          this says how many and gets you to them. */}
      {unseenCount > 0 && (
        <div className="px-4 py-2.5 border border-sage-200 bg-sage-50 text-xs flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-sage-600 flex-shrink-0" />
          <span className="flex-1 text-sage-800">
            {unseenCount} post{unseenCount !== 1 ? 's' : ''} published since you last looked — shown in solid green below.
          </span>
          <button onClick={() => markAllSeen(activeWorkspaceId)}
            className="font-semibold text-sage-800 underline">Mark all seen</button>
        </div>
      )}

      {/* Counts, for what is actually in view — filter included. */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {[
            { label: 'Scheduled',  value: counts.booked,  tone: '#2563eb' },
            { label: 'Publishing', value: counts.sending, tone: '#d97706' },
            {
              label: 'Gone out',
              // Both have left, so both belong in this number — leaving the
              // unconfirmed ones out would make the tiles disagree with the
              // grid underneath them. The note is what keeps the number from
              // claiming more than we know.
              value: counts.published + counts.sent,
              tone: '#16a34a',
              note: counts.sent > 0
                ? `${counts.sent} not confirmed yet`
                : '',
            },
            { label: 'Needs a time', value: shownPending.length, tone: '#dc2626' },
          ].map(s => (
            <div key={s.label} className="p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-2 h-2 flex-shrink-0" style={{ background: s.tone }} />
                <p className="eyebrow">{s.label}</p>
              </div>
              {loading
                ? <Skeleton className="h-6 w-10" />
                : <p className="text-2xl font-bold text-text leading-none tabular-nums">{s.value}</p>}
              {!loading && s.note && (
                <p className="text-[10px] text-text-tertiary mt-1.5">{s.note}</p>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* ── The strip ──
          Approved posts that nothing is going to publish. Not a drag source:
          the decision these are waiting on is a date and a time, and a drag
          guesses the second one from wherever the cursor was. Click one. */}
      {shownPending.length > 0 && (
        <Card className="overflow-hidden border-red-200">
          <div className="px-4 py-2.5 border-b border-border bg-red-50 flex items-center gap-2 flex-wrap">
            <p className="eyebrow text-red-800">Not scheduled yet</p>
            <span className="text-[11px] text-red-700">
              {shownPending.length} approved post{shownPending.length !== 1 ? 's' : ''} that nothing will publish —
              open one to give it a time.
            </span>
          </div>
          <div className="p-3 flex gap-2 overflow-x-auto">
            {shownPending.map(post => (
              <TrayChip key={post.id} post={post}
                pending={pendingId === post.id}
                onOpen={open} />
            ))}
          </div>
        </Card>
      )}

      {/* ── Going out next ──
          What the month grid is worst at. The next post can be three rows
          down, or on a month you are not looking at, so "what is coming" —
          the question you arrive at this page with — takes a scan of the whole
          grid to answer. This answers it in a glance, soonest first, and is
          NOT scoped to the visible period: paging to October must not empty
          the list of what goes out on Tuesday.

          Every card opens the same post panel a grid chip does — view,
          reschedule, cancel, edit. One panel, one set of controls, however you
          got there. */}
      {(loading || shownUpcoming.length > 0) && (
        <Card className="overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-surface-subtle flex items-center gap-2 flex-wrap">
            <p className="eyebrow text-text-tertiary">Going out next</p>
            {!loading && (
              <span className="text-[11px] text-text-tertiary">
                {shownUpcoming.length} booked post{shownUpcoming.length !== 1 ? 's' : ''} ahead ·
                {' '}click one to view, reschedule or cancel it
              </span>
            )}
          </div>
          <div className="p-3 flex gap-2 overflow-x-auto">
            {loading
              ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[86px] w-52 flex-shrink-0" />)
              : shownUpcoming.map(post => (
                <UpcomingChip key={post.id} post={post}
                  pending={pendingId === post.id}
                  unseen={unseen.includes(post.id)}
                  onOpen={open} />
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
            {/* Says where it takes you, and shows when you are already there.
                As a bare "Today" that jumped to a month you were looking at
                anyway, it was indistinguishable from a dead button. */}
            <button onClick={goToToday}
              title={showingToday ? "Highlight today's date" : `Jump to ${today}`}
              className={`px-3 py-1.5 border text-xs font-semibold transition-colors
                ${showingToday
                  ? 'border-amber-700 bg-amber-50 text-amber-800'
                  : 'border-border bg-white text-text-secondary hover:text-amber-800 hover:border-amber-700'}`}>
              Today
            </button>
          </div>
        </div>

        {view === 'month' ? (
          <MonthGrid
            year={year} month={month} index={index} crowded={crowded}
            pendingId={pendingId} selectedDay={selectedDay} draggingPost={dragging}
            unseen={unseen}
            onSelectDay={key => { setSelectedDay(key); setDayList(key) }}
            onDropPost={handleDrop}
            onDragStart={setDragging} onDragEnd={() => setDragging(null)}
            onOpenPost={open} />
        ) : (
          <WeekGrid
            anchorDate={anchor} index={index} crowded={crowded}
            pendingId={pendingId} draggingPost={dragging}
            unseen={unseen}
            onSelectDay={key => { setSelectedDay(key); setDayList(key) }}
            onDropPost={handleDrop}
            onDragStart={setDragging} onDragEnd={() => setDragging(null)}
            onOpenPost={open} />
        )}
      </Card>

      {!loading && shown.length === 0 && (
        <Card className="p-12 text-center">
          <p className="font-semibold text-text text-sm mb-1">Nothing booked in this period</p>
          <p className="text-sm text-text-secondary">
            {shownPending.length > 0
              ? 'The posts in the strip above are approved but have no time yet — open one to schedule it.'
              : 'Approve a month in Content Planning and its posts are booked here automatically.'}
          </p>
        </Card>
      )}

      {/* Everything on one day. Reached by clicking a date, or "+N more" in a
          crowded cell — the case a month cell physically cannot show. */}
      {dayList && (
        <DayPanel
          dateKey={dayList} entries={dayEntries(index, dayList)}
          crowded={crowded} pendingId={pendingId} unseen={unseen}
          onClose={() => setDayList(null)}
          onOpenPost={open} />
      )}

      {openPost && (
        <PostPanel
          // Keyed, so opening a different post builds a fresh panel rather than
          // reusing the last one's date and time boxes.
          key={openPost.id}
          post={byId.get(openPost.id) || openPost}
          busy={pendingId === openPost.id}
          onClose={() => setOpenPost(null)}
          onBook={(post, date, time) => void runBook(post, date, time)}
          onCancel={post => void runCancel(post)}
          onEdit={post => { setOpenPost(null); setEditing(post) }} />
      )}

      {/* The composer, for changing the words or the picture. Mounted without
          its own button — it opens only when a post is handed to it, and the
          `key` forces a fresh one per post so a second edit never reopens on
          the first post's draft state. */}
      <ComposerHost
        key={editing?.id || 'idle'}
        trigger={false}
        platform={editing?.platform || 'instagram'}
        openPost={editing}
        onOpenPostHandled={() => setEditing(null)}
        onDone={reload} />

      {platformPicker && (
        <PlatformPicker
          onClose={() => setPlatformPicker(false)}
          onPick={key => { setPlatformPicker(false); navigate(`/social/${key}`) }} />
      )}
    </div>
  )
}

// ─── Day panel ─────────────────────────────────────────────────────────────
// Everything booked on one brand day. A list, not an editor: every row opens
// the post, which is where the time and the cancel live. It used to carry its
// own inline time editor, which was a second place that knew how to reschedule
// and could drift from the one in the post itself.
function DayPanel({ dateKey, entries, crowded, pendingId, unseen, onClose, onOpenPost }) {
  const label = new Date(`${dateKey}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(28,35,33,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width: '560px', maxHeight: '82vh' }}
        className="bg-white border border-border shadow-dropdown flex flex-col overflow-hidden animate-fade-scale">

        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0 border-b border-border bg-surface-subtle">
          <div>
            <p className="eyebrow text-text-tertiary mb-1.5">Content calendar · {BRAND_TIMEZONE_LABEL}</p>
            <h3 className="font-semibold text-sm text-text">{label}</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              {entries.length === 0 ? 'Nothing booked' : `${entries.length} post${entries.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 flex items-center justify-center text-text-tertiary hover:bg-stone-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-3 space-y-1.5">
          {entries.length === 0 && (
            <p className="py-14 text-center text-sm text-text-secondary">
              Nothing goes out on this day.
            </p>
          )}
          {entries.map(({ post, time }) => (
            <PostChip key={post.id}
              post={post} time={time}
              crowded={crowded.has(post.id)}
              pending={pendingId === post.id}
              unseen={unseen.includes(post.id)}
              onOpen={onOpenPost} />
          ))}
        </div>

        <div className="px-5 py-3 border-t border-border flex-shrink-0">
          <p className="text-[11px] text-text-tertiary">Click a post to view it, change its time, or take it off the schedule.</p>
        </div>
      </div>
    </div>
  )
}


// ─── Platform picker ───────────────────────────────────────────────────────
// Built from LIVE_PLATFORMS, so it offers exactly what the app can publish to.
// It used to be a hand-written list — Instagram, TikTok, Snapchat — which
// offered a platform that cannot be connected and omitted LinkedIn, which can.
const NEW_POST_DESC = {
  instagram: 'Posts, Reels, Carousels',
  tiktok:    'Videos',
  linkedin:  'Company page posts',
}

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
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center text-text-tertiary hover:bg-stone-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="p-5">
          {LIVE_PLATFORMS.map(key => {
            const meta = PLATFORM_META[key]
            return (
              <button key={key} onClick={() => onPick(key)}
                className="flex items-center gap-3 p-4 border border-border -mt-px first:mt-0 hover:bg-surface-subtle hover:border-stone-400 transition-colors text-left group w-full">
                <div className="w-10 h-10 flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ background: meta.color }}>{meta.abbr}</div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text group-hover:text-amber-700 transition-colors">{meta.label}</p>
                  <p className="text-[10px] text-text-tertiary">{NEW_POST_DESC[key] || 'Posts'}</p>
                </div>
                <svg className="w-4 h-4 text-text-disabled ml-auto flex-shrink-0 group-hover:text-amber-600 transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
