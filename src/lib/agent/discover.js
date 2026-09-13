// ─── Finding rivals nobody listed ──────────────────────────────────────────
// RESEARCH-AGENT.md §5 calls this "not optional any more", and the live
// database is why: Alo Kheyatah has no competitor section at all, so for that
// workspace every competitor-shaped question the agent can ask is unanswerable
// before it starts. Arak has seven rows, one of them blank. Aqeeq has five.
// Nobody is going to sit down and type the rest.
//
// THE BOUNDARY THIS LIVES INSIDE — §5a, and it is the whole design:
//
// A discovered rival is written to `research_agenda`, which is the AGENT's
// watchlist, and never to `brand_directory_rows`, which is the company's own
// statement about itself. The agent has no tool that writes the Brand Brain
// and none is added here. If a person decides a discovered rival belongs in
// the directory, they put it there by hand.
//
// So the watchlist is a SUPERSET of the directory, and the difference between
// them is information rather than drift.
//
// Everything lands as `status = 'proposed'`. The agent never promotes its own
// finding to something that steers a measurement.
//
// ── WHY THE JUDGEMENT IS SPLIT THE WAY IT IS ──
//
// Searching the open web for "who else sells this in this market" is a genuine
// search problem, so a model does it. Deciding whether a returned name is
// ALREADY on the watchlist is not a judgement at all — it is string matching,
// and a model asked to do it will occasionally decide that "Technolight" and
// "Techno Light Est." are different companies, proposing a duplicate that a
// person then has to notice. That half is arithmetic here, and testable.

import { norm, domainOf, tokensOf } from './resolve.js'

/** Never propose more than this in one pass. A wall of 40 names gets ignored wholesale. */
export const MAX_PROPOSALS = 8

/**
 * What the model must hand back.
 *
 * `why` and `evidence_url` are required for a reason that outlives this file:
 * a proposed rival with no stated reason is one a person cannot accept or
 * reject without doing the research themselves, which is the work they were
 * trying to avoid. A name alone is not a proposal, it is homework.
 */
export const DISCOVER_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['competitors'],
    properties: {
      competitors: {
        type: 'array',
        description:
          'Companies that genuinely compete with this brand. An empty array is a correct ' +
          'answer — a market with few real rivals is a finding, and padding it with vaguely ' +
          'adjacent companies makes the watchlist worse, not longer.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'why'],
          properties: {
            name: { type: 'string', description: 'The company name as it trades, not a URL or handle.' },
            website: { type: 'string', description: 'Their own domain, if you saw it. Omit rather than guess.' },
            why: {
              type: 'string',
              description:
                'One sentence: what makes them a competitor to THIS brand specifically — same ' +
                'buyers, same product, same market. "They are in lighting" is not a reason.',
            },
            evidence_url: { type: 'string', description: 'A page you actually read that shows this.' },
            overlap: {
              type: 'string',
              enum: ['direct', 'adjacent'],
              description:
                'direct = sells substantially what we sell to substantially our buyers. ' +
                'adjacent = overlaps on part of it. Be honest; adjacent is useful and common.',
            },
          },
        },
      },
    },
  },
}

/**
 * The prompt. Built from the brand's own facts, with nothing about any
 * industry hardcoded — the same reason lenses.js has none.
 */
export function discoverPrompt(brand = {}, { known = [], market = '', language = '' } = {}) {
  return [
    'Find companies that compete with this brand.',
    '',
    `Brand: ${brand.brandName || '(unnamed)'}`,
    brand.descriptor ? `What they do: ${brand.descriptor}` : '',
    brand.audience ? `Who they sell to: ${brand.audience}` : '',
    market ? `Market: ${market}` : '',
    '',
    known.length
      ? `ALREADY ON THE WATCHLIST — do not return these, they are covered:\n${known.map(k => `- ${k}`).join('\n')}`
      : 'Nothing is on the watchlist yet, so everything real is worth proposing.',
    '',
    language
      ? `Search in ${language} as well as English. The companies that matter in this market ` +
        'often have no English web presence at all, and an English-only search finds the ' +
        'exporters rather than the actual local competition.'
      : '',
    '',
    'What makes this useful rather than a list of names:',
    '- A competitor is someone whose existence changes what this brand should do. Sells to the',
    '  same buyers, in the same market, solving the same problem.',
    '- A giant multinational that technically makes the same product but never bids on the same',
    '  work is NOT a competitor for this purpose. Say so by omitting it.',
    '- Every entry needs a page you actually read. No source, no proposal.',
    '- Returning nothing is a real answer. Padding the list wastes a person\'s attention, which',
    '  is the scarcest thing this whole system spends.',
    `- At most ${MAX_PROPOSALS}.`,
  ].filter(Boolean).join('\n')
}

/**
 * Is this candidate already something we watch?
 *
 * Two ways to be the same company, and both matter:
 *
 *   Same domain — conclusive. Two names for one website is one rival.
 *   Same normalised name, or one name containing the other's significant
 *   tokens — "Technolight", "Techno Light" and "Techno Light Est." are one
 *   company written three ways, and proposing all three is how a watchlist
 *   becomes something nobody reads.
 *
 * Deliberately biased toward calling a near-match a duplicate. A rival wrongly
 * suppressed can be added by hand in seconds; a watchlist with three spellings
 * of one company quietly corrupts every count in the brief that follows.
 */
export function isKnown(candidate, known) {
  const cName = norm(candidate?.name)
  if (!cName) return true // an unnamed candidate is never proposable
  const cDom = domainOf(candidate?.website)
  const cToks = tokensOf(candidate?.name)

  for (const k of (Array.isArray(known) ? known : [])) {
    const kName = norm(k?.name ?? k)
    const kDom = domainOf(k?.website)

    if (cDom && kDom && cDom === kDom) return true
    if (kName && cName === kName) return true
    if (kName && cName && (kName.includes(cName) || cName.includes(kName))) return true

    // Token overlap, as a last resort — and it needs TWO shared significant
    // tokens, not one.
    //
    // One was the first version and it was far too eager: "Delta Lighting" and
    // "Delta Electric" reduce to the single token "delta" once the category
    // and geography words are stripped, so a one-token rule declares two
    // unrelated companies to be the same one and silently loses a rival. The
    // near-miss cases this rule exists for — "Techno Light Establishment" vs
    // "Technolight" — are already caught by the normalised containment check
    // above, which is why raising the bar here costs nothing.
    const kToks = tokensOf(k?.name ?? k)
    if (cToks.length && kToks.length) {
      const shared = cToks.filter(t => kToks.includes(t))
      if (shared.length >= 2 && shared.length === Math.min(cToks.length, kToks.length)) return true
    }
  }
  return false
}

/**
 * Drop everything we already watch, everything malformed, and everything the
 * model returned twice.
 *
 * Self-deduplication is not paranoia: a model asked for competitors in one
 * market routinely returns the same company under its trading name and its
 * legal name in one response.
 */
export function newCompetitors(candidates, known) {
  const out = []
  // Not default parameters: those only fire for `undefined`, and a caller that
  // passes an explicit null — which a JSON.parse of a model's answer routinely
  // produces — would throw on the spread instead.
  const seen = [...(Array.isArray(known) ? known : [])]

  for (const c of (Array.isArray(candidates) ? candidates : [])) {
    const name = String(c?.name || '').trim()
    if (!name) continue
    // No source, no proposal — stated in the prompt and enforced here, because
    // a prompt is a request and this is a rule.
    if (!String(c?.evidence_url || '').trim()) continue
    if (isKnown({ ...c, name }, seen)) continue

    const entry = {
      name,
      website: String(c?.website || '').trim(),
      why: String(c?.why || '').trim(),
      evidence_url: String(c.evidence_url).trim(),
      overlap: c?.overlap === 'adjacent' ? 'adjacent' : 'direct',
    }
    out.push(entry)
    seen.push(entry)
    if (out.length >= MAX_PROPOSALS) break
  }
  return out
}

/**
 * The rows to insert. Every field that decides what happens next is pinned
 * here rather than left to a default:
 *
 *   status 'proposed'      a person accepts it before it steers anything
 *   created_by 'agent'     so a later pass never overwrites a human's typing
 *   ig_status 'unresolved' found is not verified; the resolve step is separate
 *                          and DELIBERATELY not run from here, because a
 *                          handle attached to a rival nobody has accepted yet
 *                          is a week of numbers about a company we may not
 *                          even want to watch.
 */
export function agendaRowsFor(workspaceId, competitors = []) {
  return competitors.map(c => ({
    workspace_id: workspaceId,
    kind: 'competitor',
    subject: c.name,
    why: [c.why, c.website ? `Site: ${c.website}` : '', `Found: ${c.evidence_url}`]
      .filter(Boolean).join(' · ')
      .slice(0, 600),
    status: 'proposed',
    cadence: 'monthly',
    created_by: 'agent',
    ig_status: 'unresolved',
    ig_handle: '',
  }))
}

/** What the endpoint reports back, in the shape the page renders. */
export function discoverSummary({ proposed = [], known = [], seen = 0, cost = 0 }) {
  return {
    ok: true,
    proposed: proposed.length,
    already_watching: known.length,
    candidates_seen: seen,
    competitors: proposed,
    cost_usd: Number((cost || 0).toFixed(4)),
    note: proposed.length === 0
      ? (seen === 0
        ? 'The search returned no competitors. That can be a real answer in a thin market — or a sign the brand descriptor is too vague to search from.'
        : 'Every company found is already on the watchlist.')
      : '',
  }
}
