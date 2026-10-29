import { retryRateLimited } from './_zernio.js'
import { cleanDemographics, weekStartOf } from '../../src/lib/linkedinAudience.js'

// ─── LinkedIn follower demographics, one weekly snapshot at a time ─────────
// The rules live in src/lib/linkedinAudience.js; this is the Zernio read and
// the row it becomes. Two callers store rows: the page (when this week has no
// snapshot yet) and the Sunday cron (api/agent/chat.js), which also feeds the
// CEO's brief.
//
// Organization pages only — Zernio answers a personal profile with 400
// personal_account_not_supported — and it needs the r_organization_followers
// scope (412 without it).

/** How many weeks of snapshots the page reads back. */
export const AUDIENCE_HISTORY_WEEKS = 12

export const isCompanyPage = account =>
  String(account?.platform || '').toLowerCase() === 'linkedin' && account?.account_type !== 'personal'

/** One live read from Zernio, cleaned. Throws a ZernioError on failure. */
export async function readLinkedInDemographics(z, accountId) {
  const out = await retryRateLimited(() => z.request('analytics/linkedin/demographics', {
    query: { accountId },
  }))
  return cleanDemographics(out)
}

/** The row stored for this week. `followers` is null when nobody has counted. */
export function snapshotRow({ workspaceId, accountId, followers = null, demographics, now = new Date() }) {
  return {
    workspace_id: workspaceId,
    zernio_account_id: accountId,
    week_start: weekStartOf(now),
    captured_at: new Date(now).toISOString(),
    followers: Number.isFinite(Number(followers)) && followers !== null ? Math.round(Number(followers)) : null,
    demographics,
  }
}
