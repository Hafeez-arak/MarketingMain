// ─── Reading a brief ───────────────────────────────────────────────────────
// Pure. Turns `research_runs.report` into the handful of decisions the page
// has to make, so those decisions are testable without a browser and identical
// wherever a brief is rendered.
//
// ── WHY THIS FILE EXISTS AT ALL ──
//
// The run has produced a full report since 2026-08-20 and nobody has ever read
// one. `/agent` renders a single line per run — the headline — and everything
// else (the movements, the gaps, the dated actions, the proposed ideas) has
// been sitting in a jsonb column that no screen opens. AGENT.md §5b build step
// 4 is the page; it was never built, and every improvement to the run has been
// invisible since.
//
// ── THE ONE ORDERING RULE ──
//
// A brief is not a report to read top to bottom. It is a queue of things to
// do, and the only ordering that matters is HOW LONG YOU HAVE. "Saudi National
// Day is 11 days out and the window opened ten days ago" outranks anything
// true-but-undated, however interesting. `rankFindings` in lenses.js already
// sorts that way; this file splits the same list into the two sections a
// reader actually wants — what has a clock on it, and everything else.

import { rankFindings, daysLeft, lensByKey } from './agent/lenses'
import { num } from './agent/num'

/** A run that is still going. Anything else is terminal. */
export const isRunning = run => run?.status === 'running'

/**
 * Split findings into the ones with a live deadline and the rest.
 *
 * `perishable_until` being null means EVERGREEN, not expired — a finding about
 * how the category is shifting has no date and is not overdue. Conflating the
 * two would push every undated finding to the top of an "act now" list, which
 * is the fastest way to teach someone to ignore it.
 *
 * Expired findings are kept, in `passed`, rather than hidden: a deadline that
 * went by unactioned is worth seeing once, because it explains a miss.
 */
export function partitionByClock(findings = [], now = new Date()) {
  const ranked = rankFindings(findings, now)
  const act = []
  const standing = []
  const passed = []

  for (const f of ranked) {
    const d = daysLeft(f, now)
    if (d === null) standing.push(f)
    else if (d >= 0) act.push(f)
    else passed.push(f)
  }
  return { act, standing, passed }
}

/** "in 11 days" / "today" / "8 days ago". Null when the finding never expires. */
export function deadlineLabel(finding, now = new Date()) {
  const d = daysLeft(finding, now)
  if (d === null) return null
  if (d === 0) return 'today'
  if (d > 0) return `in ${d} day${d === 1 ? '' : 's'}`
  const n = Math.abs(d)
  return `${n} day${n === 1 ? '' : 's'} ago`
}

/**
 * How urgent a dated finding is, for colour.
 *
 * Deliberately coarse. Three buckets a person can hold in their head beat a
 * gradient nobody can read, and the thresholds are about a working week: if
 * there is less than one left, the decision is now.
 */
export function urgencyOf(finding, now = new Date()) {
  const d = daysLeft(finding, now)
  if (d === null) return 'none'
  if (d < 0) return 'passed'
  if (d <= 7) return 'now'
  if (d <= 21) return 'soon'
  return 'later'
}

/**
 * What each lens did, in words a reader can act on.
 *
 * The distinction this exists to preserve: a lens that looked and found
 * nothing, and a lens that never ran, are completely different facts and look
 * identical in a report that only lists findings. `lensSummary` on the server
 * already separates them; this turns that into something renderable, and adds
 * the two cases the server cannot know about — a run that has not reached this
 * lens yet, and a lens the run never planned.
 */
export function lensStates(report = {}) {
  const rows = report.lenses || []
  return rows.map(r => {
    const meta = lensByKey(r.lens)
    return {
      key: r.lens,
      label: r.label || meta?.label || r.lens,
      question: meta?.question || '',
      state: r.state || (r.ran === false ? 'failed' : r.count ? 'found' : 'quiet'),
      count: r.count || 0,
      error: r.error || '',
    }
  })
}

/** One line summarising the lens strip, for a reader who will not read the strip. */
export function lensHeadline(states = []) {
  if (!states.length) return ''
  const found = states.filter(s => s.state === 'found').length
  const failed = states.filter(s => s.state === 'failed').length
  const quiet = states.filter(s => s.state === 'quiet').length
  const parts = []
  if (found) parts.push(`${found} found something`)
  if (quiet) parts.push(`${quiet} looked and found nothing`)
  // Named last and never merged into "quiet" — this is the number that tells
  // you whether to believe the rest of the brief.
  if (failed) parts.push(`${failed} could not answer`)
  return parts.join(' · ')
}

/**
 * Is this brief worth reading, and if not, why not?
 *
 * A brief with no findings is a legitimate outcome and the run is designed to
 * say so. But "nothing happened" and "three lenses broke" produce the same
 * empty page unless someone distinguishes them, so this returns the reason
 * rather than a boolean.
 */
export function emptiness(report = {}) {
  const states = lensStates(report)
  const failed = states.filter(s => s.state === 'failed')
  const hasContent =
    (report.movements || []).length ||
    (report.market || []).length ||
    (report.gaps || []).length ||
    (report.findings || []).length ||
    (report.proposed_ideas || []).length ||
    // Our own measured week is content in its own right. Without this, a brand
    // with real TikTok numbers and no market news would be told the run
    // produced nothing, on a page that is displaying its numbers.
    (report.own_performance?.measured_count || 0)

  if (hasContent) return { empty: false, reason: '' }
  if (failed.length) {
    return {
      empty: true,
      reason: `Nothing to show, but ${failed.length} lens${failed.length === 1 ? '' : 'es'} ` +
        `could not answer (${failed.map(f => f.label).join(', ')}). This is not a quiet week — ` +
        'it is a run that did not finish looking.',
    }
  }
  return {
    empty: true,
    reason: report.quiet_week
      ? 'A genuinely quiet week. Every lens looked and found nothing worth reporting, which is a ' +
        'normal and expected outcome — the weeks something moved only mean anything if these are reported honestly.'
      : 'This run produced no findings.',
  }
}

/**
 * The Brand Brain gaps that are currently costing the run quality.
 *
 * Derived from the report rather than from the profile, because the run
 * already discovers these and writes them into `unanswered` — but buried among
 * a dozen other lines where nobody acts on them. Surfacing them as a short,
 * fixable list is the difference between a note and a task.
 *
 * Every entry names what to do and where, because "set your geography" without
 * a destination is a complaint rather than an instruction.
 */
export function setupGaps(report = {}, { hasOwnAccount = true } = {}) {
  const gaps = []
  const unanswered = (report.unanswered || []).join(' ')

  if (/no geography field is set|Set `geography`|could be determined/i.test(unanswered)) {
    gaps.push({
      key: 'geography',
      what: 'No market is set, so the calendar guessed it from your description.',
      fix: 'Set `geography` in Brand Brain → custom fields.',
      to: '/brand-brain',
    })
  }
  if (report.sales_motion && report.sales_motion.explicit === false) {
    gaps.push({
      key: 'sales_motion',
      what: `How you sell was inferred as "${report.sales_motion.motion}", not set. It decides which questions lead.`,
      fix: 'Set `sales_motion` in Brand Brain → custom fields.',
      to: '/brand-brain',
    })
  }
  if (!hasOwnAccount) {
    gaps.push({
      key: 'own_account',
      what: 'No comparable account of ours is connected, so every competitor number is uncontextualised.',
      fix: 'Connect the real Instagram account.',
      to: '/integrations',
    })
  }

  // Per-platform gaps. These are the ones that silently cost the most: a
  // channel publishing without analytics looks identical, on every screen in
  // this app, to a channel nobody posts to.
  for (const p of report?.own_performance?.platforms || []) {
    if (p.state === 'unmeasured') {
      gaps.push({
        key: `analytics_${p.platform}`,
        what: `${p.posts} post${p.posts === 1 ? '' : 's'} went out on ${p.label} with no analytics synced, so that channel cannot be judged.`,
        fix: `Check the analytics sync for ${p.label}.`,
        to: '/integrations',
      })
    } else if (p.connected && p.needs_reconnection) {
      gaps.push({
        key: `reconnect_${p.platform}`,
        what: `The ${p.label} account is flagged as needing reconnection — publishing and measurement may both be failing.`,
        fix: `Reconnect ${p.label}.`,
        to: '/integrations',
      })
    }
  }
  return gaps
}

/**
 * Our own channels, ordered the way a person should read them.
 *
 * Measured first — those are the rows with an answer on them. Connected but
 * silent or unsynced next, because those are actionable. Unconnected last:
 * worth showing, since a dark channel is a marketing fact, but never at the
 * top of a page whose job is to report the week that happened.
 */
export function ownChannelRows(report = {}) {
  const rank = { measured: 0, unmeasured: 1, silent: 2, not_connected: 3 }
  return [...(report?.own_performance?.platforms || [])]
    .sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9)
      || (b.avg_engagement ?? -1) - (a.avg_engagement ?? -1))
}

/** Percentage, rounded, for confidence and share values that arrive 0–1. */
export function pct(n) {
  const v = num(n)
  return v === null ? '—' : `${Math.round(v * 100)}%`
}

/** A number a person can read at a glance. 41200 -> "41.2k". */
export function compact(n) {
  const v = num(n)
  if (v === null) return '—'
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}m`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return String(Math.round(v))
}

/** A signed delta, where the sign is the point. */
export function signed(n) {
  const v = num(n)
  if (v === null || v === 0) return '±0'
  return v > 0 ? `+${compact(v)}` : `−${compact(Math.abs(v))}`
}
