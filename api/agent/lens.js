import { db, isConfigured } from './_supabase.js'
import { authorise } from './_serviceAuth.js'
import { runSingleLens } from './_investigate.js'
import { deadlineFor } from '../../src/lib/agent/phases.js'

// ─── POST /api/agent/lens ──────────────────────────────────────────────────
// Run ONE research lens for a run that already has its numbers.
//
// Body: { workspace_id, run_id, lens, cadence? }
//
// This route exists because of a single platform fact: Vercel Hobby caps a
// function at 300 SECONDS AND THAT CANNOT BE RAISED, while one calendar lens
// was measured at 380s twice. Six lenses inside one request was never going to
// fit, so each is now its own request — and each is additionally bounded by a
// wall-clock deadline, because per-lens splitting alone still would not fit.
//
// Idempotent per (run_id, lens): a retry replaces that lens's row rather than
// appending a second result. So a driver can safely retry a lens it is unsure
// about, which is most of what makes the split worth having.

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
  const lens = String(body.lens || '').trim()
  const cadence = body.cadence === 'monthly' ? 'monthly' : 'weekly'

  if (!workspaceId || !runId || !lens) {
    res.status(400).json({ error: 'workspace_id, run_id and lens are all required.' })
    return
  }
  // Matched against a pattern before it reaches a query. Lens keys are a
  // closed set and runSingleLens checks membership too, but a value that ends
  // up inside a PostgREST filter should never have been free-form.
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(lens)) {
    res.status(400).json({ error: 'Bad lens name.' })
    return
  }

  const auth = await authorise(req, workspaceId)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return
  }

  try {
    // The run must exist, belong to this workspace, and still be going. Scoped
    // by workspace as well as by id: a run id from another workspace must not
    // attach here, and the id alone would let it.
    const runs = await db(
      `research_runs?id=eq.${encodeURIComponent(runId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
      `&select=id,status,stage&limit=1`,
    )
    const run = runs?.[0]
    if (!run) {
      res.status(404).json({ error: 'No such run for this workspace.' })
      return
    }
    if (run.status === 'complete') {
      // Not an error: a driver retrying after a network blip should get a
      // clear "already done" rather than a second charge for the same lens.
      res.status(200).json({ ok: true, skipped: true, reason: 'This run is already complete.' })
      return
    }
    if (run.status === 'failed') {
      res.status(409).json({ error: 'This run failed and cannot take more lenses.' })
      return
    }

    const out = await runSingleLens({
      workspaceId, runId, lensKey: lens, cadence,
      deadline: deadlineFor('lens', startedAt),
    })

    if (!out.ok) {
      res.status(out.status || 500).json({ error: out.error })
      return
    }

    res.status(200).json({ ...out, run_id: runId })
  } catch (err) {
    console.error('[agent/lens]', err)
    res.status(500).json({ ok: false, run_id: runId, lens, error: String(err?.message || err).slice(0, 400) })
  }
}
