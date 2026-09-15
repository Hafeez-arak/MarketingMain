// ─── The weekly market report, as three teams read it ──────────────────────
// Pure selectors behind the Research tab and the printable brief. Both render
// from these so the screen and the PDF can never disagree.
//
// ── WHY THIS LAYOUT ──
//
// The brief used to be written for marketing alone: "Do this / Evidence / How
// the run went". The 14 Sep run found three live sales leads — the Tuwaiq
// Palace retender, Mondrian Riyadh with no contractor, thirteen Riyadh hotels
// under construction — and filed all three among post ideas, where nobody who
// works leads would look. Seven of its eighteen findings were our own posting
// numbers.
//
// So the report now follows the operating spec's order, for three readers:
//
//   Top 3 → Sales: act now → Competitor moves → Social activity → Events
//   → Market & technical → Marketing recommendations → New competitors
//   → Sources
//
// with a team filter over it. Follower counts are not a section: the team was
// explicit that it wants what competitors are DOING, assembled from small
// signals across channels, not how many people follow them.
//
// ── OLD BRIEFS STILL RENDER ──
//
// Every selector falls back to what an older report carries. A brief from
// before `top_three` existed gets a top three chosen in code and labelled
// `derived`, because a list the agent wrote and a list this file assembled are
// different claims and a reader must be able to tell.

import { rankFindings, daysLeft } from './agent/lenses'
import { similarity } from './agent/memory'
import {
  sameName, nameKey, daysTo, cleanDate, isOpenOpportunity, CLOSED_STATUSES, SOCIAL_CHANNELS,
} from './agent/intel'
import { ownChannelRows, actionPlan, pct } from './researchBrief'

export const TEAMS = [
  { key: 'all', label: 'Everyone' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'sales', label: 'Sales' },
  { key: 'technical', label: 'Technical' },
]

/** Which sections each team sees. `all` sees everything. */
export const SECTIONS = [
  { key: 'top', label: 'Top 3', teams: ['marketing', 'sales', 'technical'] },
  { key: 'sales', label: 'Sales: act now', teams: ['sales'] },
  { key: 'competitors', label: 'Competitor moves', teams: ['marketing', 'sales', 'technical'] },
  { key: 'social', label: 'Social activity', teams: ['marketing'] },
  { key: 'events', label: 'Events', teams: ['marketing', 'sales'] },
  { key: 'market', label: 'Market & technical', teams: ['marketing', 'technical'] },
  { key: 'recs', label: 'Marketing recommendations', teams: ['marketing'] },
  { key: 'newcomp', label: 'New competitors', teams: ['marketing', 'sales'] },
  { key: 'sources', label: 'Sources', teams: ['marketing', 'sales', 'technical'] },
]

export const sectionVisible = (key, team) =>
  team === 'all' || (SECTIONS.find(s => s.key === key)?.teams || []).includes(team)

export const forTeam = (team, teams = []) => team === 'all' || teams.includes(team)

const str = v => String(v ?? '').trim()
const TECH_CATEGORIES = ['regulation', 'tech', 'product']
const RELEVANCE_RANK = { high: 3, medium: 2, low: 0 }

/** Low relevance is stored and never reported. Old findings have none, so they count. */
export const isReportable = f => f?.relevance !== 'low'

/**
 * Which teams a finding belongs to.
 *
 * `for_whom` says who acts; a lead always concerns sales and an event both
 * teams that plan around it, whatever the label. An openings finding from
 * before `lead` existed is treated as a lead — that is what the lens was for,
 * and it is exactly the case that hid three leads among post ideas.
 */
export function teamsOf(f) {
  const t = new Set()
  if (f?.for_whom === 'sales') t.add('sales')
  else if (f?.for_whom === 'both') { t.add('marketing'); t.add('technical') }
  else if (f?.for_whom === 'technical') t.add('technical')
  else t.add('marketing')
  if (f?.lead || (f?.lens === 'openings' && !f?.event)) t.add('sales')
  if (f?.event) { t.add('sales'); t.add('marketing') }
  if (TECH_CATEGORIES.includes(f?.category)) t.add('technical')
  return [...t]
}

const primaryTeam = f => {
  const t = teamsOf(f)
  if (t.includes('sales') && (f?.lead || f?.lens === 'openings')) return 'sales'
  return t[0]
}

const findingByRef = (report = {}) => new Map((report.findings || []).map(f => [f.ref, f]))
const signalByRef = (report = {}) => new Map((report.signal_refs || []).map(s => [s.ref, s]))

/** Resolve F- and S-refs to what they point at, dropping any that resolve to nothing. */
export function resolveRefs(refs = [], report = {}) {
  const fs = findingByRef(report)
  const ss = signalByRef(report)
  return (refs || []).map(r => {
    const key = str(r).toUpperCase()
    const f = fs.get(key)
    if (f) {
      return { ref: key, kind: 'finding', summary: f.headline, channel: f.channel || '', url: firstUrl(f.sources), date: '' }
    }
    const s = ss.get(key)
    if (s) return { ref: key, kind: 'signal', summary: s.summary, channel: s.channel || '', url: s.source_url || '', date: s.date || '' }
    return null
  }).filter(Boolean)
}

function firstUrl(sources = []) {
  for (const s of sources || []) {
    const u = typeof s === 'string' ? s : s?.url
    if (u) return u
  }
  return ''
}

// ─── Top 3 ─────────────────────────────────────────────────────────────────

/**
 * The three things that most need doing.
 *
 * The agent's own list when it wrote one. Otherwise chosen in code: relevance,
 * a live deadline inside two weeks, and whether it is a lead — our own posting
 * numbers and anything the store already knew are never candidates.
 */
export function topThree(report = {}, now = new Date()) {
  const written = (report.top_three || []).filter(t => str(t?.finding))
  if (written.length) {
    return {
      derived: false,
      items: written.slice(0, 3).map(t => ({
        finding: t.finding, action: t.action || '', team: t.team || 'marketing',
        pieces: resolveRefs(t.refs, report),
      })),
    }
  }
  const score = f => {
    let n = RELEVANCE_RANK[f.relevance] ?? 2
    const d = daysLeft(f, now)
    if (d !== null && d >= 0 && d <= 14) n += 2
    if (teamsOf(f).includes('sales')) n += 1
    return n + (Number(f.confidence) || 0)
  }
  const items = (report.findings || [])
    .filter(f => isReportable(f) && f.lens !== 'ourselves' && f.store?.state !== 'seen' && str(f.headline))
    .filter(f => { const d = daysLeft(f, now); return d === null || d >= 0 })
    .map(f => ({ f, s: score(f) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(({ f }) => ({
      finding: f.headline, action: f.suggested_action || '', team: primaryTeam(f),
      pieces: resolveRefs([f.ref], report),
    }))
  return { derived: items.length > 0, items }
}

// ─── Sales: act now ────────────────────────────────────────────────────────

const detailBits = o => [
  o.client && `Client: ${o.client}`,
  o.contractor ? `Contractor: ${o.contractor}` : null,
  o.consultant && `Consultant: ${o.consultant}`,
  o.location,
  o.stage && `Stage: ${o.stage}`,
  o.scope,
].filter(Boolean)

/**
 * Every lead worth a salesperson's time: the tracker first, then anything this
 * run found that the tracker does not have yet.
 *
 * The tracker is the current state across all runs, not this brief's slice of
 * it — a lead found three weeks ago and still open belongs on the list today.
 */
export function salesRows({ report = {}, opportunities = [], runId = null, now = new Date() } = {}) {
  const tracked = (opportunities || []).map(o => ({
    id: o.id,
    name: o.name,
    type: o.type || 'project',
    headline: o.headline || '',
    details: detailBits(o),
    deadline: cleanDate(o.deadline),
    days: daysTo(o.deadline, now),
    timing: o.timing || 'unconfirmed',
    relevance: o.relevance || 'medium',
    action: o.suggested_action || '',
    url: o.source_url || '',
    status: o.status || 'new',
    ownerNote: o.owner_note || '',
    isNew: Boolean(runId) && o.first_run_id === runId,
    changed: Boolean(runId) && o.last_run_id === runId && o.first_run_id !== runId && str(o.last_change) ? o.last_change : '',
    firstSeen: String(o.first_seen_at || '').slice(0, 10),
    tracked: true,
  }))

  const fromRun = (report.findings || [])
    .filter(f => isReportable(f) && teamsOf(f).includes('sales') && !f.event && f.lens !== 'ourselves' && f.lens !== 'calendar')
    .map(f => {
      const lead = f.lead || {}
      const name = str(lead.name) || f.headline
      return {
        id: null,
        name,
        type: lead.type || (/tender/i.test(f.headline) ? 'tender' : 'project'),
        headline: lead.name ? f.headline : '',
        details: detailBits(lead),
        deadline: cleanDate(lead.deadline) || cleanDate(f.perishable_until),
        days: daysTo(lead.deadline || f.perishable_until, now),
        timing: lead.timing || 'unconfirmed',
        relevance: f.relevance || 'medium',
        action: f.suggested_action || '',
        url: firstUrl(f.sources),
        status: null,
        ownerNote: '',
        isNew: f.store?.state !== 'seen',
        changed: f.store?.state === 'changed' ? (f.store.changes || []).join('; ') : '',
        firstSeen: '',
        tracked: false,
      }
    })
    .filter(r => !tracked.some(t => sameName(t.name, r.name) || nameKey(t.name) === nameKey(r.name)))

  const order = (a, b) =>
    (RELEVANCE_RANK[b.relevance] ?? 2) - (RELEVANCE_RANK[a.relevance] ?? 2) ||
    (Number(b.isNew || Boolean(b.changed)) - Number(a.isNew || Boolean(a.changed))) ||
    liveDays(a) - liveDays(b)

  const all = [...tracked, ...fromRun]
  return {
    open: all.filter(r => !CLOSED_STATUSES.includes(r.status)).sort(order),
    closed: all.filter(r => CLOSED_STATUSES.includes(r.status)),
    trackerAvailable: (opportunities || []).length > 0,
  }
}

const liveDays = r => (r.days === null || r.days < 0 ? 9999 : r.days)

/** "in 12 days" / "passed 3 days ago" / "unconfirmed". */
export function dayLabel(days, timing = '') {
  if (days === null || days === undefined) return timing === 'closed' ? 'closed' : 'unconfirmed'
  if (days === 0) return 'today'
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`
  return `passed ${-days} day${days === -1 ? '' : 's'} ago`
}

// ─── Competitor moves ──────────────────────────────────────────────────────

/**
 * What each competitor is doing, assembled from small pieces.
 *
 * The agent's `competitor_moves` when present, each resolved to the signals it
 * combined. Otherwise grouped in code from findings that name a competitor,
 * plus the per-rival reads older briefs carry.
 */
export function competitorMoves(report = {}) {
  const written = (report.competitor_moves || []).filter(m => str(m?.competitor))
  if (written.length) {
    return {
      derived: false,
      items: written.map(m => {
        const pieces = resolveRefs(m.refs, report)
        return {
          competitor: m.competitor,
          whatChanged: m.what_changed || '',
          picture: m.picture || '',
          effect: m.effect_on_us || '',
          relevance: m.relevance || 'medium',
          teams: m.teams?.length ? m.teams : ['marketing', 'sales'],
          pieces,
          channels: [...new Set(pieces.map(p => p.channel).filter(Boolean))],
        }
      }).sort((a, b) => (RELEVANCE_RANK[b.relevance] ?? 2) - (RELEVANCE_RANK[a.relevance] ?? 2)),
    }
  }

  const by = new Map()
  const add = (name, piece, f) => {
    const key = nameKey(name)
    if (!by.has(key)) by.set(key, { competitor: name, pieces: [], findings: [] })
    const g = by.get(key)
    g.pieces.push(piece)
    if (f) g.findings.push(f)
  }
  for (const f of report.findings || []) {
    if (!isReportable(f) || !str(f.competitor)) continue
    add(f.competitor, { ref: f.ref, kind: 'finding', summary: f.headline, channel: f.channel || '', url: firstUrl(f.sources), date: '' }, f)
  }
  for (const c of report.competitor_board || []) {
    if (!str(c.read)) continue
    add(c.name, { ref: '', kind: 'read', summary: c.read, channel: 'instagram', url: c.handle ? `https://www.instagram.com/${c.handle}/` : '', date: '' })
  }
  const items = [...by.values()].map(g => {
    const top = rankFindings(g.findings)[0]
    return {
      competitor: g.competitor,
      whatChanged: top?.headline || g.pieces[0]?.summary || '',
      picture: g.pieces.length > 1 ? `${g.pieces.length} pieces this run.` : '',
      effect: top?.suggested_action || '',
      relevance: top?.relevance || 'medium',
      teams: top ? teamsOf(top) : ['marketing'],
      pieces: g.pieces,
      channels: [...new Set(g.pieces.map(p => p.channel).filter(Boolean))],
    }
  })
  return { derived: items.length > 0, items }
}

// ─── Social activity ───────────────────────────────────────────────────────

/**
 * Our channels and what rivals are posting about — not how many follow them.
 *
 * Ours are measured per post from our own analytics on every platform we
 * publish to. Theirs are what their posts are ABOUT, from stored signals on
 * any social channel and from the Instagram posts the board already read.
 */
export function socialActivity({ report = {}, signals = [], now = new Date(), days = 45 } = {}) {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString()
  const theirs = new Map()
  const push = (competitor, item) => {
    const key = nameKey(competitor)
    if (!key) return
    if (!theirs.has(key)) theirs.set(key, { competitor, items: [] })
    const g = theirs.get(key)
    if (g.items.some(i => i.url && i.url === item.url && i.text === item.text)) return
    g.items.push(item)
  }
  for (const s of signals || []) {
    if (!SOCIAL_CHANNELS.includes(s.channel) || !s.competitor) continue
    if (String(s.last_seen_at || s.first_seen_at || '') < cutoff) continue
    push(s.competitor, { platform: s.channel, text: s.summary, url: s.source_url, date: String(s.first_seen_at || '').slice(0, 10) })
  }
  for (const f of report.findings || []) {
    if (!SOCIAL_CHANNELS.includes(f.channel) || !f.competitor || !isReportable(f)) continue
    push(f.competitor, { platform: f.channel, text: f.headline, url: firstUrl(f.sources), date: '' })
  }
  for (const c of report.competitor_board || []) {
    for (const p of (c.top_posts || []).slice(0, 3)) {
      if (!p.hook) continue
      push(c.name, { platform: 'instagram', text: p.hook, url: p.permalink || '', date: String(p.timestamp || '').slice(0, 10) })
    }
  }
  return {
    ours: ownChannelRows(report),
    theirs: [...theirs.values()].map(g => ({
      ...g,
      platforms: [...new Set(g.items.map(i => i.platform))],
      items: g.items.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6),
    })),
  }
}

// ─── Events ────────────────────────────────────────────────────────────────

/**
 * Every event our teams should know about, in three bands.
 *
 *   soon    starts within 90 days (or is on now) — decide this month
 *   later   91 days to a year out — the exhibitor deadlines for these fall now
 *   recent  ended in the last nine months — who exhibited and what came of it
 *
 * The spec's "next 90 days" alone hid the events that matter most for
 * planning: a February expo's stand has to be booked in the autumn, and last
 * spring's technology conference is where this year's asks were announced.
 * Undated editions sit in `later`, labelled TBC.
 *
 * Tracked events from the store come first; events this run found that the
 * store does not have yet follow; computed calendar dates join `soon`.
 */
export function eventsView({ report = {}, events = [], runId = null, now = new Date(), soonDays = 90, aheadDays = 365, backDays = 274 } = {}) {
  const band = (start, end) => {
    const last = cleanDate(end) || cleanDate(start)
    const ds = daysTo(start, now)
    const de = daysTo(last, now)
    if (de !== null && de < 0) return de >= -backDays ? 'recent' : null
    if (ds === null) return 'later'
    if (ds <= soonDays) return 'soon'
    return ds <= aheadDays ? 'later' : null
  }
  const out = { soon: [], later: [], recent: [] }
  const push = row => { const b = band(row.start, row.end); if (b) out[b].push(row) }

  for (const e of events || []) {
    push({
      id: e.id, kind: 'event', name: e.name, start: cleanDate(e.start_date), end: cleanDate(e.end_date),
      venue: [e.venue, e.city].filter(Boolean).join(', '), organizer: e.organizer || '', url: e.url || e.source_url || '',
      exhibitorDeadline: cleanDate(e.exhibitor_deadline), deadlineDays: daysTo(e.exhibitor_deadline, now),
      competitors: e.competitors_exhibiting || [], recommendation: e.recommendation || '', takeaway: e.takeaway || '',
      relevance: e.relevance || 'medium', decision: e.decision || 'undecided',
      isNew: Boolean(runId) && e.first_run_id === runId,
      changed: Boolean(runId) && e.last_run_id === runId && e.first_run_id !== runId ? e.last_change || '' : '',
    })
  }
  const tracked = (events || []).map(e => e.name)
  const seen = []
  for (const f of report.findings || []) {
    if (!f.event || !isReportable(f)) continue
    const name = f.event.name
    const sameEdition = n => (sameName(n, name) || nameKey(n) === nameKey(name)) &&
      String(n).match(/\b20\d\d\b/)?.[0] === String(name).match(/\b20\d\d\b/)?.[0]
    if (tracked.some(sameEdition) || seen.some(sameEdition)) continue
    seen.push(name)
    const start = cleanDate(f.event.start_date)
    const end = cleanDate(f.event.end_date)
    const ended = (daysTo(end || start, now) ?? 0) < 0
    push({
      id: null, kind: 'event', name, start, end,
      venue: [f.event.venue, f.event.city].filter(Boolean).join(', '), organizer: f.event.organizer || '',
      url: f.event.url || firstUrl(f.sources), exhibitorDeadline: cleanDate(f.event.exhibitor_deadline),
      deadlineDays: daysTo(f.event.exhibitor_deadline, now), competitors: f.event.competitors_exhibiting || [],
      recommendation: f.suggested_action || '', takeaway: ended ? f.detail || '' : '',
      relevance: f.relevance || 'medium', decision: null, isNew: f.store?.state !== 'seen', changed: '',
    })
  }
  for (const f of report.findings || []) {
    if (f.lens !== 'calendar') continue
    const date = cleanDate(f.evidence?.date || f.perishable_until)
    const d = daysTo(date, now)
    if (d === null || d < 0 || d > soonDays) continue
    out.soon.push({
      id: null, kind: 'calendar', name: f.headline, start: date, end: null, venue: '', organizer: '', url: '',
      exhibitorDeadline: null, deadlineDays: null, competitors: [], recommendation: f.suggested_action || '', takeaway: '',
      relevance: f.relevance || 'medium', decision: null, isNew: false, changed: '',
    })
  }
  const asc = (a, b) => (a.start || '9999').localeCompare(b.start || '9999')
  out.soon.sort(asc)
  out.later.sort(asc)
  out.recent.sort((a, b) => (b.end || b.start || '').localeCompare(a.end || a.start || ''))
  return { ...out, count: out.soon.length + out.later.length + out.recent.length }
}

/** The next-90-days band alone, for callers that only want what is imminent. */
export const upcomingEvents = args => eventsView(args).soon

// ─── Market & technical notes ──────────────────────────────────────────────

/**
 * Regulation, technology and giga-project change — for marketing and the
 * technical team. Leads, events and competitor findings have their own
 * sections and are not repeated here.
 */
export function marketNotes(report = {}, now = new Date()) {
  const findings = rankFindings((report.findings || []).filter(f =>
    isReportable(f) && !f.lead && !f.event && !str(f.competitor) &&
    (f.lens === 'category' || ['regulation', 'tech', 'gigaproject', 'product'].includes(f.category) ||
      f.for_whom === 'technical' || f.for_whom === 'both')), now)
    .map(f => ({
      headline: f.headline, detail: f.detail || '', action: f.suggested_action || '',
      technicalNote: f.technical_note || '', teams: teamsOf(f), sources: f.sources || [],
      days: daysLeft(f, now), confidence: f.confidence, relevance: f.relevance || 'medium',
      category: f.category || '', store: f.store || null, ref: f.ref,
    }))
  // The synthesis restates lens findings in its own words, so a rewording of
  // one already listed is dropped — and so is one that restates a lead, which
  // belongs to sales. 0.2 is measured on the 14 Sep brief: each of its seven
  // market items scored 0.23–0.60 against the finding it restates, and no
  // item scored above 0.16 against any OTHER finding.
  const leads = (report.findings || []).filter(f => teamsOf(f).includes('sales')).map(f => f.headline)
  const synth = (report.market || [])
    .filter(m => str(m.finding) &&
      ![...findings.map(f => f.headline), ...leads].some(h => similarity(h, m.finding) >= 0.2))
    .map(m => ({
      headline: m.finding, detail: '', action: '', technicalNote: '', teams: ['marketing', 'technical'],
      sources: m.sources || [], days: null, confidence: m.confidence, relevance: 'medium', category: '',
      store: null, uncited: m.uncited, ref: '',
    }))
  return [...findings, ...synth]
}

// ─── Marketing recommendations ─────────────────────────────────────────────

/** Gaps and the ideas that close them — each already names what it rests on. */
export const marketingRecommendations = report => actionPlan(report)

// ─── New competitors ───────────────────────────────────────────────────────

/**
 * Candidates for a person to accept or dismiss: what this run surfaced, and
 * what earlier runs proposed that nobody has decided on yet.
 */
export function newCompetitors({ report = {}, agendaCompetitors = [] } = {}) {
  const out = []
  for (const c of report.new_competitors || []) {
    const row = (agendaCompetitors || []).find(a => nameKey(a.subject) === nameKey(c.name))
    out.push({ name: c.name, why: c.why || '', url: c.source_url || '', agendaId: row?.id || null, status: row?.status || 'proposed', thisRun: true })
  }
  for (const a of agendaCompetitors || []) {
    if (a.status !== 'proposed') continue
    if (out.some(o => nameKey(o.name) === nameKey(a.subject))) continue
    out.push({ name: a.subject, why: a.why || '', url: '', agendaId: a.id, status: a.status, thisRun: false })
  }
  return out
}

// ─── Sources ───────────────────────────────────────────────────────────────

/** Every URL the brief rests on, once, with what cites it. */
export function sourceList(report = {}) {
  const by = new Map()
  const add = (url, title, label) => {
    const u = str(url)
    if (!/^https?:\/\//i.test(u)) return
    if (!by.has(u)) by.set(u, { url: u, title: str(title), domain: domainOf(u), citedBy: [] })
    const row = by.get(u)
    if (!row.title && title) row.title = str(title)
    if (label && !row.citedBy.includes(label)) row.citedBy.push(label)
  }
  for (const f of report.findings || []) {
    if (!isReportable(f)) continue
    for (const s of f.sources || []) add(typeof s === 'string' ? s : s.url, s?.title, f.ref || '')
  }
  for (const m of report.market || []) for (const s of m.sources || []) add(s.url, s.title, 'market')
  for (const r of report.proposed_rules || []) for (const s of r.sources || []) add(typeof s === 'string' ? s : s.url, '', 'rule')
  for (const s of report.signal_refs || []) {
    const cited = (report.competitor_moves || []).some(m => (m.refs || []).includes(s.ref)) ||
      (report.top_three || []).some(t => (t.refs || []).includes(s.ref))
    if (cited) add(s.source_url, '', s.ref)
  }
  return [...by.values()].sort((a, b) => b.citedBy.length - a.citedBy.length || a.domain.localeCompare(b.domain))
}

export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'source' }
}

/** "Relevance high · confidence 60%" — short, and never "confidence null". */
export function metaLine(item) {
  return [
    item.relevance && `relevance ${item.relevance}`,
    item.confidence != null && `confidence ${pct(item.confidence)}`,
  ].filter(Boolean).join(' · ')
}

export { isOpenOpportunity }
