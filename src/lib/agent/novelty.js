// ─── Is this actually new? ─────────────────────────────────────────────────
// `novelty` is the field that turns a report into a REVIEW — continuing
// findings collapse, changed ones lead. It was asserted by the model, and the
// model has never seen a previous brief: no lens receives prior findings, so
// "continuing" was a word chosen with no evidence available to choose it.
//
// Measured against the seven real Arak runs before this was written, and the
// model is wrong about half the time in a specific, systematic way:
//
//   In the 2026-09-12 run it labelled FOUR findings "continuing". Every one of
//   them was genuinely new — maximum similarity 0.09 against every finding
//   from every prior run. It was not recalling; it was using "continuing" to
//   mean "this is a long-standing fact about the world" (SBC 601/602 has been
//   in force for years, lead time has always been a fear). That is a true
//   statement and a different claim from the one the field is for, and the
//   page renders it as the second.
//
//   The one genuine repeat — "Saudi National Day is 11 days away" appearing in
//   two runs on the same day — scored 1.00.
//
// So the separation is not marginal: 1.00 for a real repeat, ≤ 0.11 for
// everything else. Far cleaner than the 0.714 / 0.167 margin REPEAT_AT was
// originally tuned on, which is why that threshold is reused here rather than
// a new one invented.
//
// ── WHAT THIS DELIBERATELY DOES NOT TOUCH ──
//
// Findings from the COMPUTED lenses. The calendar lens sets 'continuing' from
// a date it calculated, and the ourselves lens sets 'changed' from a
// subtraction over two stored windows. Those are measurements, not
// recollections, and they are already right. Only a model's guess gets
// overwritten — see `isComputedLens`.

import { similarity, REPEAT_AT } from './memory.js'

/**
 * Lenses whose novelty is computed rather than asserted.
 *
 * Kept here rather than read off `budget.searches === 0` — that happens to
 * select the same two today, but it says "this lens is cheap", not "this
 * lens's novelty is trustworthy", and the day a searching lens computes its
 * own deltas the coincidence would silently mislead.
 */
export const COMPUTED_LENSES = new Set(['calendar', 'ourselves'])

export const isComputedLens = lens => COMPUTED_LENSES.has(String(lens || ''))

/**
 * Flatten prior runs into one list of findings, newest first, each carrying
 * when it was seen.
 *
 * Accepts the `research_runs` rows the run context already loads, so this adds
 * no query. A run with no findings contributes nothing rather than erroring.
 */
export function priorFindingsFrom(priorRuns = []) {
  const out = []
  for (const run of priorRuns || []) {
    const at = run?.started_at || run?.period_end || run?.report?.period?.end || ''
    for (const f of run?.report?.findings || []) {
      const headline = String(f?.headline || '').trim()
      if (headline) out.push({ headline, lens: f.lens || '', at: String(at).slice(0, 10) })
    }
  }
  return out
}

/**
 * The best prior match for one finding, or null.
 *
 * Same-lens matches are preferred when scores tie, because two lenses can
 * legitimately reach the same sentence from different evidence and collapsing
 * those loses the fact that two independent lines of enquiry agreed.
 */
export function matchPrior(finding, priorFindings = [], threshold = REPEAT_AT) {
  const headline = String(finding?.headline || '').trim()
  if (!headline) return null

  let best = null
  let bestScore = 0
  for (const p of priorFindings || []) {
    const score = similarity(headline, p.headline)
    if (score > bestScore || (score === bestScore && best && p.lens === finding.lens && best.lens !== finding.lens)) {
      bestScore = score
      best = p
    }
  }
  return bestScore >= threshold ? { ...best, score: Number(bestScore.toFixed(3)) } : null
}

/**
 * Rewrite each finding's novelty from evidence.
 *
 * Adds two fields the brief can actually use:
 *
 *   first_seen   the date this finding first appeared. "We have been saying
 *                this for three weeks and nothing has happened" is a far more
 *                useful sentence than "continuing", and it is the one a person
 *                acts on.
 *   novelty_by   'computed' or 'model', so a reader — and a later maintainer —
 *                can tell which claims were measured.
 *
 * Findings from computed lenses pass through untouched.
 */
export function applyNovelty(findings = [], priorFindings = [], { threshold = REPEAT_AT } = {}) {
  return (findings || []).map(f => {
    if (isComputedLens(f?.lens)) return { ...f, novelty_by: 'computed' }

    const hit = matchPrior(f, priorFindings, threshold)
    if (!hit) {
      return { ...f, novelty: 'new', novelty_by: 'computed', first_seen: null }
    }
    return {
      ...f,
      // Never 'changed' from this comparison alone. Two similar headlines do
      // not tell us a NUMBER moved, and 'changed' is the label that makes a
      // finding lead the brief — claiming it on a text match would put the
      // loudest badge on the weakest evidence.
      novelty: 'continuing',
      novelty_by: 'computed',
      first_seen: hit.at || null,
      repeat_of: hit.headline,
      repeat_score: hit.score,
    }
  })
}

/**
 * How many weeks this has been said, for the one sentence that matters.
 *
 * Null when it is new or undated — callers must not render "0 weeks", which
 * reads as "brand new" for something first seen four days ago.
 */
export function weeksRunning(finding, now = new Date()) {
  if (!finding?.first_seen) return null
  const then = Date.parse(`${String(finding.first_seen).slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(then)) return null
  const days = Math.floor((now.getTime() - then) / 86_400_000)
  return days < 7 ? null : Math.floor(days / 7)
}

/** A short, honest label for the UI. */
export function noveltyLabel(finding, now = new Date()) {
  if (finding?.novelty !== 'continuing') return finding?.novelty || 'new'
  const weeks = weeksRunning(finding, now)
  if (weeks === null) return 'continuing'
  return `continuing · ${weeks}w`
}

/**
 * What the brief should say about repetition, in one line.
 *
 * Surfaced because a run that is 80% repeats is telling you something — either
 * the market is quiet, or the agent is stuck asking questions it has already
 * answered. Both are worth knowing and neither is visible per-finding.
 */
export function repetitionNote(findings = []) {
  const judged = (findings || []).filter(f => !isComputedLens(f?.lens))
  if (!judged.length) return ''
  const repeats = judged.filter(f => f.novelty === 'continuing')
  if (!repeats.length) return ''
  if (repeats.length === judged.length) {
    return `Every researched finding this run repeats something from a previous run. Either the market is genuinely still, or the standing questions need changing.`
  }
  return `${repeats.length} of ${judged.length} researched findings repeat earlier runs.`
}
