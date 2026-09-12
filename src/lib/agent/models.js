// ─── The model registry ────────────────────────────────────────────────────
// The ONE place in this codebase where a model is named or priced. Every
// agent call goes through `modelFor(job)`, so swapping the model behind a job
// — or the provider behind a model — is an edit here and nothing else. That
// seam is the whole reason this file exists as its own module: the comparison
// that picked these models (AGENT.md §7) will be re-run in a month against
// real ledger numbers, and the answer changing must not mean a rewrite.
//
// Two models, deliberately. Haiku was considered and ruled out on 2026-09-09:
// a third tier saves a few dollars a month on a bill already estimated at
// $30–80, and costs a third prompt style plus a quality cliff wherever the
// split is drawn slightly wrong.

// Prices in USD per 1,000,000 tokens, as published 2026-09-09.
//
// Cache reads and writes are listed explicitly rather than computed from a
// multiplier. The multipliers (~0.1× read, ~1.25× write) are documented
// behaviour, not a contract, and a ledger that silently disagrees with the
// invoice is worse than no ledger — see agent_usage in
// supabase/migrations/20260827_agent_spine.sql, which stores the computed cost
// rather than deriving it on read for the same reason.
export const MODELS = {
  'claude-opus-5': {
    label: 'Opus 5',
    input:      5.00,
    cacheRead:  0.50,
    cacheWrite: 6.25,
    output:    25.00,
  },
  'claude-sonnet-5': {
    label: 'Sonnet 5',
    input:      3.00,
    cacheRead:  0.30,
    cacheWrite: 3.75,
    output:    15.00,
  },
}

export const DEFAULT_MODEL = 'claude-sonnet-5'

// ─── Jobs → models ─────────────────────────────────────────────────────────
// Named by what the call is FOR, never by which model it wants. A caller that
// says `modelFor('synthesise')` keeps working when the mapping changes; one
// that hardcodes 'claude-opus-5' does not, and there is no way to find every
// such caller later except by grepping and hoping.
//
// Opus where a person acts on the output and a wrong answer costs real work.
// Sonnet everywhere else — the long middle of a run, where the job is reading
// and shaping rather than judging.
export const JOBS = {
  // ── Opus: the output someone acts on ──
  plan:        'claude-opus-5',   // decides what the whole run chases
  synthesise:  'claude-opus-5',   // writes the brief people read
  chat:        'claude-opus-5',   // the assistant answering a real question
  review:      'claude-opus-5',   // critiquing a draft before it goes out

  // ── Sonnet: the long middle ──
  search:      'claude-sonnet-5', // the bounded read-and-gather loop
  reflect:     'claude-sonnet-5', // what is still unanswered
  extract:     'claude-sonnet-5', // pulling shaped data out of fetched pages
  title:       'claude-sonnet-5', // naming a chat thread
  // Compacting the agent's memory. Sonnet rather than a third, cheaper tier:
  // this runs roughly ten times a month, so the saving would be pennies, and
  // the job is genuinely lossy — deciding what the agent never sees again is
  // not where to buy a quality cliff. See the Haiku note at the top.
  remember:    'claude-sonnet-5',
}

/**
 * The model id for a job. Unknown jobs fall back to Sonnet rather than
 * throwing: a new caller that forgot to register its job should run slightly
 * cheaper than intended, not take the agent down. It is still a bug — the
 * ledger will show a `job` the JOBS table does not contain.
 *
 * @param {string} job
 * @returns {string} model id
 */
export function modelFor(job) {
  return JOBS[job] || DEFAULT_MODEL
}

/**
 * Price card for a model id, or null if we do not know it. Null rather than a
 * guess: an unpriced model must show up as a hole in the ledger, because a
 * cost silently recorded as 0 is how a cap gets bypassed forever.
 *
 * @param {string} model
 */
export function priceOf(model) {
  return MODELS[model] || null
}

export const KNOWN_MODELS = Object.keys(MODELS)
