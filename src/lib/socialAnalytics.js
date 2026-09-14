import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// ─── Provider-neutral analytics reads ──────────────────────────────────────
// Plain Supabase reads of `social_accounts` and `post_analytics`. No secret is
// involved and no provider is implied: both tables are written by whichever
// publishing workflow wrote them (Zernio now; Meta until 2026-09-14), and every row
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

// Where an account lives on its platform. Zernio returns `profileUrl: null` for
// an Instagram account connected through facebook_login, and Zernio Sync
// stores that as '', so the stored value is only a first choice. Instagram and
// TikTok URLs follow from the handle; LinkedIn's do not (a person and a company
// page live under different paths), so it is never guessed.
export function profileUrlOf(account) {
  const stored = String(account?.profile_url || '').trim()
  if (stored) return stored
  const handle = String(account?.username || '').trim().replace(/^@/, '')
  if (!handle) return ''
  if (account.platform === 'instagram') return `https://www.instagram.com/${encodeURIComponent(handle)}/`
  if (account.platform === 'tiktok') return `https://www.tiktok.com/@${encodeURIComponent(handle)}`
  return ''
}

// Active accounts only. A deactivated row is a connection someone removed —
// the 1-follower test account, for one — and listing it would put its numbers
// back on every screen that reads this.
export async function fetchSocialAccounts(workspaceId, accessToken) {
  if (!workspaceId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/social_accounts?workspace_id=eq.${workspaceId}&is_active=eq.true&select=*&order=platform.asc`,
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
