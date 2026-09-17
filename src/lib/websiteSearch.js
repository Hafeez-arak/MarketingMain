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
