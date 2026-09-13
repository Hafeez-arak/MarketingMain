import { callerId, callerMayUseWorkspace, db, isConfigured } from './_supabase.js'
import { callModel } from './_provider.js'
import { loadBrandContext, IDENTITY } from './_context.js'
import { textIn } from '../../src/lib/agent/loop.js'
import { marketOf } from '../../src/lib/agent/calendar.js'
import {
  DISCOVER_SCHEMA, discoverPrompt, newCompetitors, agendaRowsFor, discoverSummary,
} from '../../src/lib/agent/discover.js'

// ─── POST /api/agent/discover ──────────────────────────────────────────────
// Find rivals nobody listed, and propose them onto the agent's own watchlist.
//
// Body: { workspace_id }
//
// RESEARCH-AGENT.md §5 moved this up from "later" for a reason the live
// database confirms: Alo Kheyatah has no competitor section at all, so the
// rivals lens, the competitor board and every "versus us" number are inert for
// that workspace before anything runs. Arak has seven rows and one is blank.
//
// One model call with web search, then arithmetic. The searching is a genuine
// search problem; deciding whether a returned name is already on the list is
// string matching, and src/lib/agent/discover.js does that half where it can
// be tested.
//
// ── THE WRITE BOUNDARY ──
//
// Writes land in `research_agenda` as `status = 'proposed'`, `created_by =
// 'agent'`. Nothing here touches brand_profile, brand_fields, brand_sections
// or brand_directory_*, and the grep that proves it is the whole of §5a:
//
//   grep -n "brand_directory\|brand_profile\|brand_fields\|brand_sections" api/agent/discover.js
//
// That must return only this comment.

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  if (!isConfigured) return res.status(500).json({ error: 'Supabase is not configured on this deployment.' })

  let body
  try { body = await readBody(req) } catch { return res.status(400).json({ error: 'Body must be JSON.' }) }

  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required.' })

  if (!(await callerId(req))) return res.status(401).json({ error: 'Sign in to discover competitors.' })
  if (!(await callerMayUseWorkspace(req, workspaceId))) {
    return res.status(403).json({ error: 'You do not have access to this workspace.' })
  }

  try {
    const { ctx, profile, directory } = await loadBrandContext(workspaceId, 'research')

    // What we already watch, from BOTH sides — the agent's watchlist and the
    // human-authored directory. Reading the directory here is a read, which
    // §5a permits and in fact requires: proposing a rival someone already
    // typed into the Brand Brain is the most obviously stupid thing this
    // endpoint could do.
    const agendaRows = await db(
      `research_agenda?workspace_id=eq.${workspaceId}&kind=eq.competitor` +
      `&status=neq.retired&select=subject`,
    )
    const known = [
      ...(agendaRows || []).map(r => ({ name: r.subject })),
    ]
    for (const list of Object.values(directory?.rowsBySection || {})) {
      for (const row of list) {
        const data = row.data || {}
        const name = data.name || data.company || data.title || ''
        const site = data.website || data.url || data.site || ''
        if (name) known.push({ name: String(name), website: String(site || '') })
      }
    }

    const market = marketOf({ profile, ctx })
    const brandFacts = {
      brandName: ctx?.brandName || '',
      descriptor: ctx?.brandDescriptor || '',
      audience: (profile?.targetPersonas || '').split('\n').slice(0, 4).join('; '),
    }

    const search = await callModel({
      workspaceId, job: 'extract', surface: 'discover', stage: 'discover',
      identity: IDENTITY,
      brand: 'You are building a competitor watchlist for one brand.',
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
      messages: [{
        role: 'user',
        content: discoverPrompt(brandFacts, {
          known: known.map(k => k.name).filter(Boolean),
          market: market.label,
          language: market.language || '',
        }),
      }],
      maxTokens: 6_000, effort: 'medium',
      outputFormat: DISCOVER_SCHEMA,
    })

    if (search.refused) {
      return res.status(200).json({ ok: false, error: search.error, proposed: 0 })
    }

    let reported = []
    if (search.ok) {
      try { reported = JSON.parse(textIn(search.response))?.competitors || [] } catch { reported = [] }
    }

    const proposed = newCompetitors(reported, known)

    // One row at a time, so a single rejected row cannot lose the rest. The
    // same reason the snapshot writes are sequential: a partial watchlist is
    // strictly better than none, and a 400 on one name should not cost the
    // other seven.
    const written = []
    for (const row of agendaRowsFor(workspaceId, proposed)) {
      try {
        await db('research_agenda', { method: 'POST', body: row, prefer: 'return=minimal' })
        written.push(row.subject)
      } catch (err) {
        console.error('[agent/discover] could not store', row.subject, err?.message || err)
      }
    }

    return res.status(200).json({
      ...discoverSummary({
        proposed: proposed.filter(p => written.includes(p.name)),
        known,
        seen: reported.length,
        cost: search.cost || 0,
      }),
      // Reported separately from `proposed`, because a row that was found and
      // then failed to store is a different problem from one never found, and
      // collapsing them would hide a database issue behind a thin-market note.
      store_failures: proposed.length - written.length,
    })
  } catch (err) {
    console.error('[agent/discover]', err)
    return res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 400) })
  }
}
