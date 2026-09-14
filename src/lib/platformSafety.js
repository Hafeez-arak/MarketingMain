// ─── Accounts this product must not write to ───────────────────────────────
//
// ARAK Lighting's LinkedIn is the company's real, official page. Instagram in
// this workspace is @lightingaaa — a test account with one follower that has
// been connected, disconnected and reconnected three times while this product
// was built, and published to with captions like "bvvv" and "Testing post
// again".
//
// Every publish path in this app was written against the second kind of
// account, where a mistake costs nothing and is deleted a minute later. One of
// the connected accounts is now a real audience that cannot be un-posted to.
// This module is the line between them.
//
// ── WHY A PLATFORM RULE AND NOT ONLY THE DATABASE FLAG ──
//
// `social_accounts.is_protected` is the visible, per-account, auditable
// state — see the 20260914_protected_accounts migration. But a row is not a
// durable place to hang this rule on its own: reconnecting an account INSERTS
// A NEW ROW, and a new row defaults to is_protected = false. That is not a
// hypothetical failure. It is exactly how this workspace's Instagram came to
// have three rows, and it would drop the protection at the precise moment
// someone is fiddling with the connection.
//
// So the platform is the rule that cannot be defeated, and the flag is the
// rule that can be SEEN and — deliberately, by a person, one account at a
// time — relaxed. A caller must satisfy both.
//
// ── WHAT THIS DOES NOT DO ──
//
// It does not block READING. Analytics, follower counts, post history and
// everything the research agent does are untouched: the whole point of
// connecting the account is to measure it. Only writes that reach the
// platform — publishing, scheduling, deleting a published post — and
// disconnecting the account are refused.

/**
 * Platforms no account may be published to, whatever the row says.
 *
 * LinkedIn is here because ARAK's is the company's official page and the
 * business has not asked for publishing to it. Removing a platform from this
 * list is a deliberate decision with a real audience on the other side of it,
 * not a cleanup.
 */
export const PROTECTED_PLATFORMS = ['linkedin']

/** Is this platform write-protected for every account, current and future? */
export function isProtectedPlatform(platform) {
  return PROTECTED_PLATFORMS.includes(String(platform || '').trim().toLowerCase())
}

/**
 * May this product publish to this account?
 *
 * Takes the account ROW rather than a platform string wherever one is to hand,
 * so the flag is honoured too — an Instagram account someone marks protected
 * is protected without a code change.
 *
 * Fails CLOSED on a missing account. A publish path that cannot identify what
 * it is publishing to must not proceed: "we could not check" has to mean no,
 * the same rule `callerId` follows before spending money.
 */
export function mayPublishTo(account) {
  if (!account) return false
  if (account.is_protected === true) return false
  return !isProtectedPlatform(account.platform)
}

/** May this account be disconnected? Same rule; losing the connection to a real page is its own harm. */
export function mayDisconnect(account) {
  return mayPublishTo(account)
}

/**
 * Why a write was refused, in words for the person who tried.
 *
 * Named rather than generic, because "publishing failed" and "this account is
 * deliberately protected" send someone to two completely different places —
 * one to a status page, the other to whoever decided.
 */
export function protectionReason(account) {
  if (!account) {
    return 'The account could not be identified, so publishing was refused rather than guessed at.'
  }
  const label = account.display_name || account.username || account.platform || 'This account'
  if (isProtectedPlatform(account.platform)) {
    return `${label} is a protected ${account.platform} account — this product does not publish to it, ` +
      'and does not disconnect it. Analytics and reporting are unaffected. ' +
      'Changing that is a decision for whoever owns the page, not a setting to toggle past.'
  }
  return `${label} is marked protected, so publishing and disconnecting are refused. ` +
    'Clear is_protected on the account to change that.'
}
