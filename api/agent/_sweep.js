import { db } from './_supabase.js'
import { searchWeb, readPage, webConfigured } from './_web.js'
import { availableProviders } from '../../src/lib/agent/web.js'
import { sweepPlan, belongs, headlinesFrom, mergeResults } from '../../src/lib/agent/sourceSweep.js'

// ─── The source sweep, with the network ────────────────────────────────────
// Every active "Where to look" source, searched in code before the project
// lenses start. Why, and what each kind of query does, is in
// src/lib/agent/sourceSweep.js; this file only does the calling and the
// bookkeeping.
//
// ── TWO LENSES, ONE SWEEP ──
//
// Openings and targets both need it, and n8n starts them in the same batch.
// Neither waits for the other to begin: each claims the sources it will
// check by inserting (run_id, source_id) rows, which are unique, so a source
// is claimed once and checked once. Each lens then works through its own
// claims and waits for the other's. A lens that died holding claims leaves
// them `claimed`; after STALE_MS the survivor checks those itself.
//
// ── PACED, ACROSS BOTH PROVIDERS ──
//
// Firecrawl's plan allows about 24 requests a minute. The first live sweep
// (2026-10-19) sent them all at once, was refused with 429 after a few
// seconds, and fell through to Tavily for the rest. So every sweep call takes
// a slot: Firecrawl at most one every GAP_MS.firecrawl, Tavily one every
// GAP_MS.tavily, each call going to whichever is free first. That keeps the
// sweep well under Firecrawl's limit — the other lenses running beside it use
// Firecrawl too — and roughly halves the time. The slots are module state,
// so the two lenses sharing one agent process share one pace.
//
// ── ITS OWN CLOCK ──
//
// The sweep stops starting new sources after SWEEP_MS, and anything left is
// recorded as not reached. runSingleLens starts the lens's own clock after the
// sweep, so it never eats the lens's time (n8n waits 600s for a lens; 150s of
// sweep plus the box's 420s lens budget fits).
//
// Never fatal. A sweep that fails entirely leaves the lens exactly where it
// was before the sweep existed: with the list of names, and its own searches.

const CONCURRENCY = 4
export const SWEEP_MS = 150_000
const STALE_MS = 120_000
const POLL_MS = 3_000
const GAP_MS = { firecrawl: 3_500, tavily: 1_500 }

const sleep = ms => new Promise(r => setTimeout(r, ms))

const nextFree = { firecrawl: 0, tavily: 0 }
/** Wait for the next free slot and say which provider it belongs to. */
async function slot() {
  const providers = availableProviders(process.env)
  let best = providers[0]
  let at = Infinity
  for (const p of providers) {
    const t = Math.max(Date.now(), nextFree[p] || 0)
    if (t < at) { at = t; best = p }
  }
  if (!best) return undefined
  nextFree[best] = at + (GAP_MS[best] || 2_000)
  await sleep(at - Date.now())
  return best
}
const paced = {
  search: async (query, opts) => searchWeb(query, { ...opts, prefer: await slot() }),
  read: async url => readPage(url, { prefer: await slot() }),
}

/** Check one source. Never throws; a failure is a row that says so. */
export async function checkSource(source, { geography = '' } = {}) {
  const plan = sweepPlan(source, { geography })
  if (!plan) return { status: 'failed', error: 'Not a source the sweep can search.', queries: [], results: [], provider: '' }

  const lists = []
  const queries = []
  const errors = []
  let provider = ''

  for (const { query, limit } of plan.searches) {
    queries.push(query)
    const out = await paced.search(query, { limit, recent: true })
    if (!out.ok) { errors.push(`${query}: ${out.error}`); continue }
    provider = provider || out.provider || ''
    const kept = (out.results || []).filter(r => belongs(r.url, plan.keep))
    lists.push(kept)
    // Instagram and LinkedIn pages rarely carry a date a search engine can
    // filter on, so "little this month" often means "little dated": @addadruh
    // posts daily and the month filter found one post (2026-10-19). A thin
    // answer is topped up without the filter; the lens judges the dates.
    if (kept.length < 3) {
      const more = await paced.search(query, { limit })
      if (more.ok) lists.push((more.results || []).filter(r => belongs(r.url, plan.keep)))
    }
  }

  // The front page after the searches, and only a few of its headlines: the
  // searches carry the project words, a front page carries whatever the site
  // leads with — on 2026-10-19 that was Morocco solar and Iraqi oil on MEED,
  // and company-profile links on Argaam, which pushed the Saudi contract
  // awards the searches had found out of the list.
  if (plan.read) {
    const page = await paced.read(plan.read)
    if (page.ok) {
      provider = provider || page.provider || ''
      lists.push(headlinesFrom(page.page?.markdown || '', plan.keep.host, 6))
    } else {
      errors.push(`read ${plan.read}: ${page.error}`)
    }
  }

  const results = mergeResults(lists, 16)
  const nothingWorked = errors.length && !lists.length
  return {
    status: nothingWorked ? 'failed' : 'done',
    error: errors.join(' | ').slice(0, 500),
    queries,
    results,
    provider,
  }
}

async function record(workspaceId, runId, sourceId, outcome) {
  await db(
    `research_source_checks?workspace_id=eq.${workspaceId}&run_id=eq.${runId}&source_id=eq.${sourceId}`,
    {
      method: 'PATCH',
      body: {
        status: outcome.status,
        error: outcome.error || '',
        queries: outcome.queries || [],
        results: outcome.results || [],
        result_count: (outcome.results || []).length,
        provider: outcome.provider || '',
        checked_at: new Date().toISOString(),
      },
      prefer: 'return=minimal',
    },
  ).catch(err => console.error('[agent/sweep] record:', err?.message || err))
}

/**
 * Work through sources with a small pool, so a slow site does not hold the
 * rest. Top tier first, so a sweep cut short by its clock loses the light
 * sources, not the ones someone marked as the best.
 */
async function checkAll(workspaceId, runId, sources, geography, deadline) {
  const queue = [...sources].sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9))
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift()
      const outcome = Date.now() > deadline
        ? { status: 'failed', error: 'Not reached this run: the source check ran out of time.', queries: [], results: [], provider: '' }
        : await checkSource(s, { geography }).catch(err => ({
          status: 'failed', error: String(err?.message || err).slice(0, 300), queries: [], results: [], provider: '',
        }))
      await record(workspaceId, runId, s.id, outcome)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
}

/**
 * Make sure this run's sweep is done, doing whatever share of it is unclaimed,
 * and return every check joined to its source.
 *
 * @param {{ workspaceId: string, runId: string, sources: object[], geography?: string }} args
 * @returns {Promise<object[]>} rows: { source_id, status, results, error, source }
 */
export async function ensureSweep({ workspaceId, runId, sources = [], geography = '' }) {
  const live = (sources || []).filter(s => s?.id && sweepPlan(s, { geography }))
  if (!live.length || !runId || !webConfigured()) return []
  const byId = new Map(live.map(s => [s.id, s]))
  const deadline = Date.now() + SWEEP_MS

  try {
    // ignore-duplicates + representation returns only the rows THIS call
    // inserted, which is exactly the set this lens now owns.
    const mine = await db('research_source_checks?on_conflict=run_id,source_id', {
      method: 'POST',
      body: live.map(s => ({ workspace_id: workspaceId, run_id: runId, source_id: s.id, status: 'claimed' })),
      prefer: 'resolution=ignore-duplicates,return=representation',
    })
    await checkAll(workspaceId, runId, (mine || []).map(r => byId.get(r.source_id)).filter(Boolean), geography, deadline)

    for (;;) {
      const rows = await db(
        `research_source_checks?workspace_id=eq.${workspaceId}&run_id=eq.${runId}` +
        '&select=source_id,status,results,error,checked_at',
      )
      const pending = (rows || []).filter(r => r.status === 'claimed' && byId.has(r.source_id))
      if (!pending.length || Date.now() > deadline + 15_000) {
        return (rows || []).filter(r => byId.has(r.source_id)).map(r => ({ ...r, source: byId.get(r.source_id) }))
      }
      // The other lens stopped answering for these: check them here.
      const stale = pending.filter(r => Date.now() - new Date(r.checked_at).getTime() > STALE_MS)
      if (stale.length) {
        await checkAll(workspaceId, runId, stale.map(r => byId.get(r.source_id)), geography, deadline)
        continue
      }
      await sleep(POLL_MS)
    }
  } catch (err) {
    console.error('[agent/sweep]', err?.message || err)
    return []
  }
}

/**
 * After synthesis: how many of this run's project findings rested on each
 * checked source. Written to the check rows so the panel can say "led to a
 * project 12 Oct". Never fatal.
 */
export async function recordSweepFindings(workspaceId, runId, counts) {
  for (const [sourceId, n] of counts) {
    await db(
      `research_source_checks?workspace_id=eq.${workspaceId}&run_id=eq.${runId}&source_id=eq.${sourceId}`,
      { method: 'PATCH', body: { findings: n }, prefer: 'return=minimal' },
    ).catch(err => console.error('[agent/sweep] findings:', err?.message || err))
  }
}
