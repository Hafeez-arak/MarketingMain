import { db } from './_supabase.js'
import { planStoreWrites, eventStatus } from '../../src/lib/agent/intel.js'

// ─── The market-intelligence store, server half ────────────────────────────
// Reads the store before a run reports anything, and writes to it after. The
// decisions — what is new, what changed, what a row may be patched with — are
// all in src/lib/agent/intel.js, pure and tested. This file only moves rows.
//
// Every query carries its own workspace_id filter. The service key bypasses
// RLS, and RLS is not isolation in this database anyway.
//
// ── NEVER ALLOWED TO FAIL A RUN ──
//
// A missing table (the migration not applied yet), a PostgREST hiccup, a
// constraint a model's value trips — all of these log and return. The store
// makes the brief better; it must never be the reason there is no brief.

const enc = encodeURIComponent

/** Everything a run needs from the store. Empty lists when it cannot be read. */
export async function loadIntel(workspaceId) {
  const ws = enc(workspaceId)
  const [signals, opportunities, events] = await Promise.all([
    db(`research_signals?workspace_id=eq.${ws}&order=last_seen_at.desc&limit=300` +
       '&select=id,competitor,category,channel,summary,relevance,source_url,fingerprint,first_seen_at,last_seen_at,times_seen,last_run_id,line')
      .catch(logged('signals')),
    db(`research_opportunities?workspace_id=eq.${ws}&order=last_seen_at.desc&limit=200&select=*`)
      .catch(logged('opportunities')),
    db(`research_events?workspace_id=eq.${ws}&order=start_date.asc.nullslast&limit=150&select=*`)
      .catch(logged('events')),
  ])
  return { signals: signals || [], opportunities: opportunities || [], events: events || [] }
}

function logged(what) {
  return err => {
    console.error(`[agent/intel] load ${what}:`, err?.message || err)
    return []
  }
}

/**
 * Write a finished run's findings into the store.
 *
 * Re-plans against a fresh read rather than trusting the plan synthesis made:
 * minutes pass between the two, and a person may have closed a lead in the
 * meantime. Returns counts for the report.
 */
export async function persistIntel(workspaceId, runId, report, { now = new Date(), watchlist = [] } = {}) {
  const counts = { signals_new: 0, signals_seen: 0, opportunities_new: 0, opportunities_changed: 0, events_new: 0, events_changed: 0, brands_seen: 0 }
  try {
    const existing = await loadIntel(workspaceId)
    const plan = planStoreWrites(report?.findings || [], existing, { runId, now, watchlist })
    const week = now.toISOString().slice(0, 10)

    for (const [table, kind] of [['research_signals', 'signals'], ['research_opportunities', 'opportunities'], ['research_events', 'events']]) {
      const { insert, update } = plan[kind]
      if (insert.length) {
        const rows = insert.map(r => ({
          ...r,
          workspace_id: workspaceId,
          // Reported the week it first appears — unless it is low relevance,
          // which is stored and deliberately never reported.
          ...(kind === 'signals' ? { reported_in: r.relevance === 'low' ? null : week } : {}),
        }))
        // One row at a time on purpose: a single bad value (a check
        // constraint, an over-long field) must cost that row, not the batch.
        for (const row of rows) {
          await db(`${table}?on_conflict=workspace_id,fingerprint`, {
            method: 'POST', body: row, prefer: 'resolution=ignore-duplicates,return=minimal',
          }).catch(err => console.error(`[agent/intel] insert ${kind}:`, err?.message || err))
        }
      }
      for (const u of update) {
        await db(`${table}?id=eq.${enc(u.id)}&workspace_id=eq.${enc(workspaceId)}`, {
          method: 'PATCH', body: u.patch, prefer: 'return=minimal',
        }).catch(err => console.error(`[agent/intel] update ${kind}:`, err?.message || err))
      }
    }

    // ── Distribution rights ──
    // Merge rather than ignore-duplicates, unlike the three tables above: a
    // brand row carries a RELATIONSHIP, and a rival moving from 'claimed' to
    // 'exclusive' — or to 'ended' — is the whole reason to track it. Ignoring
    // the duplicate would freeze the first thing we ever saw.
    for (const row of plan.brands?.insert || []) {
      const ok = await db('competitor_brands?on_conflict=workspace_id,fingerprint', {
        method: 'POST',
        body: { ...row, workspace_id: workspaceId },
        prefer: 'resolution=merge-duplicates,return=minimal',
      }).then(() => true).catch(err => {
        console.error('[agent/intel] insert brands:', err?.message || err)
        return false
      })
      if (ok) counts.brands_seen += 1
    }

    // Events that have passed since anyone looked. Code closes them — the one
    // status the agent is allowed to write, because it is arithmetic.
    for (const e of existing.events) {
      if (e.status !== 'concluded' && eventStatus(e, now) === 'concluded') {
        await db(`research_events?id=eq.${enc(e.id)}&workspace_id=eq.${enc(workspaceId)}`, {
          method: 'PATCH', body: { status: 'concluded' }, prefer: 'return=minimal',
        }).catch(() => {})
      }
    }

    for (const a of plan.annotations) {
      for (const n of a.notes) {
        if (n.kind === 'signals') counts[n.state === 'new' ? 'signals_new' : 'signals_seen'] += 1
        if (n.kind === 'opportunities' && n.state === 'new') counts.opportunities_new += 1
        if (n.kind === 'opportunities' && n.state === 'changed') counts.opportunities_changed += 1
        if (n.kind === 'events' && n.state === 'new') counts.events_new += 1
        if (n.kind === 'events' && n.state === 'changed') counts.events_changed += 1
      }
    }
  } catch (err) {
    console.error('[agent/intel] persist:', err?.message || err)
  }
  return counts
}
