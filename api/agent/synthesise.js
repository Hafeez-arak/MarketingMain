import { db, isConfigured } from './_supabase.js'
import { authorise } from './_serviceAuth.js'
import { synthesiseRun, persistReport } from './_investigate.js'
import { persistIntel } from './_intel.js'
import { patchRun } from './_gather.js'
import { runTotals } from '../../src/lib/agent/cost.js'
import { rememberRun, rebuildDigest } from './_memory.js'
import { deadlineFor } from '../../src/lib/agent/phases.js'

// ─── POST /api/agent/synthesise ────────────────────────────────────────────
// The last phase: read what the lenses stored, write the brief, close the run.
//
// Body: { workspace_id, run_id, cadence? }
//
// Returns 409 while any lens is still outstanding, naming which — so a driver
// can wait and retry rather than producing a brief that silently omits a third
// of the research.
//
// ── THE RULE THIS ROUTE MUST NEVER BREAK ──
//
// Every terminal path writes a status. The browser opened the spinner and only
// the server can close it (`draft_status` is one-way), so a path that returns
// without writing `complete` or `failed` leaves a spinner nobody can clear.
// That includes the catch block.

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req, res) {
  const startedAt = Date.now()

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only.' })
    return
  }
  if (!isConfigured) {
    res.status(500).json({ error: 'Supabase is not configured on this deployment.' })
    return
  }

  let body
  try {
    body = await readBody(req)
  } catch {
    res.status(400).json({ error: 'Body must be JSON.' })
    return
  }

  const workspaceId = String(body.workspace_id || '').trim()
  const runId = String(body.run_id || '').trim()
  const cadence = body.cadence === 'monthly' ? 'monthly' : 'weekly'

  if (!workspaceId || !runId) {
    res.status(400).json({ error: 'workspace_id and run_id are both required.' })
    return
  }

  const auth = await authorise(req, workspaceId)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return
  }

  try {
    const runs = await db(
      `research_runs?id=eq.${encodeURIComponent(runId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
      `&select=id,status,stage,report&limit=1`,
    )
    const run = runs?.[0]
    if (!run) {
      res.status(404).json({ error: 'No such run for this workspace.' })
      return
    }
    // ── "COMPLETE" IS NOT THE SAME AS "SYNTHESISED" ──
    //
    // This used to test `run.status === 'complete'`, and a run the spend cap
    // cut short is written as complete at stage `gather` — so the one run that
    // still had work owing was the one permanently refused. On 2026-09-17 run
    // 191e21f4 had eight finished lenses and $2.29 of paid-for search sitting
    // in research_lens_results with no report and no persisted leads, and the
    // only way to finish it was to edit its status by hand.
    //
    // The stage is what records whether synthesis happened. Cost is paid at
    // the lens stage and value is delivered at this one, so being cut between
    // them must stay recoverable.
    if (run.stage === 'synthesise') {
      res.status(200).json({ ok: true, skipped: true, run_id: runId, reason: 'Already synthesised.' })
      return
    }

    const deep = await synthesiseRun({
      workspaceId, runId, cadence,
      deadline: deadlineFor('synthesise', startedAt),
    })

    // Lenses still outstanding. Not a failure and NOT terminal — the run stays
    // open so the driver can finish them and call back. Deliberately does not
    // write a status: a 409 that marked the run failed would turn a retryable
    // wait into a lost run.
    if (deep.status === 409) {
      res.status(409).json({ ok: false, run_id: runId, error: deep.error, pending: deep.pending })
      return
    }

    // From here the run ends, whichever way it went. `deep.report` is the
    // gathered report when synthesis failed, so the numbers survive.
    await persistReport(workspaceId, runId, deep.report)

    // Signals, leads and events into the store that carries them across
    // weeks. Never fails the run — see _intel.js. The counts ride on the
    // report so the page can say "3 new leads, 1 changed" without a query.
    {
      const watch = await db(
        `research_agenda?workspace_id=eq.${encodeURIComponent(workspaceId)}&kind=eq.competitor&status=neq.retired&select=subject`,
      ).catch(() => [])
      deep.report.intel = await persistIntel(workspaceId, runId, deep.report, {
        watchlist: (watch || []).map(r => r.subject).filter(Boolean),
      })
    }

    // Memory, after persist, and never allowed to fail the run: an agent with
    // no memory is the agent we had last week, which worked.
    await rememberRun(workspaceId, deep.report, runId)
    await rebuildDigest(workspaceId, { force: true })

    // The summary columns, filled from the ledger.
    //
    // tokens_in, tokens_out and model have existed since this table did and
    // nothing ever wrote them, so every completed run reported 0 tokens beside
    // a real dollar cost. agent_usage has the truth per call; this rolls it up.
    // Never allowed to fail the run — a telemetry read that 500s must not cost
    // someone their brief.
    let totals = null
    try {
      const usage = await db(
        `agent_usage?run_id=eq.${runId}&workspace_id=eq.${workspaceId}` +
        `&select=model,cost_usd,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,searches`,
      )
      totals = runTotals(usage || [])
    } catch (err) {
      console.error('[agent/synthesise] usage roll-up:', err?.message || err)
    }

    await patchRun(workspaceId, runId, {
      status: 'complete',
      stage: deep.ok ? 'synthesise' : 'gather',
      report: deep.report,
      error: deep.ok ? '' : String(deep.error || '').slice(0, 500),
      // The ledger wins when it is readable. `deep.cost` only counts what THIS
      // invocation spent, and the lenses ran in five earlier invocations.
      cost_estimate: totals ? totals.cost_usd : Number((deep.cost || 0).toFixed(4)),
      ...(totals ? {
        tokens_in: totals.tokens_in,
        tokens_out: totals.tokens_out,
        searches: totals.searches,
        model: totals.model,
      } : {}),
      finished_at: new Date().toISOString(),
    })

    res.status(200).json({
      ok: true,
      run_id: runId,
      investigated: deep.ok,
      headline: deep.report?.headline || '',
      baseline: deep.report?.baseline,
      quiet_week: deep.report?.quiet_week,
      cost_usd: Number((deep.cost || 0).toFixed(4)),
      proposed_ideas: (deep.report?.proposed_ideas || []).length,
      repeated_ideas: (deep.report?.repeated_ideas || []).length,
      proposed_rules: (deep.report?.proposed_rules || []).length,
      note: deep.ok ? '' : `The measured numbers are complete. ${deep.error}`,
    })
  } catch (err) {
    console.error('[agent/synthesise]', err)
    const message = String(err?.message || err).slice(0, 500)
    // A crashed invocation that writes nothing leaves a spinner nobody can
    // close, so the status is written even on the way out of a crash.
    await patchRun(workspaceId, runId, {
      status: 'failed', error: message, finished_at: new Date().toISOString(),
    }).catch(() => {})
    res.status(500).json({ ok: false, run_id: runId, error: message })
  }
}
