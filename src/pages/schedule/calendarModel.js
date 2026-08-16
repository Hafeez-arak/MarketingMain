// ─── Calendar model ────────────────────────────────────────────────────────
// Pure functions behind the schedule views. Kept out of the components because
// every one of them is a place a timezone bug can hide, and they are far easier
// to reason about — and to check — as plain data in, plain data out.
//
// The governing rule: a calendar cell is a BRAND-time day, and a lane is a
// BRAND-time hour. Nothing here ever calls getDate()/getHours() on a Date,
// because those read the browser's zone and would put a 1 AM Riyadh post on
// the previous day's cell for anyone west of KSA.

import { utcToBrandParts, brandDateKey, brandTodayKey } from '../../lib/brandTime'
import { moveKindFor } from '../../lib/scheduledPosts'

// ── Drag and drop ─────────────────────────────────────────────────────────
// A private MIME type, so a grid cell only accepts chips from this calendar
// and never a dragged file or a link from another tab.
export const DRAG_MIME = 'application/x-arak-post'

// Whether a chip can be picked up is a data question, not a view one — a
// published post has nowhere to move to and a publishing one is mid-flight at
// the platform. Both views ask this, so the answer cannot drift between them.
export const chipDraggable = post => moveKindFor(post).kind !== 'blocked'

export const DAY_LABELS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

export const PLATFORM_COLORS = {
  instagram: { dot: '#E1306C', light: '#fce4f0', label: 'Instagram' },
  facebook:  { dot: '#1877F2', light: '#e8f0fe', label: 'Facebook' },
  tiktok:    { dot: '#555555', light: '#f0f0f0', label: 'TikTok' },
  snapchat:  { dot: '#B8A400', light: '#fffbe6', label: 'Snapchat' },
  x:         { dot: '#333333', light: '#f5f5f5', label: 'X / Twitter' },
}
export const platformColor = p => PLATFORM_COLORS[p] || { dot: '#78716c', light: '#f5f5f4', label: p || 'Unknown' }

// Publish state, as the calendar shows it. Distinct from the review `status`
// column: a post can be approved (status) and still not_published (publish).
export const PUBLISH_STATE = {
  not_published: { label: 'Draft',      cls: 'bg-stone-100 text-stone-600' },
  scheduled:     { label: 'Scheduled',  cls: 'bg-blue-50 text-blue-700' },
  publishing:    { label: 'Publishing', cls: 'bg-amber-50 text-amber-700' },
  published:     { label: 'Published',  cls: 'bg-green-50 text-green-700' },
  failed:        { label: 'Failed',     cls: 'bg-red-50 text-red-700' },
}
export const publishState = s => PUBLISH_STATE[s] || PUBLISH_STATE.not_published

// ── Date keys, without Date arithmetic ────────────────────────────────────
// 'YYYY-MM-DD' +/- n days. Done through Date.UTC rather than a local Date so
// the result cannot drift across a DST boundary in the BROWSER's zone — which
// is irrelevant to the brand's calendar but would still shift a key by a day.
export function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

// Day of week for a date key, 0=Sun. Again via UTC — a key is a label, not an
// instant, so it must not be interpreted in anybody's local zone.
export function weekdayOf(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function startOfWeek(dateKey) {
  return addDays(dateKey, -weekdayOf(dateKey))
}

export function monthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`
}

// The 6-row grid a month view draws, as date keys with an `outside` flag for
// the leading/trailing days that belong to the neighbouring months.
export function monthGrid(year, monthIndex) {
  const first = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`
  const lead = weekdayOf(first)
  const cells = []
  // Always 42 cells: a month view that changes height as you page through the
  // year makes the whole page jump under the cursor.
  for (let i = 0; i < 42; i++) {
    const key = addDays(first, i - lead)
    cells.push({ key, outside: !key.startsWith(monthKey(year, monthIndex)) })
  }
  return cells
}

export function weekGrid(anchorDateKey) {
  const start = startOfWeek(anchorDateKey)
  return Array.from({ length: 7 }, (_, i) => ({ key: addDays(start, i), outside: false }))
}

// ── Indexing posts onto the grid ──────────────────────────────────────────
// One pass, keyed by brand date. Each entry carries the decoded brand-time
// parts so a view never has to re-derive them per render.
export function indexByDay(posts) {
  const map = new Map()
  for (const post of posts) {
    if (!post?.scheduled_publish_at) continue
    const parts = utcToBrandParts(post.scheduled_publish_at)
    if (!parts) continue
    const entry = { post, ...parts }
    const list = map.get(parts.dateKey)
    if (list) list.push(entry)
    else map.set(parts.dateKey, [entry])
  }
  // Within a day, order by time — a day cell that lists 9 AM under 6 PM is
  // just wrong, and the API's ordering is across the whole range, not per day.
  for (const list of map.values()) list.sort((a, b) => a.hourFloat - b.hourFloat)
  return map
}

export const dayEntries = (index, dateKey) => index.get(dateKey) || []

// ── Crowding ──────────────────────────────────────────────────────────────
// Two posts to the SAME platform close together is a real problem — the
// platforms suppress the second, and an audience reads it as spam. Two posts
// at the same moment on DIFFERENT platforms is normal and deliberate, so this
// deliberately does not flag it.
//
// Returns a Set of post ids involved in at least one too-close pair, which is
// what a view needs to decorate a chip.
export function findCrowding(posts, minGapMinutes = 60) {
  const byPlatform = new Map()
  for (const post of posts) {
    if (!post?.scheduled_publish_at) continue
    const ms = Date.parse(post.scheduled_publish_at)
    if (!Number.isFinite(ms)) continue
    const list = byPlatform.get(post.platform)
    if (list) list.push({ id: post.id, ms })
    else byPlatform.set(post.platform, [{ id: post.id, ms }])
  }
  const crowded = new Set()
  const gapMs = minGapMinutes * 60 * 1000
  for (const list of byPlatform.values()) {
    list.sort((a, b) => a.ms - b.ms)
    for (let i = 1; i < list.length; i++) {
      if (list[i].ms - list[i - 1].ms < gapMs) {
        crowded.add(list[i].id)
        crowded.add(list[i - 1].id)
      }
    }
  }
  return crowded
}

// ── Time lanes for the week view ──────────────────────────────────────────
// Only the hours worth showing. A full 24-row grid is mostly empty for a brand
// that posts between breakfast and late evening, and the empty rows push the
// real ones off-screen. Widened to include anything actually scheduled, so a
// 2 AM post is never invisible.
export const DEFAULT_LANE_START = 6
export const DEFAULT_LANE_END   = 23

export function laneRange(entries) {
  let lo = DEFAULT_LANE_START
  let hi = DEFAULT_LANE_END
  for (const e of entries) {
    if (e.hour < lo) lo = e.hour
    if (e.hour + 1 > hi) hi = e.hour + 1
  }
  return { start: Math.max(0, lo), end: Math.min(24, Math.max(hi, lo + 1)) }
}

// Side-by-side placement for posts that would otherwise sit on top of each
// other.
//
// In the week view a chip is positioned purely by its time, so two posts at
// 7 PM render at the same offset and the second one hides the first entirely.
// That is not an edge case: posting to two accounts at the same
// moment is normal and deliberate — findCrowding above goes out of its way NOT
// to flag it — so the layout has to show both.
//
// Chips are ~22px against a 46px hour, so anything within half an hour of
// another overlaps visually. Clustering is chained: A overlapping B and B
// overlapping C puts all three in one cluster, which is what keeps a run of
// closely-spaced posts to a consistent width instead of having them
// half-cover each other.
export function layoutDayColumn(entries, slotHours = 0.5) {
  const out = []
  let cluster = []
  let clusterEnd = -Infinity

  const flush = () => {
    const n = cluster.length
    cluster.forEach((e, i) => out.push({ ...e, lane: i, lanes: n }))
    cluster = []
  }

  for (const e of entries) {
    if (cluster.length && e.hourFloat >= clusterEnd) flush()
    cluster.push(e)
    clusterEnd = Math.max(clusterEnd, e.hourFloat + slotHours)
  }
  flush()
  return out
}

export function laneLabel(hour) {
  const h = ((hour % 24) + 24) % 24
  return `${h % 12 || 12}${h >= 12 ? 'pm' : 'am'}`
}

// Where a post sits vertically within the lane band, as a 0..1 fraction.
export function lanePosition(hourFloat, start, end) {
  const span = end - start
  if (span <= 0) return 0
  return Math.min(1, Math.max(0, (hourFloat - start) / span))
}

// Drop target -> wall clock. A drop lands on a day column at some fraction of
// its height; snap to a sensible granularity so dragging produces round times
// like 14:30, never 14:37.
export function dropToTime(fraction, start, end, snapMinutes = 15) {
  const span = end - start
  const raw = start + Math.min(1, Math.max(0, fraction)) * span
  const totalMin = Math.round((raw * 60) / snapMinutes) * snapMinutes
  const clamped = Math.min(24 * 60 - snapMinutes, Math.max(0, totalMin))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ── Summary counters ──────────────────────────────────────────────────────
// Computed off the fetched rows rather than a separate count query: the range
// is already in memory and a second round-trip could disagree with it.
export function summarize(posts) {
  const out = { scheduled: 0, published: 0, publishing: 0, failed: 0, draft: 0 }
  for (const p of posts) {
    const s = p.publish_status || 'not_published'
    if (s === 'scheduled') out.scheduled++
    else if (s === 'published') out.published++
    else if (s === 'publishing') out.publishing++
    else if (s === 'failed') out.failed++
    else out.draft++
  }
  return out
}

// Is this slot in the past, in brand time? Scheduling backwards is always a
// mistake, and the platforms reject it — better to refuse at the drop.
export function isPastSlot(dateKey, time) {
  const today = brandTodayKey()
  if (dateKey < today) return true
  if (dateKey > today) return false
  const now = utcToBrandParts(Date.now())
  return time < now.time
}

export const isToday = dateKey => dateKey === brandTodayKey()
export const keyOf = value => brandDateKey(value)
