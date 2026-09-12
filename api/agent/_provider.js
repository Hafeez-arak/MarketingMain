import Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../../src/lib/agent/models.js'
import { usageRow, normaliseUsage } from '../../src/lib/agent/cost.js'
import { buildRequest } from '../../src/lib/agent/prompt.js'
import { spentInMonth, capDecision, monthKey } from '../../src/lib/agent/budget.js'
import { msLeft, worthStarting } from '../../src/lib/agent/phases.js'
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

  const abort = new AbortController()
  const timer = remaining === null
    ? null
    : setTimeout(() => { timedOut = true; abort.abort() }, remaining)

  try {
    // Streamed even when the caller does not consume events: a long tool-loop
    // turn with a large max_tokens can otherwise exceed the SDK's HTTP timeout,
    // and a timeout here bills for the generation and returns nothing.
    const stream = client.messages.stream(params, { signal: abort.signal })

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

    response = await stream.finalMessage()
  } catch (err) {
    // An abort is OUR decision, not a fault, and it must not be reported as
    // one — "the openings lens crashed" and "the openings lens ran out of
    // time" send a reader looking in completely different places.
    error = timedOut
      ? `Stopped at the time budget after ${Math.round((remaining || 0) / 1000)}s. It did not finish, which is not the same as finding nothing.`
      : (err?.message || String(err))
  } finally {
    if (timer) clearTimeout(timer)
  }

  // ── The ledger, written on BOTH paths ──
  // A failed call that burned tokens still spent money. Writing only on
  // success is how a ledger comes to disagree with an invoice in exactly the
  // week something is going wrong.
  const usage = normaliseUsage(response?.usage)
  const row = usageRow({
    workspaceId, surface, stage, runId, chatId,
    model, usage: response?.usage || {}, error,
  })
  try {
    await db('agent_usage', { method: 'POST', body: row, prefer: 'return=minimal' })
  } catch (ledgerErr) {
    // A ledger write must never take down the answer the user is waiting for.
    // It is logged loudly instead — an agent running with a blind ledger is a
    // real problem, just not this request's problem.
    console.error('[agent] ledger write failed:', ledgerErr.message)
  }

  // `timedOut` travels with the failure so callers can tell "stopped by us" from
  // "broke". The ledger row above is still written either way: a generation we
  // aborted was still partly paid for, and a ledger that only counts successes
  // disagrees with the invoice in exactly the week something is going wrong.
  if (error) return { ok: false, error, usage, cost: row.cost_usd, timedOut }
  return { ok: true, response, usage, cost: row.cost_usd, budget: decision }
}
