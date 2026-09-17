import { callerId, callerMayUseWorkspace, db, isConfigured } from './_supabase.js'
import { searchConfig } from '../../src/lib/agent/searchConsole.js'
import { fetchSearchData } from './_searchConsole.js'

// ─── POST /api/agent/search ────────────────────────────────────────────────
// The dashboard's Website card. Search Console for this workspace's property,
// returned as rows for the browser to turn into numbers and recommendations.
//
// Body: { workspace_id }
//
// ── WHY THIS IS A ROUTE AND NOT A LENS CALL ──
//
// runSearchLens (api/agent/_lenses.js) answers the same property and then
// spends model tokens turning it into prose. A dashboard card that loads on
// every visit must not do that: the numbers and the rules that read them are
// deterministic, they live in src/lib/agent/searchConsole.js, and they are
// free. This route is the lens's first half with the model removed — the same
// module, the same window, the same floors, so the card and the weekly report
// can never disagree about what the site is doing.
//
// The browser gets ROWS, not conclusions. Everything that decides what a row
// MEANS stays in the pure module, where it is tested and where the report
// reads it from too.
//
// ── WHY IT LIVES UNDER api/agent/ ──
//
// Two reasons, both practical. The Search Console credential is already on the
// agent's allowlist in vite.config.js, so this runs on a laptop without a
// second env plumbing exercise. And _searchConsole.js is the only place that
// knows how to sign the JWT; importing it from a route outside this directory
// would make the agent container's dependency boundary (see AGENT.md) a lie.

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only.' })
  }
  if (!isConfigured) {
    // Named rather than swallowed, for the same reason every other route in
    // this directory names it: a missing key that looks like "the feature
    // quietly does nothing" has cost this project a day already.
    return res.status(500).json({ ok: false, error: 'Supabase is not configured on this deployment.' })
  }

  let body
  try {
    body = await readBody(req)
  } catch {
    return res.status(400).json({ ok: false, error: 'Body must be JSON.' })
  }

  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) {
    return res.status(400).json({ ok: false, error: 'workspace_id is required.' })
  }

  // Who is asking, and may they — both with the caller's own token, so RLS
  // answers the second one. A workspace_id in a request body is not evidence.
  const userId = await callerId(req)
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Sign in to read website analytics.' })
  }
  if (!(await callerMayUseWorkspace(req, workspaceId))) {
    return res.status(403).json({ ok: false, error: 'You do not have access to this workspace.' })
  }

  try {
    // Only the jsonb column, not the whole brand brain. loadBrandContext would
    // answer this too, but it issues six queries and loads the agent's memory
    // to do it — a card that paints on every dashboard visit should not pay
    // for a context assembly it never reads.
    const rows = await db(`brand_profile?workspace_id=eq.${workspaceId}&select=custom_fields`)
    const customFields = rows?.[0]?.custom_fields || {}
    const { site, lines, brandTerms } = searchConfig(
      { customFields },
      { brandName: customFields.brand_name || '' },
    )

    const data = await fetchSearchData({ site })

    // Three states the card must be able to tell apart, so they are three
    // distinct answers rather than one empty array:
    //
    //   configured: false   nobody has set this up — show the setup steps
    //   ok: false           set up and FAILING — show the error, loudly
    //   ok: true            a real answer, even when it holds no rows
    //
    // Collapsing the middle one into "no data" is how a dead credential comes
    // to read as "nobody is searching for us", which is the exact silent
    // failure the lens comments in searchConsole.js are about.
    if (!data.configured) {
      return res.status(200).json({
        ok: true,
        configured: false,
        site: data.site || '',
        error: data.error || '',
        // Said here rather than in the component, so the browser bundle does
        // not carry setup instructions for a credential it never handles.
        setup: [
          'Create a Google Cloud service account and download its JSON key.',
          'In Search Console, add that service account\'s client_email as a Full user on the property.',
          'Put the JSON in GOOGLE_SA_KEY on this deployment (raw or base64).',
          'Set customFields.website on the Brand Brain to the verified property, e.g. sc-domain:example.com.',
        ],
      })
    }
    if (!data.ok) {
      return res.status(200).json({
        ok: false, configured: true, site: data.site || '', error: data.error || 'Search Console did not answer.',
      })
    }

    return res.status(200).json({
      ok: true,
      configured: true,
      site: data.site,
      windows: data.windows,
      queries: data.queries,
      previous: data.previous,
      pages: data.pages,
      // The brand's own names travel with the rows, because splitting brand
      // traffic from real demand is the difference between "122 clicks" and
      // "18 clicks from people who did not already know us" — and the browser
      // cannot work that out without them.
      brandTerms,
      lines,
    })
  } catch (err) {
    return res.status(500).json({ ok: false, configured: true, error: String(err?.message || err).slice(0, 300) })
  }
}
