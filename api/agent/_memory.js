import { db } from './_supabase.js'
import { callModel } from './_provider.js'
import { textIn } from '../../src/lib/agent/loop.js'
import {
  makeNote, notesFromRun, renderDigest, freshTail, digestIsStale,
  approxTokens, DIGEST_TOKEN_BUDGET,
} from '../../src/lib/agent/memory.js'

// ─── Reading and writing the agent's memory ────────────────────────────────
// The executor half. All the judgement lives in src/lib/agent/memory.js, which
// is pure and tested; this file does the network and the database.
//
// ── THE RULE THAT MATTERS MOST HERE ──
//
// Nothing in this file throws. Memory is an enhancement: an agent with no
// memory is the agent we had last week, which worked. An agent whose research
// run dies because a summariser call timed out is strictly worse than that.
// Every export returns a safe empty value on failure.
//
// This also covers the migration gap. docs/memory-schema.sql is applied BY
// HAND, so between deploying this code and running that SQL the tables do not
// exist and PostgREST answers 404. That must look like "no memory yet", not
// like a broken product — and it is the reason the catch blocks are silent
// rather than loud.

/** A PostgREST failure that means the migration has not been run yet. */
function isMissingTable(err) {
  return /PGRST205|Could not find the table|does not exist/i.test(String(err?.message || ''))
}

/**
 * Append notes to the log.
 *
 * De-duplicated against what is already stored, so the same idea proposed in
 * three consecutive runs is ONE row whose seen_count climbs — which is also
 * what makes "this keeps coming up" visible to ranking later.
 *
 * @returns {Promise<{written: number, bumped: number}>}
 */
export async function recordNotes(workspaceId, notes = []) {
  if (!workspaceId || !notes.length) return { written: 0, bumped: 0 }

  try {
    const fps = [...new Set(notes.map(n => n.fingerprint).filter(Boolean))]
    if (!fps.length) return { written: 0, bumped: 0 }

    // `in.(...)` needs each value quoted — a fingerprint contains spaces, and
    // an unquoted one silently truncates the filter at the first space rather
    // than erroring.
    const list = fps.map(f => `"${f.replace(/"/g, '')}"`).join(',')
    const existing = await db(
      `agent_notes?workspace_id=eq.${workspaceId}&fingerprint=in.(${list})` +
      `&select=id,fingerprint,seen_count`,
    )

    const byFp = new Map((existing || []).map(r => [r.fingerprint, r]))
    const fresh = []
    const bumps = []

    for (const n of notes) {
      const hit = byFp.get(n.fingerprint)
      if (hit) bumps.push(hit)
      else if (n.fingerprint) {
        fresh.push({ ...n, workspace_id: workspaceId })
        // So two identical notes inside ONE batch do not both insert.
        byFp.set(n.fingerprint, { id: null, fingerprint: n.fingerprint, seen_count: 1 })
      }
    }

    if (fresh.length) {
      await db('agent_notes', { method: 'POST', body: fresh, prefer: 'return=minimal' })
    }

    for (const hit of bumps) {
      if (!hit.id) continue
      await db(`agent_notes?id=eq.${hit.id}`, {
        method: 'PATCH',
        body: {
          seen_count: (Number(hit.seen_count) || 1) + 1,
          last_seen_at: new Date().toISOString(),
        },
        prefer: 'return=minimal',
      }).catch(() => {})
    }

    return { written: fresh.length, bumped: bumps.length }
  } catch (err) {
    if (!isMissingTable(err)) console.error('[agent/memory] recordNotes:', err.message)
    return { written: 0, bumped: 0 }
  }
}

/** Everything this run proposed, concluded and established, as notes. */
export function rememberRun(workspaceId, report, runId) {
  return recordNotes(workspaceId, notesFromRun(report, runId))
}

/**
 * The ideas this workspace has already proposed.
 *
 * Used for the code-level repeat check, which is the half of the
 * anti-repetition guarantee that a model cannot talk its way past.
 */
export async function priorIdeas(workspaceId, limit = 120) {
  if (!workspaceId) return []
  try {
    return await db(
      `agent_notes?workspace_id=eq.${workspaceId}&kind=eq.idea_proposed` +
      `&order=created_at.desc&limit=${limit}&select=id,body,fingerprint,created_at,seen_count`,
    ) || []
  } catch (err) {
    if (!isMissingTable(err)) console.error('[agent/memory] priorIdeas:', err.message)
    return []
  }
}

/**
 * The digest, plus the tail of anything newer than it.
 *
 * The two are returned separately and must stay separate: `digest` goes into
 * the CACHED system block, `tail` goes on the user turn. Concatenating them
 * before they reach the caller would put volatile bytes inside the cached
 * prefix, which is the exact failure the split exists to prevent.
 */
export async function loadMemory(workspaceId) {
  const empty = { digest: '', tail: '', builtAt: null, tokens: 0 }
  if (!workspaceId) return empty

  try {
    const [rows, recent] = await Promise.all([
      db(`agent_digest?workspace_id=eq.${workspaceId}&select=digest,approx_tokens,built_through,built_at&limit=1`),
      db(`agent_notes?workspace_id=eq.${workspaceId}&status=eq.new` +
         `&order=created_at.desc&limit=12&select=body,kind,created_at,expires_at`),
    ])

    const row = rows?.[0]
    return {
      digest: row?.digest || '',
      tail: freshTail(recent || [], row?.built_through || null),
      builtAt: row?.built_at || null,
      tokens: Number(row?.approx_tokens) || 0,
    }
  } catch (err) {
    if (!isMissingTable(err)) console.error('[agent/memory] loadMemory:', err.message)
    return empty
  }
}

// ─── Compaction ────────────────────────────────────────────────────────────

const COMPACT_PROMPT = [
  'You are compacting an agent\'s working memory of one brand.',
  '',
  'Below are raw notes. Rewrite them into the SHORTEST set of statements that',
  'preserves everything a future run or conversation would need. This is the',
  'agent\'s only memory — anything you drop, it will never know again.',
  '',
  'Rules:',
  '- MERGE notes that say the same thing. Keep the clearest wording.',
  '- NEVER drop or soften a correction or a constraint. Those are standing',
  '  instructions from the team and outrank everything else here. If you are',
  '  unsure whether something is a constraint, keep it.',
  '- NEVER drop a proposed idea. The entire point is that they are not',
  '  proposed twice. Shorten the wording, keep every distinct one.',
  '- Drop anything that is trivially re-readable from the database, anything',
  '  purely conversational, and anything that has stopped mattering.',
  '- Keep each statement to one line. No preamble, no commentary.',
  '',
  'Return JSON: {"notes":[{"kind":"...","body":"..."}]} using ONLY the kinds',
  'that appear in the input.',
].join('\n')

const COMPACT_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['notes'],
    properties: {
      notes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'body'],
          properties: {
            kind: { type: 'string' },
            body: { type: 'string' },
          },
        },
      },
    },
  },
}

/**
 * Rebuild the digest from the log.
 *
 * Two stages, and the order is deliberate. Notes are ranked and rendered in
 * CODE first; the model is only asked to compact when that render overflows
 * the budget. Most weeks it will not, and those weeks cost nothing at all —
 * paying a model to summarise eight notes that already fit would be the kind
 * of quiet waste this codebase's ledger exists to expose.
 *
 * @returns {Promise<{ok, tokens, kept, dropped, compacted, cost, error}>}
 */
export async function rebuildDigest(workspaceId, { force = false } = {}) {
  const nil = { ok: false, tokens: 0, kept: 0, dropped: 0, compacted: false, cost: 0, error: '' }
  if (!workspaceId) return nil

  try {
    const [notes, current] = await Promise.all([
      db(`agent_notes?workspace_id=eq.${workspaceId}&status=neq.dropped` +
         `&order=created_at.desc&limit=400` +
         `&select=id,kind,body,created_at,expires_at,seen_count,status`),
      db(`agent_digest?workspace_id=eq.${workspaceId}&select=built_through&limit=1`),
    ])

    const all = notes || []
    if (!all.length) return { ...nil, ok: true }

    const unfolded = all.filter(n => n.status === 'new')
    const builtThrough = current?.[0]?.built_through || null

    if (!force && !digestIsStale({
      builtThrough,
      latestNoteAt: all[0]?.created_at || null,
      unfoldedCount: unfolded.length,
    })) {
      return { ...nil, ok: true }
    }

    // Stage 1: render in code. Free.
    let rendered = renderDigest(all)
    let compacted = false
    let cost = 0

    // Stage 2: only if code alone cannot fit it. A render that had to drop
    // notes means real memory is being lost, and a model can usually merge
    // duplicates well enough to keep it instead.
    if (rendered.dropped > 0) {
      const out = await callModel({
        workspaceId,
        surface: 'run',
        job: 'remember',
        stage: 'compact_memory',
        identity: 'You compact memory. You are lossy by design, and you know which losses are unacceptable.',
        brand: '',
        messages: [{
          role: 'user',
          content: `${COMPACT_PROMPT}\n\nNotes:\n${
            all.map(n => `[${n.kind}] ${n.body}`).join('\n')
          }`,
        }],
        maxTokens: 4_000,
        effort: 'low',
        outputFormat: COMPACT_SCHEMA,
      })
      cost = out.cost || 0

      if (out.ok) {
        try {
          const merged = (JSON.parse(textIn(out.response))?.notes || [])
            .filter(n => String(n?.body || '').trim())
            .map(n => ({
              ...makeNote({ kind: n.kind, body: n.body }),
              created_at: new Date().toISOString(),
              seen_count: 1,
            }))
          if (merged.length) {
            const viaModel = renderDigest(merged)
            // Only accept the compaction if it actually helped. A summariser
            // that returns something no smaller has cost money to make the
            // memory worse, and the code render is the safer artefact.
            if (viaModel.text && viaModel.dropped < rendered.dropped) {
              rendered = viaModel
              compacted = true
            }
          }
        } catch { /* keep the code-rendered version */ }
      }
    }

    const builtAt = new Date().toISOString()
    await db('agent_digest', {
      method: 'POST',
      body: {
        workspace_id: workspaceId,
        digest: rendered.text,
        approx_tokens: rendered.approx_tokens,
        built_through: all[0]?.created_at || builtAt,
        built_at: builtAt,
        build_error: '',
      },
      prefer: 'resolution=merge-duplicates,return=minimal',
    })

    // Mark what is now folded in. Done AFTER the digest is safely written, so
    // a failure between the two leaves notes unfolded — which costs one extra
    // rebuild, rather than marking them folded into a digest that never landed.
    const ids = unfolded.map(n => n.id).filter(Boolean)
    if (ids.length) {
      await db(`agent_notes?id=in.(${ids.join(',')})`, {
        method: 'PATCH', body: { status: 'folded' }, prefer: 'return=minimal',
      }).catch(() => {})
    }

    return {
      ok: true,
      tokens: rendered.approx_tokens,
      kept: rendered.kept,
      dropped: rendered.dropped,
      compacted,
      cost,
      error: '',
    }
  } catch (err) {
    // A missing table is not a failure, it is "the migration has not been run
    // yet". Reporting it as an error would put a red line in front of a person
    // for a state the product is designed to sit in, and a caller that surfaces
    // `error` would show a broken run for a feature that is merely absent.
    if (isMissingTable(err)) return { ...nil, ok: true }
    console.error('[agent/memory] rebuildDigest:', err.message)
    return { ...nil, error: String(err?.message || err).slice(0, 200) }
  }
}

// ─── Learning from a conversation ──────────────────────────────────────────

/** Extract every N assistant turns, rather than on every one. */
export const EXTRACT_EVERY = 6

const EXTRACT_PROMPT = [
  'Below is part of a conversation between a marketing team and their agent.',
  '',
  'Pull out ONLY what the agent would need to know in a FUTURE, unrelated',
  'conversation. You are writing to a notebook that is expensive to carry, so',
  'the default answer is nothing. Most exchanges contain nothing worth keeping,',
  'and returning an empty list is a correct and common answer.',
  '',
  'Keep:',
  '- correction  — the person told the agent it was wrong about something.',
  '- constraint  — a standing rule about how they work, what they will not do,',
  '                what they always do. These outlive everything else.',
  '- fact        — something established that the agent could not cheaply look',
  '                up again.',
  '- idea_outcome— the person accepted, rejected or acted on a specific idea.',
  '',
  'Do NOT keep: questions they asked, answers the agent gave, anything already',
  'in the database (competitor numbers, post history, brand details), opinions',
  'the agent volunteered, or pleasantries. A note that merely records that a',
  'topic came up is noise.',
  '',
  'Write each as ONE self-contained sentence that will still make sense in six',
  'months with no surrounding conversation. Never write "as discussed" or "the',
  'above" — there will be no above.',
  '',
  'Return JSON: {"notes":[{"kind":"...","body":"..."}]}',
].join('\n')

const EXTRACT_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['notes'],
    properties: {
      notes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'body'],
          properties: {
            kind: {
              type: 'string',
              enum: ['correction', 'constraint', 'fact', 'idea_outcome'],
            },
            body: { type: 'string' },
          },
        },
      },
    },
  },
}

/**
 * Learn what is worth keeping from recent conversation.
 *
 * Runs every EXTRACT_EVERY assistant turns, not every turn. A model call per
 * message would roughly double the cost of chat to record something on maybe
 * one turn in ten — and the user's own framing was that memory must not mean
 * paying more on every message.
 *
 * Never throws, and the caller does not await it before answering the person:
 * the reply is already streamed by the time this runs.
 */
export async function rememberChat(workspaceId, chatId, { turnCount = 0, force = false } = {}) {
  if (!workspaceId || !chatId) return { written: 0, ran: false }
  if (!force && (turnCount <= 0 || turnCount % EXTRACT_EVERY !== 0)) return { written: 0, ran: false }

  try {
    const recent = await db(
      `research_messages?chat_id=eq.${encodeURIComponent(chatId)}` +
      `&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
      `&order=created_at.desc&limit=${EXTRACT_EVERY * 2}&select=role,content,created_at`,
    )
    if (!recent?.length) return { written: 0, ran: false }

    const transcript = [...recent].reverse()
      .map(m => `${m.role === 'user' ? 'PERSON' : 'AGENT'}: ${String(m.content || '').slice(0, 1_500)}`)
      .join('\n\n')

    const out = await callModel({
      workspaceId,
      surface: 'chat',
      chatId,
      job: 'remember',
      stage: 'extract_memory',
      identity: 'You decide what is worth remembering. Keeping too much is as bad as keeping too little.',
      brand: '',
      messages: [{ role: 'user', content: `${EXTRACT_PROMPT}\n\n---\n${transcript}` }],
      maxTokens: 2_000,
      effort: 'low',
      outputFormat: EXTRACT_SCHEMA,
    })
    if (!out.ok) return { written: 0, ran: true, cost: out.cost || 0 }

    let parsed = []
    try {
      parsed = JSON.parse(textIn(out.response))?.notes || []
    } catch {
      return { written: 0, ran: true, cost: out.cost || 0 }
    }

    const notes = parsed
      .filter(n => String(n?.body || '').trim())
      .map(n => makeNote({ kind: n.kind, body: n.body, source: 'chat', sourceId: chatId }))

    const { written } = await recordNotes(workspaceId, notes)
    return { written, ran: true, cost: out.cost || 0 }
  } catch (err) {
    if (!isMissingTable(err)) console.error('[agent/memory] rememberChat:', err.message)
    return { written: 0, ran: false }
  }
}

export { DIGEST_TOKEN_BUDGET, approxTokens }
