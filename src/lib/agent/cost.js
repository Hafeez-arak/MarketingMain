// Extension included, and it matters. Vite resolves './models' happily; Node
// does not, and these modules are imported by the Vercel functions under
// api/agent/ as well as by the browser. A missing '.js' here fails only on
// the server, and only at request time.
import { priceOf } from './models.js'

// ─── What a call cost ──────────────────────────────────────────────────────
// Pure arithmetic over a usage object, kept separate from anything that talks
// to a provider so it can be tested without a network or a key — the same
// reason the research stages were built as pure functions over stubbed HTTP.

/**
 * Normalise a provider usage block into the four numbers we bill on.
 *
 * The Anthropic shape is the one this app already speaks, and its cached
 * tokens are reported SEPARATELY from `input_tokens` rather than included in
 * it. Getting that backwards would double-count every cached read and make
 * caching look like it was costing money instead of saving it.
 *
 * Tolerant of missing fields on purpose: a provider that omits cache counters
 * entirely should read as zero cached tokens, not as NaN propagating into a
 * cost and from there into a spend cap.
 *
 * @param {object} usage raw `response.usage`
 */
export function normaliseUsage(usage = {}) {
  const n = v => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0)
  return {
    tokens_in:          n(usage.input_tokens),
    tokens_cache_read:  n(usage.cache_read_input_tokens),
    tokens_cache_write: n(usage.cache_creation_input_tokens),
    tokens_out:         n(usage.output_tokens),
    // The second real cost of a run, and the only one that was invisible.
    // Every lens declares a search budget and nothing confirmed what it spent,
    // so a lens burning its whole allowance to answer nothing — which is what
    // `openings` did on 2026-09-12 — looked identical on the ledger to one
    // that found its answer in two.
    searches:           n(usage.server_tool_use?.web_search_requests),
  }
}

/**
 * Cost in USD for one call. Returns null for a model we have no price for —
 * see priceOf(). Callers must treat null as "unknown", never as zero.
 *
 * @param {string} model
 * @param {{tokens_in:number,tokens_cache_read:number,tokens_cache_write:number,tokens_out:number}} usage
 * @returns {number|null}
 */
export function costOf(model, usage) {
  const price = priceOf(model)
  if (!price) return null
  const u = usage || {}
  const per = 1_000_000
  return (
    ((u.tokens_in          || 0) * price.input      +
     (u.tokens_cache_read  || 0) * price.cacheRead  +
     (u.tokens_cache_write || 0) * price.cacheWrite +
     (u.tokens_out         || 0) * price.output) / per
  )
}

/**
 * One ledger row, ready to insert into agent_usage.
 *
 * `error` is carried through because a call that failed after burning tokens
 * still spent money, and a ledger that only records successes will disagree
 * with the invoice in exactly the week something is going wrong.
 */
export function usageRow({ workspaceId, surface, stage = '', runId = null, chatId = null, model, usage, error = '' }) {
  const tokens = normaliseUsage(usage)
  const cost = costOf(model, tokens)
  return {
    workspace_id: workspaceId,
    surface,
    stage,
    run_id: runId,
    chat_id: chatId,
    model,
    ...tokens,
    // An unknown model records 0 and is findable by its model string. The
    // alternative — refusing to write the row — would lose the token counts
    // as well as the cost, which is strictly worse.
    cost_usd: cost === null ? 0 : cost,
    error,
  }
}

/**
 * Did the cache actually work? Exposed as its own function because it is the
 * assertion the tests make (AGENT.md §7): a stable prefix that stops being
 * byte-identical — one `Date.now()` in a system prompt is enough — degrades
 * silently, costs ~10× on the prefix, and shows up nowhere except the bill.
 */
export function cacheHitRate(usage) {
  const u = normaliseUsage(usage)
  const prefix = u.tokens_in + u.tokens_cache_read
  if (prefix === 0) return 0
  return u.tokens_cache_read / prefix
}

/**
 * Roll every ledger row for one run up into the summary columns on
 * `research_runs`.
 *
 * Those columns — tokens_in, tokens_out, model — have existed since the table
 * did and nothing ever wrote them, so every completed run reports 0 tokens
 * against a real bill. `agent_usage` is the authority and has the true
 * figures per call; this is the arithmetic that gets them onto the run.
 *
 * `model` is the most expensive model the run actually used, not the last one
 * or the first. A run is Sonnet for its lenses and Opus for synthesis, and
 * naming Sonnet would make the cost look inexplicable to anyone reading the
 * row later.
 *
 * `searches` comes from the ledger too, now that agent_usage has somewhere to
 * keep it (20260913_agent_usage_searches.sql). Rows written before that
 * migration carry 0, which is honest for them — nobody was counting.
 */
export function runTotals(rows = [], { rank = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'] } = {}) {
  const list = (rows || []).filter(Boolean)
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

  let model = ''
  let bestRank = Infinity
  for (const r of list) {
    const i = rank.indexOf(r.model)
    // An unknown model still beats no model at all, but never outranks a
    // known one — a typo in the ledger should not rename the run.
    const score = i === -1 ? rank.length : i
    if (r.model && score < bestRank) { bestRank = score; model = r.model }
  }

  return {
    calls: list.length,
    tokens_in: list.reduce((n, r) => n + num(r.tokens_in) + num(r.tokens_cache_read) + num(r.tokens_cache_write), 0),
    tokens_out: list.reduce((n, r) => n + num(r.tokens_out), 0),
    cost_usd: Number(list.reduce((n, r) => n + num(r.cost_usd), 0).toFixed(4)),
    searches: list.reduce((n, r) => n + num(r.searches), 0),
    model,
  }
}
