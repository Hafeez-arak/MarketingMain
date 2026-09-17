// ─── What a finished turn actually means ───────────────────────────────────
// `stop_reason` says how a generation ended, and until 2026-09-17 nothing in
// this codebase read it. Every stop was treated as a completed answer, which
// is wrong in three different ways and cost real findings each time:
//
//   pause_turn   The API runs its own sampling loop for server-side tools. On
//                hitting that loop's iteration limit it returns pause_turn —
//                the work is UNFINISHED and is meant to be continued by
//                sending the turn back. Treated as complete, whatever partial
//                output existed was parsed as the final answer.
//   max_tokens   The output is truncated mid-structure. A structured-output
//                caller then fails to parse it and reports malformed JSON,
//                which sends a reader looking at the schema rather than at the
//                token ceiling.
//   refusal      An HTTP 200 with nothing usable in it. `stop_details` is
//                populated for this stop_reason and no other.
//
// Pure, so the classification can be tested without a network, a key or a
// Supabase row — the same reason the lens stages were built as pure functions
// over stubbed HTTP.

/**
 * How many times a paused turn may be resumed before we stop paying.
 *
 * Four. A resume loop with no ceiling is how one lens quietly bills for nine,
 * and a turn still unfinished after four continuations has a problem that more
 * money will not solve.
 */
export const MAX_CONTINUATIONS = 4

/**
 * Classify a finished leg of a call.
 *
 * @param {string} stopReason            response.stop_reason
 * @param {object} [opts]
 * @param {number} [opts.continuations]  how many resumes have already happened
 * @param {number} [opts.max]            the ceiling
 * @returns {{resume:boolean, refused:boolean, truncated:boolean, exhausted:boolean}}
 */
export function turnOutcome(stopReason, { continuations = 0, max = MAX_CONTINUATIONS } = {}) {
  const paused = stopReason === 'pause_turn'
  return {
    // Resume only while there is headroom. Past the ceiling the turn is
    // reported as unfinished rather than silently accepted — see `exhausted`.
    resume: paused && continuations < max,
    exhausted: paused && continuations >= max,
    refused: stopReason === 'refusal',
    truncated: stopReason === 'max_tokens',
  }
}

/**
 * The message for a turn that paused more times than we were willing to pay
 * for. Worded like the timeout message on purpose: both mean "did not finish",
 * and both are routinely misread as "found nothing".
 */
export function exhaustedMessage(max = MAX_CONTINUATIONS) {
  return `The model was still working after ${max} continuations and was stopped. ` +
         'It did not finish, which is not the same as finding nothing.'
}

/**
 * The message for a refusal. `stop_details.category` is an open set, so it is
 * quoted rather than switched on.
 */
export function refusalMessage(stopDetails = null) {
  const category = stopDetails?.category
  return `The model declined this request${category ? ` (${category})` : ''}.`
}
