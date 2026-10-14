import { explainRunError, isPartialRun } from '../../lib/agent/runHealth'

// ─── The Research page, in words a marketer reads ──────────────────────────
// The selectors in lib/ speak the agent's language — lenses, allowances, raw
// provider errors, Brand Brain field keys in backticks — because that is what
// the tests and the printable brief are written against. This file is the
// page's translation layer: it reads the same values and says them plainly.
// It never decides anything the lib has not already decided; it only words it.

/** A run's error, as one sentence with no provider names or JSON in it. */
export function plainRunProblem(error, fallback = 'Something went wrong part-way through the research.') {
  const { key } = explainRunError(error)
  return {
    credit: 'The research service has run out of credit, so nothing new was searched.',
    cap: 'This month’s research budget has been used up, so the run stopped before searching.',
    busy: 'The research service was too busy to answer. Running it again usually works.',
  }[key] || fallback
}

/** True when a run finished but never really did the research — see isPartialRun. */
export const partRun = isPartialRun

/** How a run ended, as a short status for a badge. */
export function runStatus(run) {
  if (!run) return null
  if (run.status === 'running') return { label: 'Running', tone: 'bg-amber-50 text-amber-800 border-amber-200' }
  if (run.status === 'failed') return { label: 'Did not finish', tone: 'bg-red-50 text-red-700 border-red-200' }
  if (partRun(run)) return { label: 'Partly finished', tone: 'bg-amber-50 text-amber-800 border-amber-200' }
  return { label: 'Complete', tone: 'bg-sage-50 text-sage-700 border-sage-200' }
}

/**
 * The run-health warning (lib/agent/runHealth) in plain words. `runs` is the
 * same list the health was computed from, so the failed run's own error can
 * be worded instead of shown raw.
 */
export function plainHealth(health, runs = []) {
  if (!health) return null
  if (health.level === 'stuck') {
    return {
      tone: 'amber',
      headline: 'A research run has stopped responding.',
      detail: 'Nothing more is being spent on it. You can start a new run whenever you are ready.',
    }
  }
  if (health.level === 'failed') {
    const newest = [...runs].filter(Boolean)
      .sort((a, b) => Date.parse(b.finished_at || b.started_at || '') - Date.parse(a.finished_at || a.started_at || ''))[0]
    return {
      tone: 'red',
      headline: newest?.status === 'failed' ? 'The last research run did not finish.' : 'The last research run only partly worked.',
      detail: `${plainRunProblem(newest?.error)} Anything it did manage is still shown below.`,
    }
  }
  return {
    tone: 'amber',
    headline: health.headline,
    detail: 'The weekly automatic run may have stopped. You can run the research now instead.',
  }
}

/** A setup gap (lib/researchBrief setupGaps) with its fix in plain words. */
export function plainGap(g) {
  if (g.key === 'geography') {
    return { ...g, what: 'No market is set for this brand, so the research had to guess where to look.', fix: 'Set it in Brand Brain' }
  }
  if (g.key === 'sales_motion') {
    return { ...g, what: 'How this brand sells has not been set, so the research guessed it.', fix: 'Set it in Brand Brain' }
  }
  if (g.key === 'own_account') {
    return { ...g, what: 'Our own Instagram account is not connected, so competitor numbers have nothing to compare against.', fix: 'Connect it' }
  }
  if (String(g.key).startsWith('analytics_')) return { ...g, fix: 'Check the connection' }
  return g
}

/** What happened to each research topic, in a word or two. */
export const TOPIC_STATE = {
  found: { tone: 'text-sage-700 bg-sage-50 border-sage-200', label: 'Found something' },
  // Amber, not grey: reading forty pages and reporting none of them is worth
  // a second look, not a quiet week.
  searched: { tone: 'text-amber-800 bg-amber-50 border-amber-200', label: 'Read pages, reported nothing' },
  quiet: { tone: 'text-text-secondary bg-surface-subtle border-border', label: 'Nothing new' },
  failed: { tone: 'text-red-700 bg-red-50 border-red-200', label: 'Could not check' },
}

/** One line on how much reading the run did. Empty when the run did not record it. */
export function readingLine(states = []) {
  const counted = states.filter(s => s.sources != null)
  if (!counted.length) return ''
  const pages = counted.reduce((n, s) => n + (s.sources || 0), 0)
  return pages
    ? `It read ${pages} web page${pages === 1 ? '' : 's'} across ${states.length} topic${states.length === 1 ? '' : 's'}.`
    : ''
}

/** Why a report has nothing in it — a quiet week and a broken run are different things. */
export function emptyReason(report = {}, states = []) {
  const failed = states.filter(s => s.state === 'failed')
  if (failed.length) {
    return `Nothing to show — ${failed.length} topic${failed.length === 1 ? '' : 's'} could not be checked, ` +
      'so this is not a quiet week: the research did not finish looking.'
  }
  return report.quiet_week
    ? 'A quiet week. Every topic was checked and nothing worth reporting turned up.'
    : 'This research did not find anything to report.'
}

export const PRIORITY_LABEL = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' }
export const TEAM_LABEL = { marketing: 'Marketing', sales: 'Sales', technical: 'Technical' }
