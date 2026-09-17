// ─── The last research run, in three lines ─────────────────────────────────
//
// The dashboard's research card. Not a ranked to-do list and not a second copy
// of the Research page — a short answer to "what did the last run find", with
// a way through to the full thing.
//
// ── WHY THE HEADLINE LEADS ──
//
// `headline` is the one field the synthesis prompt asks for in plain prose:
// "one sentence, what actually changed this week". It is the best writing in
// the report, it is already scoped to a week, and it is the only field that can
// honestly say "nothing moved" — the prompt names that as a complete and
// correct answer. Truncating it into a row, or rebuilding a worse version of it
// out of ranked findings, throws away the one thing the model was asked to do
// well.
//
// ── WHY A RUN CAN LOOK FINE AND BE EMPTY ──
//
// Arak's 17 Sep run: `status: "complete"`, `stage_reached: "synthesise"`, 33
// findings, a strong headline — and top_three, market_direction,
// competitor_moves, gaps and proposed_ideas ALL empty. It had spent $15.06 of a
// $15.00 monthly cap and stopped before it could analyse anything.
//
// Neither status nor stage_reached catches that. The reliable tell is
// structural: findings present, every synthesis section empty. So that is what
// `hasAnalysis` tests, and a run failing it is stepped over rather than shown
// as a quiet week — which is exactly what it looked like on the dashboard for
// two days.

const str = v => String(v ?? '').trim()
const arr = v => (Array.isArray(v) ? v : [])

/**
 * The sections a run only has if it actually got as far as thinking.
 *
 * Findings are NOT in this list on purpose: they are produced by the gather
 * stage, so a run that died before synthesis still has plenty of them. They are
 * the evidence, not the conclusion.
 */
export const ANALYSIS_KEYS = [
  'top_three', 'market_direction', 'competitor_moves', 'gaps', 'proposed_ideas',
]

export const hasAnalysis = report =>
  ANALYSIS_KEYS.some(key => arr(report?.[key]).length > 0)

/**
 * The newest run worth showing, plus whatever newer ones were stepped over.
 *
 * A capped or crashed run must not blank the dashboard for a week — the
 * previous run's findings are still the best picture anyone has. But silently
 * showing old analysis as current is the other failure, so what was skipped
 * comes back too, and the card says so.
 */
export function usableReport(runs = []) {
  const skipped = []
  for (const run of runs) {
    const report = run?.report
    if (!report || typeof report !== 'object' || !Object.keys(report).length) continue

    const at = run.finished_at || run.started_at || ''
    if (!hasAnalysis(report)) {
      skipped.push({
        runId: run.id,
        runAt: at,
        headline: str(report.headline),
        findings: arr(report.findings).length,
        // The run's own explanation, in its own words. Not parsed for a cause:
        // the text is written by run.js and reads perfectly well, and pattern
        // matching on prose to decide whether it "counts" as a budget problem
        // would be a guess dressed as a check.
        reason: str(arr(report.unanswered)[0]),
      })
      continue
    }
    return { report, runId: run.id, runAt: at, skipped }
  }
  return { report: null, runId: '', runAt: '', skipped }
}

/**
 * One or two lines under the headline.
 *
 * `top_three` first, because the prompt defines it as "the three things that
 * most need doing this week, across ALL three teams, most important first" —
 * the agent's own answer to this exact question, and better than any ranking
 * this file could invent.
 *
 * The fallbacks are not decoration. Arak's 14 Sep run has an empty top_three
 * and three market directions; a run can synthesise one section and not
 * another, and a card that only ever read top_three would have been blank on a
 * report that had plenty to say.
 */
export function keyPoints(report = {}, { limit = 2 } = {}) {
  const top = arr(report.top_three)
    .filter(t => str(t.finding))
    .map(t => ({ text: str(t.finding), note: str(t.action), from: 'top_three' }))
  if (top.length) return top.slice(0, limit)

  const direction = arr(report.market_direction)
    .filter(m => str(m.movement))
    .map(m => ({ text: str(m.movement), note: str(m.so_what), from: 'market_direction' }))
  if (direction.length) return direction.slice(0, limit)

  const moves = arr(report.competitor_moves)
    .filter(m => str(m.what_changed))
    .map(m => ({
      text: str(m.competitor) ? `${str(m.competitor)}: ${str(m.what_changed)}` : str(m.what_changed),
      note: str(m.effect_on_us),
      from: 'competitor_moves',
    }))
  if (moves.length) return moves.slice(0, limit)

  return arr(report.gaps)
    .filter(g => str(g.gap))
    .map(g => ({ text: str(g.gap), note: str(g.suggested_response), from: 'gaps' }))
    .slice(0, limit)
}

/**
 * What the run produced, for the "we looked at this much" line.
 *
 * Counts only. The card is a pointer to the Research page, so the job here is
 * to say the run was substantial enough to be worth opening — not to reproduce
 * it.
 */
export function runScale(report = {}) {
  return {
    findings: arr(report.findings).length,
    competitors: arr(report.competitor_board).length,
    moves: arr(report.competitor_moves).length,
    gaps: arr(report.gaps).length,
    ideas: arr(report.proposed_ideas).length,
    unanswered: arr(report.unanswered).length,
  }
}

/** "3 findings · 2 rivals moved · 4 ideas ready", skipping whatever is zero. */
export function scaleLine(scale = {}) {
  const parts = []
  if (scale.findings) parts.push(`${scale.findings} finding${scale.findings === 1 ? '' : 's'}`)
  if (scale.moves) parts.push(`${scale.moves} rival${scale.moves === 1 ? '' : 's'} moved`)
  if (scale.gaps) parts.push(`${scale.gaps} gap${scale.gaps === 1 ? '' : 's'}`)
  if (scale.ideas) parts.push(`${scale.ideas} idea${scale.ideas === 1 ? '' : 's'} ready`)
  return parts.join(' · ')
}

/**
 * Everything the card draws, from the run list.
 *
 * One function so the component holds no logic about what counts as a usable
 * run — that question has a wrong answer that looks right, and it belongs
 * somewhere it can be tested.
 */
export function summariseRuns(runs = []) {
  const { report, runAt, runId, skipped } = usableReport(runs)
  if (!report) {
    return {
      ok: false,
      everRan: runs.length > 0,
      report: null, runId: '', runAt: '',
      headline: '', points: [], scale: null, scaleLine: '',
      skipped,
    }
  }
  const scale = runScale(report)
  return {
    ok: true,
    everRan: true,
    report, runId, runAt,
    // "Nothing moved this week" is a complete headline — the prompt says so
    // explicitly — and must render as the answer rather than as a blank card.
    headline: str(report.headline),
    points: keyPoints(report),
    scale,
    scaleLine: scaleLine(scale),
    skipped,
  }
}
