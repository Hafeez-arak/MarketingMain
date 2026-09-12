// ─── Where this brand stands, on one screen ────────────────────────────────
// Pure. The model behind the summary at the top of "What We Learned".
//
// ── WHY THE PAGE NEEDED THIS ──
//
// The page is called What We Learned and it did not show what the agent
// learned. It showed two things only: decisions people made on ideas, and
// analytics from posts that have gone out. For Arak that is 10 decisions and
// ONE post with numbers, so the page read as a set of empty tables — while the
// research runs, the rules those runs proposed, and the dated things the brand
// should act on all lived somewhere else entirely.
//
// RESEARCH-AGENT.md §14 said this would happen: "this agent will be the
// primary source of learning for these brands, not a supplement to it", because
// there is almost no posting history to learn from. The page was built on the
// supplement and left out the primary source.
//
// ── WHAT A SUMMARY IS FOR ──
//
// Not a digest of everything. One screen that answers three questions in the
// order a person actually asks them:
//
//   1. What should I do now?      — the single most useful next action
//   2. What do we know?           — learning, market, our own work
//   3. What is holding it back?   — the fixable gaps
//
// The first is the whole point. A summary that lists nine true facts and no
// instruction is a report, and reports get skimmed.

import { partitionByClock, setupGaps, deadlineLabel } from './researchBrief'
import { num } from './agent/num'

/** A run older than this is no longer describing the present. */
export const STALE_AFTER_DAYS = 10

/**
 * "today" / "yesterday" / "6 days ago" — the age of a run, in words.
 *
 * `0d ago` is technically correct and reads like a placeholder nobody
 * finished, which undermines the number beside it.
 */
export function ageLabel(days) {
  if (days === null || days === undefined) return 'never'
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** Days since a run finished, or null when there has never been one. */
export function daysSinceRun(run, now = new Date()) {
  const at = run?.finished_at || run?.started_at
  if (!at) return null
  const t = new Date(at).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((now.getTime() - t) / 86_400_000)
}

/**
 * The one thing worth doing next, and why.
 *
 * Ordered by what it costs to ignore, not by what is easiest to show:
 *
 *   a dated opportunity closes          — gone forever, so it leads
 *   proposals sit unreviewed            — the agent's output does nothing
 *   research is stale or absent         — everything below it is guesswork
 *   setup gaps                          — cost accuracy, not opportunity
 *
 * Returns null when there is genuinely nothing, which is a real state and must
 * be sayable. A page that always manufactures an urgent action trains people
 * to ignore the urgent ones.
 */
export function nextStep({ run, proposedRules = 0, gaps = [], now = new Date() } = {}) {
  if (!run) {
    return {
      kind: 'no_research',
      text: 'No research has run for this brand yet. Everything below is based on our own posts only.',
      action: 'Run research', to: '/insights/research',
    }
  }

  const { act } = partitionByClock(run?.report?.findings || [], now)
  if (act.length) {
    const first = act[0]
    return {
      kind: 'deadline',
      text: `${first.headline} (${deadlineLabel(first, now)})`,
      detail: first.suggested_action || '',
      action: 'See the brief', to: '/insights/research',
    }
  }

  if (proposedRules > 0) {
    return {
      kind: 'review',
      text: `${proposedRules} proposed rule${proposedRules === 1 ? '' : 's'} waiting on you. ` +
        'Until one is approved it steers nothing.',
      action: 'Review them', to: '/insights/research',
    }
  }

  const age = daysSinceRun(run, now)
  if (age !== null && age >= STALE_AFTER_DAYS) {
    return {
      kind: 'stale',
      text: `The last research run was ${age} days ago. The market has had ${age} days to move.`,
      action: 'Run research', to: '/insights/research',
    }
  }

  if (gaps.length) {
    return {
      kind: 'setup',
      text: gaps[0].what,
      detail: gaps[0].fix,
      action: 'Fix it', to: gaps[0].to,
    }
  }

  return null
}

/**
 * The whole summary.
 *
 * Every count carries what it rests on, because a number with no sample size
 * is the failure this app is organised against. `usable` is the flag that says
 * whether the performance half of the page can support a conclusion at all.
 */
export function summarise({
  run = null,
  memory = [],
  performance = null,
  decisions = null,
  hasOwnAccount = false,
  weakSample = 5,
  now = new Date(),
} = {}) {
  const active = memory.filter(m => m.status === 'active')
  const proposed = memory.filter(m => m.status === 'proposed')
  const report = run?.report || {}
  const { act, standing } = partitionByClock(report.findings || [], now)
  const gaps = run ? setupGaps(report, { hasOwnAccount }) : []

  // `postsWithMetrics` is what summarisePerformance actually calls it.
  const postsMeasured = num(performance?.postsWithMetrics) ?? 0

  return {
    next: nextStep({ run, proposedRules: proposed.length, gaps, now }),

    learned: {
      active: active.length,
      proposed: proposed.length,
      // Where the rules came from matters: a rule from research was argued
      // from sources, one from analytics from our own numbers, and a reader
      // deciding whether to trust the set should be able to see the mix.
      fromResearch: active.filter(m => m.source === 'research').length,
      fromAnalytics: active.filter(m => m.source === 'analytics').length,
      byHand: active.filter(m => m.source === 'human').length,
    },

    market: {
      hasRun: Boolean(run),
      headline: report.headline || '',
      ranAt: run?.finished_at || run?.started_at || null,
      ageDays: daysSinceRun(run, now),
      stale: (daysSinceRun(run, now) ?? 0) >= STALE_AFTER_DAYS,
      actNow: act.length,
      standing: standing.length,
      // Named separately from `actNow` so "checked and quiet" never reads as
      // "never ran" — the same distinction the brief page is built around.
      lensesRan: (report.lenses || []).filter(l => l.ran !== false).length,
      lensesFailed: (report.lenses || []).filter(l => l.ran === false).length,
    },

    ourWork: {
      decided: num(decisions?.decided) ?? 0,
      approvalRate: decisions?.approvalRate ?? null,
      postsMeasured,
      // The honest gate. Below this the tables on this page are describing
      // noise, and saying so is worth more than showing them.
      usable: postsMeasured >= weakSample,
    },

    blocking: gaps,
  }
}

/**
 * One sentence describing the state of learning itself.
 *
 * Deliberately allowed to say that almost nothing has been learned yet — which
 * is the true answer for every workspace here today, and a page that dressed it
 * up would be the first thing to lose someone's trust.
 */
export function learningLine(s = {}) {
  const { active = 0, proposed = 0 } = s.learned || {}
  if (!active && !proposed) {
    return 'Nothing is steering generation yet beyond the Brand Brain itself.'
  }
  const parts = [`${active} rule${active === 1 ? '' : 's'} steering generation`]
  if (proposed) parts.push(`${proposed} waiting on review`)
  return `${parts.join(' · ')}.`
}
