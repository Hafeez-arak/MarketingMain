// ─── Not proposing the same standing question twice ────────────────────────
// Every run may propose questions for the agenda. Nothing checked whether it
// had proposed them before, so the queue accumulates: Arak has ten proposed
// questions, none accepted, and two of them are the same request in different
// words.
//
// ── WHY THIS IS AN EXACT MATCH AND NOT A SIMILARITY SCORE ──
//
// The obvious move was to reuse `partitionRepeats` from memory.js, which
// already does fuzzy repeat detection for ideas and is tuned and tested. It
// was measured against the real rows before being adopted, and it does the
// wrong thing here — in both directions at once:
//
//   MISSED the actual duplicate. "Connect ARAK's own Instagram account to the
//   board" and "Connect the Arak Instagram account so the competitor board has
//   a second side" scored below the 0.6 threshold and both passed as fresh.
//
//   SUPPRESSED a distinct question. "Which Saudi giga-projects are entering
//   DESIGN stage right now?" and the same sentence with CONSTRUCTION scored as
//   a repeat — so asking about the two stages of a project pipeline, which are
//   completely different commercial moments, would become one question.
//
// That is not a threshold that needs tuning, it is the wrong instrument. A
// standing question turns on its decisive noun, and swapping that noun barely
// moves a lexical score while changing the entire meaning. Ideas are prose and
// tolerate fuzzy matching; questions are not.
//
// So: exact match on normalised text. It catches the case that actually
// recurs — a run re-proposing wording it produced before — and it can never
// cost a question that differs by a single load-bearing word. Near-duplicates
// in different words survive, and a person retires one in a click, which is a
// far cheaper mistake than the other kind.

/**
 * Normalised form of a question, for comparison only.
 *
 * Punctuation and case go, and so does a leading article, because "the Arak
 * account" and "Arak account" are the same string for this purpose. Word order
 * and every significant word are preserved — those are exactly what must still
 * distinguish two questions.
 */
export function questionKey(subject) {
  return String(subject || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Which proposed questions are worth writing.
 *
 * `existing` is every agenda question in any status — including RETIRED, which
 * is the important one. A question a person explicitly retired must not be
 * re-proposed next week; that is the whole reason dismissal keeps the row
 * instead of deleting it.
 *
 * Self-deduplicating as it goes, so one run proposing the same wording twice
 * writes it once.
 */
export function freshQuestions(proposed = [], existing = []) {
  const seen = new Set((existing || []).map(e => questionKey(e?.subject ?? e)).filter(Boolean))
  const fresh = []
  const duplicates = []

  for (const p of proposed || []) {
    const subject = String(p?.subject || '').trim()
    if (!subject) continue
    const key = questionKey(subject)
    if (!key) continue
    if (seen.has(key)) { duplicates.push(subject); continue }
    seen.add(key)
    fresh.push(p)
  }
  return { fresh, duplicates }
}
