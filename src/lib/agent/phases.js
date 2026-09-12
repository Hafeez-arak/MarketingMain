// ─── Splitting the run so it fits inside a function timeout ────────────────
// Pure. No network, no clock it did not receive.
//
// ── WHY THIS EXISTS ──
//
// api/agent/run.js used to await the whole run in ONE HTTP request: gather,
// six lenses, synthesis, persist, memory. Vercel kills the function at its
// ceiling, mid-run, and the browser's spinner never closes — only the server
// closes it.
//
// This project is on Vercel Hobby, where the ceiling is 300 SECONDS AND CANNOT
// BE RAISED. Pro allows 800s; Hobby does not. That single fact rules out the
// one-line fix and is why the run is now three routes.
//
// ── THE PART THAT IS EASY TO GET WRONG ──
//
// Splitting per phase is necessary and NOT sufficient. A single calendar lens
// was measured at 49s, then 380s, then 380s. One lens alone exceeded the
// Hobby ceiling twice, so a run split into "one HTTP call per lens" would
// still fail — just in a smaller place.
//
// Hence deadlines. A lens is given a wall-clock budget and returns whatever it
// has when the budget runs out. The lens layer already guarantees that a lens
// never throws; this adds that a lens never overruns. Together those two make
// the run bounded BY CONSTRUCTION rather than by hope, on any host and any
// plan tier.

/** The phases a run moves through, in order. */
export const PHASES = ['gather', 'lenses', 'synthesise', 'complete']

/**
 * The platform ceiling, and what we actually allow ourselves inside it.
 *
 * The margin is not padding-for-its-own-sake. When a function is killed at the
 * ceiling, nothing runs: no status write, no error, no ledger row — the run
 * simply stops existing mid-flight and the spinner spins forever. Finishing
 * EARLY and writing an honest "this timed out" is strictly better than being
 * killed, so every budget here leaves room to write that row.
 */
export const PLATFORM_CEILING_MS = 300_000
export const SAFETY_MARGIN_MS = 45_000

/** How long each phase may take before it must wrap up and report. */
export const PHASE_BUDGET_MS = {
  // Stage 0 is measured in seconds and must not be budgeted tightly — it is
  // the part whose output everything else is a bonus on top of.
  gather: 120_000,
  // One lens. Deliberately well under the ceiling: the route also has to load
  // context, write a result row, and answer.
  lens: 150_000,
  // Synthesis reads every lens result and writes the brief someone acts on.
  synthesise: 180_000,
}

/**
 * When must this piece of work stop?
 *
 * Returns an absolute epoch-millisecond deadline, so callers pass one value
 * around instead of each recomputing "how much is left" from a different
 * start time and disagreeing.
 */
export function deadlineFor(phase, startedAt = Date.now()) {
  const budget = PHASE_BUDGET_MS[phase] ?? PHASE_BUDGET_MS.lens
  return startedAt + Math.min(budget, PLATFORM_CEILING_MS - SAFETY_MARGIN_MS)
}

/**
 * Milliseconds left before a deadline, floored at zero.
 *
 * Never returns a negative number: a negative timeout passed to an
 * AbortController or setTimeout fires immediately in some runtimes and never
 * in others, and "never" is the failure mode this whole module exists to
 * prevent.
 */
export function msLeft(deadline, now = Date.now()) {
  const left = Number(deadline) - Number(now)
  return Number.isFinite(left) && left > 0 ? Math.floor(left) : 0
}

/**
 * Is there enough time left to be worth starting this?
 *
 * Starting a model call with eight seconds left buys an aborted generation
 * that still bills for its tokens. Refusing to start is cheaper and produces a
 * clearer report.
 */
export function worthStarting(deadline, minimumMs = 15_000, now = Date.now()) {
  return msLeft(deadline, now) >= minimumMs
}

/**
 * Which lenses still need to run.
 *
 * `done` is whatever is already in research_lens_results for this run. A lens
 * that FAILED is considered done rather than pending: retrying it
 * automatically would spend the same money on the same failure, and the brief
 * is designed to report a missing lens honestly. A caller that genuinely wants
 * a retry asks for one by name.
 */
export function pendingLenses(wanted = [], done = []) {
  const seen = new Set(done.map(d => d?.lens).filter(Boolean))
  return wanted.map(l => (typeof l === 'string' ? l : l?.key)).filter(k => k && !seen.has(k))
}

/**
 * Can synthesis start?
 *
 * Not "did every lens succeed" — that would let one blocked Instagram hold the
 * whole brief hostage, which is the exact failure the parallel lens design was
 * built to end. Synthesis runs when nothing is still pending, and reports what
 * was missing.
 */
export function readyToSynthesise(wanted = [], done = []) {
  return pendingLenses(wanted, done).length === 0
}

/**
 * What the run row should say next.
 *
 * Kept here rather than inline in the routes so the state machine is in one
 * place and testable. A run that stops writing its stage is a run nobody can
 * tell apart from a crashed one.
 */
export function nextPhase({ phase, wanted = [], done = [] }) {
  if (phase === 'gather') return 'lenses'
  if (phase === 'lenses') return readyToSynthesise(wanted, done) ? 'synthesise' : 'lenses'
  if (phase === 'synthesise') return 'complete'
  return phase
}

/**
 * A lens result that ran out of time.
 *
 * Shaped exactly like a real one so nothing downstream has to branch on it,
 * and marked `timed_out` so the budgets can later be tuned against
 * measurements rather than against the two data points we have today.
 */
export function timedOutResult(lens, ms) {
  return {
    lens,
    ok: false,
    findings: [],
    sources: [],
    cost: 0,
    timed_out: true,
    duration_ms: ms,
    error: `The ${lens} lens ran out of time after ${Math.round(ms / 1000)}s and was stopped. ` +
           'It is not that it found nothing — it did not finish looking.',
  }
}

/**
 * Turn stored lens rows back into the shape investigate() works with.
 *
 * The two halves of the run now talk through a table rather than a variable,
 * and this is the seam. Keeping the conversion here — rather than letting each
 * caller reach into the row shape — means a column rename breaks one function
 * and one test, not six call sites.
 */
export function resultsFromRows(rows = []) {
  return rows.map(r => ({
    lens: r.lens,
    ok: r.status === 'ok',
    findings: Array.isArray(r.findings) ? r.findings : [],
    sources: Array.isArray(r.sources) ? r.sources : [],
    note: r.note || '',
    error: r.error || '',
    cost: Number(r.cost_usd) || 0,
    timed_out: Boolean(r.timed_out),
  }))
}

/**
 * A one-line account of how the run was actually executed.
 *
 * Surfaced in the brief because a run that quietly lost two lenses to the
 * clock looks, from the outside, exactly like a quiet week — and those two
 * things should never be confused.
 */
export function timingNote(results = []) {
  const out = results.filter(r => r?.timed_out)
  if (!out.length) return ''
  const names = out.map(r => r.lens).join(', ')
  return `${out.length} lens${out.length === 1 ? '' : 'es'} (${names}) ran out of time and ` +
         'reported early. This is a limit of the run, not a finding about the market.'
}
