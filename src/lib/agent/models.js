// ─── The model registry ────────────────────────────────────────────────────
// The ONE place in this codebase where a model is named or priced. Every
// agent call goes through `modelFor(job)`, so swapping the model behind a job
// — or the provider behind a model — is an edit here and nothing else. That
// seam is the whole reason this file exists as its own module: the comparison
// that picked these models (AGENT.md §7) will be re-run in a month against
// real ledger numbers, and the answer changing must not mean a rewrite.
//
// Three models since 2026-11-02. Haiku was ruled out on 2026-09-09 against a
// bill estimated at $30–80 and an older Haiku at $1 / $5. The ledger measured
// about a sixth of that estimate, and Haiku 5.5 arrived at $0.10 / $0.50 —
// forty times under Opus. The owner chose: the chat answers easy questions
// (numbers, lookups, "assign this") on Haiku and anything that needs judgement
// on Sonnet; Opus stays only where a run's output is acted on. The split is
// drawn in code, in src/lib/agent/chatRoute.js, not here.

// Prices in USD per 1,000,000 tokens. The 5.5 models as published on
// platform.claude.com/docs/en/about-claude/pricing (read 2026-10-13); cache
// reads there are 5% of input, not 10%. The older entries stay so rows the
// ledger already holds still read back against a known model.
//
// Cache reads and writes are listed explicitly rather than computed from a
// multiplier. The multipliers (~0.1× read, ~1.25× write) are documented
// behaviour, not a contract, and a ledger that silently disagrees with the
// invoice is worse than no ledger — see agent_usage in
// supabase/migrations/20260827_agent_spine.sql, which stores the computed cost
// rather than deriving it on read for the same reason.
export const MODELS = {
  // Two rate cards chosen by prompt length: up to 100,000 input tokens the
  // card below, past it `long` — five times every line. Cache reads are 0.1×
  // input and five-minute writes 1.25× (model-migration guide, read
  // 2026-11-02). No server-side refusal fallback exists for this model, so
  // `fallbacks` is false and _provider.js does not ask for one.
  'claude-haiku-5-5': {
    label: 'Haiku 5.5',
    input:      0.10,
    cacheRead:  0.01,
    cacheWrite: 0.125,
    output:     0.50,
    long: {
      above:   100_000,
      input:      0.50,
      cacheRead:  0.05,
      cacheWrite: 0.625,
      output:     2.50,
    },
    fallbacks: false,
  },
  'claude-opus-5-5': {
    label: 'Opus 5.5',
    input:      4.00,
    cacheRead:  0.20,
    cacheWrite: 5.00,
    output:    20.00,
  },
  'claude-sonnet-5-5': {
    label: 'Sonnet 5.5',
    input:      2.00,
    cacheRead:  0.10,
    cacheWrite: 2.50,
    output:    10.00,
  },
  'claude-opus-5': {
    label: 'Opus 5',
    input:      5.00,
    cacheRead:  0.50,
    cacheWrite: 6.25,
    output:    25.00,
  },
  // $2 / $10, not the $3 / $15 this card used to say: the rise scheduled for
  // 2026-09-01 was cancelled and the launch price became standard (pricing
  // page, read 2026-10-18). Research runs from 09-21 to 10-13 were recorded at
  // the old card, about 1.5× what they really cost.
  'claude-sonnet-5': {
    label: 'Sonnet 5',
    input:      2.00,
    cacheRead:  0.20,
    cacheWrite: 2.50,
    output:    10.00,
  },
}

export const DEFAULT_MODEL = 'claude-sonnet-5-5'

// ─── Jobs → models ─────────────────────────────────────────────────────────
// Named by what the call is FOR, never by which model it wants. A caller that
// says `modelFor('synthesise')` keeps working when the mapping changes; one
// that hardcodes 'claude-opus-5-5' does not, and there is no way to find every
// such caller later except by grepping and hoping.
//
// Opus where a person acts on the output and a wrong answer costs real work.
// Sonnet everywhere else — the long middle of a run, where the job is reading
// and shaping rather than judging. Haiku for the chat's easy questions and the
// small jobs around the chat (sorting a question, summarising a thread).
export const JOBS = {
  // ── Opus: the output someone acts on ──
  plan:        'claude-opus-5-5',   // decides what the whole run chases
  synthesise:  'claude-opus-5-5',   // writes the brief people read
  // The chat's medium and hard questions: advice, strategy, decisions,
  // analysing an attachment, writing something that gets published, and any
  // turn where the person pushed back. Sonnet since 2026-11-02 — the owner's
  // call that Opus is more than the chat needs.
  chat:        'claude-sonnet-5-5',
  // The CEO's weekly one-page brief (2026-10-18). Sonnet since 2026-11-02, by
  // the owner's choice: one writing call a week from facts gathered in code.
  ceo_brief:   'claude-sonnet-5-5',
  review:      'claude-opus-5-5',   // critiquing a draft before it goes out
  // Explaining a screen of numbers in three sentences. Small in tokens and
  // large in consequence: it is the first thing read on the page, it sits
  // directly above the figures it describes, and it is read by someone who
  // will not check it. Judgement about what matters this month is the whole
  // job, so it goes where judgement goes. Measured at $0.023 a press against
  // the real payload on 2026-09-20 — Sonnet would save a cent and buy a
  // worse first paragraph.
  explain:     'claude-opus-5-5',
  // Drafting an email that goes to customers or prospects under the company's
  // name. A person edits it, but the draft sets the tone they start from, and
  // three options a person would not send cost more in rewriting than the
  // model saves. A few calls a week.
  email:       'claude-opus-5-5',

  // ── Sonnet: the long middle ──
  search:      'claude-sonnet-5-5', // the bounded read-and-gather loop
  reflect:     'claude-sonnet-5-5', // what is still unanswered
  extract:     'claude-sonnet-5-5', // pulling shaped data out of fetched pages
  title:       'claude-haiku-5-5',  // naming a chat thread
  revise:      'claude-sonnet-5-5', // rewording one post idea on a person's instruction
  // The Monday email drafts (server/agentHandlers/emailWeekly.js). Sonnet by
  // choice: three options a person picks from and edits, once a week, from a
  // context that is already curated down to what matters. The on-demand
  // "Write with AI" in the composer stays on Opus (`email`).
  email_weekly: 'claude-sonnet-5-5',
  // Compacting the agent's memory. Sonnet rather than a third, cheaper tier:
  // this runs roughly ten times a month, so the saving would be pennies, and
  // the job is genuinely lossy — deciding what the agent never sees again is
  // not where to buy a quality cliff. See the Haiku note at the top.
  remember:    'claude-sonnet-5-5',
  // Answering a buyer's question with web search, to see whether the company
  // is named (server/agentHandlers/aiAnswers.js). Sonnet on purpose: it is a
  // stand-in for an ordinary assistant's answer, not a judgement anyone acts
  // on directly, and a list of twenty costs a dollar or two on a button.
  ai_check:    'claude-sonnet-5-5',

  // ── Haiku: the chat's easy half ──
  // Numbers, lookups, "what did Instagram do", "assign this", "file it".
  // chatRoute.js decides which questions these are.
  chat_easy:   'claude-haiku-5-5',
  // Sorting a question into easy or hard before it is answered. One tiny call
  // that runs while the thread and brand context load, so it adds no wait.
  chat_route:  'claude-haiku-5-5',
  // Folding a long thread's older turns into a running summary, after the
  // answer has been sent (threadSummary.js). The person never waits on it.
  chat_compact: 'claude-haiku-5-5',
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

/** May this model be asked for the server-side refusal fallback? */
export function supportsFallbacks(model) {
  return MODELS[model]?.fallbacks !== false
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
