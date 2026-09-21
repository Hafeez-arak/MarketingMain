import { callerId, callerMayUseWorkspace, db, isConfigured } from './_supabase.js'
import { searchConfig } from '../../src/lib/agent/searchConsole.js'
import { fetchPageTotals } from './_searchConsole.js'
import { fetchSitemapUrls, fetchInspections } from './_urlInspection.js'
import { inspectionTargets, indexHealth, MAX_INSPECTIONS } from '../../src/lib/agent/urlInspection.js'

// ─── POST /api/agent/indexHealth ───────────────────────────────────────────
// Page by page: is it in Google's index, when was it last crawled, which
// canonical did Google pick, who links to it, and what structured data does
// Google see on it.
//
// Body: { workspace_id, limit? }
//
// ── WHY THIS IS A SEPARATE ROUTE FROM /api/agent/website ──
//
// Because it is one Google call PER URL — up to 120 — where the whole search
// pull is twenty-two, and because it answers a question that changes on the
// scale of days rather than one a reader scans on every visit. Bolting it on
// to the tab's own fetch would make every visit to Analytics wait twenty
// seconds for an answer nobody asked for, which is the bug this project
// already shipped once: the channel picker fired twenty-eight Google requests
// on every page load before it knew which tab was chosen.
//
// So it is asked for. A person presses a button, waits, and gets the answer.
//
// ── WHY IT IS NOT CACHED IN THE DATABASE ──
//
// It could be, and one day it should be — but a cache needs an invalidation
// rule, and the honest rule here is "whenever Google changes its mind", which
// is not observable. A stored answer with no way to know it is stale would be
// read as current on the day it stops being true, which is worse than a
// button that takes twenty seconds and says when it ran. Google's quota
// allows about sixteen presses a day on a site this size.

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

const SETUP = [
  'Create a Google Cloud service account and download its JSON key.',
  "In Search Console, add that service account's client_email as a Full user on the property.",
  'Put the JSON in GOOGLE_SA_KEY on this deployment (raw or base64).',
  'Set customFields.website on the Brand Brain to the verified property, e.g. sc-domain:example.com.',
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
  const limit = Math.min(Math.max(1, Number(body.limit) || MAX_INSPECTIONS), MAX_INSPECTIONS)

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
    const { site } = searchConfig({ customFields }, { brandName: customFields.brand_name || '' })

    // What was submitted, and what is earning. Both at once: neither depends
    // on the other, and the sitemap fetch is two HTTP round trips to a static
    // file that has no reason to wait behind a Google call.
    const [sitemap, pages] = await Promise.all([
      fetchSitemapUrls({ site }),
      fetchPageTotals({ site }),
    ])

    const targets = inspectionTargets({ pages: pages.rows, sitemap: sitemap.urls, limit })

    if (!targets.length) {
      // No URLs is not an empty index — it means we could not find out which
      // pages to ask about, and the reader has to be told which of the two
      // happened or a site with a broken sitemap reads as a site with no
      // pages.
      const inspected = await fetchInspections({ site, urls: [] })
      return res.status(200).json({
        ok: inspected.configured,
        configured: inspected.configured,
        site: inspected.site || site,
        setup: inspected.configured ? undefined : SETUP,
        error: inspected.configured
          ? 'No URLs to check: no sitemap is submitted for this property, and no page took an impression in the window.'
          : inspected.error,
        sitemap: { sources: sitemap.sources, found: sitemap.urls.length, error: sitemap.error },
        health: null,
        rows: [],
      })
    }

    const inspected = await fetchInspections({ site, urls: targets })
    if (!inspected.ok) {
      return res.status(200).json({
        ok: false,
        configured: inspected.configured,
        site: inspected.site || site,
        setup: inspected.configured ? undefined : SETUP,
        error: inspected.error,
        sitemap: { sources: sitemap.sources, found: sitemap.urls.length, error: sitemap.error },
        health: null,
        rows: [],
      })
    }

    // The impressions each inspected page took, carried onto its row so the
    // problem lists can be ordered by what the page is already worth. Done
    // here rather than in the pure module because it is a join between two
    // products' rows, and the pure module must stay a function of one.
    const impressionsByUrl = new Map((pages.rows || []).map(r => [String(r.page).replace(/\/$/, ''), r.impressions]))
    const withWeight = inspected.rows.map(r => ({
      ...r,
      impressions: impressionsByUrl.get(String(r.url).replace(/\/$/, '')) || 0,
    }))

    return res.status(200).json({
      ok: true,
      configured: true,
      site: inspected.site,
      checkedAt: new Date().toISOString(),
      // Said plainly, because "42 pages are fine" means nothing without
      // knowing whether the site has 42 pages or 420.
      coverage: {
        inspected: withWeight.length,
        sitemap: sitemap.urls.length,
        withImpressions: (pages.rows || []).length,
        capped: targets.length >= limit,
      },
      sitemap: { sources: sitemap.sources, found: sitemap.urls.length, error: sitemap.error },
      health: indexHealth(withWeight, { site: inspected.site }),
      rows: withWeight,
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 300) })
  }
}
