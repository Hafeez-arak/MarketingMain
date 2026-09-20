// ─── The website's side of the dashboard ───────────────────────────────────
// One call to /api/agent/search, which reads Google Search Console for this
// workspace's property. The service-account key stays on the server, exactly
// like every other provider in this project.
//
// The route answers three states and they are deliberately not collapsed:
//
//   configured: false   nobody has set it up — the card shows the steps
//   ok: false           set up and FAILING — the card shows the error
//   ok: true            a real answer, even when it holds no rows
//
// A dead credential that reads as "nobody is searching for us" is the silent
// failure this project has already paid for twice, so the middle state is
// never folded into the third.

export async function fetchWebsiteSearch(workspaceId, accessToken) {
  if (!workspaceId) return { ok: false, configured: false, error: 'No workspace selected.' }
  if (!accessToken) return { ok: false, configured: false, error: 'Sign in to read website analytics.' }
  try {
    const res = await fetch('/api/agent/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ workspace_id: workspaceId }),
    })
    const data = await res.json().catch(() => null)
    if (!data) return { ok: false, configured: true, error: `The server returned ${res.status} with nothing in it.` }
    return data
  } catch (err) {
    return { ok: false, configured: true, error: `Could not reach the server: ${err.message}` }
  }
}

/**
 * Everything the Analytics page's Website tab draws.
 *
 * A second call rather than a parameter on the one above, mirroring the two
 * routes: the dashboard card must stay three Search Console calls because it
 * paints on every visit to the home page, and this one makes twenty-eight
 * requests across two Google products. See the header of api/agent/website.js.
 *
 * The two halves of the answer — `search` and `ga4` — each carry their own
 * configured/ok/error, and the page renders whichever it has. GA4 being
 * unconfigured is the normal state until somebody installs a tag on the site,
 * and it must never hide working Search Console numbers behind it.
 */
export async function fetchWebsiteAnalytics(workspaceId, accessToken, days = 28) {
  if (!workspaceId) return { ok: false, error: 'No workspace selected.' }
  if (!accessToken) return { ok: false, error: 'Sign in to read website analytics.' }
  try {
    const res = await fetch('/api/agent/website', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ workspace_id: workspaceId, days }),
    })
    const data = await res.json().catch(() => null)
    if (!data) return { ok: false, error: `The server returned ${res.status} with nothing in it.` }
    return data
  } catch (err) {
    return { ok: false, error: `Could not reach the server: ${err.message}` }
  }
}
