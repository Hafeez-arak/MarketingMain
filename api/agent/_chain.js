import { patchRun } from './_gather.js'
import { pendingLenses } from '../../src/lib/agent/phases.js'

// ─── A run that drives itself ──────────────────────────────────────────────
//
// A run is three routes: /run (the numbers), one /lens per lens, then
// /synthesise (the brief). Something has to call them in order. Until now that
// something was ONLY the n8n workflow in n8n/agentRun.workflow.json, and that
// workflow starts from its Monday schedule or a click inside n8n — nothing
// else.
//
// So the Run button in the app, which calls /run directly, started a run that
// nobody would ever finish. Run a1cf0bf9 on 2026-09-14 is the case: stage 0
// committed at 14:54, the row said `stage: lenses`, and it sat there for hours
// with zero lens results, because no driver existed for it.
//
// Now each step starts the next one itself, server to server:
//
//   /run  → first lens → next lens → … → last lens → /synthesise
//
// n8n's Monday run still drives its own lenses (it sends trigger 'scheduled'
// and is left alone), so nothing runs twice.
//
// ── WHY "DISPATCH" WAITS A FEW SECONDS AND THEN LETS GO ──
//
// A lens takes minutes. The step that started it cannot wait for it: every
// invocation lives under the same 300s ceiling, and a chain of waits would add
// up past it. So the request is sent, given a few seconds to be refused
// outright (a 401, a 409, a bad deploy), and then abandoned. Vercel does not
// cancel a function because its caller hung up — that is opt-in, and this
// project does not opt in — which is observed, not assumed: a run driven from
// a browser tab that was reloaded mid-run still had every lens complete
// server-side (2026-09-12).
//
// ── THE RULE ──
//
// A chain that breaks must say so. If the next step cannot be started, the
// run is marked failed with the reason, right then. The failure this file
// fixes was a run that said "running" for hours while nothing ran.

export const DISPATCH_WAIT_MS = 4000

/**
 * Should /run drive this run itself?
 *
 * An explicit `drive` wins. Otherwise everything except n8n's scheduled run,
 * which calls the lens and synthesise routes on its own and would otherwise
 * run every lens twice and pay for it twice.
 */
export function shouldDrive({ trigger, drive } = {}) {
  if (typeof drive === 'boolean') return drive
  return trigger !== 'scheduled'
}

/** What runs after these results: the first lens still missing, or the brief. */
export function nextStep(planned = [], done = []) {
  const pending = pendingLenses(planned, done)
  return pending.length ? { route: 'lens', lens: pending[0] } : { route: 'synthesise' }
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

/**
 * Where this deployment can reach itself, and whether that address is one we
 * trust with the service secret.
 *
 * The secret must never follow a Host header. A request's Host is whatever the
 * caller wrote, and a route that sent AGENT_RUN_SECRET to "the host you called
 * me on" would hand it to anyone who asked with a forged header. So the secret
 * only goes to an address that came from the platform (VERCEL_URL) or
 * to localhost; any other address gets the caller's own sign-in token
 * forwarded, which proves nothing the caller could not already prove.
 */
export function chainTarget(req, env = process.env) {
  // VERCEL_URL is THIS deployment's own address, set by the platform. Not the
  // production domain: that could be a newer deploy than the step that is
  // calling it, and a chain must run one version of the code end to end.
  // Deployment URLs on this project are not behind Vercel's protection —
  // checked 2026-09-14, an unsigned POST to one gets our own 401 JSON back.
  if (env.VERCEL_URL) {
    return { base: `https://${String(env.VERCEL_URL).replace(/^https?:\/\//, '').replace(/\/+$/, '')}`, trusted: true }
  }
  const headers = req?.headers || {}
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim()
  if (!host || !/^[a-z0-9.\-[\]:]+$/i.test(host)) return { base: '', trusted: false }
  if (LOCAL_HOST.test(host)) return { base: `http://${host}`, trusted: true }
  return { base: `https://${host}`, trusted: false }
}

/** The Authorization header the next step is called with. */
export function chainAuth({ trusted, incoming, secret }) {
  if (trusted && secret) return `Bearer ${secret}`
  return String(incoming || '')
}

/**
 * Start a step and let it go.
 *
 * `dispatched: true` means the step either accepted the work or finished it
 * within the wait. A step that answers with an error inside the wait was
 * refused, and the caller must fail the run rather than assume it is going.
 */
export async function dispatch(url, body, { authorization = '', fetchImpl = fetch, waitMs = DISPATCH_WAIT_MS } = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), waitMs)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    let payload = {}
    try { payload = await res.json() } catch { /* a slow body is still a started step */ }
    if (res.ok) return { dispatched: true, answered: true, status: res.status }
    return {
      dispatched: false, answered: true, status: res.status,
      error: String(payload?.error || `returned ${res.status}`).slice(0, 300),
    }
  } catch (err) {
    // Our own abort: the step is working and we stopped listening. That is
    // the normal case for any lens that searches.
    if (ctl.signal.aborted) return { dispatched: true, answered: false }
    return { dispatched: false, error: String(err?.message || err).slice(0, 300) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Start whatever comes after `done`, or fail the run saying why not.
 *
 * @returns {Promise<{ok: boolean, step: object, error?: string}>}
 */
export async function advance(req, { workspaceId, runId, cadence = 'weekly', planned = [], done = [] }, deps = {}) {
  const env = deps.env || process.env
  const patch = deps.patch || patchRun
  const step = nextStep(planned, done)

  const fail = async error => {
    await Promise.resolve(patch(workspaceId, runId, {
      status: 'failed', error: String(error).slice(0, 500), finished_at: new Date().toISOString(),
    })).catch(() => {})
    return { ok: false, step, error }
  }

  const { base, trusted } = chainTarget(req, env)
  if (!base) return fail('The run could not work out its own address, so the next step was never started.')

  const authorization = chainAuth({
    trusted,
    incoming: req?.headers?.authorization || req?.headers?.Authorization,
    secret: env.AGENT_RUN_SECRET,
  })
  const body = step.route === 'lens'
    ? { workspace_id: workspaceId, run_id: runId, lens: step.lens, cadence, chain: true }
    : { workspace_id: workspaceId, run_id: runId, cadence }

  const out = await dispatch(`${base}/api/agent/${step.route}`, body, {
    authorization, fetchImpl: deps.fetchImpl, waitMs: deps.waitMs,
  })
  if (!out.dispatched) {
    const what = step.route === 'lens' ? `the ${step.lens} lens` : 'the brief'
    return fail(`Could not start ${what}: ${out.error}`)
  }
  return { ok: true, step }
}
