import { callerId, callerMayUseWorkspace, db, isConfigured } from './_supabase.js'
import { searchConfig } from '../../src/lib/agent/searchConsole.js'
import { ga4Config, bioLink, siteOrigin, SOCIAL_PLATFORMS } from '../../src/lib/agent/ga4.js'
import { createZernio } from '../zernio/_zernio.js'
import { zernioProfileFor, accountInsights, MAX_INSIGHT_DAYS } from './_zernioLive.js'
import { fetchWebsiteData, fetchSitemaps } from './_searchConsole.js'
import { fetchGa4Data } from './_ga4.js'
import { normalizeRange, resolveRange, isCustom } from '../../src/lib/dateRange.js'

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
// makes seventeen Search Console calls and twelve GA4 reports. Putting both
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

// The shortcuts the picker offers. A custom window is allowed alongside them
// now, but the floor below is not negotiable: a window shorter than a week
// lets a weekday effect read as a trend, and at this site's volume three days
// is mostly zeroes with a percentage sign on it. Search Console's own
// retention stops at 16 months, comfortably outside MAX_RANGE_DAYS.
export const WINDOWS = [7, 28, 90]

// The profiles this brand actually has a bio on, so the panel offers two
// links to paste rather than a menu of ten it will never use. Adding a
// platform here is the whole change needed when one is connected — the
// counting side already recognises every source in SOCIAL_PLATFORMS.
const BIO_LINK_PLATFORMS = ['instagram', 'linkedin']
export const MIN_WINDOW_DAYS = 7

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

// ─── The bio link ──────────────────────────────────────────────────────────
//
// The one question this tab could not answer: is anybody actually clicking the
// link in the Instagram bio, and do they reach the site?
//
// It takes two sources, because no single one knows both halves. Instagram
// counts the TAP and knows nothing after it. GA4 counts the ARRIVAL and, on a
// bare untagged link, usually cannot tell it apart from someone typing the
// address in — Instagram's in-app browser sends no referrer. So both are
// fetched, both are labelled, and neither is ever subtracted from the other.
//
// ── WHY THE TAPS CAN BE ABSENT ON A WINDOW THAT WORKS FOR GA4 ──
//
// Meta rejects any account-insights request spanning more than 30 days — the
// whole request, not the excess — so there is no 90-day tap count to be had.
// A capped 29-day figure printed under a "Last 90 days" heading would be read
// as 90 days of taps and would make the bio link look three times worse than
// it is. So on a window Instagram cannot serve, the taps are absent and say
// why, which is the same rule the LinkedIn 88-day cap already follows.

/** Instagram's own count of bio-link taps, or a stated reason there is none. */
async function fetchBioTaps(workspaceId, days) {
  if (days > MAX_INSIGHT_DAYS) {
    return {
      ok: false,
      capped: true,
      maxDays: MAX_INSIGHT_DAYS,
      error: `Instagram will not report link taps over a window longer than ${MAX_INSIGHT_DAYS} days, ` +
        'so there is no tap count for this one. Choose a shorter window to see it.',
    }
  }
  const key = process.env.ZERNIO_API_KEY || ''
  if (!key) return { ok: false, error: 'ZERNIO_API_KEY is not set on this deployment.' }
  try {
    const profile = await zernioProfileFor(workspaceId)
    const instagram = (profile?.accounts || []).find(a => String(a.platform).toLowerCase() === 'instagram')
    if (!instagram?.zernio_account_id) {
      return { ok: false, error: 'No Instagram account is connected, so there are no bio-link taps to count.' }
    }
    const insights = await accountInsights(createZernio({ apiKey: key }), instagram.zernio_account_id, days)
    if (!insights.ok) return { ok: false, error: insights.error }
    return {
      ok: true,
      taps: insights.profile_links_taps,
      window: insights.window,
      dataDelay: insights.data_delay || '',
    }
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 300) }
  }
}

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
  // The window, as chosen. A fixed one wins when both dates are real; the
  // preset list is a set of shortcuts now rather than a whitelist, because
  // Search Console and GA4 both take arbitrary start and end dates.
  const { range, error: rangeError } = normalizeRange(
    body.from && body.to ? { from: body.from, to: body.to } : { days: Number(body.days) || 28 },
    { minDays: MIN_WINDOW_DAYS },
  )
  // Said rather than silently widened. A window quietly stretched from three
  // days to seven answers a question nobody asked, and the reader has no way
  // to tell that is what happened.
  if (body.from && body.to && rangeError) {
    return res.status(400).json({ ok: false, error: rangeError })
  }
  const window = range || { days: 28 }
  const { fromDate, toDate, days } = resolveRange(window)
  const fixed = isCustom(window) ? { from: fromDate, to: toDate } : {}

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
    const [search, sitemaps, analytics, taps] = await Promise.all([
      fetchWebsiteData({ site, days, ...fixed }),
      fetchSitemaps({ site }),
      fetchGa4Data({ property: ga4.path, days, ...fixed }),
      // Never throws, and never fails the request: a workspace with no
      // Instagram connected still has a website, and the tap half being
      // missing must not take the arrivals half down with it.
      fetchBioTaps(workspaceId, days),
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
      // ── The bio link, as a third thing ──
      // Not folded into `ga4` even though the arrivals come from there,
      // because half of it is Instagram's number and the object it would sit
      // in is otherwise literally GA4's payload, down to its ok/configured
      // flags. A reader of that object should never have to wonder which
      // fields Google answered for.
      bio: {
        site: siteOrigin(site),
        // Ready to paste. Built here from the same constants the arrivals
        // counter matches on, so a link that was copied off this screen is
        // guaranteed to be counted by the panel that offered it.
        links: SOCIAL_PLATFORMS.filter(p => BIO_LINK_PLATFORMS.includes(p.id)).map(p => ({
          id: p.id, label: p.label, url: bioLink(site, p.id),
        })).filter(l => l.url),
        taps,
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
