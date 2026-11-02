// ─── Long threads, folded into a running summary ───────────────────────────
// What the model is sent shrinks; what the person sees never does. Every
// message stays in research_messages exactly as it was, and the drawer reads
// that table, so a summary is invisible from the screen.
//
// The shape of what the model receives:
//
//   [summary of everything up to summary_through]   ← one user block, stable
//   [every message after summary_through, verbatim] ← grows by two a turn
//   [this turn's question]
//
// The verbatim tail does NOT slide one turn at a time. A sliding window
// changes the start of the conversation on every turn, which breaks the
// prompt cache on every turn. Instead the tail only grows, and once it passes
// a size it is folded in one go — after an answer has been sent, so nobody
// waits for it — leaving the last few messages verbatim. Between folds the
// conversation is append-only and caches like any other.

// Fold once the unsummarised tail passes either line.
export const FOLD_AT_MESSAGES = 12
export const FOLD_AT_TOKENS = 8_000
// Kept verbatim after a fold: the last three exchanges. "Do the same as
// yesterday" and "make it shorter" need the actual words, not a summary.
export const KEEP_MESSAGES = 6
// Hard ceiling on the history sent with a question, whatever happened to the
// summary. A fold that failed must not turn into a request past Haiku's
// 100,000-token rate step.
export const HISTORY_TOKEN_CEILING = 40_000
// A summary longer than this has stopped being one. Cut at a line break, never
// mid-sentence — but the replay showed the cut lands on the NEWEST facts, so
// the prompt asks for the newest first and the cap sits well above its length.
export const SUMMARY_MAX_CHARS = 10_000

/** Rough tokens for a string. Mixed Arabic and English runs nearer 3.5 chars a token than 4. */
export function approxTokens(text) {
  return Math.ceil(String(text || '').length / 3.5)
}

const tokensOf = rows => rows.reduce((n, m) => n + approxTokens(m?.content), 0)

/** The block the summary travels in. Fixed wording, so its bytes only change when the summary does. */
export function summaryBlock(summary) {
  return [
    'Summary of our earlier conversation in this thread (the full messages are on the',
    "person's screen; this is what you need to carry forward):",
    '',
    String(summary || '').trim(),
  ].join('\n')
}

/**
 * The history as the model will see it.
 *
 * @param {object} args
 * @param {Array<{role:string, content:string}>} args.rows  messages AFTER the summary, oldest first
 * @param {string} [args.summary]
 * @param {number} [args.ceiling]  token ceiling for the verbatim tail
 */
export function modelHistory({ rows = [], summary = '', ceiling = HISTORY_TOKEN_CEILING } = {}) {
  let tail = rows.filter(m => (m?.role === 'user' || m?.role === 'assistant') && String(m.content || '').trim())

  // Over the ceiling (a fold that never ran): drop the oldest messages until
  // it fits, a whole exchange at a time so the tail still starts with the
  // person speaking.
  while (tail.length > 2 && tokensOf(tail) > ceiling) tail = tail.slice(1)
  while (tail.length && tail[0].role !== 'user') tail = tail.slice(1)

  const out = tail.map(m => ({ role: m.role, content: m.content }))
  if (String(summary || '').trim()) out.unshift({ role: 'user', content: summaryBlock(summary) })
  return out
}

/**
 * Should the thread be folded now, and where?
 *
 * Returns null when it should not. Otherwise `fold` is the messages to fold
 * into the summary and `through` the created_at of the last of them — the new
 * summary_through. The fold always ends on an assistant message, so the tail
 * left behind starts with a question.
 *
 * @param {Array<{role:string, content:string, created_at:string}>} rows  messages after the current summary, oldest first
 */
export function planFold(rows = []) {
  if (rows.length <= KEEP_MESSAGES) return null
  if (rows.length < FOLD_AT_MESSAGES && tokensOf(rows) < FOLD_AT_TOKENS) return null

  let cut = rows.length - KEEP_MESSAGES
  // Step back to the end of an exchange.
  while (cut > 0 && rows[cut - 1]?.role !== 'assistant') cut -= 1
  if (cut <= 0) return null

  const fold = rows.slice(0, cut)
  const through = fold[fold.length - 1]?.created_at
  if (!through) return null
  return { fold, through }
}

export const FOLD_PROMPT = [
  'You keep the running summary of a conversation between a person at a company and its',
  'assistant. The summary replaces the older messages for the assistant, so anything you leave',
  'out the assistant no longer knows. The person never sees it.',
  '',
  'Keep, in short plain lines:',
  '- what the person asked for and what they are working on;',
  '- every decision, preference and correction they gave ("no, smaller projects", "both languages");',
  '- names, numbers, dates, projects, companies and links that came up, exactly as written;',
  '- the name of every file the person attached and what it was, since the assistant can re-open it by name;',
  '- what the assistant did: drafts written, requests filed, agenda items added, edits made;',
  '- anything still open or promised for later;',
  '- the language the person writes in.',
  '',
  'Drop greetings, repetition and anything the later messages replaced. Do not restate facts',
  'about the company itself (its brands, history, projects); the assistant already has those.',
  'Never invent. Put the most recent and still-open points first. Write it in English, quoting',
  'Arabic names and phrases as they were written. Stay under 450 words.',
].join('\n')

/** The fold call's one user message: the old summary, then the messages being folded in. */
export function foldInput({ summary = '', fold = [] } = {}) {
  const transcript = fold
    .map(m => `${m.role === 'user' ? 'PERSON' : 'ASSISTANT'}: ${String(m.content || '').slice(0, 6_000)}`)
    .join('\n\n')
  return [
    String(summary || '').trim()
      ? `The summary so far:\n"""\n${summary.trim()}\n"""`
      : 'There is no summary yet.',
    `Fold these messages into it and return the whole new summary:\n"""\n${transcript}\n"""`,
  ].join('\n\n')
}

/** The new summary out of the fold call's text, or '' when it is unusable. */
export function cleanSummary(text) {
  const s = String(text || '').trim()
  if (s.length <= SUMMARY_MAX_CHARS) return s
  const cut = s.lastIndexOf('\n', SUMMARY_MAX_CHARS)
  return s.slice(0, cut > SUMMARY_MAX_CHARS / 2 ? cut : SUMMARY_MAX_CHARS).trim()
}
