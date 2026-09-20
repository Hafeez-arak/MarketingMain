import { useState, useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AppContext } from '../store/app'
import { AuthContext } from '../store/auth'
import { Schedule } from '../pages/schedule/index'
import { MonthGrid } from '../pages/schedule/MonthGrid'
import { WeekGrid } from '../pages/schedule/WeekGrid'
import { TrayChip } from '../pages/schedule/PostChip'
import { PostPanel } from '../pages/schedule/PostPanel'
import { indexByDay, findCrowding, addDays, MONTH_LABELS } from '../pages/schedule/calendarModel'
import { brandTodayKey, brandWallToUtcISO, formatBrandDateTime, BRAND_TIMEZONE_LABEL } from '../lib/brandTime'
import '../index.css'

// ─── Dev-only schedule harness ─────────────────────────────────────────────
// Mounts the month and week grids on fixture posts, so the calendar can be
// driven in a browser without signing in — /schedule is behind auth and has no
// data until a workspace exists, and the drag-and-drop and time-lane geometry
// are the parts most worth seeing move.
//
// Moves here are local only: they rewrite the fixture array and never call
// Supabase or Zernio. That is the point — the routing decisions are covered by
// tests, and this is for looking at layout, drag targets and timezone labels.
//
// Served by Vite at /dev-schedule.html. Vite only builds index.html, so this
// never reaches a production bundle.

const today = brandTodayKey()

// Deliberately includes the cases that used to be wrong:
//  · a 01:30 KSA post, which a browser-timezone calendar puts on the wrong day
//  · two Instagram posts 30 minutes apart, which should flag as crowded
//  · one of every stage, so all four chip colours are visible at once
//  · a published post in the past, which is the only place green ever appears
function fixtures() {
  const mk = (id, platform, dayOffset, time, publish_status, caption) => ({
    id, platform, publish_status, caption,
    status: 'pending_publish',
    post_table: 'instagram_generated_posts',
    scheduled_publish_at: brandWallToUtcISO(addDays(today, dayOffset), time),
    published_at: publish_status === 'published'
      ? brandWallToUtcISO(addDays(today, dayOffset), time) : null,
    image_url: '', video_url: '',
  })
  return [
    mk('a', 'instagram', 0, '01:30', 'scheduled',  'Late-night reel — 1:30 AM KSA, the day-boundary case'),
    mk('b', 'instagram', 0, '19:00', 'scheduled',  'Evening villa facade shot'),
    mk('c', 'instagram', 0, '19:30', 'scheduled',  'Crowding test — 30 min after the last one'),
    mk('d', 'linkedin',  0, '19:00', 'scheduled',  'Same instant, different platform — must NOT flag'),
    mk('e', 'instagram', -1, '09:00', 'published', 'Already out — green, and in the past'),
    mk('f', 'tiktok',    1, '14:15', 'publishing', 'Mid-flight — amber, cannot be dragged'),
    mk('g', 'tiktok',    2, '11:00', 'scheduled',  'TikTok, booked'),
    mk('i', 'instagram', 4, '08:00', 'scheduled',  'Early morning post'),
    mk('j', 'linkedin', -2, '10:00', 'published',  'Last week, already published'),
  ]
}

// The strip: approved posts that nothing is going to publish.
const PENDING = [
  { id: 't1', platform: 'instagram', publish_status: 'not_published', status: 'pending_publish',
    post_table: 'instagram_generated_posts',
    caption: 'Approved, but no time was ever chosen', scheduled_publish_at: null },
  { id: 't2', platform: 'tiktok', publish_status: 'failed', status: 'pending_publish',
    post_table: 'generated_posts', publish_error: 'Zernio rejected the media: video too short',
    caption: 'Failed to publish — needs a new time', scheduled_publish_at: null },
  { id: 't3', platform: 'linkedin', publish_status: 'not_published', status: 'pending_publish',
    post_table: 'generated_posts',
    caption: 'Planned for a date that has already gone by',
    scheduled_publish_at: brandWallToUtcISO(addDays(today, -3), '09:00') },
]

function Harness() {
  const [posts, setPosts]   = useState(fixtures)
  const [pending, setPending] = useState(PENDING)
  const [view, setView]     = useState('month')
  const [anchor, setAnchor] = useState(today)
  const [dragging, setDragging] = useState(null)
  const [openPost, setOpenPost] = useState(null)
  // Pretend the newest published post has not been looked at yet, so the
  // darker "just published" treatment is visible without waiting for a poll.
  const [unseen, setUnseen] = useState(['e'])
  const [log, setLog]       = useState([])

  const index   = useMemo(() => indexByDay(posts), [posts])
  const crowded = useMemo(() => findCrowding(posts), [posts])
  const byId    = useMemo(() => new Map([...posts, ...pending].map(p => [p.id, p])), [posts, pending])

  const year  = Number(anchor.slice(0, 4))
  const month = Number(anchor.slice(5, 7)) - 1

  // Local only — no Supabase, no Zernio. Booking here just rewrites the
  // fixture array so the geometry and the colours can be driven; the real
  // routing decisions are covered by tests.
  function bookLocally(id, dateKey, time) {
    const post = byId.get(id)
    if (!post) return
    const whenISO = brandWallToUtcISO(dateKey, time || '10:00')
    setPosts(prev => [...prev.filter(p => p.id !== id),
      { ...post, scheduled_publish_at: whenISO, publish_status: 'scheduled' }])
    setPending(prev => prev.filter(p => p.id !== id))
    setLog(l => [`${id} → ${formatBrandDateTime(whenISO)}`, ...l].slice(0, 8))
  }

  function cancelLocally(post) {
    setPosts(prev => prev.filter(p => p.id !== post.id))
    setPending(prev => [...prev, { ...post, publish_status: 'not_published', scheduled_publish_at: null }])
    setLog(l => [`${post.id} → off the schedule`, ...l].slice(0, 8))
  }

  function open(post) {
    setOpenPost(post)
    setUnseen(u => u.filter(id => id !== post.id))
  }

  return (
    <div className="p-6 space-y-4 bg-surface min-h-screen">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="font-semibold text-sm text-text">Schedule harness</h1>
        <span className="text-xs text-text-tertiary">
          All times {BRAND_TIMEZONE_LABEL} · browser is {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </span>
        <div className="flex ml-auto">
          {['month', 'week'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 border -ml-px first:ml-0 text-xs font-semibold capitalize
                ${view === v ? 'bg-amber-700 text-white border-amber-700' : 'bg-white text-text-secondary border-border'}`}>
              {v}
            </button>
          ))}
        </div>
        <button onClick={() => setAnchor(a => addDays(a, view === 'month' ? -30 : -7))}
          className="px-2 py-1.5 border border-border bg-white text-xs">←</button>
        <span className="text-xs font-semibold tabular-nums">{MONTH_LABELS[month]} {year}</span>
        <button onClick={() => setAnchor(a => addDays(a, view === 'month' ? 30 : 7))}
          className="px-2 py-1.5 border border-border bg-white text-xs">→</button>
        <button onClick={() => { setPosts(fixtures()); setPending(PENDING); setUnseen(['e']); setLog([]) }}
          className="px-3 py-1.5 border border-border bg-white text-xs font-semibold">Reset</button>
      </div>

      {/* Legend — the whole point of the colour change, stated once. */}
      <div className="flex items-center gap-4 flex-wrap text-[11px] text-text-secondary">
        {[['#2563eb', 'Scheduled'], ['#d97706', 'Publishing'], ['#16a34a', 'Published'], ['#dc2626', 'Not booked']]
          .map(([c, l]) => (
            <span key={l} className="flex items-center gap-1.5">
              <span className="w-3 h-3 border-l-2" style={{ borderLeftColor: c, background: `${c}14` }} />{l}
            </span>
          ))}
      </div>

      {pending.length > 0 && (
        <div className="border border-red-200 bg-white">
          <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-red-800 border-b border-border bg-red-50">
            Not scheduled yet — click one to give it a time
          </p>
          <div className="p-3 flex gap-2 overflow-x-auto">
            {pending.map(p => <TrayChip key={p.id} post={p} onOpen={open} />)}
          </div>
        </div>
      )}

      <div className="border border-border bg-white overflow-hidden">
        {view === 'month' ? (
          <MonthGrid year={year} month={month} index={index} crowded={crowded}
            pendingId="" selectedDay={null} draggingPost={dragging} unseen={unseen}
            onSelectDay={() => {}} onDropPost={bookLocally} onOpenPost={open}
            onDragStart={setDragging} onDragEnd={() => setDragging(null)} />
        ) : (
          <WeekGrid anchorDate={anchor} index={index} crowded={crowded}
            pendingId="" draggingPost={dragging} unseen={unseen}
            onSelectDay={() => {}} onDropPost={bookLocally} onOpenPost={open}
            onDragStart={setDragging} onDragEnd={() => setDragging(null)} />
        )}
      </div>

      {openPost && (
        <PostPanel post={byId.get(openPost.id) || openPost} busy={false}
          onClose={() => setOpenPost(null)}
          onBook={(post, date, time) => { bookLocally(post.id, date, time); setOpenPost(null) }}
          onCancel={post => { cancelLocally(post); setOpenPost(null) }}
          onEdit={post => setLog(l => [`${post.id} → edit (composer)`, ...l].slice(0, 8))} />
      )}

      <div className="text-[11px] text-text-secondary space-y-0.5">
        <p className="font-semibold text-text">Actions</p>
        {log.length === 0 ? <p className="text-text-tertiary">Click a chip to open it, or drag a booked one to another day/hour.</p>
          : log.map((l, i) => <p key={i} className="tabular-nums">{l}</p>)}
      </div>
    </div>
  )
}

// ─── The real page, against a stub data layer ──────────────────────────────
// The grids above are driven directly, which is what makes the geometry easy
// to look at. This mounts the actual /schedule page instead, so its wiring —
// the fetch hook, the period maths, the day panel, the empty state — is
// exercised too rather than only compiled.
//
// The contexts are stubbed rather than the real providers: AuthProvider would
// try to reach Supabase, and the point here is to render without a session.
// With no workspace id the hook never fetches, so this shows the page's real
// empty state, which is exactly the path a first-run user hits.
const APP_STUB = {
  state: { webhooks: {}, posts: [], instagramSchedule: {} },
  dispatch: () => {},
}
const AUTH_STUB = { activeWorkspaceId: null, accessToken: null, user: null, session: null }

function RealPage() {
  return (
    <MemoryRouter>
      <AuthContext.Provider value={AUTH_STUB}>
        <AppContext.Provider value={APP_STUB}>
          <div className="p-6 bg-surface min-h-screen">
            <Schedule />
          </div>
        </AppContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

export function ScheduleHarness() {
  const [mode, setMode] = useState('grids')
  return (
    <>
      <div className="px-6 pt-4 flex gap-0">
        {[{ k: 'grids', l: 'Grids (fixtures)' }, { k: 'page', l: 'Real /schedule page' }].map(t => (
          <button key={t.k} onClick={() => setMode(t.k)}
            className={`px-3 py-1.5 border -ml-px first:ml-0 text-xs font-semibold
              ${mode === t.k ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-text-secondary border-border'}`}>
            {t.l}
          </button>
        ))}
      </div>
      {mode === 'grids' ? <Harness /> : <RealPage />}
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<ScheduleHarness />)
