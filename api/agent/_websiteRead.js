import { callModel } from './_provider.js'
import { db } from './_supabase.js'
import { fetchWebsiteData } from './_searchConsole.js'
import { fetchGa4Data } from './_ga4.js'
import { textIn } from '../../src/lib/agent/loop.js'
import { searchConfig } from '../../src/lib/agent/searchConsole.js'
import { ga4Config } from '../../src/lib/agent/ga4.js'
import {
  websiteFacts, WEBSITE_READ_SCHEMA, WEBSITE_READ_PROMPT, normaliseWebsiteRead,
} from '../../src/lib/agent/websiteRead.js'

// ─── The website read, once per run ────────────────────────────────────────
// See src/lib/agent/websiteRead.js. One Sonnet call, no web tools, about
// three cents. Never throws: a run whose website read failed still has its
// brief, and says why the website part is missing.

export async function readWebsite({ workspaceId, runId, identity, brand, deadline = null }) {
  try {
    const rows = await db(`brand_profile?workspace_id=eq.${workspaceId}&select=custom_fields`)
    const customFields = rows?.[0]?.custom_fields || {}
    const { site, brandTerms } = searchConfig({ customFields }, { brandName: customFields.brand_name || '' })
    const ga4 = ga4Config({ customFields })

    const [search, analytics] = await Promise.all([
      fetchWebsiteData({ site, days: 28 }),
      fetchGa4Data({ property: ga4.path, days: 28 }),
    ])
    const facts = websiteFacts({ search, ga4: analytics, brandTerms, site })
    if (!facts) {
      return { ok: false, cost: 0, error: search?.error || analytics?.error || 'No website data is configured.' }
    }

    const out = await callModel({
      workspaceId, surface: 'run', runId, job: 'search', stage: 'website',
      identity, brand,
      messages: [{ role: 'user', content: `${WEBSITE_READ_PROMPT}\n\nFACTS:\n${JSON.stringify(facts, null, 1)}` }],
      maxTokens: 3_000, effort: 'low',
      outputFormat: WEBSITE_READ_SCHEMA,
      deadline,
    })
    if (!out.ok) return { ok: false, cost: out.cost || 0, error: out.error }

    const read = normaliseWebsiteRead(JSON.parse(textIn(out.response)))
    return {
      ok: true,
      cost: out.cost || 0,
      read: {
        ...read,
        window: facts.google_search?.window || facts.visits?.window || null,
        from: { search: Boolean(facts.google_search), visits: Boolean(facts.visits) },
      },
    }
  } catch (err) {
    return { ok: false, cost: 0, error: String(err?.message || err).slice(0, 300) }
  }
}
