import { fingerprint, similarity, REPEAT_AT } from './memory.js'
import { isComputedLens } from './novelty.js'

// ─── The market-intelligence store, in pure functions ──────────────────────
// A lens returns findings for ONE run. The store keeps three kinds of thing
// across runs, because they are what a team keeps coming back to:
//
//   signals        small observed facts — a rival's LinkedIn post about a new
//                  brand, a job advert, a name on an exhibitor list. Worth
//                  little alone; worth a great deal combined over weeks.
//   opportunities  tenders, projects and leads, with a status sales owns.
//   events         expos and sponsorship openings, with deadlines.
//
// This file decides, in code, what is NEW, what was SEEN before, and what
// CHANGED — the "check the store before you call it new" rule. A model asked
// whether something is new has never seen the store; this has.
//
// ── WHY NAMES, NOT HEADLINES, ARE THE KEY ──
//
// The same project is written up in different words every week ("Tuwaiq
// Palace retendered", "contractor still unnamed at Tuwaiq Palace"), so a
// headline is the wrong identity. The lens is asked for the thing's own NAME,
// and a name is matched exactly after normalisation — or when one name's words
// are all inside the other's ("Tuwaiq Palace" inside "Tuwaiq Palace hotel
// conversion"). Not by a similarity score: agendaDedup.js measured that a
// score both merges two different projects that share a city and misses one
// project written two ways. A missed merge costs a duplicate row a person can
// drop; a wrong merge silently loses a lead.
//
// Pure. No network, no clock unless passed in.

export const SIGNAL_CATEGORIES = [
  'project', 'partnership', 'product', 'pricing', 'hiring', 'expansion', 'content', 'event',
  'award', 'leadership', 'regulation', 'gigaproject', 'tech', 'tender', 'other',
]
export const CHANNELS = [
  'website', 'linkedin', 'instagram', 'tiktok', 'x', 'youtube', 'news', 'jobs',
  'tender_portal', 'event_site', 'government', 'other',
]
export const SOCIAL_CHANNELS = ['linkedin', 'instagram', 'tiktok', 'x', 'youtube']
export const RELEVANCE = ['high', 'medium', 'low']
export const OPPORTUNITY_TYPES = ['tender', 'project', 'lead']
export const OPPORTUNITY_STATUSES = ['new', 'assigned', 'pursued', 'won', 'lost', 'dropped']
export const CLOSED_STATUSES = ['won', 'lost', 'dropped']
export const TIMINGS = ['open', 'closed', 'unconfirmed']
export const EVENT_DECISIONS = ['undecided', 'visiting', 'exhibiting', 'sponsoring', 'skipping']

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback)
const str = v => String(v ?? '').trim()

/** 'YYYY-MM-DD' when the value is a real calendar date, else null. */
export function cleanDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(value))
  if (!m) return null
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

const today = now => now.toISOString().slice(0, 10)

/**
 * The comparable form of a name.
 *
 * Unicode-aware on purpose: `[^a-z0-9]` would erase every Arabic name to an
 * empty string, and two empty keys are "the same project".
 */
export function nameKey(name) {
  return str(name)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(the|al) /, '')
    .trim()
}

const words = key => key.split(' ').filter(w => w.length > 1)

/**
 * Are these two names the same thing?
 *
 * Exact after normalisation, or every word of the shorter name appears in the
 * longer one and there are at least two such words. "Riyadh" alone is not a
 * project.
 */
export function sameName(a, b) {
  const ka = nameKey(a)
  const kb = nameKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  const [short, long] = words(ka).length <= words(kb).length ? [words(ka), words(kb)] : [words(kb), words(ka)]
  if (short.length < 2) return false
  const set = new Set(long)
  return short.every(w => set.has(w))
}

/** The first usable URL on a finding, and its title. */
export function firstSource(sources = []) {
  for (const s of sources || []) {
    const url = str(typeof s === 'string' ? s : s?.url)
    if (/^https?:\/\//i.test(url)) return { url, title: str(s?.title) }
  }
  return null
}

/** Relevance with a sane default. Low is kept, never reported. */
export const relevanceOf = f => pick(f?.relevance, RELEVANCE, 'medium')

/** A competitor name matched back to the watchlist spelling when possible. */
export function canonicalCompetitor(name, watchlist = []) {
  const n = str(name)
  if (!n) return ''
  const nk = nameKey(n)
  const prefix = (a, b) => b.length >= 4 && (a === b || a.startsWith(`${b} `))
  const hit = (watchlist || []).find(w => sameName(w, n) || prefix(nameKey(w), nk) || prefix(nk, nameKey(w)))
  return hit || n
}

// ─── Findings → store rows ─────────────────────────────────────────────────

/**
 * Every searched finding with a source is a signal.
 *
 * Computed lenses (calendar, ourselves) are not: their facts are our own
 * numbers and public holidays, which the store has no reason to accumulate.
 */
export function signalFromFinding(f, watchlist = []) {
  if (!f || isComputedLens(f.lens)) return null
  const src = firstSource(f.sources)
  const summary = str(f.headline)
  if (!src || !summary) return null
  const competitor = canonicalCompetitor(f.competitor, watchlist)
  return {
    competitor,
    category: pick(f.category, SIGNAL_CATEGORIES, 'other'),
    channel: pick(f.channel, CHANNELS, 'other'),
    summary,
    detail: str(f.detail).slice(0, 2000),
    relevance: relevanceOf(f),
    source_url: src.url,
    source_title: src.title,
    event_date: cleanDate(f.event?.start_date) || cleanDate(f.perishable_until),
    fingerprint: signalKey(competitor, summary),
  }
}

export const signalKey = (competitor, summary) => `${nameKey(competitor) || '-'}|${fingerprint(summary)}`

export function opportunityFromFinding(f) {
  const lead = f?.lead
  const name = str(lead?.name)
  if (!name) return null
  const src = firstSource(f.sources)
  if (!src) return null
  return {
    type: pick(lead.type, OPPORTUNITY_TYPES, 'project'),
    name,
    headline: str(f.headline),
    client: str(lead.client),
    contractor: str(lead.contractor),
    consultant: str(lead.consultant),
    location: str(lead.location),
    scope: str(lead.scope),
    stage: str(lead.stage),
    deadline: cleanDate(lead.deadline),
    timing: pick(lead.timing, TIMINGS, 'unconfirmed'),
    relevance: relevanceOf(f),
    suggested_action: str(f.suggested_action),
    source_url: src.url,
    sources: (f.sources || []).slice(0, 5),
    fingerprint: `opp|${nameKey(name)}`,
  }
}

const yearOf = d => (d ? String(d).slice(0, 4) : '')
const yearIn = name => (/\b(20\d\d)\b/.exec(name) || [])[1] || ''

export function eventFromFinding(f, watchlist = []) {
  const ev = f?.event
  const name = str(ev?.name)
  if (!name) return null
  const src = firstSource(f.sources)
  const start = cleanDate(ev.start_date)
  return {
    name,
    start_date: start,
    end_date: cleanDate(ev.end_date),
    venue: str(ev.venue),
    city: str(ev.city),
    organizer: str(ev.organizer),
    url: str(ev.url) || src?.url || '',
    exhibitor_deadline: cleanDate(ev.exhibitor_deadline),
    competitors_exhibiting: [...new Set((ev.competitors_exhibiting || [])
      .map(c => canonicalCompetitor(c, watchlist)).filter(Boolean))],
    relevance: relevanceOf(f),
    recommendation: str(f.suggested_action),
    source_url: src?.url || str(ev.url),
    // The year is part of an event's identity — Saudi Build 2026 and 2027 are
    // two rows, and the unique index would refuse the second otherwise. An
    // undated sighting still matches its dated self through matchEvent.
    fingerprint: `evt|${nameKey(name.replace(/\b20\d\d\b/g, ''))}|${yearOf(start) || yearIn(name) || 'tbc'}`,
  }
}

// ─── Matching against what is already stored ──────────────────────────────


export function matchOpportunity(candidate, rows = []) {
  return (rows || []).find(r => r.fingerprint === candidate.fingerprint || sameName(r.name, candidate.name)) || null
}

export function matchEvent(candidate, rows = []) {
  return (rows || []).find(r => {
    if (!(r.fingerprint === candidate.fingerprint || sameName(
      r.name.replace(/\b20\d\d\b/g, ''), candidate.name.replace(/\b20\d\d\b/g, ''),
    ))) return false
    const a = yearOf(r.start_date) || yearIn(r.name)
    const b = yearOf(candidate.start_date) || yearIn(candidate.name)
    return !a || !b || a === b
  }) || null
}

/**
 * Same competitor, and the same fact.
 *
 * Signals ARE prose, unlike names, so here a similarity score is the right
 * instrument — the same threshold the idea-repeat check was measured at.
 */
export function matchSignal(candidate, rows = []) {
  const ck = nameKey(candidate.competitor)
  let best = null
  let bestScore = 0
  for (const r of rows || []) {
    if (nameKey(r.competitor) !== ck) continue
    if (r.fingerprint === candidate.fingerprint) return r
    const s = similarity(r.summary, candidate.summary)
    if (s > bestScore) { bestScore = s; best = r }
  }
  return bestScore >= REPEAT_AT ? best : null
}

/**
 * What a new sighting establishes that the stored row does not already say.
 *
 * Only ever FILLS or CORRECTS a field with a real value. A sighting that
 * could not reach the deadline must not blank the deadline a previous one
 * found — "unconfirmed this week" is not "no deadline".
 */
function fieldChanges(row, cand, fields) {
  const patch = {}
  const changes = []
  for (const [field, label] of fields) {
    const next = cand[field]
    if (next == null || next === '' || (Array.isArray(next) && !next.length)) continue
    const prev = row[field]
    if (Array.isArray(next)) {
      const merged = [...new Set([...(prev || []), ...next])]
      if (merged.length !== (prev || []).length) {
        patch[field] = merged
        changes.push(`${label}: ${next.filter(x => !(prev || []).includes(x)).join(', ')}`)
      }
      continue
    }
    if (String(prev ?? '') === String(next)) continue
    patch[field] = next
    changes.push(prev ? `${label} ${prev} → ${next}` : `${label} now ${next}`)
  }
  return { patch, changes }
}

const OPP_FIELDS = [
  ['deadline', 'deadline'], ['contractor', 'contractor'], ['consultant', 'consultant'],
  ['client', 'client'], ['stage', 'stage'], ['location', 'location'], ['scope', 'scope'],
]
const EVENT_FIELDS = [
  ['start_date', 'starts'], ['end_date', 'ends'], ['venue', 'venue'], ['city', 'city'],
  ['exhibitor_deadline', 'exhibitor deadline'], ['organizer', 'organiser'],
  ['competitors_exhibiting', 'exhibiting'],
]

/**
 * Plan every store write for a set of findings, and say for each finding
 * whether the store already knew it.
 *
 * Returns rows to insert, patches to apply, and `annotations` keyed by the
 * finding's position so synthesis and the page can say "tracked since 2 Sep"
 * rather than presenting a known lead as news.
 *
 * Self-deduplicating within the run: two lenses reporting the same tender
 * produce one insert.
 */
export function planStoreWrites(findings = [], existing = {}, { runId = null, now = new Date(), watchlist = [] } = {}) {
  const stamp = now.toISOString()
  const out = {
    signals: { insert: [], update: [] },
    opportunities: { insert: [], update: [] },
    events: { insert: [], update: [] },
    annotations: [],
  }
  const pools = {
    signals: [...(existing.signals || [])],
    opportunities: [...(existing.opportunities || [])],
    events: [...(existing.events || [])],
  }

  const upsert = (kind, cand, match, fields) => {
    const hit = match(cand, pools[kind])
    if (!hit) {
      const row = {
        ...cand,
        first_run_id: runId, last_run_id: runId, first_seen_at: stamp, last_seen_at: stamp,
        ...(kind === 'events' ? { status: eventStatus(cand, now) } : {}),
      }
      out[kind].insert.push(row)
      pools[kind].push({ ...row, _pending: true })
      return { kind, state: 'new' }
    }
    if (hit._pending) return { kind, state: 'new' }
    const { patch, changes } = fields ? fieldChanges(hit, cand, fields) : { patch: {}, changes: [] }
    const touch = {
      ...patch,
      last_run_id: runId,
      last_seen_at: stamp,
      ...(kind !== 'events' ? { times_seen: (Number(hit.times_seen) || 1) + (hit.last_run_id === runId ? 0 : 1) } : {}),
      ...(changes.length && kind !== 'signals' ? { last_change: changes.join('; '), updated_at: stamp } : {}),
      ...(kind === 'events' ? { status: eventStatus({ ...hit, ...patch }, now) } : {}),
    }
    out[kind].update.push({ id: hit.id, patch: touch })
    Object.assign(hit, touch)
    return {
      kind, id: hit.id, state: changes.length ? 'changed' : 'seen', changes,
      first_seen_at: hit.first_seen_at || null, times_seen: touch.times_seen || hit.times_seen || 1,
      status: hit.status || null,
    }
  }

  ;(findings || []).forEach((f, index) => {
    const notes = []
    const opp = opportunityFromFinding(f)
    if (opp) notes.push(upsert('opportunities', opp, matchOpportunity, OPP_FIELDS))
    const ev = eventFromFinding(f, watchlist)
    if (ev) notes.push(upsert('events', ev, matchEvent, EVENT_FIELDS))
    const sig = signalFromFinding(f, watchlist)
    if (sig) notes.push(upsert('signals', sig, matchSignal, null))
    if (notes.length) out.annotations.push({ index, ref: f.ref || null, notes })
  })

  return out
}

/**
 * Fold the store's verdict back onto the findings.
 *
 * The strongest verdict wins: a lead whose contractor was just named is
 * CHANGED even if its signal text was seen before. And this overrides the
 * headline-similarity novelty, because it rests on stronger evidence — a
 * stored row with a name, not two sentences that share words.
 */
export function annotateFindings(findings = [], plan) {
  const byIndex = new Map((plan?.annotations || []).map(a => [a.index, a.notes]))
  const rank = { new: 0, seen: 1, changed: 2 }
  return (findings || []).map((f, i) => {
    const notes = byIndex.get(i)
    if (!notes?.length) return f
    // A tracked row (lead or event) decides the verdict when there is one: a
    // lead entering the tracker for the first time is NEW to sales even if a
    // loose signal about the same site was stored last month.
    const decisive = notes.some(n => n.kind !== 'signals') ? notes.filter(n => n.kind !== 'signals') : notes
    const state = decisive.reduce((s, n) => (rank[n.state] > rank[s] ? n.state : s), 'new')
    const firstSeen = notes.map(n => n.first_seen_at).filter(Boolean).sort()[0] || null
    return {
      ...f,
      store: {
        state,
        changes: notes.flatMap(n => n.changes || []),
        first_seen_at: firstSeen,
        times_seen: Math.max(1, ...notes.map(n => n.times_seen || 1)),
        opportunity_id: notes.find(n => n.kind === 'opportunities')?.id || null,
        event_id: notes.find(n => n.kind === 'events')?.id || null,
        status: notes.find(n => n.kind === 'opportunities')?.status || null,
      },
      ...(state === 'new' ? {} : {
        novelty: state === 'changed' ? 'changed' : 'continuing',
        novelty_by: 'store',
        first_seen: firstSeen ? firstSeen.slice(0, 10) : f.first_seen || null,
      }),
    }
  })
}

// ─── Reading the store ─────────────────────────────────────────────────────

/** Upcoming, concluded or tbc — from the dates alone. */
export function eventStatus(ev, now = new Date()) {
  const end = cleanDate(ev?.end_date) || cleanDate(ev?.start_date)
  if (!end) return 'tbc'
  return end < today(now) ? 'concluded' : 'upcoming'
}

/** Whole days from today to a date-only value; null when there is no date. */
export function daysTo(date, now = new Date()) {
  const d = cleanDate(date)
  if (!d) return null
  return Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today(now)}T00:00:00Z`)) / 86_400_000)
}

/**
 * Is this lead still worth a salesperson's attention?
 *
 * A person closing it out ends it. A passed deadline does NOT: a tender that
 * closed may still have sub-packages, and the brief marks it passed rather
 * than hiding it — the same rule the dated findings follow.
 */
export const isOpenOpportunity = o => !CLOSED_STATUSES.includes(o?.status)

/**
 * The block every searching lens is shown, so it reports changes instead of
 * re-announcing what the team already tracks.
 *
 * In the user turn, never the cached system block — it changes every run.
 */
export function knownIntelPrompt({ opportunities = [], events = [], signals = [] } = {}, { now = new Date(), competitors = null } = {}) {
  const lines = []
  const openOpps = (opportunities || []).filter(isOpenOpportunity).slice(0, 25)
  if (openOpps.length) {
    lines.push('LEADS ALREADY TRACKED — the sales team has these. Do NOT report one again unless something about',
      'it CHANGED (deadline set or moved, contractor or consultant named, awarded, cancelled, new package).',
      'When it did, report it with the same lead.name so it updates the tracked row, and say what changed.')
    for (const o of openOpps) {
      const bits = [o.stage, o.deadline ? `deadline ${o.deadline}` : '', o.contractor ? `contractor ${o.contractor}` : 'no contractor named',
        o.consultant ? `consultant ${o.consultant}` : ''].filter(Boolean)
      lines.push(`- ${o.name}${bits.length ? ` (${bits.join(', ')})` : ''}`)
    }
  }
  const upcoming = (events || []).filter(e => eventStatus(e, now) !== 'concluded').slice(0, 15)
  if (upcoming.length) {
    lines.push('', 'EVENTS ALREADY TRACKED — report again only if dates, venue, exhibitor deadline or exhibitors changed:')
    for (const e of upcoming) {
      lines.push(`- ${e.name}${e.start_date ? ` ${e.start_date}` : ' (dates unconfirmed)'}` +
        `${e.exhibitor_deadline ? `, exhibitor deadline ${e.exhibitor_deadline}` : ''}` +
        `${(e.competitors_exhibiting || []).length ? `, exhibiting: ${e.competitors_exhibiting.join(', ')}` : ''}`)
    }
  }
  const wanted = competitors ? new Set(competitors.map(nameKey)) : null
  const recent = (signals || [])
    .filter(s => s.competitor && (!wanted || wanted.has(nameKey(s.competitor))))
    .slice(0, 40)
  if (recent.length) {
    lines.push('', 'ALREADY KNOWN ABOUT COMPETITORS — do not re-report these; look for what is NEW beyond them:')
    for (const s of recent) {
      lines.push(`- ${s.competitor} [${s.channel}, ${String(s.last_seen_at || s.first_seen_at || '').slice(0, 10)}]: ${s.summary}`)
    }
  }
  return lines.join('\n')
}

/**
 * The accumulated picture of each competitor, for synthesis to combine.
 *
 * Each signal gets an S-ref so a competitor move can cite the small pieces it
 * was assembled from — the combining is the whole point, and a combined claim
 * nobody can trace back is an opinion.
 */
export function signalHistory(signals = [], { now = new Date(), days = 120, perCompetitor = 10 } = {}) {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString()
  const by = new Map()
  let n = 0
  const refs = []
  for (const s of signals || []) {
    if (!s.competitor || s.relevance === 'low') continue
    if (String(s.last_seen_at || s.first_seen_at || '') < cutoff) continue
    const key = s.competitor
    if (!by.has(key)) by.set(key, [])
    const list = by.get(key)
    if (list.length >= perCompetitor) continue
    n += 1
    const row = {
      ref: `S${n}`, id: s.id, date: String(s.first_seen_at || '').slice(0, 10),
      channel: s.channel, category: s.category, summary: s.summary, source_url: s.source_url,
    }
    list.push(row)
    refs.push({ ...row, competitor: key })
  }
  return { byCompetitor: Object.fromEntries(by), refs }
}
