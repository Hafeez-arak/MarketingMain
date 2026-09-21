// ─── The website numbers, said in a sentence ───────────────────────────────
//
// Every other module that touches Search Console in this codebase is
// arithmetic: websiteAnalytics.js turns rows into things to SEE, seoAdvice.js
// turns them into things to DO, and neither asks a model anything. This one
// does, and it is the only one, so the line is worth stating plainly.
//
// ── WHAT A MODEL IS FOR HERE, AND WHAT IT IS NOT ──
//
// It is NOT for the numbers. Every figure the model is shown was computed by
// the pure modules and is handed to it already rounded; the model is forbidden
// from doing arithmetic and the prompt says so, because a model that adds up
// impressions will eventually add them up wrong and a page that prints one
// number in a tile and a different one in a sentence beneath it is worse than
// a page with no sentence.
//
// It is for the sentence. "3,312 impressions, 4.4% CTR, position 16.3" is not
// an answer to "how is the website doing", and the rule-based panels next to
// it can only say things somebody thought to write a rule for. The judgement
// that image search earning nothing matters more this month than a two-place
// position drift is the part that cannot be spelled out in advance.
//
// ── WHY THE OUTPUT IS BULLETS AND WHY THEY ARE SHORT ──
//
// Asked for, in those words: simple and clear, not long paragraphs. A cap in
// the schema is not enough on its own — a model told "be brief" writes four
// long sentences and calls them brief — so the length is stated in the
// description of the field itself, checked on the way out, and anything over
// the ceiling is dropped rather than shown, because one over-long bullet in a
// list of short ones reads as the important one.

const str = v => String(v ?? '').trim()
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Longest a bullet may be, in characters. Roughly two lines on a phone. */
export const MAX_POINT = 170

/** Most bullets in one answer. Five is already more than a person reads in a
 *  panel they did not open deliberately; the prompt asks for three. */
export const MAX_POINTS = 5

export const EXPLAIN_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['points'],
    properties: {
      points: {
        type: 'array',
        description:
          'Three short observations, most important first. Two is fine if there are only two ' +
          'worth making, and an empty array is the right answer for a period where nothing ' +
          'happened — inventing a third observation to fill the list is what makes a summary ' +
          'unreadable.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'kind'],
          properties: {
            text: {
              type: 'string',
              description:
                'ONE sentence, under 170 characters, in plain English a busy person reads once. ' +
                'Say what happened and why it matters. Quote a number only when it is the point ' +
                'of the sentence, and only a number you were given.',
            },
            kind: {
              type: 'string',
              enum: ['good', 'problem', 'opportunity', 'context'],
              description:
                'What this observation IS: something working (good), something broken or ' +
                'falling (problem), something available that nobody has taken yet ' +
                '(opportunity), or a fact needed to read the rest (context).',
            },
          },
        },
      },
    },
  },
}

/**
 * The facts a model is allowed to see, as small as they can be made.
 *
 * ── WHY THIS IS A WHITELIST AND NOT THE PAYLOAD ──
 *
 * The tab's payload is a few hundred kilobytes of rows. Sending it would cost
 * more per press than the answer is worth, and would hand the model five
 * different routes to the same number — from which it would eventually pick a
 * different one than the tile did. So the facts are named, one at a time, and
 * ROUNDED HERE: a model given 4.4382% writes 4.4382% into a sentence sitting
 * beside a tile reading 4.4%.
 *
 * `null` is preserved and never turned into 0. "We do not know the previous
 * period" and "the previous period was zero" are different facts, and the
 * second one is a sentence about a collapse.
 */
export function explainFacts({
  summary = {}, windowDays = 28, site = '', coverage = {}, types = [],
  queries = [], pages = [], bands = [], sitemap = {}, image = null, index = null,
  findings = [],
} = {}) {
  const round = (v, digits = 0) => (v === null || v === undefined ? null : Number(Number(v).toFixed(digits)))

  return {
    site: str(site),
    windowDays: num(windowDays),
    totals: {
      impressions: num(summary.impressions),
      clicks: num(summary.clicks),
      ctrPercent: round(summary.ctr, 1),
      averagePosition: round(summary.position, 1),
      // Null when the property has no previous window at all, which on a
      // recently verified property is most of them. The prompt is told what
      // null means, because a model shown nothing will otherwise explain the
      // absence as a fall.
      impressionsChangePercent: round(summary.impressionsDelta, 0),
      baseline: !!summary.baseline,
    },
    brandSplit: {
      brandImpressions: num(summary.brand?.impressions),
      nonBrandImpressions: num(summary.nonBrand?.impressions),
      nonBrandClicks: num(summary.nonBrand?.clicks),
    },
    // How much of the total the query table can even account for. Without
    // this the model explains a gap that is Google's privacy rule.
    queryCoverage: {
      namedQueries: num(coverage.namedQueries),
      namedImpressions: num(coverage.named),
      allImpressions: num(coverage.all),
      withheldPercent: coverage.all ? round(100 - (coverage.named / coverage.all) * 100, 0) : null,
    },
    surfaces: types.slice(0, 5).map(t => ({
      surface: str(t.label || t.type),
      impressions: num(t.impressions),
      clicks: num(t.clicks),
      averagePosition: round(t.position, 1),
    })),
    topQueries: queries.slice(0, 10).map(q => ({
      query: str(q.query),
      impressions: num(q.impressions),
      clicks: num(q.clicks),
      position: round(q.position, 1),
      brand: !!q.brand,
      landsOn: str(q.page),
    })),
    topPages: pages.slice(0, 8).map(p => ({
      page: str(p.label || p.path),
      impressions: num(p.impressions),
      clicks: num(p.clicks),
      position: round(p.position, 1),
    })),
    positionBands: bands.map(b => ({ band: str(b.label), impressions: num(b.impressions) })),
    sitemap: sitemap && sitemap.state ? {
      state: str(sitemap.state),
      note: str(sitemap.note),
    } : null,
    imageSearch: image ? {
      impressions: num(image.impressions),
      clicks: num(image.clicks),
      averagePosition: round(image.position, 1),
      topQueries: (image.queries || []).slice(0, 8).map(q => ({
        query: str(q.query),
        impressions: num(q.impressions),
        unrelatedToWhatWeSell: !!q.unrelated,
      })),
      unrelatedShare: image.unrelated?.measurable ? round(image.unrelated.share, 0) : null,
    } : null,
    // What the weekly research lens already wrote about this period. Present
    // only on the research side of the house, where the reader is about to
    // scroll past these same sentences — so the prompt's job there is to sit
    // ABOVE them and say what they add up to, not to restate them one by one.
    alreadyReported: findings.slice(0, 8).map(f => ({
      headline: str(f.headline),
      action: str(f.action || f.suggested_action),
      line: str(f.line),
    })).filter(f => f.headline),
    indexing: index ? {
      pagesChecked: num(index.checked),
      indexed: num(index.counts?.indexed),
      seenButNotIndexed: num(index.counts?.excluded),
      neverSeenByGoogle: num(index.counts?.unknown),
      examplesMissing: (index.missing?.rows || []).slice(0, 8).map(r => str(r.url)),
      externalLinkingDomains: (index.referrers || []).length,
      richResultTypes: (index.richResults || []).map(r => str(r.type)),
    } : null,
  }
}

/** The one thing this call is for, said to the model in its own words. */
export const EXPLAIN_IDENTITY =
  'You explain website search performance to the person who runs marketing for one company. ' +
  'They are not an SEO. They have one screen of numbers in front of them and ninety seconds.'

/**
 * The prompt.
 *
 * Every rule in it was paid for by something this project has already got
 * wrong once, and they are grouped that way rather than as a style guide:
 *
 *  - Do not calculate: the numbers on the screen are computed and cached, and
 *    a sentence that disagrees with the tile above it destroys the page's
 *    credibility far beyond the sentence.
 *  - An empty period is an answer: the lenses spent a month reporting "quiet"
 *    when they were failing, and the fix was to make silence say which kind of
 *    silence it is.
 *  - A baseline is not a fall: this property holds nothing before 2026-08-25,
 *    so every comparison across that line reads as a collapse to anything that
 *    does not know it.
 */
export function explainPrompt(facts, { audience = 'analytics' } = {}) {
  const where = audience === 'research'
    ? 'This goes at the top of a weekly research report, above the detailed findings.'
    : 'This goes at the top of the website analytics screen, above the charts and tables.'

  return [
    'Here are this website\'s search numbers, already computed. Explain them.',
    '',
    where,
    '',
    'RULES',
    '1. Write AT MOST three points. Each is one sentence under 170 characters. No preamble, no',
    '   heading, no closing summary — the points are the whole answer.',
    '2. Do NOT calculate anything. Every number you use must appear verbatim below. If a number',
    '   you want is not there, write the sentence without it.',
    '3. Plain English. No "CTR", "SERP", "impressions-to-click ratio", no marketing register.',
    '   Say "shown in search results" rather than "impressions" where the sentence still reads.',
    '4. Say what it MEANS, not what it says. "Position 16.3" is on the screen already; "we are on',
    '   page two for everything except our own name" is the explanation.',
    '5. `baseline: true` or a null change means there is no earlier period to compare against.',
    '   That is not a fall and must never be described as one.',
    '6. `withheldPercent` is Google refusing to name rare queries, not missing data on our side.',
    '7. If nothing notable happened, say that in one point and stop. Two good points beat three.',
    '8. `alreadyReported` is what the report under this already says, sentence by sentence. Do not',
    '   repeat any of it — say what it ADDS UP TO, or name the one item that matters most and why.',
    '',
    'THE NUMBERS',
    JSON.stringify(facts, null, 1),
  ].join('\n')
}

/**
 * What came back, made safe to render.
 *
 * A structured-output call still returns text, and text can be malformed, over
 * length, or — on a refusal — absent. Each of those is a different thing to
 * tell the reader, and returning an empty list for all three would put "no
 * explanation available" on the screen for a parse error.
 */
export function parseExplain(text) {
  let parsed
  try {
    parsed = JSON.parse(str(text))
  } catch {
    return { ok: false, points: [], error: 'The explanation came back in a shape this page could not read.' }
  }

  const points = (parsed?.points || [])
    .map(p => ({ text: str(p?.text), kind: str(p?.kind) || 'context' }))
    // Over-length points are DROPPED, not truncated. A sentence cut mid-word
    // is read as a bug in the page; a list of two short points is read as two
    // short points.
    .filter(p => p.text && p.text.length <= MAX_POINT)
    .slice(0, MAX_POINTS)

  return { ok: true, points, error: '' }
}
