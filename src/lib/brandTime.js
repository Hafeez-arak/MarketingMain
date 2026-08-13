// ─── Brand time ───────────────────────────────────────────────────────────
// Every scheduled post in this app is scheduled in ONE timezone: the brand's.
// Arak publishes to a Saudi audience, every time label in the UI already says
// "KSA", and "10 AM" in a content plan has never meant "10 AM wherever the
// person clicking happens to be sitting".
//
// Before this file there was no timezone anywhere in the codebase, and the
// gap showed up as two separate bugs:
//
//   1. Approvals sent `Intl.DateTimeFormat().resolvedOptions().timeZone` — the
//      BROWSER's zone. Schedule from a laptop on London time and the post went
//      out at 10 AM London, 12 PM Riyadh.
//
//   2. The publish workflow wrote the raw <input type="datetime-local"> string
//      ('2026-08-20T19:00', no offset) into `scheduled_publish_at`, which is
//      `timestamptz`. Postgres resolves a naive literal in the SESSION zone,
//      which is UTC on Supabase — so 7 PM Riyadh was stored as 7 PM UTC, three
//      hours late. Zernio published at the right moment (it gets the wall time
//      and the zone as two separate fields) while our own database, and so any
//      calendar reading it, believed something different. A split brain that
//      no single-timezone test could ever surface.
//
// So: wall-clock times ('2026-08-20', '19:00') are what the UI and Zernio deal
// in, absolute UTC instants are what the database stores, and the conversion
// between them happens ONLY here.

export const BRAND_TIMEZONE = 'Asia/Riyadh'
export const BRAND_TIMEZONE_LABEL = 'KSA'

// How far ahead of UTC `tz` is at a given instant, in ms.
//
// Formats the instant into the zone, then reads those wall-clock digits back
// as if they were UTC. The difference between that and the real instant IS the
// offset — this is the standard trick for doing zone math with nothing but
// Intl, and it stays correct across DST because it asks about one instant
// rather than assuming a fixed shift.
function offsetMsAt(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(utcMs)
  const p = {}
  for (const { type, value } of parts) p[type] = value
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  // formatToParts has second resolution, so compare against a floored instant
  // or every offset comes out wrong by the sub-second remainder.
  return asIfUtc - Math.floor(utcMs / 1000) * 1000
}

// '2026-08-20' + '19:00' (brand wall clock) → the Date for that real instant.
//
// Returns null rather than an Invalid Date for unparseable input: callers are
// deciding whether to write a column, and `null` is a value the column accepts
// while `Invalid Date` serialises to null only by accident.
export function brandWallToUtc(dateKey, time = '00:00') {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || '').trim())
  if (!dm) return null
  const tm = /^(\d{1,2}):(\d{2})/.exec(String(time || '00:00').trim())
  if (!tm) return null
  const [, y, mo, d] = dm
  const h = +tm[1], mi = +tm[2]
  if (h > 23 || mi > 59) return null

  // Treat the wall clock as if it were UTC, then walk back by the zone's
  // offset. Two passes because the offset we need is the one in effect at the
  // RESULT instant, not at the guess — they differ only across a DST boundary.
  // Riyadh has had no DST since 1990, but this is the one place a timezone is
  // interpreted, so it should stay correct if BRAND_TIMEZONE ever moves.
  const guess = Date.UTC(+y, +mo - 1, +d, h, mi, 0)
  let utcMs = guess - offsetMsAt(guess, BRAND_TIMEZONE)
  const refined = guess - offsetMsAt(utcMs, BRAND_TIMEZONE)
  if (refined !== utcMs) utcMs = refined
  return new Date(utcMs)
}

// Same, but straight to the string the database wants.
export function brandWallToUtcISO(dateKey, time = '00:00') {
  const d = brandWallToUtc(dateKey, time)
  return d ? d.toISOString() : null
}

// The inverse: an absolute instant → the brand wall clock, split into the
// pieces the calendar grid indexes by.
export function utcToBrandParts(value) {
  if (!value) return null
  const ms = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value
    : Date.parse(value)
  if (!Number.isFinite(ms)) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRAND_TIMEZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(ms)
  const p = {}
  for (const { type, value: v } of parts) p[type] = v
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour, minute: +p.minute,
    weekday: p.weekday,
    // Fractional hour — what a day-column lays out against.
    hourFloat: +p.hour + +p.minute / 60,
  }
}

// 'YYYY-MM-DD' for an instant, in brand time. This is the calendar's cell key,
// and it must not come from the browser's zone or a post at 1 AM Riyadh lands
// on the previous day's cell for anyone west of KSA.
export function brandDateKey(value) {
  return utcToBrandParts(value)?.dateKey || null
}

// Today, in brand time — not the browser's today.
export function brandTodayKey() {
  return brandDateKey(Date.now())
}

// '19:00' → '7:00 PM'. Display only.
export function formatBrandTime(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || '').trim())
  if (!m) return ''
  const h = +m[1]
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${m[2]} ${suffix}`
}

// An instant → 'Aug 20, 7:00 PM' in brand time, with the zone named. The zone
// suffix is not decoration: the whole class of bug this file exists to kill is
// someone reading a time and assuming it is theirs.
export function formatBrandDateTime(value, { withZone = true } = {}) {
  const parts = utcToBrandParts(value)
  if (!parts) return ''
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: BRAND_TIMEZONE,
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(value instanceof Date ? value : new Date(Date.parse(value)))
  return withZone ? `${label} ${BRAND_TIMEZONE_LABEL}` : label
}

// The naive wall-clock string Zernio wants ('2026-08-20T19:00:00'), sent
// alongside `timezone: BRAND_TIMEZONE`. Deliberately NOT an ISO instant —
// Zernio takes the two separately, and appending a 'Z' here would tell it the
// wall time is UTC.
export function brandWallString(dateKey, time = '00:00') {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || '00:00').trim())
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null
  return `${dateKey}T${String(+m[1]).padStart(2, '0')}:${m[2]}:00`
}

// Split a stored instant back into the pair a <input type="date"> and a
// <input type="time"> can hold, in brand time. The round trip
// utcToBrandInputs -> brandWallToUtcISO is exact.
export function utcToBrandInputs(value) {
  const p = utcToBrandParts(value)
  return p ? { date: p.dateKey, time: p.time } : { date: '', time: '' }
}

// First/last instant of a brand-time month, as UTC ISO — the range a calendar
// month query filters `scheduled_publish_at` on. Computed through the same
// conversion as everything else, so the boundary posts (late on the 1st, late
// on the last) land in exactly one month's fetch.
export function brandMonthRangeUTC(year, monthIndex) {
  const first = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  const last = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
  return {
    from: brandWallToUtcISO(first, '00:00'),
    to: brandWallToUtcISO(last, '23:59'),
  }
}

// Same for an arbitrary span of days, keyed by brand date — what the week view
// and any drag-range query need.
export function brandRangeUTC(fromDateKey, toDateKey) {
  return {
    from: brandWallToUtcISO(fromDateKey, '00:00'),
    to: brandWallToUtcISO(toDateKey, '23:59'),
  }
}
