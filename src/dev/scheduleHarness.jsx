import { useState, useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AppContext } from '../store/app'
import { AuthContext } from '../store/auth'
import { Schedule } from '../pages/schedule/index'
import { MonthGrid } from '../pages/schedule/MonthGrid'
import { WeekGrid } from '../pages/schedule/WeekGrid'
import { TrayChip } from '../pages/schedule/PostChip'
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
//  · one of every publish_status, so the drag guards are all visible
function fixtures() {
  const mk = (id, platform, dayOffset, time, publish_status, caption) => ({
    id, platform, publish_status, caption,
    post_table: 'instagram_generated_posts',
    scheduled_publish_at: brandWallToUtcISO(addDays(today, dayOffset), time),
    image_url: '', video_url: '',
  })
  return [
    mk('a', 'instagram', 0, '01:30', 'scheduled',  'Late-night reel — 1:30 AM KSA, the day-boundary case'),
    mk('b', 'instagram', 0, '19:00', 'scheduled',  'Evening villa facade shot'),
    mk('c', 'instagram', 0, '19:30', 'not_published', 'Crowding test — 30 min after the last one'),
    mk('d', 'linkedin',  0, '19:00', 'scheduled',  'Same instant, different platform — must NOT flag'),
    mk('e', 'linkedin',  1, '09:00', 'published',  'Already out — cannot be dragged'),
    mk('f', 'tiktok',    1, '14:15', 'publishing', 'Mid-flight — cannot be dragged'),
    mk('g', 'snapchat',  2, '11:00', 'failed',     'Failed publish — draggable, retryable'),
    mk('h', 'instagram', 3, '20:00', 'not_published', 'Plain draft'),
    mk('i', 'linkedin',  4, '08:00', 'scheduled',  'Early morning thought-leadership post'),
    mk('j', 'instagram', -2, '10:00', 'published', 'Last week, already published'),
  ]
}

const TRAY = [
  { id: 't1', platform: 'instagram', publish_status: 'not_published', post_table: 'instagram_generated_posts',
    caption: 'Unscheduled — drag me onto a day', scheduled_publish_at: null },
  { id: 't2', platform: 'linkedin', publish_status: 'failed', post_table: 'linkedin_generated_posts',
    caption: 'Failed, still movable', scheduled_publish_at: null },
]

function Harness() {
  const [posts, setPosts]   = useState(fixtures)
  const [tray, setTray]     = useState(TRAY)
  const [view, setView]     = useState('month')
  const [anchor, setAnchor] = useState(today)
  const [dragging, setDragging] = useState(null)
  const [log, setLog]       = useState([])

  const index   = useMemo(() => indexByDay(posts), [posts])
  const crowded = useMemo(() => findCrowding(posts), [posts])
  const byId    = useMemo(() => new Map([...posts, ...tray].map(p => [p.id, p])), [posts, tray])

  const year  = Number(anchor.slice(0, 4))
  const month = Number(anchor.slice(5, 7)) - 1

  function onDropPost(id, dateKey, time) {
    const post = byId.get(id)
    if (!post) return
    const resolved = time || '10:00'
    const whenISO = brandWallToUtcISO(dateKey, resolved)
    setPosts(prev => [...prev.filter(p => p.id !== id), { ...post, scheduled_publish_at: whenISO }])
    setTray(prev => prev.filter(p => p.id !== id))
    setLog(l => [`${id} → ${formatBrandDateTime(whenISO)}`, ...l].slice(0, 8))
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
        <button onClick={() => { setPosts(fixtures()); setTray(TRAY); setLog([]) }}
          className="px-3 py-1.5 border border-border bg-white text-xs font-semibold">Reset</button>
      </div>

      {tray.length > 0 && (
        <div className="border border-border bg-white">
          <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-text-tertiary border-b border-border bg-surface-subtle">
            Unscheduled — drag onto the grid
          </p>
          <div className="p-3 flex gap-2">
            {tray.map(p => (
              <TrayChip key={p.id} post={p}
                onDragStart={setDragging} onDragEnd={() => setDragging(null)} />
            ))}
          </div>
        </div>
      )}

      <div className="border border-border bg-white overflow-hidden">
        {view === 'month' ? (
          <MonthGrid year={year} month={month} index={index} crowded={crowded}
            pendingId="" selectedDay={null} draggingPost={dragging}
            onSelectDay={() => {}} onDropPost={onDropPost} onOpenPost={() => {}} />
        ) : (
          <WeekGrid anchorDate={anchor} index={index} crowded={crowded}
            pendingId="" draggingPost={dragging}
            onSelectDay={() => {}} onDropPost={onDropPost} onOpenPost={() => {}} />
        )}
      </div>

      <div className="text-[11px] text-text-secondary space-y-0.5">
        <p className="font-semibold text-text">Moves</p>
        {log.length === 0 ? <p className="text-text-tertiary">Drag a chip to a different day (month) or hour (week).</p>
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
  state: { webhooks: {}, posts: [], instagramSchedule: {}, linkedinSchedule: {} },
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
