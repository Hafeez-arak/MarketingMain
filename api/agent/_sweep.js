import { db } from './_supabase.js'
import { searchWeb, readPage, webConfigured } from './_web.js'
import { availableProviders } from '../../src/lib/agent/web.js'
import {
  sweepPlan, belongs, headlinesFrom, mergeResults, isFeed, parseFeed, parseLinkedinPage, instagramItems,
  rankByMarket, freshAndNew,
} from '../../src/lib/agent/sourceSweep.js'

// ─── The source sweep, with the network ────────────────────────────────────
// Every active "Where to look" source, read in code before the project
// lenses start — directly where it can be (feed, LinkedIn page, Instagram
// through Meta), through a search engine where it cannot. Why, and what each kind of query does, is in
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

// ─── Reading a source directly ─────────────────────────────────────────────
// No search provider and no credits: the source's own feed, its public
// LinkedIn page, or its Instagram posts through Meta. Each returns
// { ok, results, via } and never throws; a failure sends the source back to
// the search engine.

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const DIRECT_TIMEOUT_MS = 15_000
// One LinkedIn page at a time, a couple of seconds apart: a handful of
// public pages a week, read the way a person would read them.
const LINKEDIN_GAP_MS = 2_500
let linkedinNext = 0

async function fetchText(url) {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), DIRECT_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: '*/*' }, redirect: 'follow', signal: abort.signal })
    return { status: res.status, text: res.ok ? await res.text() : '' }
  } catch (err) {
    return { status: 0, text: '', error: String(err?.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

async function readFeed(urls) {
  for (const url of urls) {
    const { status, text } = await fetchText(url)
    if (status === 200 && isFeed(text)) {
      const results = parseFeed(text, 30)
      if (results.length) return { ok: true, results, via: 'feed' }
    }
  }
  return { ok: false, error: 'no feed' }
}

async function readLinkedin(url) {
  const wait = Math.max(0, linkedinNext - Date.now())
  linkedinNext = Date.now() + wait + LINKEDIN_GAP_MS
  if (wait) await sleep(wait)
  const { status, text } = await fetchText(url)
  // 999 is LinkedIn declining a logged-out reader; an authwall page has no
  // posts in it. Either way the search engine takes over.
  const results = status === 200 ? parseLinkedinPage(text, 12) : []
  return results.length ? { ok: true, results, via: 'linkedin' } : { ok: false, error: `linkedin page ${status || 'unreachable'}` }
}

async function readInstagram(handle) {
  const token = process.env.META_IG_TOKEN || ''
  const igUser = process.env.META_IG_USER_ID || ''
  if (!token || !igUser) return { ok: false, error: 'no Meta credentials' }
  const fields = `business_discovery.username(${handle}){username,media.limit(15){caption,permalink,timestamp}}`
  const { status, text } = await fetchText(
    `https://graph.facebook.com/v23.0/${igUser}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`,
  )
  let body
  try { body = JSON.parse(text || '{}') } catch { body = null }
  const results = instagramItems(body?.business_discovery?.media?.data || [])
  // A personal (non-business) account, a private one, or expired data
  // access: the search engine takes over.
  return results.length ? { ok: true, results, via: 'instagram' } : { ok: false, error: `instagram ${status || 'unreachable'}` }
}

const DIRECT = { feed: d => readFeed(d.urls), linkedin: d => readLinkedin(d.url), instagram: d => readInstagram(d.handle) }

/** Check one source. Never throws; a failure is a row that says so. */
export async function checkSource(source, { geography = '', words = [], previous = [] } = {}) {
  const plan = sweepPlan(source, { geography })
  if (!plan) return { status: 'failed', error: 'Not a source the sweep can search.', queries: [], results: [], provider: '' }

  const lists = []
  const queries = []
  const errors = []
  let provider = ''

  // Straight from the source first. When an account answered, the search
  // engine has nothing to add: it only ever held scraps of the same posts.
  // A site's feed replaces its front page; a top site is still searched too,
  // because the search carries the project words and reaches further back.
  const direct = plan.direct ? await DIRECT[plan.direct.kind](plan.direct).catch(err => ({ ok: false, error: String(err?.message || err) })) : null
  if (direct?.ok) {
    provider = direct.via
    lists.push(direct.results)
  }
  const social = ['linkedin', 'instagram'].includes(plan.direct?.kind)
  const searchToo = !direct?.ok || (!social && plan.read)

  if (searchToo) {
    for (const { query, limit } of plan.searches) {
      queries.push(query)
      const out = await paced.search(query, { limit, recent: true })
      if (!out.ok) { errors.push(`${query}: ${out.error}`); continue }
      provider = provider || out.provider || ''
      const kept = (out.results || []).filter(r => belongs(r.url, plan.keep))
      lists.push(kept)
      // Instagram and LinkedIn pages rarely carry a date a search engine can
      // filter on, so "little this month" often means "little dated". A thin
      // answer is topped up without the filter; the lens judges the dates.
      if (kept.length < 3) {
        const more = await paced.search(query, { limit })
        if (more.ok) lists.push((more.results || []).filter(r => belongs(r.url, plan.keep)))
      }
    }
  }

  // The front page after the searches, and only a few of its headlines: a
  // front page carries whatever the site leads with — on 2026-10-19 that was
  // Morocco solar and Iraqi oil on MEED. Skipped when a feed was read.
  if (plan.read && !direct?.ok) {
    const page = await paced.read(plan.read)
    if (page.ok) {
      provider = provider || page.provider || ''
      lists.push(headlinesFrom(page.page?.markdown || '', plan.keep.host, 6))
    } else {
      errors.push(`read ${plan.read}: ${page.error}`)
    }
  }
  if (plan.direct && !direct?.ok) errors.unshift(`direct: ${direct?.error || 'failed'}`)

  const merged = mergeResults([rankByMarket(mergeResults(lists, 60), words)], 20)
  const results = freshAndNew(merged, previous)
  const nothingWorked = !lists.length
  return {
    status: nothingWorked ? 'failed' : 'done',
    error: errors.join(' | ').slice(0, 500),
    queries,
    results,
    new_count: results.filter(r => r.is_new).length,
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
        new_count: outcome.new_count ?? null,
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
async function checkAll(workspaceId, runId, sources, ctx, deadline) {
  const queue = [...sources].sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9))
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift()
      const outcome = Date.now() > deadline
        ? { status: 'failed', error: 'Not reached this run: the source check ran out of time.', queries: [], results: [], provider: '' }
        : await checkSource(s, { ...ctx, previous: ctx.previous?.get(s.id) || [] }).catch(err => ({
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
/**
 * Each source's results from its last finished check before this run, so this
 * run can hand the lens only what is new. A failed read means everything
 * counts as new — a repeat is better than a silent gap.
 */
async function previousResults(workspaceId, runId, ids) {
  if (!ids.length) return new Map()
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString()
  const rows = await db(
    `research_source_checks?workspace_id=eq.${workspaceId}&run_id=neq.${runId}&status=eq.done` +
    `&source_id=in.(${ids.join(',')})&checked_at=gte.${since}` +
    `&select=source_id,results&order=checked_at.desc&limit=${ids.length * 4}`,
  ).catch(err => { console.error('[agent/sweep] previous:', err?.message || err); return [] })
  const out = new Map()
  for (const r of rows || []) if (!out.has(r.source_id)) out.set(r.source_id, r.results || [])
  return out
}

export async function ensureSweep({ workspaceId, runId, sources = [], geography = '', words = [] }) {
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
    const ctx = { geography, words, previous: await previousResults(workspaceId, runId, [...byId.keys()]) }
    await checkAll(workspaceId, runId, (mine || []).map(r => byId.get(r.source_id)).filter(Boolean), ctx, deadline)

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
        await checkAll(workspaceId, runId, stale.map(r => byId.get(r.source_id)), ctx, deadline)
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
