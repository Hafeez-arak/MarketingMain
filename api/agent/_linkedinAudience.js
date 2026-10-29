import { db } from './_supabase.js'
import { createZernio, zernioKeyFor, explainZernioError } from '../zernio/_zernio.js'
import { isCompanyPage, readLinkedInDemographics, snapshotRow } from '../zernio/_audience.js'
import { audienceSummary, hasDemographics } from '../../src/lib/linkedinAudience.js'

// ─── The weekly LinkedIn follower snapshot, and what the brief reads ───────
// The Sunday cron (api/agent/chat.js) calls captureLinkedInAudiences() before
// it writes any brief, so the brief and the LinkedIn page both compare the
// same two weeks. Every workspace with a connected LinkedIn company page is
// snapshotted, whether or not it has a CEO brief.

const TABLE = 'linkedin_audience_snapshots'

/**
 * Snapshot every connected LinkedIn company page. Never throws: one page
 * failing (scope missing, Zernio down) is reported and the rest carry on.
 */
export async function captureLinkedInAudiences({ now = new Date(), env = process.env } = {}) {
  let accounts
  try {
    accounts = await db('social_accounts?platform=eq.linkedin&is_active=eq.true' +
      '&select=workspace_id,zernio_account_id,account_type,followers_count')
  } catch (err) {
    return [{ ok: false, error: `Could not list LinkedIn accounts: ${err.message}` }]
  }
  const results = []
  for (const a of (accounts || []).filter(x => x.zernio_account_id && isCompanyPage({ ...x, platform: 'linkedin' }))) {
    const key = zernioKeyFor(a.workspace_id, env)
    if (!key) { results.push({ account: a.zernio_account_id, ok: false, error: 'No Zernio key.' }); continue }
    try {
      const demographics = await readLinkedInDemographics(createZernio({ apiKey: key }), a.zernio_account_id)
      if (!hasDemographics(demographics)) {
        results.push({ account: a.zernio_account_id, ok: false, error: 'LinkedIn returned no demographics.' })
        continue
      }
      // merge-duplicates: the cron's Sunday read is the week's reference, and
      // replaces one a page view may have taken earlier the same week.
      await db(`${TABLE}?on_conflict=workspace_id,zernio_account_id,week_start`, {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: snapshotRow({
          workspaceId: a.workspace_id, accountId: a.zernio_account_id,
          followers: a.followers_count, demographics, now,
        }),
      })
      results.push({ account: a.zernio_account_id, ok: true })
    } catch (err) {
      results.push({ account: a.zernio_account_id, ok: false, error: err?.status ? explainZernioError(err) : String(err?.message || err) })
    }
  }
  return results
}

/** This workspace's latest LinkedIn audience against the week before, for the brief. */
export async function readLinkedInAudience(workspaceId) {
  const rows = await db(`${TABLE}?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    '&order=week_start.desc&limit=8&select=zernio_account_id,week_start,followers,demographics')
  if (!rows?.length) return { available: false }
  // One page per company today; if there were more, the brief speaks for the
  // one most recently snapshotted.
  const account = rows[0].zernio_account_id
  return audienceSummary(rows.filter(r => r.zernio_account_id === account))
}
