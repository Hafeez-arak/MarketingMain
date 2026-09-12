// ─── Watching a run happen ─────────────────────────────────────────────────
// Pure. Turns a `research_runs` row plus its `research_lens_results` rows into
// something a person can watch, so the logic is testable without a browser and
// without a run in flight.
//
// ── WHY THIS IS NOT AN n8n PROBLEM ──
//
// The obvious assumption is that progress lives in n8n's execution log and is
// therefore awkward to reach. It does not. Every phase writes to Postgres as it
// goes — `research_runs.stage` moves gather → lenses → synthesise → complete,
// and each lens upserts a row into `research_lens_results` the moment it
// finishes, carrying its own duration, cost, findings count and error.
//
// So the run narrates itself in the database already. n8n is only the thing
// pressing the buttons; nothing has to be scraped from it.
//
// ── WHAT MAKES THIS HONEST ──
//
// A lens that has not produced a row is not necessarily working: it may not
// have started, and on a failed run it may never start at all. So `running` is
// only ever claimed for a run whose status actually says so, and everything
// else pending on a finished run is reported as `skipped` rather than left
// spinning. A progress bar that keeps spinning after the run died is the same
// spinner-that-never-closes failure the whole run design is built against.

import { lensesFor, lensByKey } from './lenses'
import { num, numOr } from './num'

/** The phases a run moves through, in the order a reader sees them. */
export const PHASE_LABELS = [
  { key: 'gather', label: 'Measuring', note: 'Competitor numbers, computed in code' },
  { key: 'lenses', label: 'Researching', note: 'Each question, answered on its own' },
  { key: 'synthesise', label: 'Writing the brief', note: 'One judgement over everything found' },
  { key: 'complete', label: 'Done', note: '' },
]

const TERMINAL = new Set(['complete', 'failed'])

/**
 * Which lenses this run intends to run.
 *
 * Prefers what the run WROTE DOWN when it planned itself. Older runs predate
 * that field, so they fall back to the default set for their cadence — and in
 * both cases any lens that actually produced a result is included, because a
 * result is proof it was planned whatever the report says.
 */
export function plannedLenses(report = {}, lensRows = [], { live = false } = {}) {
  const seen = (lensRows || []).map(r => r?.lens).filter(Boolean)
  const written = Array.isArray(report?.planned_lenses) ? report.planned_lenses : null
  if (written && written.length) return [...new Set([...written, ...seen])]

  // No written plan. What to assume depends on whether the run is still going.
  //
  // A LIVE run is expected to produce more rows, so the default set for its
  // cadence is the right guess — that is what lets the strip show "not yet"
  // for lenses still to come.
  //
  // A FINISHED run is a historical record and must not be measured against
  // today's lens set. `category` was added on 2026-09-12; showing it as "not
  // reached" on a run from the 10th says that run skipped something, when in
  // fact the lens did not exist. What a finished run did IS what it planned.
  if (!live) return [...new Set(seen)]

  const base = lensesFor({ cadence: report?.cadence === 'monthly' ? 'monthly' : 'weekly' }).map(l => l.key)
  return [...new Set([...base, ...seen])]
}

/**
 * One row per lens, in planned order, each with what actually happened to it.
 *
 * States:
 *   done     produced findings
 *   quiet    ran, looked, found nothing — a real answer
 *   failed   could not answer
 *   running  this run is live and nothing has come back for this lens yet
 *   skipped  the run ended without ever reaching it
 */
export function lensProgress(run = {}, lensRows = []) {
  const report = run?.report || {}
  const byLens = new Map((lensRows || []).filter(r => r?.lens).map(r => [r.lens, r]))
  const live = run?.status === 'running'

  return plannedLenses(report, lensRows, { live }).map(key => {
    const row = byLens.get(key)
    const meta = lensByKey(key)
    const base = {
      key,
      label: meta?.label || key,
      question: meta?.question || '',
      // A lens with no search budget costs nothing and cannot fail for a
      // reason worth reporting. Saying so stops "free" looking like "broken".
      computed: meta ? meta.budget?.searches === 0 : false,
    }

    if (!row) {
      return {
        ...base,
        state: live ? 'running' : 'skipped',
        findings: 0, durationMs: null, cost: 0, error: '',
      }
    }

    const findings = Array.isArray(row.findings) ? row.findings.length : numOr(row.findings, 0)
    const failed = row.status !== 'ok'
    return {
      ...base,
      state: failed ? 'failed' : findings > 0 ? 'done' : 'quiet',
      findings,
      durationMs: num(row.duration_ms),
      cost: numOr(row.cost_usd, 0),
      timedOut: Boolean(row.timed_out),
      error: row.error || '',
    }
  })
}

/**
 * Where the run is overall, as a phase index plus a count.
 *
 * `done` counts every lens that reported ANYTHING, including quiet and failed
 * ones — they are finished, and a progress count that only moves on success
 * would stall on a run that is proceeding perfectly well.
 */
export function runProgress(run = {}, lensRows = []) {
  const lenses = lensProgress(run, lensRows)
  const done = lenses.filter(l => ['done', 'quiet', 'failed'].includes(l.state)).length
  const stage = run?.status === 'complete' ? 'complete' : (run?.stage || 'gather')
  const phaseIndex = Math.max(0, PHASE_LABELS.findIndex(p => p.key === stage))

  return {
    lenses,
    done,
    total: lenses.length,
    stage,
    phaseIndex,
    live: run?.status === 'running',
    failed: run?.status === 'failed',
    cost: lenses.reduce((t, l) => t + (l.cost || 0), 0),
    // Percentage across the whole run rather than across the lenses alone, so
    // the bar does not sit at 100% through the entire synthesis step.
    percent: percentOf(stage, done, lenses.length),
  }
}

/**
 * How far along, 0–100.
 *
 * Gather is a real part of the work and the part everything else rests on, so
 * it is worth 15% rather than 0. The lenses are the bulk. Synthesis is the last
 * stretch, and a run only reaches 100 when it is genuinely finished — a bar
 * that shows 100% while work continues is a bar nobody believes twice.
 */
export function percentOf(stage, done, total) {
  if (stage === 'complete') return 100
  if (stage === 'gather') return 5
  if (stage === 'synthesise') return 90
  if (!total) return 15
  return Math.round(15 + (done / total) * 70)
}

/** "2 of 5 questions answered" — the line a person reads instead of the bar. */
export function progressLine(p = {}) {
  if (p.failed) return 'This run stopped before it finished.'
  if (p.stage === 'complete') {
    const found = (p.lenses || []).filter(l => l.state === 'done').length
    return `${p.total} question${p.total === 1 ? '' : 's'} checked · ${found} found something`
  }
  if (p.stage === 'gather') return 'Measuring competitors before anything else runs'
  if (p.stage === 'synthesise') return 'All questions answered — writing the brief'
  return `${p.done} of ${p.total} question${p.total === 1 ? '' : 's'} answered`
}

/** Seconds, for a duration a person is watching rather than auditing. */
export function secs(ms) {
  const v = num(ms)
  if (v === null) return ''
  const s = Math.round(v / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/**
 * Is this run stuck?
 *
 * The run sweeps its own stale rows server-side after 20 minutes, but only on
 * the next attempt — so a browser can sit watching a dead run for a long time
 * with no signal. Saying so is better than a spinner that never resolves, and
 * it is the same lesson as every terminal path writing a status.
 */
export function looksStuck(run = {}, now = new Date(), minutes = 20) {
  if (run?.status !== 'running' || !run?.started_at) return false
  const started = new Date(run.started_at).getTime()
  if (Number.isNaN(started)) return false
  return now.getTime() - started > minutes * 60_000
}

/** Whether a run row is worth polling for. */
export const isLive = run => Boolean(run) && !TERMINAL.has(run.status)
