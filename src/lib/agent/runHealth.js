// ─── Is the research actually happening? ───────────────────────────────────
// A weekly cron that silently stops is worse than no cron. You keep believing
// the market is being watched, and the belief is the whole product — nobody
// opens a research page to check that research ran, they open it to read what
// it found, and an empty page looks identical to a quiet week.
//
// THIS IS NOT HYPOTHETICAL HERE. The n8n workflow schedules Monday 06:00 and
// every run in this database is `trigger: 'manual'`, going back to 2026-08-20
// across three Mondays. The cron has never fired and nothing said so for three
// weeks. That is precisely the failure this file exists to make visible.
//
// Three distinct states, and they need different words because they need
// different actions:
//
//   failed    the last run started and died. Read the error, run it again.
//   stale     nothing has completed recently. The schedule is not running, or
//             it is running and failing before it can write a row.
//   stuck     a run has been `running` far too long. The sweep will fail it,
//             but a person looking now should be told rather than watching a
//             spinner that will never close.
//
// Pure: every time comes in, nothing is read from a clock this file owns.

/** A run still `running` after this long is not running any more. */
export const STUCK_MINUTES = 20

/**
 * How long without a completed run before the schedule is suspect.
 *
 * Ten days, not seven. A weekly cadence plus a bank holiday plus a deploy that
 * happened to land on Monday morning should not cry wolf — the first false
 * alarm is the one that teaches people to ignore the banner, and after that it
 * is decoration.
 */
export const STALE_DAYS = 10

const at = run => Date.parse(run?.finished_at || run?.started_at || '') || 0

/**
 * Judge the health of a workspace's research from its run history.
 *
 * `runs` is the list the page already loads, newest first. Returns null when
 * everything is fine, so a caller can render nothing without deciding what
 * "fine" means.
 */
export function runHealth(runs = [], now = new Date()) {
  const list = [...(runs || [])].filter(Boolean).sort((a, b) => at(b) - at(a))
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now)

  // A workspace that has never run is not broken, it is new. Telling someone
  // their schedule is stale before they have ever pressed the button is a
  // false alarm on day one.
  if (!list.length) return null

  const running = list.find(r => r.status === 'running')
  if (running) {
    const minutes = Math.floor((nowMs - at(running)) / 60_000)
    if (minutes >= STUCK_MINUTES) {
      return {
        level: 'stuck',
        headline: `A run has been going for ${minutes} minutes and will not finish.`,
        detail: 'Runs are swept after 20 minutes. Nothing is being spent — the invocation is already gone.',
        action: 'Start a new run.',
      }
    }
    // Genuinely in progress. Not a problem.
    return null
  }

  const newest = list[0]
  if (newest.status === 'failed') {
    return {
      level: 'failed',
      headline: 'The last run failed.',
      detail: String(newest.error || '').slice(0, 300) || 'No error was recorded.',
      // The measured half survives a failed investigation, so there may still
      // be something worth reading — saying "run it again" alone would send
      // someone past a board that is sitting there complete.
      action: 'Read what it did manage, then run it again.',
    }
  }

  const lastComplete = list.find(r => r.status === 'complete')
  if (!lastComplete) return null

  const days = Math.floor((nowMs - at(lastComplete)) / 86_400_000)
  if (days >= STALE_DAYS) {
    return {
      level: 'stale',
      headline: `No research has completed in ${days} days.`,
      detail: 'The weekly schedule may not be running. Every run in this workspace was started by hand.',
      action: 'Check that the weekly workflow is imported and active, or run it now.',
    }
  }

  return null
}

/**
 * Has this workspace ever had a run it did not start by hand?
 *
 * Separate from staleness because it is a different diagnosis with a different
 * fix, and it is the one that has been true here the whole time: a schedule
 * that was written, committed, and never imported looks — from inside the app
 * — exactly like a schedule that works and a team that happens to press the
 * button first every week.
 */
export function scheduleNeverRan(runs = []) {
  const list = (runs || []).filter(Boolean)
  if (list.length < 2) return false
  return list.every(r => r.trigger === 'manual')
}

// ─── A lens that read the market and reported nothing ──────────────────────
// runHealth above watches whether RUNS happen. It cannot see the failure that
// actually cost us findings, because that failure completes successfully.
//
// On 2026-09-15 the events, demand and category lenses read 54, 31 and 45
// sources and each returned an empty findings array. Every one recorded
// `status = 'ok'`, with no error, no timeout and no refusal, and the run was
// billed $0.72 for the silence. Nothing in the system could tell that apart
// from three genuinely quiet weeks, because nothing was looking at the ratio.
//
// The rule is deliberately crude: reading real sources and reporting nothing
// is SUSPECT, never a clean result. It may still be true — some weeks are
// quiet — but it must be visible enough to check, because the alternative is
// what already happened, three times, in silence.

/**
 * Sources a lens must have read before an empty answer looks wrong.
 *
 * Five, not one. A lens that opened two pages and found nothing is ordinary;
 * one that read forty and found nothing has either hit an instruction it
 * cannot satisfy or is answering a question nobody needs asked.
 */
export const SILENT_SOURCE_FLOOR = 5

/**
 * A note for a lens result that succeeded and said nothing, or '' when the
 * result is unremarkable. Stored in research_lens_results.note, which already
 * exists — the `status` column is constrained to ok/failed, and a third state
 * would need a migration applied by hand for a signal that reads just as well
 * in prose.
 *
 * Pure, and takes the result rather than the row, so it can be called before
 * the write rather than after.
 */
export function silentLensNote(result) {
  if (!result || result.ok === false) return ''
  const sources = (result.sources || []).length
  const findings = (result.findings || []).length
  if (findings > 0 || sources < SILENT_SOURCE_FLOOR) return ''
  return `Suspect: read ${sources} sources and returned no findings. ` +
    'Check the prompt and schema for a requirement the model could not satisfy.'
}
