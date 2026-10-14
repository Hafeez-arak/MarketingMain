import { brandDateKey } from '../../lib/brandTime'

// ─── The Post Queue's order ────────────────────────────────────────────────
// Owner decision (2026-10-14): by date, soonest first, grouped by day, each
// post naming its plan. Posts that have gone out come after everything still
// to come, most recent first. It used to group by plan, so two posts going
// out tomorrow could sit at opposite ends of the page.
//
// `items` are the queue's cards: { bucket, post?, idea? }. A post's day is
// when it goes (or went) out; an unbooked one falls back to its planned date,
// and a card still being written to the date its idea was planned for.

export function itemInstant(item) {
  const p = item.post
  if (p) return Date.parse(p.scheduledPublishAt || p.publishedAt || '') || p.plannedAt || null
  const d = item.idea?.scheduled_date
  return d ? Date.parse(`${d}T12:00:00Z`) || null : null
}

export function itemDayKey(item) {
  const p = item.post
  if (p?.scheduledPublishAt || p?.publishedAt) return brandDateKey(p.scheduledPublishAt || p.publishedAt)
  if (p?.scheduledAt) return p.scheduledAt
  return item.idea?.scheduled_date || null
}

// → [{ key, dayKey, sent, items }], in display order.
export function groupByDay(items) {
  const toCome = new Map()
  const gone = new Map()
  for (const item of items) {
    const day = itemDayKey(item) || 'none'
    const map = item.bucket === 'published' ? gone : toCome
    if (!map.has(day)) map.set(day, [])
    map.get(day).push(item)
  }
  const at = x => itemInstant(x) ?? Infinity
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const days = (map, sent) => [...map.entries()]
    .sort(([a], [b]) => (a === 'none') - (b === 'none') || (sent ? b.localeCompare(a) : a.localeCompare(b)))
    .map(([day, list]) => ({
      key: `${sent ? 'sent' : 'next'}_${day}`, dayKey: day === 'none' ? null : day, sent,
      items: [...list].sort((a, b) => sent ? cmp(at(b), at(a)) : cmp(at(a), at(b))),
    }))
  return [...days(toCome, false), ...days(gone, true)]
}
