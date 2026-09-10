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
 */
export async function runAgent({
  workspaceId, job = 'chat', surface = 'chat', stage = '', runId = null, chatId = null,
  identity, brand, messages = [], tools = null, writes = false, web = false,
  onText = null, onEvent = null,
}) {
  const budget = loopBudget(surface)
  // Writes are opt-in. A tool the model can see is a tool it will eventually
  // reach for, and an assistant that files a proposal every time it has an
  // opinion is one whose review queue nobody opens.
  const defs = tools || toolDefs(toolsFor({ writes, web }))
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
        maxTokens: budget.maxTokens, effort: budget.effort, onText,
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

    const out = await callModel({
      workspaceId, job, surface, stage, runId, chatId,
      identity, brand, tools: defs, messages: convo,
      maxTokens: budget.maxTokens, effort: budget.effort, onText,
    })
    cost += out.cost || 0

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
        toolCalls: usedTools, turns, cost, allowedUrls, stoppedBy: 'answered',
      }
    }

    // Preserve the assistant turn verbatim — content blocks and all. Rebuilding
    // it from the text would drop the tool_use blocks the next request has to
    // match its tool_result blocks against.
    convo.push({ role: 'assistant', content: out.response.content })

    const results = []
    for (const use of uses) {
      toolCalls += 1
      emit({ type: 'tool', name: use.name, input: use.input })
      // workspaceId comes from the closure — the verified session — and the
      // model's input is only ever read for filters. AGENT.md §2.
      const outcome = await runTool(workspaceId, use.name, use.input)
      usedTools.push({ name: use.name, input: use.input, ok: outcome.ok, error: outcome.error || '' })
      if (outcome.ok) urlsFrom(outcome.result, allowedUrls)
      results.push(toolResultBlock(use.id, outcome))
      emit({ type: 'tool_done', name: use.name, ok: outcome.ok })
    }
    convo.push({ role: 'user', content: results })
  }
}
