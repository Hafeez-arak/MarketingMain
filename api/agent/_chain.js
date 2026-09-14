import { db } from './_supabase.js'
import { patchRun } from './_gather.js'
import { pendingLenses } from '../../src/lib/agent/phases.js'

// ─── A run that drives itself ──────────────────────────────────────────────
//
// A run is three routes: /run (the numbers), one /lens per lens, then
// /synthesise (the brief). The n8n workflow in n8n/agentRun.workflow.json
// drives the Monday run. A run started anywhere else (the Run button, the
// assistant) has nothing else to drive it, so it drives itself:
//
//   /run ──┬─▶ lens A ─┐
//          ├─▶ lens B ─┤  whichever lens finishes LAST claims the brief
//          └─▶ lens C ─┴─▶ /synthesise
//
// ── WHY A FAN-OUT AND NOT A LINE ──
//
// The first version (#50) was a line: each lens started the next. The first
// live run, 43eaa9c3 on 2026-09-14, got four lenses in and then Vercel refused
// the fifth with 508 INFINITE_LOOP_DETECTED: browser → run → openings →
// calendar → demand → ourselves → category was six requests nested inside
// each other on one deployment, and Vercel treats that as a runaway loop.
//
// Fanned out, the deepest path is browser → run → lens → synthesise: three,
// whatever the number of lenses. It is also the shape the n8n workflow already
// uses (a batch of lenses, then one synthesise), so both drivers run the same
// plan the same way.
//
// ── WHY "DISPATCH" WAITS A FEW SECONDS AND THEN LETS GO ──
//
// A lens takes minutes and every invocation lives under the same 300s ceiling,
// so a caller cannot wait for one. The request is sent, given a few seconds to
// be refused outright (a 401, a 409, a 508), and then abandoned. Vercel does
// not cancel a function because its caller hung up — observed: run 43eaa9c3's
// lenses all ran to completion after their callers had long since let go.
//
// ── THE RULE ──
//
// A driver that breaks must say so. A lens that cannot be started, or a brief
// that cannot be started, marks the run failed with the reason, right then.

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

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

/**
 * Where this deployment can reach itself, and whether that address is one we
 * trust with the service secret.
 *
 * The secret must never follow a Host header. A request's Host is whatever the
 * caller wrote, and a route that sent AGENT_RUN_SECRET to "the host you called
 * me on" would hand it to anyone who asked with a forged header. So the secret
 * only goes to an address that came from the platform (VERCEL_URL) or to
 * localhost; any other address gets the caller's own sign-in token forwarded,
 * which proves nothing the caller could not already prove.
 */
export function chainTarget(req, env = process.env) {
  // VERCEL_URL is THIS deployment's own address, set by the platform. Not the
  // production domain: that could be a newer deploy than the step that is
  // calling it, and a run must use one version of the code end to end.
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

function contextFor(req, deps) {
  const env = deps.env || process.env
  const { base, trusted } = chainTarget(req, env)
  const authorization = chainAuth({
    trusted,
    incoming: req?.headers?.authorization || req?.headers?.Authorization,
    secret: env.AGENT_RUN_SECRET,
  })
  return { base, authorization }
}

async function failRun(workspaceId, runId, error, deps) {
  const patch = deps.patch || patchRun
  await Promise.resolve(patch(workspaceId, runId, {
    status: 'failed', error: String(error).slice(0, 500), finished_at: new Date().toISOString(),
  })).catch(() => {})
}

/**
 * Move the run to `synthesise` if, and only if, it is still at `lenses`.
 *
 * Two lenses can finish in the same second and both see nothing pending. The
 * conditional PATCH is what makes exactly one of them start the brief: the
 * database applies the first, and the second's `stage=eq.lenses` no longer
 * matches, so it gets no row back.
 */
export async function claimSynthesis(workspaceId, runId, deps = {}) {
  const query = deps.db || db
  const rows = await query(
    `research_runs?id=eq.${encodeURIComponent(runId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    '&status=eq.running&stage=eq.lenses',
    { method: 'PATCH', body: { stage: 'synthesise' }, prefer: 'return=representation' },
  )
  return Array.isArray(rows) && rows.length > 0
}

/**
 * Called by a lens once its own row is written: start the brief if no lens is
 * left, and do nothing if some are.
 *
 * @returns {Promise<{ok: boolean, step: string, pending?: string[], error?: string}>}
 */
export async function finishIfDone(req, { workspaceId, runId, cadence = 'weekly', planned = [], done = [] }, deps = {}) {
  const pending = pendingLenses(planned, done)
  if (pending.length) return { ok: true, step: 'waiting', pending }

  let claimed
  try {
    claimed = await claimSynthesis(workspaceId, runId, deps)
  } catch (err) {
    const error = `Every lens finished, but the brief could not be claimed: ${String(err?.message || err).slice(0, 200)}`
    await failRun(workspaceId, runId, error, deps)
    return { ok: false, step: 'synthesise', error }
  }
  // Another lens got there first, or the run already ended. Either way the
  // brief is not ours to start.
  if (!claimed) return { ok: true, step: 'claimed_elsewhere' }

  const { base, authorization } = contextFor(req, deps)
  if (!base) {
    const error = 'Every lens finished, but the run could not work out its own address to start the brief.'
    await failRun(workspaceId, runId, error, deps)
    return { ok: false, step: 'synthesise', error }
  }
  const out = await dispatch(`${base}/api/agent/synthesise`, { workspace_id: workspaceId, run_id: runId, cadence }, {
    authorization, fetchImpl: deps.fetchImpl, waitMs: deps.waitMs,
  })
  if (!out.dispatched) {
    const error = `Could not start the brief: ${out.error}`
    await failRun(workspaceId, runId, error, deps)
    return { ok: false, step: 'synthesise', error }
  }
  return { ok: true, step: 'synthesise' }
}

/**
 * Called by /run once the numbers are committed: start every planned lens at
 * once.
 *
 * If any lens cannot be started the run is failed, naming which. Lenses that
 * did start will still finish and write their rows, but none of them can
 * claim the brief of a failed run.
 *
 * @returns {Promise<{ok: boolean, started: string[], error?: string}>}
 */
export async function startLenses(req, { workspaceId, runId, cadence = 'weekly', planned = [] }, deps = {}) {
  if (!planned.length) {
    const out = await finishIfDone(req, { workspaceId, runId, cadence, planned, done: [] }, deps)
    return { ok: out.ok, started: [], error: out.error }
  }

  const { base, authorization } = contextFor(req, deps)
  if (!base) {
    const error = 'The run could not work out its own address, so no lens was started.'
    await failRun(workspaceId, runId, error, deps)
    return { ok: false, started: [], error }
  }

  const results = await Promise.all(planned.map(async lens => ({
    lens,
    ...(await dispatch(`${base}/api/agent/lens`,
      { workspace_id: workspaceId, run_id: runId, lens, cadence, chain: true },
      { authorization, fetchImpl: deps.fetchImpl, waitMs: deps.waitMs })),
  })))

  const refused = results.filter(r => !r.dispatched)
  const started = results.filter(r => r.dispatched).map(r => r.lens)
  if (refused.length) {
    const error = `Could not start ${refused.map(r => `the ${r.lens} lens (${r.error})`).join(', ')}.`
    await failRun(workspaceId, runId, error, deps)
    return { ok: false, started, error }
  }
  return { ok: true, started }
}
