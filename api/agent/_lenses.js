import { callModel } from './_provider.js'
import { db } from './_supabase.js'
import { textIn, urlsFromResponse } from '../../src/lib/agent/loop.js'
import { lensByKey, makeFinding } from '../../src/lib/agent/lenses.js'
import { findingsFromEvents } from '../../src/lib/agent/calendar.js'
import { ownChannelFindings } from '../../src/lib/agent/ownChannels.js'
import { CHANNELS, SIGNAL_CATEGORIES } from '../../src/lib/agent/intel.js'
import { searchConfig, searchFindings, lineOf } from '../../src/lib/agent/searchConsole.js'
import { fetchSearchData } from './_searchConsole.js'

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
        // ── THIS DESCRIPTION USED TO UNDO THE PROMPT ──
        //
        // It said: "Returning an empty array is a correct and common answer —
        // most weeks most lenses find nothing, and saying so is worth more
        // than padding."
        //
        // That is the instruction lensPrompts.js documents at length as THE
        // INSTRUCTION THAT COST US EVERY FINDING, and which was removed from
        // the prompt on 2026-09-12 after it threw away a 300-key Waldorf
        // Astoria conversion. It survived here, untouched since #21 — so the
        // prompt said "report what you found" while the schema, sitting right
        // next to the output, said "finding nothing is normal". On 2026-09-15
        // the events, demand and category lenses read 130 sources between
        // them and returned valid, empty arrays, billed and recorded as `ok`.
        //
        // An instruction that lives in two places has to be fixed in two
        // places. Uncertainty belongs in `confidence`, never in silence.
        description:
          'What you actually established, with an honest confidence on each. A partial or ' +
          'low-confidence finding is worth reporting — a reader can discount a 0.35, but ' +
          'cannot discount an empty array, which is indistinguishable from never having ' +
          'looked. Only return an empty array if you genuinely read the sources and there ' +
          'was nothing in them; if you read many sources, that should be rare.',
        items: {
          type: 'object',
          additionalProperties: false,
          // ── Keep optional fields FEW ──
          // Structured outputs refuses a schema with more than 24 optional
          // parameters, counted across every nested object. On 2026-09-15 this
          // one had 32 — every lead and event field was optional — and all five
          // searching lenses were refused with a 400 before doing any work. So
          // everything a finding always has is required (an empty string is a
          // valid "not established").
          //
          // Nine are optional now, not five: 2026-09-16 established that making
          // a field REQUIRED that the model often cannot establish does not
          // produce an empty string, it produces an empty findings array. The
          // four added back are the ones with no honest empty value — a source's
          // `quote` and `title`, an event's `exhibitor_deadline` and
          // `competitors_exhibiting`. schemaLimits.test.js counts them and holds
          // the total under a budget of 12, well inside the API's 24.
          required: [
            'headline', 'detail', 'confidence', 'suggested_action', 'for_whom', 'relevance',
            'competitor', 'channel', 'category', 'sources',
          ],
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
            // Who owns this. Not what it is ABOUT — see the description: a
            // certification deadline is a technical subject and a marketing
            // opportunity at the same time, and the whole point of this field
            // is to keep that case in front of marketing rather than filing it
            // away under its subject matter.
            for_whom: {
              type: 'string',
              enum: ['marketing', 'sales', 'both', 'technical'],
              description:
                'Who acts on this. Use "sales" when the action is to contact someone, bid, or get ' +
                'specified on a project. Otherwise judge by whether there is something to PUBLISH, never by ' +
                'how technical the subject sounds. A mandatory certification deadline is a ' +
                'technical fact and an excellent post ("we are already compliant — here is ' +
                'what specifiers must check before the date"), so it is "both", not ' +
                '"technical". Use "marketing" (the default) when only marketing acts. Use ' +
                '"both" when there is a publishable angle AND the product or technical team ' +
                'needs to know. Use "technical" ONLY when you have looked for a publishable ' +
                'angle and there genuinely is not one — it must carry a technical_note saying ' +
                'so, and without one it will be shown to marketing anyway.',
            },
            technical_note: {
              type: 'string',
              description:
                'One line for the product or technical team: what they need to check, decide ' +
                'or do. Required whenever for_whom is "both" or "technical". On "technical" ' +
                'it must also say why there is no marketing angle.',
            },
            // ── Added 2026-09-15: what makes a finding a storable signal, and
            // a lead or an event a row the team can work across weeks. See
            // src/lib/agent/intel.js for how each is matched against the store.
            relevance: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'How much it MATTERS (not how sure you are). low is stored but not reported.',
            },
            competitor: { type: 'string', description: 'Competitor name exactly as listed, or an empty string for the market.' },
            channel: { type: 'string', enum: CHANNELS, description: 'Where you actually saw it.' },
            category: { type: 'string', enum: SIGNAL_CATEGORIES },
            lead: {
              type: 'object',
              additionalProperties: false,
              description: 'Fill for a tender, project or named prospect. Every field is required; use an empty string for one you did not establish.',
              required: ['name', 'type', 'client', 'contractor', 'consultant', 'location', 'scope', 'stage', 'deadline', 'timing'],
              properties: {
                name: { type: 'string', description: 'The project or tender\'s OWN name, stable week to week. Never a sentence.' },
                type: { type: 'string', enum: ['tender', 'project', 'lead', ''] },
                client: { type: 'string' },
                contractor: { type: 'string' },
                consultant: { type: 'string' },
                location: { type: 'string' },
                scope: { type: 'string' },
                stage: { type: 'string', description: 'e.g. design, tender, awarded, construction, fit-out.' },
                deadline: { type: 'string', description: 'ISO date, only when established.' },
                timing: { type: 'string', enum: ['open', 'closed', 'unconfirmed', ''] },
              },
            },
            event: {
              type: 'object',
              additionalProperties: false,
              // `exhibitor_deadline` and `competitors_exhibiting` are optional:
              // they are the two an event page almost never carries, and the
              // rest are satisfiable with an empty string. The name is what
              // makes the row, and eventFromFinding drops anything without one.
              description: 'Fill for an expo, conference, awards or sponsorship opening. Only the name is essential — use an empty string for anything else you did not establish, and omit the exhibitor deadline and competitor list entirely if you did not find them. A named event with nothing but a city is still worth reporting.',
              required: ['name', 'start_date', 'end_date', 'venue', 'city', 'organizer', 'url'],
              properties: {
                name: { type: 'string', description: 'Official name.' },
                start_date: { type: 'string' },
                end_date: { type: 'string' },
                venue: { type: 'string' },
                city: { type: 'string' },
                organizer: { type: 'string' },
                url: { type: 'string' },
                exhibitor_deadline: { type: 'string' },
                competitors_exhibiting: { type: 'array', items: { type: 'string' } },
              },
            },
            // ── WHY `quote` AND `title` ARE OPTIONAL ──
            //
            // #64 made all three required. `sources` is itself required on
            // every finding, and CLOSING forbids inventing — so a page you
            // read but cannot quote verbatim left no legal way to file the
            // finding at all, and dropping it became the cheapest compliant
            // answer.
            //
            // The lenses it killed say which: rivals and openings read news
            // and company pages, where a supporting sentence is easy, and
            // both returned 5 findings on 2026-09-15. demand, category and
            // events synthesise across many pages — or read exhibitor lists
            // and tables that contain no prose sentence at all — and all
            // three returned zero from 130 sources the same day, having
            // returned 3 and 4 the day before.
            //
            // A URL is the part that makes a finding checkable. Demanding
            // prose that some sources do not contain buys nothing and costs
            // everything.
            // ── DISTRIBUTION RIGHTS ARE THE COMPETITIVE POSITION ──
            //
            // In lighting, who holds which agency decides who can bid what. The
            // rivals prompt already asks for this and the store already has a
            // table for it (competitor_brands), and until now a lens that found
            // "X is the exclusive agent for Y" had nowhere to put it: the fact
            // ended up as prose inside a headline, unqueryable. The run of
            // 2026-09-17 found exactly that about Al Nasser and Berker and lost
            // it that way.
            //
            // One optional field, and every field inside it required, so this
            // costs a single optional parameter against the API's limit of 24.
            // `relationship` keeps 'claimed' (what they say) apart from
            // 'unconfirmed' (what we inferred) — that difference is the whole
            // value of the table.
            brands: {
              type: 'array',
              description:
                'Manufacturer brands or agencies this competitor carries, when a source says so. Omit ' +
                'entirely if the finding is not about distribution. Only what the page actually states.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['brand', 'relationship'],
                properties: {
                  brand: { type: 'string', description: 'The manufacturer or brand name, as written on the source.' },
                  relationship: {
                    type: 'string',
                    enum: ['exclusive', 'non_exclusive', 'claimed', 'unconfirmed', 'ended'],
                    description:
                      'exclusive / non_exclusive when the source states the arrangement; "claimed" when the ' +
                      'competitor asserts it about themselves; "unconfirmed" when you inferred it; "ended" ' +
                      'when a source says the arrangement has stopped.',
                  },
                },
              },
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
                  quote: {
                    type: 'string',
                    description:
                      'The sentence that actually supports this, when the page contains one. ' +
                      'Omit it for a listing, table, exhibitor list or PDF with no quotable ' +
                      'sentence, or when the detail sits behind a login — that is a fact about ' +
                      'the source, never a reason to drop the finding. Do not paraphrase into ' +
                      'quotation marks.',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}

/**
 * Server-side web search and fetch, bounded by the lens's own budget.
 *
 * ── SEARCHING AND READING ARE NOT THE SAME BUDGET ──
 *
 * Both tools used to take the same number, which reads as tidy and is wrong:
 * a search FINDS a page and a fetch READS it, and one search routinely turns
 * up three documents worth opening. Worse, exceeding `max_uses` is not an
 * exception — the API returns HTTP 200 with an `max_uses_exceeded` error
 * object in the result block, which from inside the turn is indistinguishable
 * from the web being down. On 2026-09-17 the demand lens said exactly that:
 * "every search and fetch call was blocked before a single result came back."
 *
 * `calendar.js` carries the same scar from a different lens.
 *
 * So fetches default to searches + 2. The demand lens needs it most — since
 * #71 its whole job is reading DOCUMENTS (tender criteria, job adverts,
 * standards consultations), and a document has to be fetched to be cited.
 */
const webTools = ({ searches = 0, fetches = null } = {}) => (searches > 0
  ? [
      { type: 'web_search_20260209', name: 'web_search', max_uses: searches },
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: fetches ?? searches + 2 },
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
  workspaceId, runId, lensKey, prompt, identity, brand, deadline = null, line = '',
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
      tools: webTools(lens.budget),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: lens.budget.maxTokens || 8_000,
      effort: lens.budget.effort || 'medium',
      outputFormat: FINDINGS_SCHEMA,
      // On Vercel Hobby the function ceiling is 300s and cannot be raised, and
      // this lens was measured at 380s. Stopping ourselves lets us report what
      // happened; being stopped by the platform writes nothing at all.
      deadline,
    })

    if (out.refused) return { lens: lensKey, ok: false, findings: [], sources: [], cost: out.cost || 0, error: out.error }
    if (!out.ok) {
      return {
        lens: lensKey, ok: false, findings: [], sources: [], cost: out.cost || 0,
        error: out.error, timedOut: Boolean(out.timedOut),
      }
    }

    urlsFromResponse(out.response, allowed)

    let parsed = []
    try {
      // `?.findings || []` used to stand here, and it conflated two completely
      // different outcomes: the model answering "nothing this week", and the
      // model returning a shape we did not ask for. Both produced an empty
      // array, `ok: true`, and a row indistinguishable from a quiet week.
      // A missing key is this lens failing and must say so.
      const body = JSON.parse(textIn(out.response))
      if (!body || !Array.isArray(body.findings)) {
        return {
          lens: lensKey, ok: false, findings: [], sources: [...allowed],
          cost: out.cost || 0,
          error: 'Findings missing: the response parsed but had no `findings` array.',
        }
      }
      parsed = body.findings
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
      // `line` is the pass this lens was run as — see makeFinding. A finding
      // from the controls pass is a controls finding without anyone having to
      // recognise the word "KNX" in its headline.
      findings: parsed.map(f => makeFinding(lensKey, f, line)),
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
 * CALENDAR — arithmetic, and no model at all.
 *
 * This was a hybrid: computed dates, then a model call asked to say what the
 * brand should DO about each one and which trade shows were coming. The
 * computed half was written first precisely so it would survive the model half
 * failing — and on 2026-09-12 it had to. The model half hit its 150s budget,
 * was stopped, billed nothing and produced nothing, while the free computed
 * half produced the only real finding in the entire brief.
 *
 * That happened often enough to stop calling it a bad minute. So both of the
 * model's jobs moved to where they are already being done:
 *
 *   "what should we do about this date"  ->  synthesis, which reads every
 *       finding with the full brand context in front of it and was already
 *       doing this unprompted — the National Day judgement in that same brief
 *       came out of synthesis, not out of this lens.
 *   "which trade shows are coming"       ->  the openings lens, which is
 *       already searching this market for dated events and has a proven hit.
 *
 * What is left is arithmetic over free APIs. A lens whose only valuable half
 * is free should not carry a bill, and the guarantee that used to need
 * defending — computed dates survive a model failure — is now structural,
 * because there is no model call left to fail.
 *
 * A computed date carries confidence 1 and no sources. That is correct rather
 * than sloppy: its provenance is an arithmetic conversion, not a page someone
 * read, and the citation filter must not treat it as an unsupported claim.
 *
 * Synchronous on purpose — there is nothing left here to await.
 */
export function runCalendarLens({ calendar }) {
  try {
    const findings = findingsFromEvents(calendar?.events || [])
      .map(f => makeFinding('calendar', f))

    return {
      lens: 'calendar',
      // True even with no events. A window containing no dated moment is a
      // real answer, and "checked and quiet" must never look like "failed" —
      // that distinction is the whole reason lensSummary exists.
      ok: true,
      findings,
      sources: [...new Set(calendar?.sources || [])],
      cost: 0,
      error: '',
      note: calendar?.note || '',
    }
  } catch (err) {
    return {
      lens: 'calendar', ok: false, findings: [], sources: [], cost: 0,
      note: calendar?.note || '',
      error: String(err?.message || err).slice(0, 300),
    }
  }
}

/**
 * The one lens that makes no model call.
 *
 * Our own numbers are computed, not researched, so this reads what stage 0
 * already measured and turns it into findings directly. It is listed as a lens
 * rather than left implicit so the brief can report it as checked-and-quiet
 * instead of silently absent — a lens that found nothing and a lens that never
 * ran must never look the same.
 *
 * TWO SOURCES, AND THEY ARE NOT THE SAME KIND OF FACT:
 *
 *   `movements` come from business_discovery — our Instagram account read the
 *   same way a rival's is, which is what makes the competitor board comparable
 *   at all. Follower counts and cadence, Instagram only, forever.
 *
 *   `own_performance` comes from our own published posts and their analytics
 *   rows, on EVERY platform we publish to. This is the half that was missing:
 *   the agent measured our Instagram profile but never once looked at how our
 *   own TikTok or LinkedIn posts actually did, though the rows were sitting in
 *   post_analytics the whole time.
 */
export async function runOurselvesLens({ gathered }) {
  try {
    const board = gathered?.competitor_board || []
    const movements = (gathered?.movements || []).filter(m => m.competitor === 'Us')
    const own = gathered?.own_performance || null
    const findings = []

    for (const m of movements) {
      findings.push(makeFinding('ourselves', {
        headline: `Our ${m.metric} moved ${m.from} → ${m.to} (${m.change_pct}%).`,
        detail: `Measured, not estimated. Significance: ${m.significance}. Instagram profile data.`,
        confidence: 1,
        novelty: 'changed',
        evidence: m,
        suggested_action: m.direction === 'down'
          ? 'Establish whether this was deliberate before treating it as a signal.'
          : '',
      }))
    }

    for (const raw of ownChannelFindings(own)) {
      findings.push(makeFinding('ourselves', raw))
    }

    const measurable = board.filter(c => c.data === 'instagram').length
    if (!findings.length && measurable === 0) {
      // Explicitly a quiet result rather than an empty one. `note` carries the
      // reason, so the brief can say WHY it is quiet rather than leaving a
      // reader to assume the lens broke.
      return {
        lens: 'ourselves', ok: true, findings: [], sources: [], cost: 0, error: '',
        note: own?.note || '',
      }
    }

    return { lens: 'ourselves', ok: true, findings, sources: [], cost: 0, error: '', note: own?.note || '' }
  } catch (err) {
    return { lens: 'ourselves', ok: false, findings: [], sources: [], cost: 0, error: String(err?.message || err) }
  }
}

/**
 * Search demand — measured, not researched.
 *
 * Reads Search Console for the brand's own property and turns the rows into
 * findings. Makes no model call, so it costs nothing and cannot time out on a
 * slow search.
 *
 * THE THREE OUTCOMES ARE DELIBERATELY DISTINCT, and keeping them apart is the
 * whole reason this is a lens rather than a few extra rows inside `ourselves`:
 *
 *   unconfigured  no property set for this brand. ok, with a note. Nothing is
 *                 wrong; there is simply nothing to read.
 *   failed        a property IS configured and the call did not work — a bad
 *                 key, a service account nobody added, a revoked grant. This
 *                 must surface as FAILED, because a broken credential that
 *                 reports "nothing found" is indistinguishable from nobody
 *                 searching for us, and the report would state the second with
 *                 total confidence.
 *   quiet         it answered and had nothing. A real result.
 */
export async function runSearchLens({ profile, ctx, now = new Date() }) {
  try {
    const { site, lines, brandTerms } = searchConfig(profile || {}, ctx || {})
    const data = await fetchSearchData({ site, now })

    if (!data.configured) {
      return {
        lens: 'search', ok: true, findings: [], sources: [], cost: 0, error: '',
        note: `${data.error} Set customFields.website to the verified Search Console property and add the ` +
          'service account as a user on it.',
      }
    }
    if (!data.ok) {
      return { lens: 'search', ok: false, findings: [], sources: [], cost: 0, error: data.error, note: '' }
    }

    const findings = searchFindings({
      queries: data.queries, pages: data.pages, previous: data.previous,
      brandTerms, lines, site: data.site,
      // The line is stamped in code from the landing page, never asked of a
      // model: the URL is a fact and lenses.js must stay free of any one
      // brand's vocabulary. An unclassified finding carries ''.
    }).map(raw => makeFinding('search', { ...raw, line: lineOf(raw.evidence || {}, lines) }))

    return {
      lens: 'search', ok: true, findings, sources: [], cost: 0, error: '',
      note: `${data.site}, ${data.windows.current.start} to ${data.windows.current.end}.`,
    }
  } catch (err) {
    return { lens: 'search', ok: false, findings: [], sources: [], cost: 0, error: String(err?.message || err).slice(0, 300) }
  }
}

/** Move the run's stage marker so the page can show progress. */
export function markStage(workspaceId, runId, name) {
  return db(
    `research_runs?id=eq.${encodeURIComponent(runId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    { method: 'PATCH', body: { stage: name }, prefer: 'return=minimal' },
  ).catch(() => {})
}
