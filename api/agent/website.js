import { callerId, callerMayUseWorkspace, db, isConfigured } from './_supabase.js'
import { searchConfig } from '../../src/lib/agent/searchConsole.js'
import { ga4Config } from '../../src/lib/agent/ga4.js'
import { fetchWebsiteData, fetchSitemaps } from './_searchConsole.js'
import { fetchGa4Data } from './_ga4.js'

// ─── POST /api/agent/website ───────────────────────────────────────────────
// The Analytics page's Website tab. Everything Google will say about this
// workspace's site: Search Console for what happens in the results, GA4 for
// what happens after the click.
//
// Body: { workspace_id, days? }
//
// ── WHY THIS IS NOT api/agent/search.js WITH A FLAG ──
//
// /api/agent/search answers three calls' worth of questions and paints the
// dashboard's Website card on every single visit to the home page. This route
// makes seventeen Search Console calls and eleven GA4 reports. Putting both
// behind one handler with an `include` parameter would mean the cheap caller
// pays for the expensive one's imports and the expensive one's bugs, and the
// first slow dashboard would be traced back here.
//
// They share everything that matters instead: the same window helper, the same
// brand configuration, the same pure modules. The card and the tab can be
// wrong together but they cannot disagree.
//
// ── WHY THE TWO HALVES FAIL SEPARATELY ──
//
// GA4 is not connected yet on the property this was built against — the site
// carries no analytics tag at all — and Search Console is. A route that
// returned one status for both would have to call that whole answer a failure,
// and the working half would vanish behind the missing one. So `search` and
// `ga4` are two objects, each carrying its own configured/ok/error, and the
// page renders whichever ones it has.

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

// The windows a reader can ask for. Not free-form: a window shorter than a
// week lets a weekday effect read as a trend, and Search Console's own
// retention stops at 16 months.
const WINDOWS = [7, 28, 90]

// Said here rather than in the component, so the browser bundle does not carry
// setup instructions for credentials it never handles.
const SEARCH_SETUP = [
  'Create a Google Cloud service account and download its JSON key.',
  "In Search Console, add that service account's client_email as a Full user on the property.",
  'Put the JSON in GOOGLE_SA_KEY on this deployment (raw or base64).',
  'Set customFields.website on the Brand Brain to the verified property, e.g. sc-domain:example.com.',
]

const GA4_SETUP = [
  'Install a GA4 tag on the website — without it the property collects nothing, whatever is configured here.',
  'In GA4, open Admin → Property access management and add the same service account client_email as a Viewer.',
  'Copy the numeric property id from Admin → Property settings (digits only, not the G- measurement id).',
  'Set customFields.ga4_property_id on the Brand Brain to that number.',
]

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only.' })
  }
  if (!isConfigured) {
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
  const days = WINDOWS.includes(Number(body.days)) ? Number(body.days) : 28

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
    const rows = await db(`brand_profile?workspace_id=eq.${workspaceId}&select=custom_fields`)
    const customFields = rows?.[0]?.custom_fields || {}
    const { site, lines, brandTerms } = searchConfig(
      { customFields },
      { brandName: customFields.brand_name || '' },
    )
    const ga4 = ga4Config({ customFields })

    // Both products at once. GA4 is usually the unconfigured one and answers
    // in microseconds when it is; when it is configured it is the slower of
    // the two, and there is no reason for Search Console to wait behind it.
    const [search, sitemaps, analytics] = await Promise.all([
      fetchWebsiteData({ site, days }),
      fetchSitemaps({ site }),
      fetchGa4Data({ property: ga4.path, days }),
    ])

    return res.status(200).json({
      ok: true,
      days,
      search: {
        ...search,
        // The brand's own names travel with the rows, because splitting brand
        // traffic from real demand is the difference between "147 clicks" and
        // "clicks from people who did not already know us" — and the browser
        // cannot work that out without them.
        brandTerms,
        lines,
        sitemaps: sitemaps.sitemaps || [],
        sitemapError: sitemaps.error || '',
        setup: search.configured ? undefined : SEARCH_SETUP,
      },
      ga4: {
        ...analytics,
        // A property id that is really a G- measurement id is a configuration
        // mistake, not a missing configuration, and it gets the message that
        // says which number to look for rather than the four generic steps.
        configError: ga4.error || '',
        setup: analytics.configured ? undefined : GA4_SETUP,
      },
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 300) })
  }
}
