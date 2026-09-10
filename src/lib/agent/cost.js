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
