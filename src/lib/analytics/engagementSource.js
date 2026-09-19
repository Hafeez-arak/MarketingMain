// ─── Where the engagement rate on a page comes from ────────────────────────
//
// ── THE PROBLEM THIS SETTLES ──
//
// A LinkedIn account's page carried two engagement rates, one strip apart:
// 6.3% from LinkedIn's own organisation statistics, and 3.2% worked out here
// as interactions ÷ reach over the posts in the chosen window. Different
// numerator (LinkedIn counts clicks and follows as engagement; we count likes,
// comments, shares and saves), different denominator, different set of posts.
//
// Both were right, and labelling them "Page engagement rate" and "Post
// engagement rate" made that legible — but it did not make it usable. Nobody
// reading a dashboard wants to hold two definitions of one word at once and
// decide which applies. So the page shows exactly ONE engagement rate, and
// this module decides which.
//
// ── THE RULE ──
//
// The platform's own figure wins wherever the platform publishes one, because
// that is the number the user will see if they open LinkedIn itself, and a
// tool that disagrees with the platform it reports on has to be wrong twice
// before anyone believes it once. Where the platform publishes nothing —
// Instagram takes no account-level engagement rate at all — we compute it, and
// say so.
//
// The consequence is deliberate and worth stating: the rate is NOT comparable
// between Instagram and LinkedIn, because it is not the same measurement. The
// ⓘ on the tile says which formula produced it. Making it comparable would
// mean overriding LinkedIn with our own arithmetic, which trades a real
// mismatch nobody can act on for a permanent quiet disagreement with LinkedIn.

/**
 * The platform's own engagement rate for this account, or null when the
 * platform doesn't publish one.
 *
 * LinkedIn sends it as a 0..1 fraction on the organisation aggregate;
 * everything on screen is a 0..100 percentage, so it is scaled here — once,
 * at the boundary — rather than at each of the places that render it.
 *
 * @param {object} dash The /api/zernio/analytics response.
 * @returns {number|null} A percentage in 0..100, or null.
 */
export function platformEngagementRate(dash) {
  const raw = dash?.linkedinPage?.metrics?.engagement_rate?.total
  return typeof raw === 'number' && Number.isFinite(raw) ? raw * 100 : null
}

/**
 * The single engagement rate a page should show, and where it came from.
 *
 * `source` is what the caller needs to pick the ⓘ text and the caption; it is
 * returned rather than re-derived because a caller that re-derives it can get
 * a different answer from the one that produced the number beside it, which is
 * the exact class of bug this file exists to end.
 *
 * @param {object} dash        The /api/zernio/analytics response.
 * @param {number|null} ourRate Interactions ÷ reach over the window's posts.
 * @returns {{ value: number|null, source: 'platform'|'posts'|null }}
 */
export function engagementSource(dash, ourRate) {
  const platform = platformEngagementRate(dash)
  if (platform !== null) return { value: platform, source: 'platform' }
  if (typeof ourRate === 'number' && Number.isFinite(ourRate)) {
    return { value: ourRate, source: 'posts' }
  }
  return { value: null, source: null }
}
