import { callerId, callerMayUseWorkspace, db, isConfigured } from './_supabase.js'
import { gather, patchRun } from './_gather.js'
import { periodFor } from '../../src/lib/agent/gather.js'

// ─── POST /api/agent/run ───────────────────────────────────────────────────
// The weekly research run. AGENT.md §6, RESEARCH-AGENT.md §4.
//
// Body: { workspace_id, trigger?, period_days? }
//
// Nobody writes a prompt. The agent works out its own questions from the
// standing agenda and the Brand Brain, which is what makes week 12 comparable
// to week 11 — a human-typed prompt each week would quietly research something
// slightly different every time.
//
// ASYNC, deliberately. The browser gets a run id the moment the row exists and
// polls research_runs; it never holds a fetch across a three-minute
// investigation. Vercel caps a function at 300s, and a full run can exceed
// that, so stage 0 answers first and the investigation stages are their own
// invocation.

const STALE_MINUTES = 20

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req, res) {
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
  if (!workspaceId) {
    res.status(400).json({ error: 'workspace_id is required.' })
    return
  }

  // Same gate as chat, for the same reason: a workspace_id in a request body
  // is not evidence of anything, and everything past here spends money and
  // writes rows.
  const userId = await callerId(req)
  if (!userId) {
    res.status(401).json({ error: 'Sign in to start a research run.' })
    return
  }
  if (!(await callerMayUseWorkspace(req, workspaceId))) {
    res.status(403).json({ error: 'You do not have access to this workspace.' })
    return
  }

  const trigger = ['manual', 'scheduled', 'chat'].includes(body.trigger) ? body.trigger : 'manual'
  const periodDays = Math.min(90, Math.max(1, Number(body.period_days) || 7))
  const now = new Date()
  const period = periodFor(periodDays, now)
  const asDate = iso => String(iso).slice(0, 10)

  let runId = ''
  try {
    // ── Sweep first ──
    // A run whose invocation died between the insert and the terminal write
    // holds the single-flight index open forever, and every later press comes
    // back "already running" pointing at a run that finished nothing.
    const staleBefore = new Date(now.getTime() - STALE_MINUTES * 60_000).toISOString()
    await db(
      `research_runs?workspace_id=eq.${workspaceId}&status=eq.running&started_at=lt.${staleBefore}`,
      {
        method: 'PATCH',
        body: {
          status: 'failed',
          error: 'Timed out — the run stopped writing and was swept.',
          finished_at: now.toISOString(),
        },
        prefer: 'return=minimal',
      },
    ).catch(err => console.error('[agent/run] sweep:', err.message))

    // ── Claim the run ──
    // Single-flight is a partial unique index on (workspace_id) WHERE
    // status = 'running', so the DATABASE refuses the second caller rather
    // than a check-then-insert here that two tabs could both pass.
    let run = null
    try {
      const created = await db('research_runs', {
        method: 'POST',
        body: {
          workspace_id: workspaceId, trigger, status: 'running', stage: 'gather',
          period_start: asDate(period.start), period_end: asDate(period.end),
        },
        prefer: 'return=representation',
      })
      run = Array.isArray(created) ? created[0] : created
    } catch (err) {
      // A unique violation is not an error and not a second run: hand back the
      // one already going so a double-click attaches to it rather than
      // starting a second agent on the same period and doubling the bill.
      if (!/409|duplicate key|unique/i.test(String(err?.message || ''))) throw err
      const live = await db(
        `research_runs?workspace_id=eq.${workspaceId}&status=eq.running` +
        `&select=id,started_at,stage&order=started_at.desc&limit=1`,
      )
      res.status(200).json({
        ok: true,
        already_running: true,
        run_id: live?.[0]?.id || null,
        stage: live?.[0]?.stage || '',
        reason: 'A research run is already going for this brand. Watch that one rather than starting a second.',
      })
      return
    }

    runId = run?.id
    if (!runId) throw new Error('The run row was created but returned no id.')

    // ── Stage 0 ──
    // Awaited rather than backgrounded. It is measured in seconds, not
    // minutes, and it is the part that must survive everything after it — a
    // caller who gets a run id back is guaranteed the numbers are already
    // committed. The investigation stages are what get their own invocation.
    const out = await gather(workspaceId, runId, period)

    if (!out.ok) {
      // No Meta credentials. The numbers could not be gathered, and that is a
      // terminal state for this run rather than something to investigate on
      // top of — but it is reported plainly, not as a crash.
      await patchRun(workspaceId, runId, {
        status: 'failed', error: out.error, finished_at: new Date().toISOString(),
      })
      res.status(200).json({ ok: false, run_id: runId, error: out.error })
      return
    }

    // Stages 1–4 are not built yet. Until they are, gather IS the run, so it
    // writes the terminal status itself — leaving the row 'running' would hand
    // the browser a spinner only the sweep could close, twenty minutes later.
    // When investigation lands, this is where it is invoked instead, and the
    // terminal write moves to stage 5.
    await patchRun(workspaceId, runId, {
      status: 'complete',
      stage: 'gather',
      finished_at: new Date().toISOString(),
    })

    res.status(200).json({
      ok: true,
      run_id: runId,
      already_running: false,
      snapshots: out.snapshots,
      measured: out.measured,
      failed: out.failed,
      baseline: out.report?.baseline,
      quiet_week: out.report?.quiet_week,
      headline: out.report?.headline || '',
      note: out.note || 'Stages 1–4 (plan, search, reflect, synthesise) are not built yet — this is the measured half only.',
    })
  } catch (err) {
    // Every terminal path writes a status. A crashed invocation that writes
    // nothing leaves a spinner nobody can close.
    console.error('[agent/run]', err)
    const message = String(err?.message || err).slice(0, 500)
    if (runId) {
      await patchRun(workspaceId, runId, {
        status: 'failed', error: message, finished_at: new Date().toISOString(),
      }).catch(() => {})
    }
    res.status(500).json({ ok: false, run_id: runId || null, error: message })
  }
}
