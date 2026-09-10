// ─── Request assembly ──────────────────────────────────────────────────────
// Where the caching design in AGENT.md §7 is actually enforced, and the reason
// it is a pure module with its own tests rather than a few lines inside the
// provider call: prompt caching fails SILENTLY. A prefix that stops being
// byte-identical still returns a correct answer, just at roughly ten times the
// price on the prefix, and nothing in the response says so. The only way to
// know is to assert the arrangement here and the cache counters there.
//
// The rule, in one line: the request renders as tools → system → messages, so
// everything stable goes first and everything volatile goes last.

/**
 * Anything that changes per request must NOT appear before the last cache
 * breakpoint. This is the list of things that have historically been dropped
 * into a system prompt without thinking — a timestamp, a request id, a "today
 * is" line — each of which invalidates the entire cached prefix on every call.
 */
const VOLATILE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,          // an ISO timestamp with a time in it
  /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-){1}/i,       // a uuid prefix — request/run ids
  /\bDate\.now\(\)/,                           // the literal mistake, if templated in
]

/**
 * Does this text look like it will break the cache if used as a stable prefix?
 * Returns the offending match so a test failure names what to remove.
 *
 * A plain date with no time ("2026-09-09") is deliberately NOT flagged: it is
 * stable for a whole day, which for a weekly run and a chat session is stable
 * enough to be worth the freshness.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function volatileFragment(text) {
  const s = String(text || '')
  for (const re of VOLATILE_PATTERNS) {
    const m = s.match(re)
    if (m) return m[0]
  }
  return null
}

/**
 * Build the message-creation params for one agent call.
 *
 * @param {object} args
 * @param {string} args.model
 * @param {string} args.identity   the stable part: who the agent is, the rules it follows
 * @param {string} args.brand      the stable part: this workspace's brand context (buildContext)
 * @param {Array}  args.tools      tool definitions — stable, and ORDER MATTERS
 * @param {Array}  args.messages   the conversation; volatile content lives here
 * @param {number} args.maxTokens
 * @param {string} args.effort     low | medium | high
 */
export function buildRequest({
  model, identity, brand, tools = [], messages = [], maxTokens = 8_000, effort = 'high',
  outputFormat = null,
}) {
  // Two system blocks, one breakpoint, and the breakpoint on the LAST stable
  // block rather than the first. Caching is a prefix match: marking the end of
  // the stable region caches everything up to it, whereas marking the middle
  // would leave the brand context re-billed on every call.
  const system = [
    { type: 'text', text: identity },
    { type: 'text', text: brand, cache_control: { type: 'ephemeral' } },
  ]

  return {
    model,
    max_tokens: maxTokens,
    // Adaptive thinking with an effort dial, rather than a fixed token budget:
    // the budget form is rejected outright by the models this app uses.
    thinking: { type: 'adaptive' },
    // `format` sits INSIDE output_config alongside effort — the top-level
    // `output_format` parameter is deprecated. Present only when a caller asks
    // for it: an empty `format` key would change the bytes of every request and
    // is one more thing that can be wrong.
    output_config: outputFormat ? { effort, format: outputFormat } : { effort },
    system,
    // Tools are sorted by name so that a refactor which merely reorders the
    // tool belt cannot silently invalidate every cached prefix in production.
    // They render BEFORE system, so their order is part of the cache key.
    tools: [...tools].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    messages,
  }
}

/**
 * The per-turn context descriptor from the page (AGENT.md §5a), rendered as
 * the volatile tail of a user turn — never into the system prompt, which is
 * the whole point.
 *
 * Kept narrow on purpose: a route, an entity type and an id. The agent fetches
 * what it needs through tools. The composer is the one exception (§5b) and
 * passes `draft`, because an unsaved post has no id to fetch by.
 */
export function contextPreamble(context) {
  if (!context) return ''
  const { route = '', entity = '', id = '', draft = null } = context
  const lines = []
  if (route) lines.push(`The person is on ${route}.`)
  if (entity && id) lines.push(`They are looking at ${entity} ${id}.`)
  if (draft) {
    lines.push('They are composing this draft (not saved yet):')
    lines.push(JSON.stringify({
      platform: draft.platform || '',
      format: draft.format || '',
      caption: draft.caption || '',
      media_count: Array.isArray(draft.media) ? draft.media.length : 0,
    }, null, 2))
  }
  return lines.join('\n')
}
