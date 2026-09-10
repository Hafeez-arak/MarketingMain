// ─── Plan model ────────────────────────────────────────────────────────────
// The pure functions behind the campaign planner: date maths, week grouping,
// month options, and the translation of an AI-proposed idea into the fields a
// post row actually stores.
//
// Lifted out of CampaignPlanner.jsx, which was a single 1,490-line component
// with nineteen hooks and twenty-one inner functions. None of this was
// reachable from a test while it lived in there, and all of it is exactly the
// kind of code that repays one — date arithmetic and a format translation
// whose failure mode is a post that renders at the wrong aspect ratio rather
// than an error anyone would notice.
//
// Same reasoning, and the same shape, as ../schedule/calendarModel.js.
//
// One thing these deliberately do NOT do: read the brand's timezone. A plan is
// authored in wall-clock terms — "the 14th, 7 PM" — and stays that way until
// something schedules it. brandTime.js is where the conversion belongs, and
// duplicating it here would give two answers to the same question.

import {
  formatsFor, defaultFormat, aspectRatiosFor, defaultAspectRatio,
  slideRange, derivePostKind,
} from '../../lib/postFormats'

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
export const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

// Parsed as a LOCAL date, deliberately. `new Date('2026-03-01')` is parsed as
// UTC midnight, which for anyone west of Greenwich lands on February 28th —
// so a plan starting on the 1st would render a calendar that begins the day
// before it does.
export function parseYMD(s) {
  const [y, m, d] = String(s || '').split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

// Monday-based, because a content week reads Monday-to-Sunday to the people
// planning it. Note the calendar GRID below is Sunday-based instead: that one
// mirrors the month grid people are used to seeing, and the two are answering
// different questions rather than disagreeing.
export function startOfWeek(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

export const formatDayShort = d => `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`

// '19:30' -> '7:30 PM'. Returns '' rather than 'NaN:NaN PM' for anything
// unparseable — this renders directly onto an idea card, and a half-typed time
// in an input should read as blank, not as broken.
export function formatTime(hhmm) {
  const parts = String(hhmm || '').split(':')
  const [h, m] = parts.map(Number)
  // `Number.isNaN(undefined)` is FALSE — it is true only for an actual NaN —
  // so guarding on it alone let a missing minute straight through: '' splits
  // to [''], Number('') is 0, and the minute is undefined, which rendered as
  // the literal '12:undefined AM'. Check the shape first, then the numbers.
  if (parts.length < 2) return ''
  if (!Number.isFinite(h) || !Number.isFinite(m)) return ''
  if (h < 0 || h > 23 || m < 0 || m > 59) return ''
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// Ideas grouped into the weeks they fall in, oldest first, with anything
// undated collected at the end under "Unscheduled".
//
// Undated goes LAST rather than first on purpose: the plan is read as a
// sequence of weeks, and a pile of unplaced ideas at the top would push the
// actual month below the fold.
export function groupByWeek(ideas) {
  const groups = new Map()
  const undated = []

  for (const idea of ideas || []) {
    // parseYMD is checked BEFORE startOfWeek, not after. `new Date(null)` is
    // the epoch rather than an Invalid Date, so passing an unparsed date
    // through produced a perfectly valid week in January 1970 — sorted first,
    // labelled "Dec 29 – Jan 4", and impossible to read as an error.
    const parsed = idea?.date ? parseYMD(idea.date) : null
    if (!parsed) { undated.push(idea); continue }
    const start = startOfWeek(parsed)
    if (Number.isNaN(start.getTime())) { undated.push(idea); continue }
    const key = start.getTime()
    if (!groups.has(key)) groups.set(key, { start, ideas: [] })
    groups.get(key).ideas.push(idea)
  }

  const ordered = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, g]) => {
      const end = new Date(g.start)
      end.setDate(end.getDate() + 6)
      // "Mar 2 – 8" inside one month, "Mar 30 – Apr 5" across two. Repeating
      // the month when it has not changed is noise on every row.
      const label = `${formatDayShort(g.start)} – ${
        g.start.getMonth() === end.getMonth() ? end.getDate() : formatDayShort(end)}`
      return { key: String(key), label, ideas: g.ideas }
    })

  if (undated.length) ordered.push({ key: 'undated', label: 'Unscheduled', ideas: undated })
  return ordered
}

// The next six months as selectable options, each carrying its own date range
// so the caller never has to work out how long a month is.
//
// `now` is a parameter rather than a call to Date.now() inside, which is what
// makes this testable at all — and it costs nothing, since the one caller has
// no opinion about it.
export function monthOptions(now = new Date()) {
  const out = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const y = d.getFullYear()
    const m = d.getMonth()
    const mm = String(m + 1).padStart(2, '0')
    // Day 0 of the NEXT month is the last day of this one, which is the whole
    // trick — no month-length table, and February is right in leap years.
    const lastDay = new Date(y, m + 1, 0).getDate()
    out.push({
      value: `${y}-${mm}`,
      label: `${MONTH_NAMES[m]} ${y}`,
      start: `${y}-${mm}-01`,
      end: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
    })
  }
  return out
}

// The month-grid cells covering a plan's range, padded out to whole weeks so
// the grid is rectangular. Sunday-based, matching the month calendars people
// are used to reading.
//
// `inRange` marks the days the plan actually covers; the padding days are
// still returned so the caller can render them greyed rather than having to
// compute the offsets itself.
export function buildCalendarCells(startDate, endDate) {
  const start = parseYMD(startDate)
  const end = parseYMD(endDate)
  if (!start || !end || end < start) return []

  const cur = new Date(start)
  cur.setDate(cur.getDate() - cur.getDay())
  const gridEnd = new Date(end)
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()))

  const cells = []
  while (cur <= gridEnd) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    cells.push({ key, date: new Date(cur), inRange: key >= startDate && key <= endDate })
    cur.setDate(cur.getDate() + 1)
  }
  return cells
}

// ─── AI idea -> storable post fields ───────────────────────────────────────
// The AI planner produces only the legacy `format` / `suggestedAspectRatio`
// pair (see requestCampaignPlan's normalizer in campaignPlanner.js). Every
// screen downstream reads postFormat / aspectRatio / mediaType / postKind, so
// the translation happens once, here, before anything is saved — the same way
// a hand-entered seed post is normalised.
//
// The two guards matter more than they look. A format the platform does not
// support falls back to that platform's default rather than being stored as
// asked: 'reel' is meaningful on Instagram and meaningless on LinkedIn, and a
// post row claiming to be a LinkedIn reel fails at publish, long after anyone
// remembers approving it. Same for an aspect ratio outside the valid set.
export function normalizeAiIdea(p) {
  const platform = p.platform
  const legacyFormat = p.format || 'post'
  const postFormat =
      legacyFormat === 'carousel' ? 'carousel'
    : (legacyFormat === 'reel' && platform === 'instagram') ? 'reel'
    : defaultFormat(platform)

  const mediaType = formatsFor(platform).find(f => f.id === postFormat)?.media || 'image'
  const validRatios = aspectRatiosFor(platform, postFormat)
  const aspectRatio = validRatios.includes(p.suggestedAspectRatio)
    ? p.suggestedAspectRatio
    : defaultAspectRatio(platform, postFormat)
  const slideCount = postFormat === 'carousel'
    ? (slideRange(platform, postFormat)?.default || 3)
    : 1

  return {
    ...p,
    postFormat, aspectRatio, mediaType, slideCount,
    wantsCaption: true,
    postKind: derivePostKind({ platform, format: postFormat, wantsCaption: true, slideCount }),
  }
}
