import { db, isConfigured } from './_supabase.js'
import { authorise } from './_serviceAuth.js'
import { synthesiseRun, persistReport } from './_investigate.js'
import { patchRun } from './_gather.js'
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
    if (run.status === 'complete') {
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

    // Memory, after persist, and never allowed to fail the run: an agent with
    // no memory is the agent we had last week, which worked.
    await rememberRun(workspaceId, deep.report, runId)
    await rebuildDigest(workspaceId, { force: true })

    await patchRun(workspaceId, runId, {
      status: 'complete',
      stage: deep.ok ? 'synthesise' : 'gather',
      report: deep.report,
      error: deep.ok ? '' : String(deep.error || '').slice(0, 500),
      cost_estimate: Number((deep.cost || 0).toFixed(4)),
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
