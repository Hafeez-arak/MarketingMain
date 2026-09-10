import { callModel } from './_provider.js'
import { db } from './_supabase.js'
import { loadBrandContext, IDENTITY } from './_context.js'
import { textIn, urlsFrom } from '../../src/lib/agent/loop.js'
import {
  BRIEF_SCHEMA, planPrompt, searchPrompt, REFLECT_PROMPT, SYNTHESISE_PROMPT, mergeBrief,
} from '../../src/lib/agent/brief.js'

// ─── Stages 1–4 — the agent's own invocation ───────────────────────────────
// AGENT.md §6. Stage 0 has already committed the numbers, so everything here
// is a bonus: if the key is missing, the model is unreachable, or the brief
// will not parse, the run still completes with the board plus a note saying
// what was lost.
//
//   1. Plan       one Opus call — what is worth chasing, given the numbers
//   2. Search     the only genuinely agentic part — bounded web search
//   3. Reflect    one call — what is still unanswered
//   4. Synthesise one Opus call, structured output — the brief
//
// WEB SEARCH IS SERVER-SIDE. The n8n version needed a Tavily key; the API runs
// web_search and web_fetch on Anthropic's own infrastructure, so there is no
// second provider to key, rate-limit or keep alive. `max_uses` is the bound,
// which makes the cap a property of the request rather than of a loop we have
// to police ourselves.

// The bound on the whole investigation. AGENT.md §7 names an unbounded loop as
// the only genuine runaway risk, and a weekly cron pointed at one is how a
// cheap job quietly becomes an expensive one.
const SEARCH_USES = 12
const REFLECT_SEARCH_USES = 4

/**
 * Server-side tools. `type` and `name` only — these carry no input_schema
 * because Anthropic defines them, and adding one would make them a different,
 * unrecognised tool.
 *
 * web_fetch only fetches URLs already present in the conversation, so it is
 * strictly a follow-up to a search rather than a way to reach an arbitrary
 * page — which is the behaviour we want anyway.
 */
const webTools = (uses) => ([
  { type: 'web_search_20260209', name: 'web_search', max_uses: uses },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: uses },
])

/**
 * Every URL the server-side tools actually returned, across a whole response.
 *
 * This is the citation allow-list, and with server tools it has to be built
 * from the response rather than from our own tool results. RESEARCH-AGENT.md's
 * rule stands either way: citations are checked, not trusted, because a
 * plausible-looking URL a model invented is worse than no citation at all — it
 * survives a skim.
 *
 * Server-tool errors do not throw. They come back as a result block whose
 * content is an error OBJECT rather than a list, so this walks the structure
 * and picks up strings that look like URLs instead of assuming a shape.
 */
export function urlsFromResponse(response, found = new Set()) {
  for (const block of response?.content || []) {
    if (block?.type === 'web_search_tool_result' || block?.type === 'web_fetch_tool_result') {
      urlsFrom(block.content, found)
    }
  }
  return found
}

/** Did this response refuse? Only then is stop_details populated. */
function refusalOf(response) {
  if (response?.stop_reason !== 'refusal') return ''
  const d = response.stop_details
  return `The model declined this stage${d?.category ? ` (${d.category})` : ''}.`
}

/**
 * Run stages 1–4 on top of a completed stage 0.
 *
 * Never throws. Returns { ok, report, error } — and on any failure the report
 * handed back is the one gather already committed, so a broken investigation
 * costs the reader nothing they already had.
 */
export async function investigate({ workspaceId, runId, gathered }) {
  const allowedUrls = new Set()
  let cost = 0
  const note = []

  try {
    const [{ brand }, agenda, priorRuns] = await Promise.all([
      loadBrandContext(workspaceId, 'research'),
      db(`research_agenda?workspace_id=eq.${workspaceId}&kind=eq.question&status=eq.active` +
         `&select=id,subject,why`),
      db(`research_runs?workspace_id=eq.${workspaceId}&id=neq.${runId}&status=eq.complete` +
         `&order=started_at.desc&limit=3&select=report`),
    ])

    const priorHeadlines = (priorRuns || [])
      .map(r => r.report?.headline).filter(Boolean)

    const common = { workspaceId, surface: 'run', runId, identity: IDENTITY, brand }

    // ── Stage 1: plan ──
    await stage(workspaceId, runId, 'plan')
    const plan = await callModel({
      ...common, job: 'plan', stage: 'plan',
      messages: [{ role: 'user', content: planPrompt({ report: gathered, agenda, priorHeadlines }) }],
      maxTokens: 4_000, effort: 'high',
    })
    cost += plan.cost || 0
    if (plan.refused) return bail(gathered, plan.error, cost, note)
    if (!plan.ok) return bail(gathered, plan.error, cost, note)
    const planText = textIn(plan.response) || refusalOf(plan.response)
    if (refusalOf(plan.response)) return bail(gathered, refusalOf(plan.response), cost, note)

    // ── Stage 2: search ──
    // The only genuinely agentic part, and the one held on the shortest rope.
    await stage(workspaceId, runId, 'search')
    const search = await callModel({
      ...common, job: 'search', stage: 'search',
      tools: webTools(SEARCH_USES),
      messages: [{ role: 'user', content: searchPrompt(planText) }],
      maxTokens: 16_000, effort: 'medium',
    })
    cost += search.cost || 0
    if (search.ok) {
      urlsFromResponse(search.response, allowedUrls)
    } else {
      // A failed search is not a failed run. The brief can still be written
      // from the measured numbers alone; it will just have less to explain
      // them with, and `unanswered` will say so.
      note.push(`The web search stage failed: ${search.error}`)
    }
    const searchText = search.ok ? textIn(search.response) : '(the web search stage failed)'

    // ── Stage 3: reflect ──
    // Exactly one more round is permitted. Otherwise a curious agent bills you
    // all afternoon.
    await stage(workspaceId, runId, 'reflect')
    const reflect = await callModel({
      ...common, job: 'reflect', stage: 'reflect',
      tools: webTools(REFLECT_SEARCH_USES),
      messages: [
        { role: 'user', content: searchPrompt(planText) },
        { role: 'assistant', content: searchText || '(nothing found)' },
        { role: 'user', content: REFLECT_PROMPT },
      ],
      maxTokens: 8_000, effort: 'medium',
    })
    cost += reflect.cost || 0
    if (reflect.ok) urlsFromResponse(reflect.response, allowedUrls)
    const reflectText = reflect.ok ? textIn(reflect.response) : ''

    // ── Stage 4: synthesise ──
    // Structured output, so the brief either parses or the stage fails loudly.
    // Parsing prose here and hoping would put the whole investigation at the
    // mercy of a stray code fence.
    await stage(workspaceId, runId, 'synthesise')
    const synth = await callModel({
      ...common, job: 'synthesise', stage: 'synthesise',
      messages: [
        { role: 'user', content: planPrompt({ report: gathered, agenda, priorHeadlines }) },
        { role: 'assistant', content: planText },
        { role: 'user', content: searchPrompt(planText) },
        { role: 'assistant', content: searchText || '(nothing found)' },
        ...(reflectText ? [{ role: 'user', content: REFLECT_PROMPT }, { role: 'assistant', content: reflectText }] : []),
        { role: 'user', content: SYNTHESISE_PROMPT },
      ],
      maxTokens: 16_000, effort: 'high',
      outputFormat: BRIEF_SCHEMA,
    })
    cost += synth.cost || 0
    if (!synth.ok) return bail(gathered, synth.error, cost, note)
    if (refusalOf(synth.response)) return bail(gathered, refusalOf(synth.response), cost, note)

    let brief = null
    try {
      brief = JSON.parse(textIn(synth.response))
    } catch (err) {
      return bail(gathered, `The brief did not parse: ${err.message}`, cost, note)
    }

    const report = mergeBrief(gathered, brief, allowedUrls)
    if (note.length) report.unanswered = [...(report.unanswered || []), ...note]

    return { ok: true, report, cost, sources: [...allowedUrls] }
  } catch (err) {
    return bail(gathered, String(err?.message || err).slice(0, 400), cost, note)
  }
}

/**
 * Investigation failed — hand back the measured half with a note saying what
 * was lost.
 *
 * This is the guarantee AGENT.md §6 makes and it is not negotiable: no key, an
 * unreachable model, garbled output or an exception, and the user still gets
 * their board. A failed investigation must never cost them their numbers.
 */
function bail(gathered, error, cost, note) {
  return {
    ok: false,
    error,
    cost,
    report: {
      ...gathered,
      unanswered: [
        ...(gathered.unanswered || []),
        ...note,
        `The investigation stages did not complete, so this brief is the measured numbers only. ${error}`,
      ],
    },
  }
}

/** Move the run's stage marker, for the progress line the page shows. */
function stage(workspaceId, runId, name) {
  return db(
    `research_runs?id=eq.${encodeURIComponent(runId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    { method: 'PATCH', body: { stage: name }, prefer: 'return=minimal' },
  ).catch(() => {})
}
