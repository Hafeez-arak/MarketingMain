import { CLOSED_STATUSES, cleanDate } from '../agent/intel'
import { daysUntil } from '../agent/calendar'

// ─── Sales → Targets: what the page shows, in pure functions ───────────────
// Kept out of the component so the rules can be tested without a browser:
// which events are still ahead, which targets are still open, and the numbers
// across the top.

/** Days from today to a date-only value, or null. */
export function daysTo(date, now = new Date()) {
  const d = cleanDate(date)
  return d ? daysUntil(d, now) : null
}

/**
 * Events sales can still act on, soonest first.
 *
 * An event with no date stays on the list (to be confirmed) rather than
 * dropping off: "we do not know when" is a reason to find out, not a reason to
 * forget it. Concluded editions and ones skipped by a person are left out.
 */
export function eventsAhead(events = [], now = new Date(), horizonDays = 365) {
  return (events || [])
    .filter(e => e.status !== 'concluded' && e.decision !== 'skipping')
    .map(e => {
      const starts = daysTo(e.start_date, now)
      const ends = daysTo(e.end_date, now)
      return { ...e, days: starts, deadlineDays: daysTo(e.exhibitor_deadline, now), over: (ends ?? starts) !== null && (ends ?? starts) < 0 }
    })
    .filter(e => !e.over && (e.days === null || e.days <= horizonDays))
    .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999))
}

export const isOpenTarget = r => !CLOSED_STATUSES.includes(r?.status)

/** "in 12 days", "today", "date to confirm". */
export function whenLabel(days) {
  if (days === null || days === undefined) return 'date to confirm'
  if (days === 0) return 'today'
  if (days < 0) return `${-days} days ago`
  if (days < 60) return `in ${days} day${days === 1 ? '' : 's'}`
  return `in ${Math.round(days / 30)} months`
}

/** The numbers across the top of the page. */
export function targetStats({ accounts = [], ranked = { core: [], broader: [], other: [] }, events = [], now = new Date() } = {}) {
  const open = a => !['won', 'parked'].includes(a.status)
  return {
    accounts: accounts.filter(open).length,
    accountsUntouched: accounts.filter(a => a.status === 'new').length,
    core: ranked.core.length,
    broader: ranked.broader.length,
    strong: [...ranked.core, ...ranked.broader, ...ranked.other].filter(r => r.fit?.band === 'strong').length,
    events90: eventsAhead(events, now, 90).length,
  }
}
