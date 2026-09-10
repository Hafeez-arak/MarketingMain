import { callModel } from './_provider.js'
import { db } from './_supabase.js'
import { loadBrandContext, IDENTITY } from './_context.js'
import { textIn, urlsFromResponse } from '../../src/lib/agent/loop.js'
import { BRIEF_SCHEMA, SYNTHESISE_PROMPT, mergeBrief } from '../../src/lib/agent/brief.js'
import { lensesFor, motionOf, lensSummary, rankFindings } from '../../src/lib/agent/lenses.js'
import { LENS_PROMPTS } from '../../src/lib/agent/lensPrompts.js'
import { runLens, runOurselvesLens, markStage } from './_lenses.js'

// Re-exported: the resolver imported it from here before it moved to loop.js.
export { urlsFromResponse }

// ─── Stages 1–4, as six lenses rather than one chain ───────────────────────
// AGENT.md §6, restructured. Stage 0 has already committed the numbers, so
// everything here is a bonus: a failure returns the gathered report with a note
// saying what was lost.
//
// The old shape was serial — instagram → plan → search → reflect → write — and
// every stage depended on the one before. When Instagram was blocked on
// 2026-09-10 the whole run had nothing to say, though five other questions were
// still perfectly answerable.
//
// Now: lenses run in PARALLEL, each isolated, each producing findings. One
// synthesis reads all of them. A lens that fails costs one sixth of the run and
// the brief says which sixth.

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
 * Run the lenses and synthesise one brief.
 *
 * Never throws. Returns { ok, report, error, lenses } — and on any failure the
 * report handed back is the one gather already committed.
 */
export async function investigate({ workspaceId, runId, gathered, cadence = 'weekly' }) {
  const allowedUrls = new Set()
  let cost = 0

  try {
    const [{ brand, ctx, profile }, agenda, priorRuns, competitorRows] = await Promise.all([
      loadBrandContext(workspaceId, 'research'),
      db(`research_agenda?workspace_id=eq.${workspaceId}&kind=eq.question&status=eq.active&select=subject,why`),
      db(`research_runs?workspace_id=eq.${workspaceId}&id=neq.${runId}&status=eq.complete` +
         `&order=started_at.desc&limit=3&select=report`),
      db(`research_agenda?workspace_id=eq.${workspaceId}&kind=eq.competitor&status=neq.retired&select=subject`),
    ])

    // How this brand sells decides which lenses lead. Inferred from the Brand
    // Brain until someone sets it explicitly — see motionOf().
    const { motion, explicit } = motionOf(profile || {})
    const competitors = (competitorRows || []).map(r => r.subject).filter(Boolean)

    const brandFacts = {
      brandName: ctx?.brandName || '',
      descriptor: ctx?.brandDescriptor || '',
      audience: (profile?.targetPersonas || '').split('\n').slice(0, 4).join('; '),
      geography: profile?.customFields?.geography || '',
    }

    const lenses = lensesFor({ motion, cadence })
    const window = lookahead(8)

    const argsFor = {
      calendar: () => [brandFacts, window],
      openings: () => [brandFacts, { motion }],
      demand:   () => [brandFacts, { competitors }],
      rivals:   () => [brandFacts, {
        competitors,
        board: gathered?.competitor_board || [],
        movements: gathered?.movements || [],
      }],
      craft:    () => [brandFacts, { platforms: ['instagram'] }],
    }

    // ── Run them in parallel ──
    // Independent by construction: runLens never throws, so Promise.all cannot
    // reject and one lens cannot take the others down with it.
    await markStage(workspaceId, runId, 'lenses')
    const results = await Promise.all(lenses.map(lens => {
      if (lens.key === 'ourselves') return runOurselvesLens({ gathered })
      const build = LENS_PROMPTS[lens.key]
      const args = argsFor[lens.key]
      if (!build || !args) {
        return { lens: lens.key, ok: false, findings: [], sources: [], cost: 0, error: 'No prompt for this lens.' }
      }
      return runLens({
        workspaceId, runId, lensKey: lens.key,
        prompt: build(...args()),
        identity: IDENTITY, brand,
      })
    }))

    for (const r of results) {
      cost += r.cost || 0
      for (const u of r.sources || []) allowedUrls.add(u)
    }

    const findings = rankFindings(results.flatMap(r => r.findings || []))
    const summary = lensSummary(results)

    // ── One synthesis over everything ──
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
            (priorRuns || []).length
              ? `Previous headlines:\n${priorRuns.map(r => `- ${r.report?.headline || ''}`).filter(Boolean).join('\n')}`
              : '',
          ].filter(Boolean).join('\n'),
        },
        { role: 'user', content: SYNTHESISE_PROMPT },
      ],
      maxTokens: 16_000, effort: 'high',
      outputFormat: BRIEF_SCHEMA,
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

    // Named plainly so a reader can tell "checked and quiet" from "never ran".
    const failed = summary.filter(s => !s.ran)
    if (failed.length) {
      report.unanswered = [
        ...(report.unanswered || []),
        ...failed.map(f => `The ${f.label} lens failed and was not answered: ${f.error}`),
      ]
    }

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
