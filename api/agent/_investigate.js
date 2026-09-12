import { callModel } from './_provider.js'
import { db } from './_supabase.js'
import { loadBrandContext, IDENTITY } from './_context.js'
import { textIn, urlsFromResponse } from '../../src/lib/agent/loop.js'
import { BRIEF_SCHEMA, SYNTHESISE_PROMPT, mergeBrief } from '../../src/lib/agent/brief.js'
import {
  lensesFor, motionOf, lensSummary, rankFindings, agendaFilterFor,
} from '../../src/lib/agent/lenses.js'
import { LENS_PROMPTS } from '../../src/lib/agent/lensPrompts.js'
import { runLens, runOurselvesLens, runCalendarLens, markStage } from './_lenses.js'
import { gatherCalendar } from './_calendar.js'
import { marketOf } from '../../src/lib/agent/calendar.js'
import { priorIdeas } from './_memory.js'
import { partitionRepeats } from '../../src/lib/agent/memory.js'
import {
  deadlineFor, resultsFromRows, timingNote, pendingLenses, timedOutResult,
} from '../../src/lib/agent/phases.js'

// Re-exported: the resolver imported it from here before it moved to loop.js.
export { urlsFromResponse }

// ─── Stages 1–4, as independent lenses across three HTTP requests ──────────
// AGENT.md §6, restructured twice.
//
// FIRST restructure: the old shape was serial — instagram → plan → search →
// reflect → write — and every stage depended on the one before. When Instagram
// was blocked on 2026-09-10 the whole run had nothing to say, though five
// other questions were still perfectly answerable. So: six independent lenses,
// in parallel, each isolated.
//
// SECOND restructure (this one): those six ran inside ONE HTTP request along
// with gather and synthesis. This project is on Vercel Hobby, where the
// function ceiling is 300 SECONDS AND CANNOT BE RAISED, and a single lens was
// measured at 380s twice. The platform killed the invocation mid-run — no
// status written, no error, no ledger row, and a spinner that only the server
// can close.
//
// So the run is now three routes, driven by n8n:
//
//   /api/agent/run          stage 0, commits the numbers, returns a run_id
//   /api/agent/lens         ONE lens, bounded by a wall-clock deadline
//   /api/agent/synthesise   reads what landed, writes the brief
//
// Every lens result is a row in research_lens_results rather than a variable,
// because six parallel HTTP requests cannot share a variable — and six
// concurrent updates to one jsonb column would silently lose writes.

/** Did this response refuse? Only then is stop_details populated. */
function refusalOf(response) {
  if (response?.stop_reason !== 'refusal') return ''
  const d = response.stop_details
  return `The model declined${d?.category ? ` (${d.category})` : ''}.`
}

/** The window the calendar lens looks ahead over. Long enough to produce something. */
function lookahead(weeks = 8, now = new Date()) {
  const to = new Date(now.getTime() + weeks * 7 * 86_400_000)
  return { from: now.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

/**
 * Everything all three phases need to know about this run.
 *
 * Loaded once per invocation rather than passed between them, because they are
 * now separate HTTP requests with nothing in common but the run id. That costs
 * a few database reads per phase and buys the property that any phase can be
 * retried on its own, hours later, without the others having kept anything
 * warm.
 */
export async function loadRunContext(workspaceId, runId, cadence = 'weekly') {
  const [{ brand, ctx, profile }, agenda, priorRuns, competitorRows, alreadySaid, runRows] =
    await Promise.all([
      loadBrandContext(workspaceId, 'research'),
      db(`research_agenda?workspace_id=eq.${workspaceId}&kind=eq.question&status=eq.active` +
         `${agendaFilterFor(cadence)}&select=subject,why`),
      db(`research_runs?workspace_id=eq.${workspaceId}&id=neq.${runId}&status=eq.complete` +
         `&order=started_at.desc&limit=3&select=report`),
      db(`research_agenda?workspace_id=eq.${workspaceId}&kind=eq.competitor&status=neq.retired&select=subject`),
      priorIdeas(workspaceId),
      db(`research_runs?id=eq.${runId}&workspace_id=eq.${workspaceId}&select=report,stage,status&limit=1`),
    ])

  const gathered = runRows?.[0]?.report || {}

  // How this brand sells decides which lenses lead. Inferred from the Brand
  // Brain until someone sets it explicitly — see motionOf().
  const { motion, explicit } = motionOf(profile || {})
  const competitors = (competitorRows || []).map(r => r.subject).filter(Boolean)

  // Every lens asks a question about somewhere. `customFields.geography` is
  // the obvious source and is empty on all three live workspaces, so a lens
  // trusting it researched an unnamed market — and that showed in the results:
  // searches came back about the category in general rather than about the
  // country this brand actually sells in. marketOf falls back to the brand's
  // own prose the same way the calendar has always had to.
  const market = marketOf({ profile, ctx })
  const brandFacts = {
    brandName: ctx?.brandName || '',
    descriptor: ctx?.brandDescriptor || '',
    audience: (profile?.targetPersonas || '').split('\n').slice(0, 4).join('; '),
    geography: market.label,
  }

  return {
    brand, ctx, profile, gathered, agenda: agenda || [], priorRuns: priorRuns || [],
    competitors, alreadySaid: alreadySaid || [], motion, explicit, brandFacts,
    lenses: lensesFor({ motion, cadence }),
  }
}

/**
 * Which lenses this run will execute.
 *
 * Returned by /api/agent/run so the driver does not have to know how motion
 * and cadence decide them. Adding a lens stays a code change here rather than
 * an edit inside n8n's UI that nothing tests.
 */
export async function planLenses(workspaceId, runId, cadence = 'weekly') {
  try {
    const { lenses, motion, explicit } = await loadRunContext(workspaceId, runId, cadence)
    return { lenses: lenses.map(l => l.key), motion, explicit }
  } catch (err) {
    // A run whose plan cannot be read is still a run whose numbers are
    // committed. The driver gets the default set for this cadence and finds
    // out per lens.
    console.error('[agent/run] planLenses:', err?.message || err)
    return { lenses: lensesFor({ cadence }).map(l => l.key), motion: '', explicit: false }
  }
}

/**
 * Build the argument list for one lens.
 *
 * Split out so /api/agent/lens can construct exactly one prompt rather than
 * every lens's — the calendar's dates cost an API round trip, and fetching
 * them to run the demand lens would be waste repeated on every call.
 */
async function argsForLens(key, { brandFacts, motion, competitors, gathered, profile, ctx, agenda = [] }) {
  if (key === 'calendar') {
    // No `args`: this lens has no prompt because it makes no model call. What
    // it needs is the computed calendar itself, which is the whole lens now.
    const window = lookahead(8)
    return { args: null, calendar: await gatherCalendar({ profile, ctx, window }) }
  }
  // `agenda` — the standing questions a person asked to have watched — goes to
  // every lens that searches. It used to reach synthesis only, which reads what
  // the lenses already found and cannot look anything up, so a standing question
  // could change the write-up and never change what was searched for.
  if (key === 'openings') return { args: [brandFacts, { motion, agenda }] }
  if (key === 'demand') return { args: [brandFacts, { competitors, agenda }] }
  // The market it researches rides in brandFacts like every other brand fact,
  // resolved once in loadRunContext rather than a second time here.
  if (key === 'category') return { args: [brandFacts, { agenda }] }
  if (key === 'rivals') {
    return {
      args: [brandFacts, {
        competitors,
        agenda,
        board: gathered?.competitor_board || [],
        movements: gathered?.movements || [],
      }],
    }
  }
  if (key === 'craft') return { args: [brandFacts, { platforms: ['instagram'], agenda }] }
  return { args: null }
}

/**
 * Run exactly one lens and store its result.
 *
 * Never throws. A lens that fails, refuses or runs out of time still writes a
 * row, because synthesis decides it can start by counting rows — and a lens
 * that wrote nothing would stall the run forever rather than cost it one
 * sixth.
 */
export async function runSingleLens({ workspaceId, runId, lensKey, cadence = 'weekly', deadline }) {
  const startedAt = Date.now()
  const limit = deadline || deadlineFor('lens', startedAt)

  let result
  try {
    const ctxBundle = await loadRunContext(workspaceId, runId, cadence)
    const known = ctxBundle.lenses.map(l => l.key)
    if (!known.includes(lensKey)) {
      return { ok: false, status: 400, error: `This run does not include a "${lensKey}" lens.` }
    }

    // The two computed lenses first, because neither has a prompt and asking
    // LENS_PROMPTS for one would report "no prompt for this lens" on the two
    // lenses that are the most reliable things in the run.
    if (lensKey === 'ourselves') {
      result = await runOurselvesLens({ gathered: ctxBundle.gathered })
    } else if (lensKey === 'calendar') {
      const { calendar } = await argsForLens('calendar', ctxBundle)
      result = runCalendarLens({ calendar })
    } else {
      const build = LENS_PROMPTS[lensKey]
      const { args } = await argsForLens(lensKey, ctxBundle)
      if (!build || !args) {
        result = { lens: lensKey, ok: false, findings: [], sources: [], cost: 0, error: 'No prompt for this lens.' }
      } else {
        result = await runLens({
          workspaceId, runId, lensKey,
          prompt: build(...args), identity: IDENTITY, brand: ctxBundle.brand, deadline: limit,
        })
      }
    }
  } catch (err) {
    result = {
      lens: lensKey, ok: false, findings: [], sources: [], cost: 0,
      error: String(err?.message || err).slice(0, 300),
    }
  }

  const durationMs = Date.now() - startedAt
  if (result?.timedOut) result = { ...timedOutResult(lensKey, durationMs), cost: result.cost || 0 }

  // Upsert, so a retry replaces its own row instead of appending a second
  // result for the same lens.
  //
  // `on_conflict` is not optional here and its absence fails LOUDLY rather than
  // silently, which is the only pleasant thing about it: PostgREST resolves
  // merge-duplicates against the PRIMARY KEY by default, and the primary key
  // is a generated uuid that never collides. The uniqueness that matters is
  // the (run_id, lens) index, and it has to be named.
  await db('research_lens_results?on_conflict=run_id,lens', {
    method: 'POST',
    body: {
      workspace_id: workspaceId,
      run_id: runId,
      lens: lensKey,
      status: result.ok ? 'ok' : 'failed',
      findings: result.findings || [],
      sources: result.sources || [],
      note: result.note || '',
      error: String(result.error || '').slice(0, 500),
      cost_usd: Number((result.cost || 0).toFixed(6)),
      duration_ms: durationMs,
      timed_out: Boolean(result.timed_out || result.timedOut),
    },
    prefer: 'resolution=merge-duplicates,return=minimal',
  })

  return {
    ok: true,
    lens: lensKey,
    lens_ok: result.ok,
    findings: (result.findings || []).length,
    duration_ms: durationMs,
    timed_out: Boolean(result.timed_out || result.timedOut),
    cost_usd: Number((result.cost || 0).toFixed(6)),
    error: result.error || '',
  }
}

/**
 * Read what the lenses produced and write the brief.
 *
 * Never throws. On any failure the report handed back is the one gather
 * already committed — AGENT.md §6, and not negotiable: a failed investigation
 * must never cost the user their numbers.
 */
export async function synthesiseRun({ workspaceId, runId, cadence = 'weekly', deadline }) {
  const limit = deadline || deadlineFor('synthesise')
  const allowedUrls = new Set()
  let cost = 0

  let gathered = {}
  try {
    const ctxBundle = await loadRunContext(workspaceId, runId, cadence)
    gathered = ctxBundle.gathered
    const { brand, agenda, priorRuns, alreadySaid, motion, explicit, lenses } = ctxBundle

    const rows = await db(
      `research_lens_results?run_id=eq.${runId}&workspace_id=eq.${workspaceId}` +
      `&select=lens,status,findings,sources,note,error,cost_usd,timed_out,duration_ms`,
    )
    const results = resultsFromRows(rows || [])

    const stillPending = pendingLenses(lenses.map(l => l.key), rows || [])
    if (stillPending.length) {
      return {
        ok: false, status: 409,
        error: `${stillPending.length} lens(es) have not run yet: ${stillPending.join(', ')}.`,
        pending: stillPending,
      }
    }

    for (const r of results) {
      cost += r.cost || 0
      for (const u of r.sources || []) allowedUrls.add(u)
    }

    const findings = rankFindings(results.flatMap(r => r.findings || []))
    const summary = lensSummary(results)

    await markStage(workspaceId, runId, 'synthesise')
    const synth = await callModel({
      workspaceId, surface: 'run', runId, job: 'synthesise', stage: 'synthesise',
      identity: IDENTITY, brand,
      messages: [
        {
          role: 'user',
          content: [
            'These are this week\'s MEASURED numbers, computed in code. Given facts — do not',
            'recompute or contradict them.',
            '',
            JSON.stringify({
              board: gathered?.competitor_board || [],
              movements: gathered?.movements || [],
              baseline: gathered?.baseline,
              quiet_week: gathered?.quiet_week,
            }, null, 2),
            '',
            'These are the findings each research lens returned. A lens with no findings',
            'genuinely found nothing — say so rather than inventing something for it.',
            '',
            JSON.stringify({ findings, lenses: summary }, null, 2),
            '',
            agenda?.length
              ? `Standing questions a person asked you to watch:\n${agenda.map(a => `- ${a.subject}`).join('\n')}`
              : '',
            // Half one of the anti-repetition guarantee: tell it. Half two is
            // the code check below, because telling a model not to repeat
            // itself reliably produces a rephrasing rather than silence.
            alreadySaid?.length
              ? [
                  'IDEAS YOU HAVE ALREADY PROPOSED TO THIS BRAND. Do not propose any of',
                  'these again, and do not propose a reworded version — a check in code',
                  'will catch it and drop it before anyone reads this. If one of them is',
                  'still genuinely the right answer, say so explicitly as a repeat and',
                  'say what has changed since.',
                  ...alreadySaid.slice(0, 60).map(n => `- ${n.body}`),
                ].join('\n')
              : '',
            (priorRuns || []).length
              ? `Previous headlines:\n${priorRuns.map(r => `- ${r.report?.headline || ''}`).filter(Boolean).join('\n')}`
              : '',
          ].filter(Boolean).join('\n'),
        },
        { role: 'user', content: SYNTHESISE_PROMPT },
      ],
      maxTokens: 16_000, effort: 'high',
      outputFormat: BRIEF_SCHEMA,
      deadline: limit,
    })
    cost += synth.cost || 0

    if (!synth.ok) return bail(gathered, synth.error, cost, summary)
    if (refusalOf(synth.response)) return bail(gathered, refusalOf(synth.response), cost, summary)

    let brief = null
    try {
      brief = JSON.parse(textIn(synth.response))
    } catch (err) {
      return bail(gathered, `The brief did not parse: ${err.message}`, cost, summary)
    }

    const report = mergeBrief(gathered, brief, allowedUrls)
    report.lenses = summary
    report.findings = findings
    report.sales_motion = { motion, explicit }

    // ── Anti-repetition, enforced ──
    // The prompt above asked. This decides. A guarantee held only by a prompt
    // is not a guarantee, and "do not repeat yourself" is exactly the kind of
    // instruction a model satisfies by rewording.
    if (alreadySaid?.length) {
      const { fresh, repeats } = partitionRepeats(report.proposed_ideas || [], alreadySaid)
      report.proposed_ideas = fresh
      if (repeats.length) {
        report.repeated_ideas = repeats.map(r => ({
          idea: r.body,
          previously: r.matched?.body || '',
          first_proposed: r.matched?.created_at || null,
          times_proposed: Number(r.matched?.seen_count) || 1,
        }))
        report.unanswered = [
          ...(report.unanswered || []),
          `${repeats.length} idea${repeats.length === 1 ? ' was' : 's were'} dropped for repeating ` +
          'something already proposed. They are listed under repeated_ideas.',
        ]
      }
    }

    // Named plainly so a reader can tell "checked and quiet" from "never ran".
    const failed = summary.filter(s => !s.ran)
    if (failed.length) {
      report.unanswered = [
        ...(report.unanswered || []),
        ...failed.map(f => `The ${f.label} lens failed and was not answered: ${f.error}`),
      ]
    }

    // The calendar can succeed while still being built on a guess, and a lens
    // can be cut short by the clock rather than by the market. Both are worth
    // one line, because neither is visible in the findings themselves.
    const notes = [...results.map(r => r.note).filter(Boolean), timingNote(results)].filter(Boolean)
    if (notes.length) report.unanswered = [...(report.unanswered || []), ...notes]

    return { ok: true, report, cost, sources: [...allowedUrls], lenses: summary }
  } catch (err) {
    return bail(gathered, String(err?.message || err).slice(0, 400), cost, [])
  }
}

/**
 * Investigation failed — hand back the measured half with a note saying what
 * was lost. AGENT.md §6, and not negotiable: a failed investigation must never
 * cost the user their numbers.
 */
function bail(gathered, error, cost, lenses) {
  return {
    ok: false,
    error,
    cost,
    lenses,
    report: {
      ...gathered,
      lenses,
      unanswered: [
        ...(gathered.unanswered || []),
        `The investigation did not complete, so this brief is the measured numbers only. ${error}`,
      ],
    },
  }
}

// ─── Stage 5: writing the brief's proposals into their own tables ─────────
// Moved here from run.js when the run split into three routes: synthesise is
// the phase that produces a report, so it is the phase that persists one.
// Leaving it in run.js would have been a function only another file calls.

/**
 * Stage 5 — findings and proposals land where a human already reviews things.
 *
 * Everything lands as `proposed`. There is no path to `active` and no path to
 * publish, and that is enforced by there being no code here that writes one —
 * not by the model choosing well.
 *
 * Failures are logged, never thrown: the run is already complete by this
 * point, and losing the terminal status because one insert failed would trade
 * a missing proposal for a spinner nobody can close.
 */
export async function persistReport(workspaceId, runId, report) {
  const findings = [
    ...(report?.market || []).map(m => ({
      kind: 'trend', headline: m.finding, detail: '',
      sources: m.sources || [], confidence: m.confidence ?? null,
      novelty: m.novelty || 'new',
    })),
    ...(report?.gaps || []).map(g => ({
      kind: 'gap', headline: g.gap, detail: g.suggested_response || '',
      sources: [], evidence: { our_position: g.our_position, basis: g.basis },
      confidence: null, novelty: 'new',
    })),
  ]

  for (const f of findings) {
    await db('research_findings', {
      method: 'POST',
      body: { run_id: runId, workspace_id: workspaceId, evidence: {}, ...f },
      prefer: 'return=minimal',
    }).catch(err => console.error('[agent/synthesise] finding:', err.message))
  }

  for (const r of report?.proposed_rules || []) {
    await db('brand_memory', {
      method: 'POST',
      body: {
        workspace_id: workspaceId,
        rule: r.rule, detail: r.detail || '',
        scope: r.scope || 'trend',
        // 'proposed', always. The agent can fill your review queue; it cannot
        // steer a single caption without a person saying yes first.
        status: 'proposed',
        source: 'research',
        confidence: r.confidence ?? null,
        evidence: { sources: r.sources || [], run_id: runId },
      },
      prefer: 'return=minimal',
    }).catch(err => console.error('[agent/synthesise] rule:', err.message))
  }

  for (const a of report?.agenda_changes || []) {
    if (a.action !== 'add') continue   // retiring is a human decision
    await db('research_agenda', {
      method: 'POST',
      body: {
        workspace_id: workspaceId, kind: 'question',
        subject: a.subject, why: a.why || '',
        status: 'proposed', created_by: 'agent',
      },
      prefer: 'return=minimal',
    }).catch(err => console.error('[agent/synthesise] agenda:', err.message))
  }
}
