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
  //
  // ── EMPTY BLOCKS ARE DROPPED, NOT SENT ──
  //
  // The API rejects the whole request with
  //   400 "cache_control cannot be set for empty text blocks"
  // and `brand` is legitimately '' for calls that are ABOUT the agent rather
  // than about the market — compact_memory is the one that matters, since it
  // decides what the agent never sees again.
  //
  // Every compact_memory call this app has ever made failed this way: 3 of 3,
  // on 2026-09-14 and 09-15, all 400s. Compaction only runs once the digest is
  // already dropping notes, so the one job that exists to stop memory being
  // lost could not run at exactly the moment it was needed, and the failure
  // was invisible because a compaction that never happens looks like a
  // compaction that was not needed.
  //
  // So: drop empty blocks, and put the breakpoint on the last block that
  // actually survives. A single-block system prompt still caches.
  const system = [
    { type: 'text', text: identity },
    { type: 'text', text: brand },
  ].filter(b => String(b.text || '').trim())

  if (system.length) {
    system[system.length - 1].cache_control = { type: 'ephemeral' }
  }

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
    // The conversation carries its own breakpoints — see
    // withConversationCache. Everything before it is stable; this is the
    // part that grows, and it grew uncached until 2026-09-17.
    messages: withConversationCache(messages),
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

// ─── Caching the conversation, not just the prefix ─────────────────────────
// The stable prefix above (tools → system) is only half the bill. The other
// half is the conversation, and until now it was re-billed in full on every
// pass of the tool loop: turn six re-sent five turns of tool results — search
// snippets, whole pages of scraped markdown — at the uncached input price,
// every time, because nothing after the system blocks carried a breakpoint.
//
// The fix is the standard incremental pattern: a breakpoint on the end of the
// conversation so THIS request's prefix is written, and a second one on the
// position the PREVIOUS request ended at so that prefix is read back. Two
// breakpoints, not one, because the automatic lookback that finds a hit near
// an explicit breakpoint spans a bounded number of blocks, and one loop turn
// with several parallel tool calls can push a dozen blocks on its own.
//
// What it refuses to mark is as deliberate as what it marks: thinking blocks,
// empty text, and one-shot calls that have no next turn to pay a write back.

/** Blocks that must never carry the breakpoint. */
const NEVER_CACHEABLE = new Set(['thinking', 'redacted_thinking'])

/**
 * The last block of a message that can carry `cache_control`.
 *
 * (1) Thinking blocks are skipped — they are replayed verbatim with their
 * signatures and are not ours to annotate. (2) Empty text blocks are skipped
 * for the same reason the system blocks are dropped when empty: the API
 * answers 400 "cache_control cannot be set for empty text blocks" and takes
 * the whole request with it.
 *
 * @returns {number} index, or -1 if the message has nothing markable
 */
function cacheableBlockIndex(content) {
  if (!Array.isArray(content)) return -1
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const block = content[i]
    if (!block || typeof block !== 'object') continue
    if (NEVER_CACHEABLE.has(block.type)) continue
    if (block.type === 'text' && !String(block.text || '').trim()) continue
    return i
  }
  return -1
}

/** A copy of `message` with the breakpoint on its last eligible block, or null. */
function withCacheOn(message) {
  const content = message?.content
  if (typeof content === 'string') {
    if (!content.trim()) return null
    // A bare string and a single text block are the same request to the API,
    // and only one of the two has somewhere to hang a breakpoint.
    return { ...message, content: [{ type: 'text', text: content, cache_control: { type: 'ephemeral' } }] }
  }
  const i = cacheableBlockIndex(content)
  if (i < 0) return null
  return {
    ...message,
    content: content.map((block, j) => (
      j === i ? { ...block, cache_control: { type: 'ephemeral' } } : block
    )),
  }
}

/** Drop every breakpoint a caller left on the conversation. */
function stripped(messages) {
  return messages.map(m => {
    if (!Array.isArray(m?.content) || !m.content.some(b => b?.cache_control)) return m
    return {
      ...m,
      content: m.content.map(block => {
        if (!block?.cache_control) return block
        const copy = { ...block }
        delete copy.cache_control
        return copy
      }),
    }
  })
}

/**
 * Place the conversation's cache breakpoints.
 *
 * Returns a NEW array and never mutates the one it was given — the tool loop
 * keeps appending to a single `convo` across passes, and a breakpoint written
 * into it in place would accumulate one per turn until the request crossed the
 * four-breakpoint limit and started failing outright.
 *
 * @param {Array} messages
 * @returns {Array}
 */
export function withConversationCache(messages = []) {
  const n = messages.length

  // A single-message call — every lens, synthesis, resolve, compact_memory —
  // is asked once and never followed up. Marking it would write a cache entry
  // that nothing ever reads, which is not free: a write costs 1.25× the plain
  // input price. Caching pays only where there is a next turn to pay it back.
  if (n < 3) return messages

  const out = stripped(messages)

  const mark = i => {
    if (i < 0) return false
    const marked = withCacheOn(out[i])
    if (!marked) return false
    out[i] = marked
    return true
  }

  // This request's end: written now, read by the next turn.
  mark(n - 1)

  // The previous request's end, which is where the hit comes from. Both
  // surfaces grow by exactly two messages per exchange — the tool loop pushes
  // an assistant turn and its tool results, chat stores an answer and takes a
  // question — so the previous request ended at n-3.
  //
  // Only user turns are marked. An assistant turn carries thinking blocks that
  // are replayed with their signatures, and the n-3 slot is an assistant turn
  // on exactly one path (the final out-of-budget call, which appends a third
  // message). Stepping back to the user turn behind it costs nothing: a
  // breakpoint is a position to match a prefix at, not a boundary that has to
  // land on a particular turn.
  for (let i = n - 3; i >= 0; i -= 1) {
    if (out[i]?.role !== 'user') continue
    if (mark(i)) break
  }

  return out
}
