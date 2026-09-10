// ─── Finding a competitor's Instagram handle ───────────────────────────────
// Ported from the n8n resolve step. RESEARCH-AGENT.md §7.
//
// Why this exists at all: checked against the live database, Arak has six
// competitors and only two usable handles. Every rival without one can appear
// in findings that rest on web evidence and can never appear in a measured
// number, so the Instagram half of the agent is inert for two thirds of the
// watchlist until something goes and finds them.
//
// THE SCORING IS ARITHMETIC, NOT A MODEL CALL. That is deliberate and it is
// the property worth protecting: it answers the same way twice, and when it is
// wrong a person can read exactly which signal misled it. A model asked to
// judge "is @alfanarprojects the Alfanar Lighting account?" gives a confident
// answer with no auditable reasoning and a different one next Tuesday.
//
// A model is used for exactly one thing — searching the open web for candidate
// handles — because that is genuinely a search problem. What comes back is
// then scored here.

/** A candidate must clear this to be trusted with a week of numbers. */
export const RESOLVE_AT = 0.7
/** Below this it is not even worth storing as a suggestion. */
export const SUGGEST_AT = 0.3

const STOP = new Set([
  'the', 'and', 'for', 'ltd', 'llc', 'inc', 'co', 'company', 'group', 'holding',
  'holdings', 'international', 'global', 'trading', 'est', 'establishment',
  'lighting', 'lights', 'light', 'saudi', 'arabia', 'ksa', 'al', 'the',
])

export const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function domainOf(url) {
  const m = String(url || '').match(/^(?:https?:\/\/)?(?:www\.)?([^/?#]+)/i)
  return m ? m[1].toLowerCase().replace(/^www\./, '') : ''
}

export function tokensOf(name) {
  return String(name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !STOP.has(t))
}

/**
 * How likely is this account to be that competitor?
 *
 * Signals are additive and each one is named in `reasons`, so a wrong answer
 * is explainable rather than merely wrong.
 */
export function scoreCandidate(competitor, account) {
  const reasons = []
  let score = 0

  const cName = norm(competitor?.name)
  const aUser = norm(account?.username)
  const aName = norm(account?.name)
  const cDom = domainOf(competitor?.website)
  const aDom = domainOf(account?.website)

  // The strongest signal there is, and conclusive on its own: an account whose
  // bio links to the rival's own domain is the rival's account.
  if (cDom && aDom && cDom === aDom) {
    score += 0.7
    reasons.push(`bio links to ${aDom}`)
  }

  if (cName && (cName === aUser || cName === aName)) {
    score += 0.5
    reasons.push('name matches exactly')
  } else if (cName && aUser && (aUser.includes(cName) || cName.includes(aUser))) {
    score += 0.25
    reasons.push('handle contains the name')
  } else if (cName && aName && aName.includes(cName)) {
    score += 0.25
    reasons.push('display name contains the name')
  }

  const toks = tokensOf(competitor?.name)
  if (toks.length) {
    const hay = `${account?.username || ''} ${account?.name || ''} ${account?.biography || ''}`.toLowerCase()
    const hits = toks.filter(t => hay.includes(t))
    if (hits.length) {
      score += 0.25 * (hits.length / toks.length)
      reasons.push(`mentions ${hits.join(', ')}`)
    }
  }

  // Size as a tie-breaker, not as evidence. A real brand's account is rarely
  // tiny; a squatter's usually is.
  const followers = Number(account?.followers_count || 0)
  if (followers >= 1000) {
    score += 0.1
    reasons.push(`${followers} followers`)
  } else if (account?.followers_count !== undefined && followers < 100) {
    score -= 0.3
    reasons.push(`only ${followers} followers — probably not the real account`)
  }

  return {
    score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)),
    reasons,
  }
}

// Instagram's own section paths. A URL containing one of these is a link to a
// post or a listing, not to an account, and treating it as a handle is how
// "@reel" ends up on a watchlist.
const NOT_HANDLES = new Set([
  'p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts',
  'about', 'directory', 'tags', 'legal', 'developer', 'blog', 'help',
])

/**
 * Every plausible Instagram handle mentioned in a blob of search results.
 *
 * Takes any text — a URL list, a model's summary, a page excerpt — because
 * with server-side search the handles arrive embedded in prose as often as in
 * a link.
 */
export function handlesFrom(text) {
  const out = []
  const re = /instagram\.com\/([A-Za-z0-9._]{2,30})/gi
  let m
  while ((m = re.exec(String(text || '')))) {
    const h = m[1].toLowerCase().replace(/\.$/, '')
    if (NOT_HANDLES.has(h)) continue
    if (!out.includes(h)) out.push(h)
  }
  // Bare @handles too — a search summary often writes it that way.
  const at = /(?:^|\s)@([A-Za-z0-9._]{3,30})\b/g
  while ((m = at.exec(String(text || '')))) {
    const h = m[1].toLowerCase()
    if (NOT_HANDLES.has(h)) continue
    if (!out.includes(h)) out.push(h)
  }
  return out
}

/**
 * Turn a scored candidate into the agenda columns that describe it.
 *
 * The three outcomes are genuinely different and the schema distinguishes
 * them, so this must not collapse them:
 *
 *   resolved   — verified against Instagram and above the bar. Measured.
 *   unresolved — a candidate worth a human's glance. NOT measured, on purpose.
 *   not_found  — nothing plausible at all. Web evidence only.
 *
 * A weak candidate is stored rather than discarded precisely so there is
 * something to accept or correct, instead of a blank the person cannot act on.
 */
export function resolutionFor({ score, verified }) {
  if (verified && score >= RESOLVE_AT) {
    return { ig_status: 'resolved', ig_verified_at: new Date().toISOString() }
  }
  if (score >= SUGGEST_AT) {
    // Deliberately NOT verified, even when the score is high: without a
    // successful business_discovery lookup we have not confirmed the account
    // is real, public and a business account, and a handle that was FOUND but
    // not VERIFIED must never be snapshotted.
    return { ig_status: 'unresolved', ig_verified_at: null }
  }
  return { ig_status: 'not_found', ig_verified_at: null }
}

/** The search queries worth trying for one competitor. */
export function queriesFor(competitor) {
  const name = String(competitor?.name || '').trim()
  const site = domainOf(competitor?.website)
  const queries = [`${name} Instagram official account`]
  if (site) queries.push(`${site} Instagram`)
  queries.push(`"${name}" instagram.com`)
  return queries
}

/**
 * What the search stage must return for the scorer to have anything to work
 * with.
 *
 * The first version of this asked for prose and then regexed handles out of
 * it. Run against Arak's four unresolved rivals it found candidates for one
 * and scored it 0.25 — below the threshold to store anything at all.
 *
 * The reason is structural, not bad luck: scoreCandidate's signals are the
 * account's DISPLAY NAME, BIO, WEBSITE and FOLLOWER COUNT, and a bare handle
 * string carries none of them. With business_discovery those arrive from
 * Instagram; without it, the only other place they exist is the search result
 * the model just read. So it has to hand them over rather than throw them
 * away.
 */
export const CANDIDATES_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['candidates'],
    properties: {
      candidates: {
        type: 'array',
        description: 'Every plausible account. Empty is a correct answer.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['handle', 'source_url'],
          properties: {
            handle: { type: 'string', description: 'Without the @.' },
            display_name: { type: 'string', description: 'The account name as shown, if you saw it.' },
            biography: { type: 'string', description: 'The bio text, if you saw it.' },
            website: { type: 'string', description: 'Any link in the bio, if you saw one.' },
            followers_count: { type: 'number', description: 'Follower count if stated. Omit rather than guess.' },
            source_url: { type: 'string', description: 'Where you saw this. Required — no page, no candidate.' },
          },
        },
      },
    },
  },
}

/**
 * Normalise a model-reported candidate into the shape scoreCandidate expects.
 *
 * `followers_count` is left undefined rather than zeroed when the model did
 * not report one — the scorer penalises a genuinely tiny account, and a
 * missing number must not be read as "4 followers".
 */
export function candidateToAccount(c) {
  const account = {
    username: String(c?.handle || '').replace(/^@/, '').toLowerCase(),
    name: c?.display_name || '',
    biography: c?.biography || '',
    website: c?.website || '',
  }
  const n = Number(c?.followers_count)
  if (Number.isFinite(n) && n > 0) account.followers_count = n
  return account
}
