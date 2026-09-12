import { callModel } from './_provider.js'
import { db } from './_supabase.js'
import { textIn, urlsFromResponse } from '../../src/lib/agent/loop.js'
import { lensByKey, makeFinding } from '../../src/lib/agent/lenses.js'
import { findingsFromEvents, mergeCalendarResult } from '../../src/lib/agent/calendar.js'

// ─── Running a lens ────────────────────────────────────────────────────────
// Each lens is one bounded model call with web search, asked one question and
// required to return findings — never a brief. Synthesis happens once, over
// all of them, in _investigate.js.
//
// THE RULE THAT MAKES THIS WORTH DOING: a lens never throws. A lens that fails
// returns `{ ok: false, error }` and the run continues with five answers
// instead of six. The old serial pipeline lost everything when Instagram was
// blocked, though five other questions were still perfectly answerable — that
// is the failure this shape exists to prevent, and it is only prevented if
// every lens is genuinely isolated.

/**
 * What a lens must return. Shared by every lens so synthesis reads one shape,
 * and so adding a lens means writing a prompt rather than a parser.
 */
export const FINDINGS_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        description:
          'What you actually established. Returning an empty array is a correct and ' +
          'common answer — most weeks most lenses find nothing, and saying so is worth ' +
          'more than padding.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['headline', 'confidence'],
          properties: {
            headline: { type: 'string', description: 'One sentence. What is true.' },
            detail: { type: 'string', description: 'What supports it, and how strongly.' },
            confidence: { type: 'number', description: '0 to 1. Be honest; a low number is useful.' },
            novelty: { type: 'string', enum: ['new', 'continuing', 'changed', 'resolved'] },
            perishable_until: {
              type: 'string',
              description:
                'ISO date after which this no longer matters — a deadline, an event date, ' +
                'the end of a season. Omit entirely if it does not expire. Do NOT invent one.',
            },
            suggested_action: {
              type: 'string',
              description:
                'What the brand should DO about it, concretely. A finding with no action ' +
                'is trivia however true it is.',
            },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['url'],
                properties: {
                  url: { type: 'string' },
                  title: { type: 'string' },
                  quote: { type: 'string', description: 'The sentence that actually supports this.' },
                },
              },
            },
          },
        },
      },
    },
  },
}

/** Server-side web search, bounded by the lens's own budget. */
const webTools = uses => (uses > 0
  ? [
      { type: 'web_search_20260209', name: 'web_search', max_uses: uses },
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: uses },
    ]
  : [])

/**
 * Run one lens.
 *
 * @param {object} args
 * @param {string} args.lensKey
 * @param {string} args.prompt      the question, already grounded in this brand
 * @param {string} args.brand       the cached brand block
 * @param {string} args.identity
 * @returns {Promise<{lens,ok,findings,sources,cost,error}>}
 */
export async function runLens({
  workspaceId, runId, lensKey, prompt, identity, brand,
}) {
  const lens = lensByKey(lensKey)
  if (!lens) return { lens: lensKey, ok: false, findings: [], sources: [], cost: 0, error: 'Unknown lens.' }

  const allowed = new Set()
  try {
    const out = await callModel({
      workspaceId, surface: 'run', runId,
      // Sonnet: a lens reads and shapes rather than judges. The judging happens
      // once, in synthesis, on Opus.
      job: 'search',
      stage: lensKey,
      identity,
      brand,
      tools: webTools(lens.budget.searches),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: lens.budget.maxTokens || 8_000,
      effort: lens.budget.effort || 'medium',
      outputFormat: FINDINGS_SCHEMA,
    })

    if (out.refused) return { lens: lensKey, ok: false, findings: [], sources: [], cost: out.cost || 0, error: out.error }
    if (!out.ok) return { lens: lensKey, ok: false, findings: [], sources: [], cost: out.cost || 0, error: out.error }

    urlsFromResponse(out.response, allowed)

    let parsed = []
    try {
      parsed = JSON.parse(textIn(out.response))?.findings || []
    } catch (err) {
      // Unparseable output is this lens failing, not the run failing. Five
      // other answers are unaffected.
      return {
        lens: lensKey, ok: false, findings: [], sources: [...allowed],
        cost: out.cost || 0, error: `Findings did not parse: ${err.message}`,
      }
    }

    return {
      lens: lensKey,
      ok: true,
      findings: parsed.map(f => makeFinding(lensKey, f)),
      sources: [...allowed],
      cost: out.cost || 0,
      error: '',
    }
  } catch (err) {
    return {
      lens: lensKey, ok: false, findings: [], sources: [...allowed],
      cost: 0, error: String(err?.message || err).slice(0, 300),
    }
  }
}

/**
 * CALENDAR — computed first, reasoned about second.
 *
 * The one hybrid lens, and the shape is the whole fix. The dates are turned
 * into findings BEFORE the model is called, so they are already safe when the
 * call happens. If the model then fails, refuses, runs out of searches or
 * returns an empty array, the confirmed dates are still in the brief.
 *
 * This is the stage-0 principle applied one level down: gather() commits
 * measured numbers before any model token is spent so that a failed
 * investigation cannot cost the user their numbers. The same argument holds
 * for a date that was computed from the Hijri calendar — losing it because a
 * language model had a bad minute is not a tradeoff anyone would choose.
 *
 * A computed date carries confidence 1 and no sources. That is correct rather
 * than sloppy: its provenance is an arithmetic conversion, not a page someone
 * read, and the citation filter must not treat it as an unsupported claim.
 */
export async function runCalendarLens({
  workspaceId, runId, calendar, prompt, identity, brand,
}) {
  // Safe before the model is involved. Both steps are pure and live in
  // calendar.js, because the half that must survive a model failure is the
  // half that most needs testing without a network.
  const computed = findingsFromEvents(calendar?.events || [])
    .map(f => makeFinding('calendar', f))

  const modelOut = await runLens({
    workspaceId, runId, lensKey: 'calendar', prompt, identity, brand,
  })

  return mergeCalendarResult({
    computed,
    modelOut,
    note: calendar?.note || '',
    calendarSources: calendar?.sources || [],
  })
}

/**
 * The one lens that makes no model call.
 *
 * Our own numbers are computed, not researched, so this reads the same tables
 * the get_our_performance tool does and turns them into findings directly. It
 * is listed as a lens rather than left implicit so the brief can report it as
 * checked-and-quiet instead of silently absent — a lens that found nothing and
 * a lens that never ran must never look the same.
 */
export async function runOurselvesLens({ gathered }) {
  try {
    const board = gathered?.competitor_board || []
    const movements = (gathered?.movements || []).filter(m => m.competitor === 'Us')
    const findings = []

    for (const m of movements) {
      findings.push(makeFinding('ourselves', {
        headline: `Our ${m.metric} moved ${m.from} → ${m.to} (${m.change_pct}%).`,
        detail: `Measured, not estimated. Significance: ${m.significance}.`,
        confidence: 1,
        novelty: 'changed',
        evidence: m,
        suggested_action: m.direction === 'down'
          ? 'Establish whether this was deliberate before treating it as a signal.'
          : '',
      }))
    }

    const measurable = board.filter(c => c.data === 'instagram').length
    if (!movements.length && measurable === 0) {
      // Explicitly a quiet result rather than an empty one.
      return { lens: 'ourselves', ok: true, findings: [], sources: [], cost: 0, error: '' }
    }

    return { lens: 'ourselves', ok: true, findings, sources: [], cost: 0, error: '' }
  } catch (err) {
    return { lens: 'ourselves', ok: false, findings: [], sources: [], cost: 0, error: String(err?.message || err) }
  }
}

/** Move the run's stage marker so the page can show progress. */
export function markStage(workspaceId, runId, name) {
  return db(
    `research_runs?id=eq.${encodeURIComponent(runId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    { method: 'PATCH', body: { stage: name }, prefer: 'return=minimal' },
  ).catch(() => {})
}
