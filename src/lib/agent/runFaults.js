// ─── A run's own faults are not open market questions ──────────────────────
// `unanswered` carries both: "is the 1 July requirement real?" and "your
// credit balance is too low". Only the first is something a person can go
// and answer. The second kind is said once, at the top of the report, for the
// run it happened in, never carried forward as an open item, and never handed
// to the next run's brief: told "say whether each is closed", the 2026-10-13
// rerun wrote "Last week's run fault is closed" into its own unanswered list.
//
// Its own file, with no imports, because the server reads it too
// (_investigate.js) and marketReport.js is browser-only.

const flat = v => String(v ?? '').replace(/\s+/g, ' ').trim()

const FAULT = new RegExp([
  'credit balance', 'fault in the run', 'run fault', 'lens failed and was not answered',
  'investigation did not complete', 'time budget', 'did not finish', 'not enough time',
  'could not start', 'was not started', 'returned \\d{3}', 'invalid_request_error',
  'dropped for repeating',
].join('|'), 'i')

// A label that leaked in as a note ("sc-domain:arak-sa.com, 2026-09-13 to
// 2026-10-10."), from reports before 2026-10-13, and anything restating it.
const LABEL = /sc-domain:|^https?:\/\/\S+, \d{4}-\d{2}-\d{2} to /i

export const isRunFault = text => FAULT.test(flat(text))
export const isLabel = text => LABEL.test(flat(text))

/** The unanswered lines a person could actually go and answer. */
export const realQuestions = (lines = []) => (lines || []).filter(t => flat(t) && !isRunFault(t) && !isLabel(t))
