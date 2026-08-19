import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// ─── Provider-neutral analytics reads ──────────────────────────────────────
// Plain Supabase reads of `social_accounts` and `post_analytics`. No secret is
// involved and no provider is implied: both tables are written by whichever
// publishing workflow is active (Zernio historically, Meta now), and every row
// carries `publish_provider` saying which.
//
// These lived in zernio.js, which was only ever true by accident — they read
// OUR tables, not Zernio's API, and nothing about them changed when the
// publishing provider did. Leaving them there would have meant the Meta path
// importing a module named after the provider it replaced, which is exactly
// the kind of stale name that later gets read as a live dependency.

function headers(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}

export async function fetchSocialAccounts(workspaceId, accessToken) {
  if (!workspaceId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/social_accounts?workspace_id=eq.${workspaceId}&select=*&order=platform.asc`,
      { headers: headers(accessToken) },
    )
    return res.ok ? await res.json() : []
  } catch { return [] }
}

// Latest metric row per (zernio_post_id, platform) — the running totals, not
// the whole daily time series (see fetchPostAnalyticsTimeline for that). Done
// client-side with a Map rather than a second query shape, since post_analytics
// is small per workspace (dozens to low hundreds of rows) and this avoids a
// Postgres DISTINCT ON round-trip for now.
export async function fetchLatestAnalytics(workspaceId, accessToken) {
  if (!workspaceId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/post_analytics?workspace_id=eq.${workspaceId}&select=*&order=metric_date.desc&limit=1000`,
      { headers: headers(accessToken) },
    )
    if (!res.ok) return []
    const rows = await res.json()
    const latest = new Map()
    for (const r of rows) {
      const key = `${r.zernio_post_id}::${r.platform}`
      if (!latest.has(key)) latest.set(key, r) // rows already ordered newest-first
    }
    return [...latest.values()]
  } catch { return [] }
}

export async function fetchPostAnalyticsTimeline(workspaceId, accessToken, postMetricId) {
  if (!workspaceId || !postMetricId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/post_analytics?workspace_id=eq.${workspaceId}&zernio_post_id=eq.${postMetricId}&select=*&order=metric_date.asc`,
      { headers: headers(accessToken) },
    )
    return res.ok ? await res.json() : []
  } catch { return [] }
}
