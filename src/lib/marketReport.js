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

/**
 * The second axis: which side of the business a reader is in.
 *
 * `TEAMS` filters one report by WHO you are. This filters the same report by
 * WHICH BUSINESS — lighting or controls — and the two are independent: a sales
 * person in controls wants sales items about controls.
 *
 * A filter and not tabs, deliberately. "Top 3 this week" is genuinely
 * company-wide and splitting it would hide the most important item from half
 * the readers. The Business view is the surface that separates the lines
 * properly, because there the whole question is per-line.
 *
 * Built from the run itself rather than from a fixed list, so a brand with one
 * line never sees a control that does nothing, and a brand with three sees all
 * three. An unclassified finding shows under "Everything" and nowhere else —
 * it is not evidence about either business.
 */
export function linesIn(report = {}) {
  const seen = new Map()
  for (const f of report?.findings || []) {
    const line = str(f?.line)
    if (line && !seen.has(line)) seen.set(line, { key: line, label: line[0].toUpperCase() + line.slice(1) })
  }
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** Does this item belong to the line being read? `all` always passes. */
export const forLine = (line, value) => line === 'all' || str(value) === line

/**
 * Which line a section item belongs to, from the findings it cites.
 *
 * The same shape as freshnessOf: sections are written by the model and carry
 * refs, not lines, so the line is read back off the evidence. An item citing
 * two lines belongs to both and is shown under either — that is a real
 * property of a cross-line move, not a failure to decide.
 */
export function linesOfRefs(refs = [], report = {}) {
  const fs = findingByRef(report)
  const out = new Set()
  for (const r of refs || []) {
    const line = str(fs.get(str(r).toUpperCase())?.line)
    if (line) out.add(line)
  }
  return [...out]
}

export const matchesLine = (line, lines = []) => line === 'all' || lines.includes(line)

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
  { key: 'search', label: 'Search demand', teams: ['marketing', 'sales'] },
  { key: 'market', label: 'Market & technical', teams: ['marketing', 'technical'] },
  // The world industry is read by the technical team and by marketing for
  // what to say; sales works this market, not Shenzhen's.
  { key: 'global', label: 'Global industry', teams: ['marketing', 'technical'] },
  { key: 'poles', label: 'Smart poles', teams: ['marketing', 'sales', 'technical'] },
  { key: 'recs', label: 'Marketing recommendations', teams: ['marketing'] },
  { key: 'newcomp', label: 'New competitors', teams: ['marketing', 'sales'] },
  { key: 'sources', label: 'Sources', teams: ['marketing', 'sales', 'technical'] },
]

export const sectionVisible = (key, team) =>
  team === 'all' || (SECTIONS.find(s => s.key === key)?.teams || []).includes(team)

export const forTeam = (team, teams = []) => team === 'all' || teams.includes(team)

const str = v => String(v ?? '').trim()
/** Whitespace a source title carried in from the page it was scraped off. */
const flat = v => str(v).replace(/\s+/g, ' ')
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

/** Every team the cited findings concern; marketing and sales when none resolve. */
function teamsFromRefs(refs = [], report = {}) {
  const fs = findingByRef(report)
  const teams = new Set((refs || []).flatMap(r => {
    const f = fs.get(str(r).toUpperCase())
    return f ? teamsOf(f) : []
  }))
  return teams.size ? [...teams] : ['marketing', 'sales']
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

// ── WHAT IS A LEAD, AND WHAT IS ONLY ABOUT A COMPETITOR ──
//
// This filter used to be `teamsOf(f).includes('sales')`, which is true of any
// finding whose `for_whom` is "sales" — and the competitors lens writes those
// constantly, because "this rival now sells GRMS, tell sales" is genuinely
// sales's to know. The 15 Sep report is what that costs: Datacore, Tawridat Al
// Hadaf and Inara each appeared as a row in a table headed "act now", typed
// PROJECT · MEDIUM, and then appeared AGAIN two pages down under Competitor
// moves. A salesperson opening a list of things to call found three rows with
// nobody to call.
//
// So a row here needs a thing to work: a named lead, or a finding from the
// lens whose whole question is "who is about to need what we sell". A finding
// that names a competitor is competitor intelligence and belongs to that
// section — unless it ALSO carries a named lead, which is the real case of a
// rival being on a project we want.
export function isLeadFinding(f) {
  if (!f || f.event || ['ourselves', 'calendar'].includes(f.lens)) return false
  if (str(f.lead?.name)) return true
  if (str(f.competitor)) return false
  return f.lens === 'openings' || f.for_whom === 'sales'
}

// ── WHEN DOES THIS CLOSE, WHEN NOBODY PUBLISHED A DATE ──
//
// Six of six rows in the 15 Sep report read "— unconfirmed" or "closed", which
// is honest and unusable: a table nobody can sort by urgency is a table nobody
// works. Tender portals put the deadline behind a login (lensPrompts.js says
// so at length), so the date is often genuinely unreachable — but the STAGE is
// not, and the stage is what actually closes the window. A project in design
// can still be specified; one whose contractor is buying cannot.
//
// Estimated from the stage and labelled as an estimate, never printed as if it
// were a published date.
const STAGE_WINDOWS = [
  [/feasib|concept|master ?plan|early|announc/i, 'while the concept is open — closes when the consultant is appointed'],
  [/design|schematic|dd\b|detailed/i, 'while it is in design — closes when the package goes to tender'],
  [/tender|bid|rfp|itt|prequal|eoi/i, 'closes when bids are returned'],
  [/award|contract(or)? (appointed|named|signed)/i, 'closes when the contractor places procurement'],
  [/construct|fit.?out|delivery|handover/i, 'closing now — procurement is running'],
]

/**
 * When the window on a lead shuts, and on what authority.
 *
 * `basis` is the point: "deadline" is a date someone published, "stage" is our
 * own inference from where the project has got to, and "unknown" is the
 * admission that we have neither. A reader must be able to tell those apart
 * before they sort on them.
 */
export function leadWindow(row = {}) {
  if (row.deadline) return { label: dayLabel(row.days, row.timing), basis: 'deadline' }
  // Checked BEFORE the stage scan: a lens that established the window has
  // closed knows more than a regular expression reading the word "tender" in
  // the project's name, and telling someone bids are still open when they are
  // not is the one error this whole column must not make.
  if (row.timing === 'closed') return { label: 'the published window has closed', basis: 'deadline' }
  const hay = [row.details && row.details.join(' '), row.headline, row.name].filter(Boolean).join(' ')
  for (const [re, label] of STAGE_WINDOWS) {
    if (re.test(hay)) return { label, basis: 'stage' }
  }
  return { label: 'no window established — the call is how to find out', basis: 'unknown' }
}

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
    // ── THE TRACKER HAS TO CARRY ITS LINE ──
    //
    // The page filters these on `r.line`, and nothing ever set it: every
    // tracked lead vanished the moment a reader picked a business, which reads
    // as "no controls leads" when the truth was "the column was not read".
    // Stored since the 2026-09-20 migration; '' on every row written before it.
    line: str(o.line),
    tracked: true,
  }))

  const fromRun = (report.findings || [])
    .filter(f => isReportable(f) && isLeadFinding(f))
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
        // Straight off the finding — this run's leads are stamped before
        // synthesis ever sees them.
        line: str(f.line),
        tracked: false,
      }
    })
    .filter(r => !tracked.some(t => sameName(t.name, r.name) || nameKey(t.name) === nameKey(r.name)))

  const order = (a, b) =>
    (RELEVANCE_RANK[b.relevance] ?? 2) - (RELEVANCE_RANK[a.relevance] ?? 2) ||
    (Number(b.isNew || Boolean(b.changed)) - Number(a.isNew || Boolean(a.changed))) ||
    liveDays(a) - liveDays(b)

  // Every row carries its window, so the section can be sorted and read by
  // urgency even where no date was ever published.
  const all = [...tracked, ...fromRun].map(r => ({ ...r, window: leadWindow(r) }))
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

// ── SIGNIFICANCE AND FRESHNESS ARE TWO DIFFERENT QUESTIONS ──
//
// Every competitor move in the 15 Sep report was rated Medium, including one
// the agent itself described as "a standing page rather than a launch —
// confirmation of current state, not momentum". Both readings are defensible
// on a single axis, which is the tell that the axis is wrong: a standing fact
// about a serious rival is HIGH significance and ZERO freshness, and squashing
// those into one word makes the whole column stop discriminating.
//
// So `relevance` keeps its meaning — how much this matters — and freshness is
// derived, in code, from the store verdict the findings already carry. Derived
// rather than asked for: the model is not a reliable judge of whether it has
// said something before, and planStoreWrites already decided this against rows
// with names.
const FRESHNESS_RANK = { new: 0, changed: 1, standing: 2 }

export function freshnessFromFindings(findings = []) {
  const states = (findings || []).filter(Boolean).map(f => f.store?.state || 'new')
  // Empty means we have nothing to judge on — an old brief whose moves were
  // assembled from per-rival reads, with no findings behind them. Saying
  // "standing" there would be asserting that nothing moved, which nobody
  // checked; an empty label renders as no chip at all.
  if (!states.length) return ''
  if (states.includes('new')) return 'new'
  if (states.includes('changed')) return 'changed'
  return 'standing'
}

export function freshnessOf(refs = [], report = {}) {
  const fs = findingByRef(report)
  const cited = (refs || []).map(r => fs.get(str(r).toUpperCase())).filter(Boolean)
  // Refs that resolve to nothing but signals: every piece of this reading came
  // from an earlier week, which IS a standing picture rather than a move.
  if (!cited.length) return (refs || []).length ? 'standing' : ''
  return freshnessFromFindings(cited)
}

/** "new this week" / "changed this week" / "standing — nothing moved". */
export const freshnessLabel = f =>
  ({ new: 'new this week', changed: 'changed this week', standing: 'standing — nothing moved this week' }[f] || '')

/**
 * What each competitor is doing, assembled from small pieces.
 *
 * The agent's `competitor_moves` when present, each resolved to the signals it
 * combined. Otherwise grouped in code from findings that name a competitor,
 * plus the per-rival reads older briefs carry.
 */
/**
 * @param {object} report
 * @param {object} [opts]
 * @param {Array}  [opts.watchlist] research_agenda competitor rows, for the
 *   line fallback below.
 */
export function competitorMoves(report = {}, { watchlist = [] } = {}) {
  // ── THE LINE FALLBACK ──
  //
  // A rival whose only trace this week is an Instagram board read has no
  // finding behind it, so there is nothing to read a line off — and Huda, who
  // sells lighting and nothing else, would land under "Not tied to a business"
  // beside a genuine unknown.
  //
  // Same rule as lineForFinding, and the same reason for its limit: a rival
  // who sells into exactly ONE line settles the question by being named, and
  // one who straddles settles nothing. Guessing from a straddler is precisely
  // how a controls move ends up on the lighting board.
  const soleLine = new Map(
    (watchlist || [])
      .map(c => [nameKey(c?.subject || c?.name), (c?.lines || []).filter(Boolean)])
      .filter(([k, lines]) => k && lines.length === 1)
      .map(([k, lines]) => [k, lines[0]]),
  )
  const linesFor = (name, found) => {
    if (found.length) return found
    const only = soleLine.get(nameKey(name))
    return only ? [only] : []
  }

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
          // Read back off the evidence, same as `teams`. A move citing two
          // lines belongs to both and is shown under each — a rival we meet in
          // two businesses is two competitive situations, not one.
          lines: linesFor(m.competitor, linesOfRefs(m.refs, report)),
          freshness: freshnessOf(m.refs, report),
          // Derived from the findings it cites rather than asked for: the
          // schema field was dropped to keep the grammar under the API limit.
          teams: teamsFromRefs(m.refs, report),
          pieces,
          channels: [...new Set(pieces.map(p => p.channel).filter(Boolean))],
        }
      }).sort((a, b) =>
        (RELEVANCE_RANK[b.relevance] ?? 2) - (RELEVANCE_RANK[a.relevance] ?? 2) ||
        (FRESHNESS_RANK[a.freshness] ?? 2) - (FRESHNESS_RANK[b.freshness] ?? 2)),
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
      lines: linesFor(g.competitor, [...new Set(g.findings.map(f => str(f.line)).filter(Boolean))]),
      freshness: freshnessFromFindings(g.findings),
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
export function socialActivity({ report = {}, signals = [], watching = null, now = new Date(), days = 45 } = {}) {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString()
  // A competitor taken off the watchlist should stop appearing in a report
  // about who we watch. Signals outlive the watchlist entry by design — they
  // are evidence, and evidence is not deleted because priorities changed — so
  // the filter belongs here rather than in the store.
  //
  // `null` means "no watchlist was passed", which is not the same as an empty
  // one: an old caller, or a load that failed, must not silently blank the
  // section. Only an explicit list filters.
  const watched = watching?.length ? new Set(watching.map(n => nameKey(n)).filter(Boolean)) : null
  const isWatched = name => !watched || watched.has(nameKey(name))
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
    if (!isWatched(s.competitor)) continue
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
 * store does not have yet follow.
 *
 * ── CALENDAR DATES ARE NOT EVENTS ──
 *
 * They used to be pushed into `soon` alongside the expos. The 15 Sep report is
 * what that produced: a 90-day events table containing Saudi National Day —
 * which is a date in the calendar, not something anyone exhibits at — while
 * Saudi Build and Saudi Elenex, 48 days out at RICEC with lighting pavilions,
 * were absent. Mixing the two makes an empty events table look full, which is
 * the one thing that must never happen to this section: a reader who sees rows
 * stops asking why the show they were expecting is not among them.
 *
 * So they get their own band. Both are reported; neither is disguised as the
 * other.
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
  const out = { soon: [], later: [], recent: [], dates: [] }
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
    out.dates.push({
      id: null, kind: 'calendar', name: f.headline, start: date, end: null, venue: '', organizer: '', url: '',
      exhibitorDeadline: null, deadlineDays: null, competitors: [], recommendation: f.suggested_action || '', takeaway: '',
      relevance: f.relevance || 'medium', decision: null, isNew: false, changed: '',
    })
  }
  const asc = (a, b) => (a.start || '9999').localeCompare(b.start || '9999')
  out.soon.sort(asc)
  out.later.sort(asc)
  out.dates.sort(asc)
  out.recent.sort((a, b) => (b.end || b.start || '').localeCompare(a.end || a.start || ''))
  // The deadline STATUS, on every row, every week. A tracked expo whose
  // exhibitor deadline nobody has established is a different thing from one
  // whose deadline has passed, and the person reading this needs the deadline
  // in front of them rather than the diff against last week.
  for (const band_ of ['soon', 'later', 'recent']) {
    out[band_] = out[band_].map(e => ({ ...e, deadlineStatus: deadlineStatus(e) }))
  }
  return { ...out, count: out.soon.length + out.later.length + out.recent.length }
}

/** "open, in 12 days" / "closed 3 days ago" / "not established". */
export function deadlineStatus(e = {}) {
  if (!e.exhibitorDeadline) return e.kind === 'calendar' ? '' : 'not established'
  const d = e.deadlineDays
  if (d === null || d === undefined) return 'not established'
  return d >= 0 ? `open, ${dayLabel(d)}` : `closed ${-d} day${d === -1 ? '' : 's'} ago`
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

// ─── Search demand ─────────────────────────────────────────────────────────

/**
 * What people typed on the way to us, and where we appear without being chosen.
 *
 * Assembled from the `search` lens's findings rather than re-derived, because
 * the judgement about what is worth reporting — the impression floor, the
 * winnable position band, the refusal to narrate thin click counts — lives in
 * src/lib/agent/searchConsole.js and is tested there. This function only sorts
 * the results into the shapes the page renders.
 *
 * `present` is false when the lens did not run at all, which is NOT the same
 * as a lens that ran and found nothing. The renderer has to be able to tell
 * them apart or an unconfigured property looks like an empty market.
 */
export function searchDemand(report = {}) {
  const findings = (report.findings || []).filter(f => f?.lens === 'search')
  if (!findings.length) return { present: false, summary: null, opportunities: [], movers: [], byLine: [] }

  const asRow = f => ({
    headline: f.headline, detail: f.detail || '', action: f.suggested_action || '',
    line: f.line || '', relevance: f.relevance || 'medium', ref: f.ref,
    evidence: f.evidence || {},
  })

  const summaryFinding = findings.find(f => f.evidence?.all)
  const summary = summaryFinding?.evidence || null

  return {
    present: true,
    summary,
    note: summaryFinding?.headline || '',
    // Queries where the ranking already exists and the click does not — the
    // highest-value half, and the half that does not depend on traffic volume.
    opportunities: findings.filter(f => f.category === 'content').map(asRow),
    // Reported in impressions. See the note at the top of searchConsole.js for
    // why clicks are not trusted to move at this volume.
    movers: findings.filter(f => f !== summaryFinding && f.category !== 'content' && f.evidence?.state).map(asRow),
    byLine: summary?.byLine || [],
  }
}

// ─── Marketing recommendations ─────────────────────────────────────────────

/**
 * Gaps and the ideas that close them — each already names what it rests on.
 *
 * Numbered here rather than in the renderer, and numbered ACROSS both lists.
 * The 15 Sep report numbered its gap-backed recommendations 1, 2, 3 and then
 * rendered two loose ideas with no number at all, so the most time-critical
 * item in the document (a National Day piece with nine days on it) read as an
 * afterthought under the numbered ones. A reader counts what is numbered.
 *
 * The spec asks for two to four. More than four is not truncated — an idea
 * that was researched is not made wrong by its position — but `overCap` says
 * so, and the renderer folds the surplus.
 */
export const RECOMMENDATION_CAP = 4

export function marketingRecommendations(report) {
  const plan = actionPlan(report)
  const blocks = plan.blocks.map((b, i) => ({ ...b, n: i + 1 }))
  const loose = plan.loose.map((l, i) => ({ ...l, n: blocks.length + i + 1 }))
  const total = blocks.length + loose.length
  return { ...plan, blocks, loose, total, overCap: total > RECOMMENDATION_CAP, cap: RECOMMENDATION_CAP }
}

// ─── Open items ────────────────────────────────────────────────────────────

/**
 * What we said last week and the week before that nobody has closed.
 *
 * ── WHY A SECTION AND NOT A FOOTNOTE ──
 *
 * `unanswered` is written fresh every run and read as this run's caveats, so
 * an item that keeps recurring looks new every time and an item that stops
 * recurring vanishes without anyone deciding it was fixed. Two real cases from
 * consecutive Arak runs: a 404 on the company's own About page, flagged as a
 * pre-tender credibility risk and then simply absent the following week; and
 * the Instagram connection, raised twice, both times in a limitations
 * footnote, where nobody acts.
 *
 * This reads the run history the page has already loaded and says, for each
 * item, when it was first raised and whether this run repeated it. It cannot
 * know that something was FIXED — only a person knows that — so it says
 * "not repeated this run" rather than "resolved", which is the honest claim.
 */
export function openItems({ runs = [], limit = 10, lookback = 6 } = {}) {
  const complete = (runs || [])
    .filter(r => r?.report && (r.report.unanswered || []).length)
    .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')))
    .slice(0, lookback)
  if (!complete.length) return []

  const latestId = complete[0].id
  const items = []
  for (const run of complete) {
    const date = String(run.started_at || '').slice(0, 10)
    for (const raw of run.report.unanswered || []) {
      const text = flat(raw)
      if (!text) continue
      // Similarity, not equality: the same blocker is written a little
      // differently every week, and two lines that are 80% the same sentence
      // are one open item rather than two.
      const hit = items.find(i => similarity(i.text, text) >= 0.6)
      if (hit) {
        hit.runs += 1
        hit.firstRaised = date || hit.firstRaised
        continue
      }
      items.push({ text, firstRaised: date, lastRaised: date, runs: 1, thisRun: run.id === latestId })
    }
  }
  return items
    .filter(i => i.runs > 1 || i.thisRun)
    .sort((a, b) => Number(b.thisRun) - Number(a.thisRun) || b.runs - a.runs ||
      String(a.firstRaised).localeCompare(String(b.firstRaised)))
    .slice(0, limit)
}

// ─── New competitors ───────────────────────────────────────────────────────

/**
 * Candidates for a person to accept or dismiss: what this run surfaced, and
 * what earlier runs proposed that nobody has decided on yet.
 *
 * A rejected rival (status retired) is left out entirely: rejecting is how a
 * person says "not this one", and a list that keeps showing it afterwards
 * reads as though the click did nothing. The row itself stays in the table so
 * the next run does not propose it again.
 */
export function newCompetitors({ report = {}, agendaCompetitors = [] } = {}) {
  const out = []
  for (const c of report.new_competitors || []) {
    const row = (agendaCompetitors || []).find(a => nameKey(a.subject) === nameKey(c.name))
    if (row?.status === 'retired') continue
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
    // Flattened, because a scraped title arrives carrying the newlines of the
    // page it came off — and a numbered list whose items contain line breaks
    // printed as two entries run together in the 15 Sep PDF.
    const u = flat(url)
    if (!/^https?:\/\//i.test(u)) return
    if (!by.has(u)) by.set(u, { url: u, title: flat(title), domain: domainOf(u), citedBy: [] })
    const row = by.get(u)
    if (!row.title && title) row.title = flat(title)
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

// ─── Competitor moves, grouped by business line ────────────────────────────

/** The label a line key reads as, from the run's own roll-up. */
const labelForLine = (key, labels = []) =>
  labels.find(l => l.key === key)?.label || (key ? key[0].toUpperCase() + key.slice(1) : '')

/**
 * The same moves, split into the businesses they belong to.
 *
 * Lighting is specified by an architect at concept stage; controls by an MEP
 * or ELV consultant months later. The rivals barely overlap — of the 17 on
 * Arak's watchlist, 8 sell only lighting and 4 only controls — so one
 * undifferentiated list puts a controls integrator and a lighting supplier in
 * adjacent cards when the two companies are never in the same room.
 *
 * A move belonging to BOTH lines appears under both, deliberately: that is a
 * real property of a cross-line rival, and picking one for it would hide them
 * from half the people who need to know.
 *
 * `unlined` is returned as its own trailing group rather than dropped or
 * folded into one of the businesses. A move we could not tie to a line is a
 * gap in what we know, and filing it under the wrong business is worse than
 * leaving it visible as unclassified — someone acts on it either way.
 */
export function movesByLine(items = [], lineLabels = []) {
  const order = []
  const by = new Map()
  const push = (key, m) => {
    if (!by.has(key)) { by.set(key, []); order.push(key) }
    by.get(key).push(m)
  }
  for (const m of items || []) {
    const lines = (m.lines || []).filter(Boolean)
    if (lines.length) for (const l of lines) push(l, m)
    else push('', m)
  }
  // Named lines in the order they first appear; unclassified always last.
  return order
    .sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0))
    .map(key => ({
      key,
      label: key ? labelForLine(key, lineLabels) : 'Not tied to a business',
      items: by.get(key),
    }))
}

/**
 * The world industry — the `global` lens, on its own.
 *
 * Kept out of "Market & technical" because that section is this market: every
 * finding the category lens returned on 2026-09-17 was Saudi, correctly. A
 * European standard and a Riyadh tender are read by different people for
 * different reasons and should not share a list.
 */
export function globalView(report = {}) {
  const items = (report.findings || [])
    .filter(f => f?.lens === 'global' && isReportable(f) && str(f.headline))
  return { items: rankFindings(items) }
}

/**
 * One business line, on its own, as a small section.
 *
 * For a line nobody on the watchlist competes with us on, there is no
 * competitor research to show and pretending otherwise would be dishonest —
 * so this reads the market and industry findings that landed on the line
 * instead, and says plainly when that is all there is.
 */
export function lineView(report = {}, key = '') {
  const line = str(key)
  if (!line) return { key: '', items: [], rivals: 0 }
  const items = (report.findings || [])
    .filter(f => str(f.line) === line && isReportable(f) && str(f.headline))
  return {
    key: line,
    items: rankFindings(items),
    // How many of them came from a competitor pass, so the section can say
    // "nobody on the watchlist sells this" rather than showing an empty box.
    rivals: items.filter(f => str(f.competitor)).length,
  }
}
