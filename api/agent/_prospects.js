import { db } from './_supabase.js'
import { callModel } from './_provider.js'
import { loadBrandContext, IDENTITY } from './_context.js'
import { backupWeb } from './_lenses.js'
import { textIn, urlsFromResponse } from '../../src/lib/agent/loop.js'
import { marketOf } from '../../src/lib/agent/calendar.js'
import { backupPrompt, claudeSearchesFor } from '../../src/lib/agent/backupSearch.js'
import {
  PROSPECTS_SCHEMA, prospectsPrompt, cleanProspects, prospectRows, prospectsSummary,
  DEFAULT_COUNT, MAX_PROSPECTS,
} from '../../src/lib/agent/prospects.js'

// ─── Find prospects: POST /api/agent/discover { mode: 'prospects' } ────────
// Companies a person could contract with, for one segment, on request. See
// src/lib/agent/prospects.js for why this is not a weekly lens.
//
// A mode of discover rather than its own route: Vercel Hobby allows twelve
// functions and api/ is at twelve (server/agent.js has the story of the
// thirteenth taking production down). Finding rivals and finding prospects are
// the same shape anyway: one searching call, then string matching in code,
// then rows a person accepts or rejects.
//
// Runs on Vercel and waits for the answer. Measured lenses with this budget
// finish in one to three minutes; the deadline below stops the call itself
// before the platform's 300s, so a slow search ends as "did not finish" with
// a reason rather than as a spinner.
//
// ── THE WRITE BOUNDARY ──
// research_prospect_searches and research_prospects only. Nothing here writes
// the Brand Brain, and nothing writes email_contacts: putting a prospect into
// outreach is a person's click on the page.

// Searching like a project lens: Firecrawl first, because directories, branch
// lists and contact pages are what it beat Claude's search on (search bake-off,
// 2026-09-15), with web_search for dated news about the company.
const PROSPECT_LENS = { key: 'prospects', web: 'firecrawl', budget: { searches: 4, fetches: 10, maxTokens: 12_000 } }

// Under Vercel's 300s, with room to write the rows and answer.
const BUDGET_MS = 240_000

// A search row still 'running' after this is a function that died, not one
// in progress. The page reads the same number (src/lib/prospects.js).
export const STALE_MS = 6 * 60_000

const str = v => String(v ?? '').trim()

export async function findProspects(res, { workspaceId, body, userId }) {
  const segment = str(body.segment).slice(0, 140)
  const area = str(body.area).slice(0, 80)
  const count = Math.max(1, Math.min(MAX_PROSPECTS, Math.round(Number(body.count) || DEFAULT_COUNT)))
  if (!segment) return res.status(400).json({ ok: false, error: 'Say which kind of company to look for.' })

  // One at a time per company. Two people pressing Find at once would pay
  // twice for overlapping lists and race each other on the unique name key.
  const since = new Date(Date.now() - STALE_MS).toISOString()
  const running = await db(
    `research_prospect_searches?workspace_id=eq.${workspaceId}&status=eq.running&started_at=gte.${since}&select=id&limit=1`,
  )
  if ((running || []).length) {
    return res.status(409).json({ ok: false, error: 'A prospect search is already running for this company. Try again when it finishes.' })
  }

  const [{ brand, ctx, profile }, icpRows, prospectRowsNow, accountRows] = await Promise.all([
    loadBrandContext(workspaceId, 'research'),
    db(`sales_icp?workspace_id=eq.${workspaceId}&select=config&limit=1`),
    // Every status: a rejected company is what must not come back.
    db(`research_prospects?workspace_id=eq.${workspaceId}&select=name,name_key,website,domain`),
    db(`sales_accounts?workspace_id=eq.${workspaceId}&select=name`).catch(() => []),
  ])
  const icp = icpRows?.[0]?.config || null
  const known = [...(prospectRowsNow || []), ...(accountRows || []).map(a => ({ name: a.name }))]

  const [search] = await db('research_prospect_searches', {
    method: 'POST',
    body: { workspace_id: workspaceId, segment, area, status: 'running', created_by: userId || null },
    prefer: 'return=representation',
  })
  const searchId = search?.id
  const finish = patch => db(`research_prospect_searches?id=eq.${searchId}&workspace_id=eq.${workspaceId}`, {
    method: 'PATCH', body: { ...patch, finished_at: new Date().toISOString() }, prefer: 'return=minimal',
  }).catch(err => console.error('[agent/prospects] could not close the search row', err?.message || err))

  try {
    const market = marketOf({ profile, ctx })
    const brandFacts = {
      brandName: ctx?.brandName || '',
      descriptor: ctx?.brandDescriptor || '',
      audience: (profile?.targetPersonas || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 8).join('; '),
      geography: market.label,
    }
    const prompt = prospectsPrompt(brandFacts, {
      segment, area, count, icp, language: market.language || '',
      known: known.map(k => k.name).filter(Boolean),
    })

    const deadline = Date.now() + BUDGET_MS
    const backup = backupWeb(PROSPECT_LENS, deadline)
    const searches = backup ? claudeSearchesFor(PROSPECT_LENS) : 6
    const out = await callModel({
      workspaceId, job: 'search', surface: 'prospects', stage: 'prospects',
      identity: IDENTITY,
      brand,
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: searches },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: PROSPECT_LENS.budget.fetches },
        ...(backup?.tools || []),
      ],
      messages: [{ role: 'user', content: backup ? prompt + backupPrompt(PROSPECT_LENS) : prompt }],
      runTool: backup?.runTool || null,
      maxTokens: PROSPECT_LENS.budget.maxTokens,
      effort: 'medium',
      outputFormat: PROSPECTS_SCHEMA,
      deadline,
    })
    const cost = out.cost || 0

    if (out.refused || !out.ok) {
      const error = out.timedOut
        ? 'The search ran out of time before it finished. Try a narrower kind of company.'
        : String(out.error || 'The search did not finish.').slice(0, 400)
      await finish({ status: 'failed', error, cost_usd: cost })
      return res.status(200).json({ ok: false, error, capped: Boolean(out.refused), cost })
    }

    let reported = []
    let note = ''
    try {
      const parsed = JSON.parse(textIn(out.response))
      reported = Array.isArray(parsed?.prospects) ? parsed.prospects : []
      note = str(parsed?.note)
    } catch {
      const error = 'The search answered in a shape we could not read.'
      await finish({ status: 'failed', error, cost_usd: cost })
      return res.status(200).json({ ok: false, error, cost })
    }

    const allowed = new Set(backup?.found || [])
    urlsFromResponse(out.response, allowed)
    const { keep, dropped } = cleanProspects(reported, { known, allowed, icp, count })

    // One row at a time, so one rejected row cannot lose the rest. A name key
    // that collides (another search wrote it a moment ago) is skipped, not
    // overwritten: a person may already have reviewed that row.
    let written = 0
    for (const row of prospectRows(workspaceId, searchId, segment, keep)) {
      try {
        await db('research_prospects?on_conflict=workspace_id,name_key', {
          method: 'POST', body: row, prefer: 'resolution=ignore-duplicates,return=minimal',
        })
        written += 1
      } catch (err) {
        console.error('[agent/prospects] could not store', row.name, err?.message || err)
      }
    }

    await finish({ status: 'complete', found: reported.length, added: written, cost_usd: cost })
    return res.status(200).json({
      ...prospectsSummary({ keep, dropped, seenCount: reported.length, cost, note }),
      search_id: searchId,
      store_failures: keep.length - written,
    })
  } catch (err) {
    console.error('[agent/prospects]', err)
    const error = String(err?.message || err).slice(0, 400)
    await finish({ status: 'failed', error })
    return res.status(500).json({ ok: false, error })
  }
}
