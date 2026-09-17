import Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../../src/lib/agent/models.js'
import { usageRow, normaliseUsage } from '../../src/lib/agent/cost.js'
import { buildRequest } from '../../src/lib/agent/prompt.js'
import { spentInMonth, capDecision, monthKey } from '../../src/lib/agent/budget.js'
import { msLeft, worthStarting } from '../../src/lib/agent/phases.js'
import {
  turnOutcome, exhaustedMessage, refusalMessage, MAX_CONTINUATIONS,
} from '../../src/lib/agent/turnOutcome.js'
import { db } from './_supabase.js'

// ─── The one place a model is actually called ──────────────────────────────
// Every agent call in this codebase goes through callModel(). That is what
// makes the ledger complete: a second call path would be spend nobody can see,
// and a cap that can be bypassed by writing a new file is not a cap.
//
// The seam is deliberate (AGENT.md §7). Swapping a job to a different model —
// or this whole function to a different provider — should not require touching
// a single caller.

const KEY = process.env.ANTHROPIC_API_KEY || ''
const client = KEY ? new Anthropic({ apiKey: KEY }) : null

/**
 * What this workspace has spent this calendar month, and its ceiling.
 *
 * The ledger is filtered by month in the query as well as in spentInMonth():
 * the query keeps the response small, the function is what a test and a
 * support question run against a dump.
 */
export async function budgetFor(workspaceId, now = new Date()) {
  const since = `${monthKey(now)}-01T00:00:00Z`
  const [rows, workspaces] = await Promise.all([
    db(`agent_usage?workspace_id=eq.${workspaceId}&created_at=gte.${since}&select=cost_usd,created_at`),
    db(`workspaces?id=eq.${workspaceId}&select=agent_monthly_cap_usd`),
  ])
  const cap = workspaces?.[0]?.agent_monthly_cap_usd
  return {
    spent: spentInMonth(rows || [], now),
    cap: cap === null || cap === undefined ? null : Number(cap),
  }
}

/**
 * Call a model on behalf of a workspace, with the cap enforced and the ledger
 * written.
 *
 * Returns { ok, response, usage, cost, refused }.
 *
 * @param {object} args
 * @param {string} args.workspaceId  from the VERIFIED session, never from a model
 * @param {string} args.job          a key in JOBS — decides the model
 * @param {string} args.surface      run | chat | review — for the ledger
 * @param {(text:string)=>void} [args.onText]  called with each text delta
 */
export async function callModel({
  workspaceId, job, surface, stage = '', runId = null, chatId = null,
  identity, brand, tools = [], messages = [], maxTokens = 8_000, effort = 'high',
  estimateUsd = 0, onText = null, outputFormat = null,
  // Absolute wall-clock deadline (epoch ms). Past it, the generation is
  // aborted and reported as a timeout.
  //
  // This exists because the project runs on Vercel Hobby, where the function
  // ceiling is 300s and CANNOT be raised, and a single lens was measured at
  // 380s twice. Without a deadline the platform kills the whole invocation
  // instead — writing no status, no error and no ledger row, leaving a spinner
  // that never closes. Stopping ourselves is strictly better than being
  // stopped, because we can still report what happened.
  deadline = null,
}) {
  if (!client) {
    // Named, not swallowed. A missing key here previously looked exactly like
    // "the feature silently does nothing", which cost this project a day once
    // already with the n8n webhook secret.
    return { ok: false, refused: true, error: 'ANTHROPIC_API_KEY is not set on this deployment, so the agent cannot run.' }
  }

  const model = modelFor(job)

  // ── The cap, checked BEFORE the call ──
  // Checked before rather than after because a refusal after the fact has
  // already been paid for.
  const { spent, cap } = await budgetFor(workspaceId)
  const decision = capDecision({ cap, spent, estimate: estimateUsd })
  if (!decision.allowed) {
    return { ok: false, refused: true, error: decision.reason, budget: decision }
  }

  const params = buildRequest({ model, identity, brand, tools, messages, maxTokens, effort, outputFormat })

  let response = null
  let error = ''
  let timedOut = false
  // Every turn this call made, so a resumed generation reports all of its
  // sources rather than only the last leg's. See the pause_turn loop below.
  const allContent = []
  let totalCost = 0
  let continuations = 0

  // The deadline, as an abort signal the SDK understands. Checked before the
  // call as well: starting a generation with four seconds left buys an aborted
  // one that still bills for its tokens.
  const remaining = deadline ? msLeft(deadline) : null
  if (remaining !== null && !worthStarting(deadline)) {
    return {
      ok: false,
      timedOut: true,
      error: 'Not enough time left in this invocation to start the call, so it was not started.',
      cost: 0,
      usage: normaliseUsage(null),
    }
  }

  // ── ONE leg of the call ──
  // Its own abort timer, recomputed from the deadline each time, because a
  // resumed turn starts later than the first one did and must not inherit a
  // budget that has already been spent.
  const oneTurn = async turnParams => {
    const left = deadline ? msLeft(deadline) : null
    if (left !== null && !worthStarting(deadline)) {
      timedOut = true
      return { error: 'Ran out of time before this leg of the call could start.' }
    }
    const abort = new AbortController()
    const timer = left === null
      ? null
      : setTimeout(() => { timedOut = true; abort.abort() }, left)
    try {
      // Streamed even when the caller does not consume events: a long tool-loop
      // turn with a large max_tokens can otherwise exceed the SDK's HTTP timeout,
      // and a timeout here bills for the generation and returns nothing.
      const stream = client.messages.stream(turnParams, { signal: abort.signal })

      // The chat surface passes onText so the browser can type the answer out as
      // it arrives. Everything else ignores it and waits for the final message —
      // which is why this stays ONE function rather than growing a streaming
      // twin. A second call path would be spend nobody can see, and a cap that
      // can be bypassed by writing a new file is not a cap.
      if (typeof onText === 'function') {
        stream.on('text', delta => {
          // A throw inside a consumer's handler must not abort a generation that
          // is already being paid for. The answer still lands in finalMessage()
          // and still gets persisted; only the live typing stops.
          try { onText(delta) } catch (err) {
            console.error('[agent] onText handler threw:', err?.message || err)
          }
        })
      }

      return { response: await stream.finalMessage() }
    } catch (err) {
      // An abort is OUR decision, not a fault, and it must not be reported as
      // one — "the openings lens crashed" and "the openings lens ran out of
      // time" send a reader looking in completely different places.
      return {
        error: timedOut
          ? `Stopped at the time budget after ${Math.round((left || 0) / 1000)}s. It did not finish, which is not the same as finding nothing.`
          : (err?.message || String(err)),
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  // ── The ledger, written on BOTH paths and on EVERY leg ──
  // A failed call that burned tokens still spent money. Writing only on
  // success is how a ledger comes to disagree with an invoice in exactly the
  // week something is going wrong — and a resumed turn is a second billable
  // request, so it gets its own row rather than being folded into the first.
  const bill = async legResponse => {
    const row = usageRow({
      workspaceId, surface, stage, runId, chatId,
      model, usage: legResponse?.usage || {}, error,
    })
    totalCost += row.cost_usd || 0
    try {
      await db('agent_usage', { method: 'POST', body: row, prefer: 'return=minimal' })
    } catch (ledgerErr) {
      // A ledger write must never take down the answer the user is waiting for.
      // It is logged loudly instead — an agent running with a blind ledger is a
      // real problem, just not this request's problem.
      console.error('[agent] ledger write failed:', ledgerErr.message)
    }
    return row
  }

  // ── pause_turn: the silence that cost us three lenses ──
  //
  // When a turn uses server-side tools, the API runs its own sampling loop. On
  // reaching that loop's iteration limit it returns `stop_reason: "pause_turn"`
  // — the work is UNFINISHED and is meant to be continued by sending the turn
  // back. Nothing here read stop_reason at all, so a paused turn was recorded
  // as a completed one and whatever partial output existed was parsed as the
  // final answer.
  //
  // Resuming needs no extra user message: the API sees the trailing
  // server_tool_use block and picks up where it stopped. Bounded, because a
  // resume loop with no ceiling is how one lens quietly bills for nine.
  let leg = await oneTurn(params)
  if (leg.response) { allContent.push(...(leg.response.content || [])) }
  error = leg.error || ''
  await bill(leg.response)
  response = leg.response

  while (!error && turnOutcome(response?.stop_reason, { continuations }).resume) {
    continuations += 1
    leg = await oneTurn(buildRequest({
      model, identity, brand, tools, maxTokens, effort, outputFormat,
      messages: [...messages, { role: 'assistant', content: response.content }],
    }))
    if (leg.error) {
      // Out of time or a broken leg. What earlier legs established still
      // stands — report it rather than throwing the whole turn away.
      console.error(`[agent] ${stage || surface}: resume ${continuations} failed: ${leg.error}`)
      break
    }
    allContent.push(...(leg.response.content || []))
    await bill(leg.response)
    response = leg.response
  }

  // The turn the caller sees carries EVERY leg's content — sources found
  // before a pause are part of the answer — with the last leg's stop_reason,
  // which is the one that says how the whole turn actually ended.
  if (response && continuations > 0) {
    response = { ...response, content: allContent }
  }

  const usage = normaliseUsage(response?.usage)
  const stopReason = response?.stop_reason || ''

  const outcome = turnOutcome(stopReason, { continuations })

  // Still paused after the ceiling: unfinished, and must not read as complete.
  if (!error && outcome.exhausted) error = exhaustedMessage(MAX_CONTINUATIONS)

  // A refusal is an HTTP 200 with nothing usable in it. `stop_details` is
  // populated only for this stop_reason, so it is read only here.
  if (!error && outcome.refused) {
    return {
      ok: false, refused: true, stopReason, usage, cost: totalCost, budget: decision,
      error: refusalMessage(response?.stop_details),
    }
  }

  // Truncation. Not fatal on its own — a chat answer cut short is still an
  // answer — but a structured-output caller will fail to parse it, and it must
  // be able to say WHY rather than reporting malformed JSON.
  if (outcome.truncated) {
    console.error(`[agent] ${stage || surface}: hit max_tokens (${maxTokens}); output is truncated.`)
  }

  // `timedOut` travels with the failure so callers can tell "stopped by us" from
  // "broke". The ledger rows above are still written either way: a generation we
  // aborted was still partly paid for, and a ledger that only counts successes
  // disagrees with the invoice in exactly the week something is going wrong.
  if (error) return { ok: false, error, usage, cost: totalCost, timedOut, stopReason }
  return {
    ok: true, response, usage, cost: totalCost, budget: decision, stopReason,
    truncated: outcome.truncated,
    continuations,
  }
}
