// ─── The bounded loop ──────────────────────────────────────────────────────
// AGENT.md §7 names an unbounded loop as the only genuine runaway risk in this
// design, so the bounds live here as pure functions with their own tests
// rather than as a `for` condition buried in an endpoint.
//
// Two separate limits, because they fail differently:
//
//   maxTurns      — how many times the model may be called. Each turn costs a
//                   full prompt, so this is what bounds the BILL.
//   maxToolCalls  — how many tools may be executed in total. Free reads are
//                   cheap but not free of latency, and a model that fetches
//                   the same table forty ways is one the person is waiting on.
//
// A cap that is hit is not an error. The model gets told it has run out and is
// asked to answer with what it has, which produces a useful partial answer
// instead of a truncated one.

/**
 * The budget for one invocation, by surface.
 *
 * Chat is deliberately tight: AGENT.md §5 budgets two or three tool calls and
 * a couple of cents for a question like "why did this flop?", and the value of
 * a chat answer decays with how long the person waits for it. The research run
 * gets room because it is asynchronous and nobody is watching it.
 */
export const BUDGETS = {
  chat:   { maxTurns: 6,  maxToolCalls: 10, maxTokens: 4_000,  effort: 'medium' },
  // Reviewing a draft reads a handful of things — the draft, the active rules,
  // our numbers for that format — and then answers. Same shape as chat.
  review: { maxTurns: 6,  maxToolCalls: 10, maxTokens: 4_000,  effort: 'high' },
  // The search stage of a run: the only genuinely agentic part, and the one
  // that has to be held on a short rope precisely because it is the one that
  // could bill all afternoon.
  search: { maxTurns: 8,  maxToolCalls: 16, maxTokens: 8_000,  effort: 'medium' },
  plan:   { maxTurns: 2,  maxToolCalls: 6,  maxTokens: 4_000,  effort: 'high' },
  synthesise: { maxTurns: 1, maxToolCalls: 0, maxTokens: 12_000, effort: 'high' },
}

export const DEFAULT_BUDGET = BUDGETS.chat

/**
 * The budget for a surface. Unknown surfaces get the tightest one, not the
 * loosest.
 *
 * Named loopBudget, not budgetFor, because _provider.js already exports a
 * budgetFor(workspaceId) that answers an entirely different question — what
 * this workspace has SPENT against its monthly cap. Two functions a letter
 * apart, both about "budget", one taking a workspace and one a surface, is a
 * mix-up waiting to happen in a file that imports both.
 */
export function loopBudget(surface) {
  return BUDGETS[surface] || DEFAULT_BUDGET
}

/**
 * May the loop run another turn?
 *
 * Returns a reason when it may not, so the caller can tell the model WHY it is
 * being stopped. "You have used your tool budget, answer with what you have"
 * gets a usable answer; silently cutting the loop gets a dangling one.
 *
 * @param {object} state
 * @param {number} state.turns      model calls made so far
 * @param {number} state.toolCalls  tools executed so far
 * @param {object} budget           from budgetFor()
 */
export function loopCheck({ turns = 0, toolCalls = 0 } = {}, budget = DEFAULT_BUDGET) {
  if (turns >= budget.maxTurns) {
    return {
      allowed: false,
      reason: `You have used all ${budget.maxTurns} of your turns for this question. ` +
              `Answer now with what you already have, and say plainly what you could not check.`,
    }
  }
  if (toolCalls >= budget.maxToolCalls) {
    return {
      allowed: false,
      reason: `You have used all ${budget.maxToolCalls} of your tool calls for this question. ` +
              `Answer now with what you already have, and say plainly what you could not check.`,
    }
  }
  return { allowed: true, reason: '' }
}

/**
 * The tool_use blocks in a model response, normalised.
 *
 * Anything that is not a tool_use block is ignored rather than trusted: the
 * response shape is the provider's, and a new block type appearing should not
 * be read as a tool call.
 */
export function toolUsesIn(response) {
  const content = Array.isArray(response?.content) ? response.content : []
  return content
    .filter(block => block?.type === 'tool_use')
    .map(block => ({ id: block.id, name: block.name, input: block.input || {} }))
}

/** The plain text the model produced in this response, joined. */
export function textIn(response) {
  const content = Array.isArray(response?.content) ? response.content : []
  return content
    .filter(block => block?.type === 'text')
    .map(block => block.text || '')
    .join('')
    .trim()
}

/**
 * A tool result, in the shape the next request expects.
 *
 * A FAILED tool comes back as a tool_result with is_error, NOT as a thrown
 * exception. The model can recover from "that table was empty" or "no such
 * tool" by asking differently; it cannot recover from the turn ending, and the
 * person is still owed an answer. The failure text is passed through verbatim
 * so the model can tell a missing row from a broken query.
 */
export function toolResultBlock(toolUseId, outcome) {
  const ok = outcome?.ok !== false
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    is_error: !ok,
    content: ok
      ? JSON.stringify(outcome?.result ?? {})
      : String(outcome?.error || 'The tool failed for an unknown reason.'),
  }
}

/**
 * Which URLs a turn's tool results actually returned.
 *
 * This is the citation allow-list. RESEARCH-AGENT.md's rule is that citations
 * are checked, not trusted: the model's claimed sources are filtered against
 * the URLs the tools really produced, because a plausible-looking URL a model
 * invented is worse than no citation at all — it survives a skim.
 */
export function urlsFrom(value, found = new Set()) {
  if (!value) return found
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) found.add(value)
    return found
  }
  if (Array.isArray(value)) {
    for (const item of value) urlsFrom(item, found)
    return found
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) urlsFrom(item, found)
  }
  return found
}

/**
 * Keep only the sources that appeared in something a tool returned.
 *
 * A finding that loses all of its sources is labelled uncited rather than
 * dropped — it may still be true and a person can judge it. That asymmetry is
 * deliberate and it is the write side that is strict: a proposed RULE which
 * loses its sources is dropped silently, because a rule steers every future
 * caption this brand generates.
 */
export function checkCitations(claimed, allowed) {
  const list = Array.isArray(claimed) ? claimed : []
  const ok = list.filter(s => allowed.has(typeof s === 'string' ? s : s?.url))
  return { sources: ok, uncited: ok.length === 0 && list.length > 0 }
}

/**
 * Every URL the SERVER-SIDE tools actually returned, across a whole response.
 *
 * The same allow-list as urlsFrom, one level up: server tools execute inside
 * the API, so their results arrive as content blocks rather than as our own
 * tool results. Lives here rather than beside either caller because both the
 * lens runner and the synthesiser need it, and importing one from the other
 * makes a cycle.
 *
 * Server-tool errors do not throw — they come back as a result block whose
 * content is an error OBJECT rather than a list — so this walks the structure
 * and picks up anything URL-shaped instead of assuming a shape.
 */
export function urlsFromResponse(response, found = new Set()) {
  for (const block of response?.content || []) {
    if (block?.type === 'web_search_tool_result' || block?.type === 'web_fetch_tool_result') {
      urlsFrom(block.content, found)
    }
  }
  return found
}
