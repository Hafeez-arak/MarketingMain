import { daysLeft } from './agent/lenses'
import { marketDirection, actionPlan, basisLabel } from './researchBrief'

// ─── One list of what to do, from every source the dashboard has ───────────
//
// The research report, the Search Console rules and the post queue each answer
// a different question, and a person arriving at the dashboard has only one:
// what should I do now. This merges the three into a single ranked list.
//
// ── WHY ONE LIST, AND HOW IT STAYS READABLE ──
//
// Mixing "a post failed to publish" with "the market is moving toward guest
// room management" in one ranked column is a real risk — they are not the same
// kind of claim and a flat list of both reads as noise. Two things hold it
// together:
//
//   every row carries its KIND     deadline, fix, direction, publish — shown
//                                  as a tag, so the eye can filter without
//                                  the list being split into sections
//   the order is by CLOCK, not by  anything with a date leads, soonest first,
//   importance                     because a missed deadline is the only
//                                  failure here that cannot be undone later
//
// So it is one list to read top-to-bottom, and four lists to anyone scanning
// for a particular kind.
//
// ── WHAT IS DELIBERATELY NOT HERE ──
//
// Anything that is only interesting. A row earns its place by being something
// a person would DO this week; "a new competitor appeared" is worth knowing
// and is not worth the top of the page, so it stays on the Research page.

const str = v => String(v ?? '').trim()

/**
 * The newest run that actually produced a report.
 *
 * Not simply runs[0]: a run that is still going, or that failed, carries no
 * report, and reading the dashboard off it would blank the card every time
 * somebody pressed the button on the Research page.
 */
export function latestReport(runs = []) {
  for (const run of runs) {
    const report = run?.report
    if (report && typeof report === 'object' && Object.keys(report).length) {
      return { report, runId: run.id, runAt: run.finished_at || run.started_at || '' }
    }
  }
  return null
}

/** How a deadline reads when it is the whole point of the row. */
export function dueLabel(days) {
  if (days === null || days === undefined) return ''
  if (days < 0) return 'closed'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days <= 14) return `in ${days} days`
  return `in ${Math.round(days / 7)} weeks`
}

/**
 * Findings with a live date on them, soonest first.
 *
 * `perishable_until` is the agent's own field for "this stops being true on a
 * date" — a tender closing, an exhibitor deadline, a standard coming into
 * force. An expired one is dropped rather than shown as overdue: the report
 * keeps expired findings so they can explain a miss, but the dashboard is for
 * what can still be acted on.
 */
export function deadlineRows(report = {}, now = new Date(), { withinDays = 30 } = {}) {
  return (report.findings || [])
    .map(f => ({ f, days: daysLeft(f, now) }))
    .filter(({ f, days }) => days !== null && days >= 0 && days <= withinDays && str(f.headline))
    .sort((a, b) => a.days - b.days)
    .map(({ f, days }) => ({
      id: `deadline:${f.ref || f.headline}`,
      kind: 'deadline',
      tag: dueLabel(days),
      urgent: days <= 14,
      title: f.headline,
      detail: str(f.suggested_action),
      meta: str(f.channel) || str(f.lens),
      to: '/insights',
      days,
    }))
}

/**
 * Where the market is moving, with the "so what" that makes it a row.
 *
 * A movement with no consequence stated is an observation, and observations
 * belong on the Research page. This keeps only the ones the agent bothered to
 * say something about — or, on an older report with no `market_direction` at
 * all, the per-rival reads that said the same thing at the bottom of a
 * competitor card nine sections down.
 */
export function directionRows(report = {}, { limit = 2 } = {}) {
  const { items, derived } = marketDirection(report)
  return items
    .filter(m => str(m.movement))
    .slice(0, limit)
    .map((m, i) => ({
      id: `direction:${i}:${str(m.movement).slice(0, 40)}`,
      kind: 'direction',
      tag: 'market',
      urgent: false,
      title: str(m.movement),
      detail: str(m.so_what),
      // `derived` travels as meta because a synthesis the agent wrote and a
      // list this code stitched together are different claims, and a reader
      // who cannot tell them apart will over-trust the second.
      meta: derived ? 'assembled from competitor reads' : basisLabel(m.basis),
      to: '/insights',
    }))
}

/**
 * Content gaps, each carrying the idea that fills it.
 *
 * This is the only part of the research with a real next action inside the
 * product rather than a link out — the ideas can be pushed into a plan. The
 * gap is the row and the idea is its detail, because a gap with no idea under
 * it is a complaint and an idea with no gap above it has no reason.
 */
export function publishRows(report = {}, { limit = 3 } = {}) {
  const plan = actionPlan(report)
  const rows = []

  for (const block of plan.blocks) {
    if (!str(block.gap?.gap)) continue
    const idea = block.ideas[0]
    rows.push({
      id: `gap:${block.gap.id}`,
      kind: 'publish',
      tag: 'content gap',
      urgent: false,
      title: str(block.gap.gap),
      detail: idea
        ? `Ready to make: ${str(idea.title || idea.angle)}`
        : str(block.gap.suggested_response),
      meta: block.ideas.length > 1 ? `${block.ideas.length} ideas ready` : idea ? '1 idea ready' : '',
      to: '/insights',
    })
  }

  // Ideas answering no gap still count — every idea in every report written
  // before `answers_ref` existed falls here, and dropping them would empty
  // this row type entirely on an older report.
  for (const idea of plan.loose) {
    if (!str(idea.title || idea.angle)) continue
    rows.push({
      id: `idea:${str(idea.title || idea.angle).slice(0, 40)}`,
      kind: 'publish',
      tag: 'idea',
      urgent: false,
      title: str(idea.title || idea.angle),
      detail: str(idea.title) ? str(idea.angle) : '',
      meta: '',
      to: '/insights',
    })
  }

  return rows.slice(0, limit)
}

/** Search Console items the rules called urgent. */
export function seoRows(recommendations = [], { limit = 2 } = {}) {
  return recommendations
    .filter(r => r.priority === 'high')
    .slice(0, limit)
    .map(r => ({
      id: `seo:${r.id}`,
      kind: 'fix',
      tag: 'website',
      urgent: false,
      title: r.title,
      detail: r.action,
      meta: typeof r.impressions === 'number' ? `${r.impressions} impressions` : '',
      to: '',
    }))
}

/**
 * Posts that will not go out on their own.
 *
 * One row for all of them rather than one row each: five failed posts is one
 * trip to the post queue, and five identical rows would push everything else
 * off the list.
 */
export function queueRow(attention = []) {
  const failed = attention.filter(p => p.publish_status === 'failed')
  if (!failed.length && !attention.length) return null
  const stuck = attention.length - failed.length
  const parts = []
  if (failed.length) parts.push(`${failed.length} failed to publish`)
  if (stuck) parts.push(`${stuck} made but never booked`)
  return {
    id: 'queue:attention',
    kind: 'fix',
    tag: 'posts',
    urgent: failed.length > 0,
    title: parts.join(' · '),
    detail: failed.length
      ? 'A failed post stays failed until someone retries it — nothing picks these up automatically.'
      : 'These have no slot, so they will not go out.',
    meta: '',
    to: '/social/approvals',
  }
}

const KIND_ORDER = ['deadline', 'fix', 'direction', 'publish']

/**
 * How many rows any one kind may take.
 *
 * ── WHY CAPS AND NOT A FLAT RANKING ──
 *
 * A flat ranking looks right until a real week arrives. Two live tenders, two
 * urgent Search Console items and a failed post is five rows before anything
 * about what to PUBLISH gets a look in — so the content gaps, which are the
 * whole reason marketing opens this page, fall off the bottom of a six-row
 * list every single time. The list would be correct and useless.
 *
 * Capping each kind means the list always answers all four questions: what
 * closes soon, what is broken, where the market is going, what to make. A
 * third tender is not more informative than the first two; it is the same
 * message again, and the Research page is where the full list lives.
 */
export const KIND_CAP = { deadline: 2, fix: 2, direction: 1, publish: 2 }

/**
 * The whole list, ranked.
 *
 * Clock first, and soonest-first inside it, because a missed deadline is the
 * only failure on this page that cannot be undone later. Everything else
 * follows in a fixed kind order so the list does not reshuffle itself between
 * two loads of the same data.
 */
export function priorityRows({
  report = null, recommendations = [], attention = [], now = new Date(), limit = 7,
} = {}) {
  const queue = queueRow(attention)
  const byKind = {
    deadline: report ? deadlineRows(report, now) : [],
    // The queue leads the fixes: a post that failed to publish is something
    // BROKEN, and a Search Console recommendation is an opportunity. Broken
    // first.
    fix: [...(queue ? [queue] : []), ...seoRows(recommendations)],
    direction: report ? directionRows(report) : [],
    publish: report ? publishRows(report) : [],
  }

  const rows = KIND_ORDER.flatMap(kind => byKind[kind].slice(0, KIND_CAP[kind]))

  // The cap can leave the list short of the limit when a kind has nothing in
  // it — a quiet week with no deadlines should not mean a four-row list when
  // there are more gaps worth showing. Backfill in the same kind order.
  if (rows.length < limit) {
    const shown = new Set(rows.map(r => r.id))
    for (const kind of KIND_ORDER) {
      for (const row of byKind[kind]) {
        if (rows.length >= limit) break
        if (!shown.has(row.id)) { rows.push(row); shown.add(row.id) }
      }
    }
    // Backfilled rows are appended, so sort back into kind order to keep the
    // reading order stable.
    rows.sort((a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (a.days ?? 999) - (b.days ?? 999))
  }

  return rows.slice(0, limit)
}
