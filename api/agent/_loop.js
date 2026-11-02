import { callModel } from './_provider.js'
import { runTool } from './_tools.js'
import { toolDefs, toolsFor } from '../../src/lib/agent/tools.js'
import {
  loopBudget, loopCheck, toolUsesIn, textIn, toolResultBlock, urlsFrom,
} from '../../src/lib/agent/loop.js'

// ─── Running the agent ─────────────────────────────────────────────────────
// The tool loop, shared by every surface. The bounds are in
// src/lib/agent/loop.js as pure functions; this is the part that awaits.
//
// Shape of one pass:
//   call the model → it either answers, or asks for tools
//   → run the tools (workspace-scoped, never with an id the model supplied)
//   → hand the results back → repeat, under a hard cap.

/**
 * Run the agent until it answers or runs out of budget.
 *
 * @param {object} args
 * @param {string} args.workspaceId   VERIFIED. Passed to every tool; never from the model.
 * @param {string} args.job           picks the model via JOBS
 * @param {string} args.surface       chat | run | review — ledger + budget
 * @param {string} args.identity      stable system block
 * @param {string} args.brand         stable system block (buildContext)
 * @param {Array}  args.messages      the conversation so far
 * @param {(t:string)=>void} [args.onText]   token deltas, for streaming
 * @param {(e:object)=>void} [args.onEvent]  loop events, for a progress line
 * @param {object} [args.session]  VERIFIED { userId, chatId, isAdmin } from the
 *                                 endpoint. Handed to every tool call; only the
 *                                 chat passes it, so only the chat can edit.
 */
export async function runAgent({
  workspaceId, job = 'chat', surface = 'chat', stage = '', runId = null, chatId = null,
  identity, brand, messages = [], tools = null, writes = false, web = false, company = false,
  session = {}, onText = null, onEvent = null,
  // Overrides the surface's effort. The chat's easy tier runs Haiku at `low`.
  effort = null,
  // The job to re-ask on when this one's model declines (HTTP 200,
  // stop_reason "refusal"). Haiku has no server-side fallback, so the chat's
  // easy tier passes 'chat' here and a decline is answered on Sonnet instead
  // of reaching the person as an error.
  onDecline = null,
}) {
  const surfaceBudget = loopBudget(surface)
  const budget = effort ? { ...surfaceBudget, effort } : surfaceBudget
  // Back to the surface's own effort if the question moves up to Sonnet.
  let turnEffort = budget.effort
  // Writes are opt-in. A tool the model can see is a tool it will eventually
  // reach for, and an assistant that files a proposal every time it has an
  // opinion is one whose review queue nobody opens.
  // `admin` follows the verified session, not a separate flag a caller could
  // set out of step with it: the belt offered and the gate in runTool read the
  // same value.
  const defs = tools || toolDefs(toolsFor({ writes, web, company, admin: session?.isAdmin === true }))
  const convo = [...messages]

  let turns = 0
  let toolCalls = 0
  let cost = 0
  const usedTools = []
  // Every URL any tool actually returned this turn. The citation allow-list.
  const allowedUrls = new Set()
  const emit = event => { try { onEvent?.(event) } catch { /* never fatal */ } }

  while (true) {
    const check = loopCheck({ turns, toolCalls }, budget)
    if (!check.allowed) {
      // Tell the model it is out of budget and let it answer, rather than
      // cutting the loop and returning a dangling turn. One final call, with
      // no tools offered so it cannot ask for more.
      emit({ type: 'budget', reason: check.reason })
      convo.push({ role: 'user', content: check.reason })
      const last = await callModel({
        workspaceId, job, surface, stage, runId, chatId,
        identity, brand, tools: [], messages: convo,
        maxTokens: budget.maxTokens, effort: turnEffort, onText,
      })
      cost += last.cost || 0
      return {
        ok: last.ok,
        text: last.ok ? textIn(last.response) : '',
        error: last.error || '',
        refused: Boolean(last.refused),
        toolCalls: usedTools, turns, cost, allowedUrls,
        stoppedBy: 'budget',
      }
    }

    turns += 1
    emit({ type: 'turn', turn: turns })

    let out = await callModel({
      workspaceId, job, surface, stage, runId, chatId,
      identity, brand, tools: defs, messages: convo,
      maxTokens: budget.maxTokens, effort: turnEffort, onText,
    })
    cost += out.cost || 0

    // A decline on the cheap model: the rest of this question moves up, once.
    // The thinking blocks Haiku left in `convo` are readable by Sonnet, and a
    // declined turn produced no text worth keeping.
    if (out.declined && onDecline && job !== onDecline) {
      emit({ type: 'escalate', from: job, to: onDecline })
      job = onDecline
      turnEffort = surfaceBudget.effort
      out = await callModel({
        workspaceId, job, surface, stage, runId, chatId,
        identity, brand, tools: defs, messages: convo,
        maxTokens: budget.maxTokens, effort: turnEffort, onText,
      })
      cost += out.cost || 0
    }

    // A refusal is the budget cap talking, and it is the one case where the
    // reason must reach the person verbatim: "the agent did nothing" and "this
    // workspace is out of budget until the 1st" are different problems.
    if (out.refused) {
      return {
        ok: false, text: '', error: out.error, refused: true,
        toolCalls: usedTools, turns, cost, allowedUrls, stoppedBy: 'cap',
      }
    }
    if (!out.ok) {
      return {
        ok: false, text: '', error: out.error, refused: false,
        toolCalls: usedTools, turns, cost, allowedUrls, stoppedBy: 'error',
      }
    }

    const uses = toolUsesIn(out.response)
    if (!uses.length) {
      // The model answered. This is the normal exit.
      return {
        ok: true, text: textIn(out.response), error: '', refused: false,
        toolCalls: usedTools, turns, cost, allowedUrls, stoppedBy: 'answered', job,
      }
    }

    // Preserve the assistant turn verbatim — content blocks and all. Rebuilding
    // it from the text would drop the tool_use blocks the next request has to
    // match its tool_result blocks against.
    convo.push({ role: 'assistant', content: out.response.content })

    // Every tool the model asked for this turn, run at the same time rather
    // than one after another: "how is Instagram doing" asks for posts,
    // analytics and the live account at once, and the person was waiting for
    // each in turn. Results go back in the order they were asked for, all in
    // one user message — splitting them teaches the model to stop asking in
    // parallel.
    for (const use of uses) emit({ type: 'tool', name: use.name, input: use.input })
    toolCalls += uses.length
    const outcomes = await Promise.all(uses.map(async use => {
      // workspaceId comes from the closure — the verified session — and the
      // model's input is only ever read for filters. AGENT.md §2.
      let outcome
      try {
        outcome = await runTool(workspaceId, use.name, use.input, session)
      } catch (err) {
        outcome = { ok: false, error: err?.message || String(err) }
      }
      emit({ type: 'tool_done', name: use.name, ok: outcome.ok })
      return outcome
    }))
    const results = uses.map((use, i) => {
      const outcome = outcomes[i]
      usedTools.push({ name: use.name, input: use.input, ok: outcome.ok, error: outcome.error || '' })
      if (outcome.ok) urlsFrom(outcome.result, allowedUrls)
      return toolResultBlock(use.id, outcome)
    })
    convo.push({ role: 'user', content: results })
  }
}
