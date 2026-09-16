import { sameName, daysTo } from './agent/intel'

// ─── The business view ─────────────────────────────────────────────────────
//
// The weekly report answers "what happened". This answers "where do we stand",
// which is a different question with a different audience and a different
// clock. It is one page per business line, and the six blocks on it are fixed:
//
//   verdict   one sentence — the honest state of play in this line
//   losing    who is beating us and on what, from contested bids
//   board     the rivals, on the axes that decide work IN THIS LINE
//   moved     at most three things that changed
//   decide    the one call to make
//   unknown   what we still cannot answer, named
//
// ── THE RULE THIS FILE EXISTS TO ENFORCE ──
//
// Every block can return "not established", and several of them will for
// months. A page that fills six blocks every time regardless of what was found
// is a page that will be wrong six ways and trusted for about two months — and
// this brand's whole reporting discipline has been built on the opposite
// habit. Nothing here manufactures a conclusion to avoid a gap.
//
// The hardest of those is `losing`. It can only come from `deal_outcomes`,
// which people fill in after a contested bid. No amount of web research
// substitutes for it, and the view says so rather than guessing from signals.

const str = v => String(v ?? '').trim()
const lower = v => str(v).toLowerCase()

/** A block with nothing behind it. `why` is shown to the reader, not hidden. */
export const notEstablished = why => ({ established: false, why })

/**
 * Which lines this brand has rivals in.
 *
 * Read off the watchlist rather than the brand config, because this page is
 * about competitors and a line with no competitor on it has no board to show.
 * A rival in no line at all lands in `''`, which renders as one extra page
 * rather than being silently dropped.
 */
export function linesOf(watchlist = []) {
  const seen = new Set()
  for (const c of watchlist) for (const l of c.lines || []) if (str(l)) seen.add(str(l))
  if (!seen.size) return ['']
  return [...seen].sort()
}

export const inLine = (c, line) => (line ? (c.lines || []).some(l => lower(l) === lower(line)) : !(c.lines || []).length)

// ─── Losing ────────────────────────────────────────────────────────────────

export const DECIDED_BY_LABEL = {
  price: 'price', lead_time: 'lead time', spec_lock_in: 'spec lock-in',
  relationship: 'relationship', agency_rights: 'agency rights', compliance: 'compliance',
  scope: 'scope', other: 'something else', unknown: 'a reason nobody recorded',
}

/**
 * Who beat us, and on what.
 *
 * The block a person reads first, and the only one no amount of research can
 * produce. Contested means lost or won — a win against a named rival is
 * evidence about them too, and a log that only records defeats is one people
 * stop filling in.
 */
export function losing(deals = [], line = '') {
  const mine = deals.filter(d => (line ? lower(d.line) === lower(line) : true))
  const contested = mine.filter(d => ['lost', 'won'].includes(d.outcome) && str(d.competitor))
  if (!contested.length) {
    return notEstablished(mine.length
      ? 'Deals are recorded for this line, but none names who we were up against.'
      : 'No contested bid has been recorded for this line. Until one is, who we lose to and why is a guess ' +
        'and this page will not make it.')
  }

  const by = new Map()
  for (const d of contested) {
    const key = lower(d.competitor)
    const row = by.get(key) || { competitor: str(d.competitor), lost: 0, won: 0, reasons: new Map(), value: 0 }
    row[d.outcome === 'lost' ? 'lost' : 'won']++
    if (d.outcome === 'lost') {
      const r = str(d.decided_by) || 'unknown'
      row.reasons.set(r, (row.reasons.get(r) || 0) + 1)
    }
    row.value += Number(d.value_sar) || 0
    by.set(key, row)
  }

  const rows = [...by.values()]
    .map(r => {
      const top = [...r.reasons.entries()].sort((a, b) => b[1] - a[1])[0]
      return { ...r, reasons: undefined, topReason: top ? top[0] : '', topReasonCount: top ? top[1] : 0, contested: r.lost + r.won }
    })
    .sort((a, b) => b.lost - a.lost || b.contested - a.contested)

  return { established: true, rows, contested: contested.length, lost: contested.filter(d => d.outcome === 'lost').length }
}

// ─── The board ─────────────────────────────────────────────────────────────

/**
 * The rivals in one line, with what we actually know about each.
 *
 * `researched` is the honest column. A rival on the watchlist that no run has
 * ever returned a signal for is not a quiet rival — it is one we have not
 * looked at, and the board says which.
 */
export function board({ watchlist = [], signals = [], brands = [], line = '', now = new Date() } = {}) {
  const rivals = watchlist.filter(c => inLine(c, line))
  if (!rivals.length) return notEstablished('No competitor on the watchlist is marked as competing in this line.')

  const rows = rivals.map(c => {
    const mine = signals.filter(s => sameName(s.competitor, c.subject))
    const last = mine.map(s => s.last_seen_at).filter(Boolean).sort().pop() || null
    return {
      name: c.subject,
      domain: str(c.domain),
      kinds: c.kinds || [],
      city: str(c.city),
      // `Number(null)` is 0, which is finite — so a null tier scored as tier 0
      // and sorted an unrated rival ABOVE a rated one. Null is checked first.
      tier: c.tier == null || c.tier === '' ? null : (Number.isFinite(Number(c.tier)) ? Number(c.tier) : null),
      resolution: str(c.resolution) || 'unresolved',
      brands: brands
        .filter(b => sameName(b.competitor, c.subject) && (!line || !str(b.line) || lower(b.line) === lower(line)))
        .map(b => ({ brand: b.brand, relationship: b.relationship })),
      signals: mine.length,
      researched: mine.length > 0,
      lastSeenDays: last ? -daysTo(last, now) : null,
    }
  })
  // Tier first where sales has set one, then by what we actually know.
  rows.sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9) || b.signals - a.signals || a.name.localeCompare(b.name))
  return { established: true, rows, researched: rows.filter(r => r.researched).length }
}

// ─── Moved ─────────────────────────────────────────────────────────────────

/** At most three. Nothing padded, and a quiet month says so. */
export function moved({ signals = [], watchlist = [], line = '', now = new Date(), days = 35, limit = 3 } = {}) {
  const rivals = watchlist.filter(c => inLine(c, line)).map(c => c.subject)
  const RANK = { high: 3, medium: 2, low: 1 }
  const recent = signals
    .filter(s => str(s.competitor) && rivals.some(n => sameName(n, s.competitor)))
    .filter(s => s.first_seen_at && -daysTo(s.first_seen_at, now) <= days)
    .sort((a, b) => (RANK[b.relevance] || 0) - (RANK[a.relevance] || 0) ||
                    String(b.first_seen_at).localeCompare(String(a.first_seen_at)))
  if (!recent.length) {
    return notEstablished(rivals.length
      ? `Nothing new was found about the ${rivals.length} rivals in this line in the last ${days} days.`
      : 'No rivals are assigned to this line.')
  }
  return {
    established: true,
    rows: recent.slice(0, limit).map(s => ({
      competitor: str(s.competitor), summary: str(s.summary), category: str(s.category),
      channel: str(s.channel), url: str(s.source_url), relevance: str(s.relevance) || 'medium',
      days: -daysTo(s.first_seen_at, now),
    })),
    more: Math.max(0, recent.length - limit),
  }
}

// ─── Unknown ───────────────────────────────────────────────────────────────

/**
 * What this page cannot yet answer, and why.
 *
 * Deliberately the last block and deliberately never empty-by-default: on a
 * new install it is the longest one on the page, and that is the correct first
 * impression. An honest gap list is what gets the gaps closed.
 */
export function unknown({ watchlist = [], signals = [], deals = [], line = '' } = {}) {
  const rivals = watchlist.filter(c => inLine(c, line))
  const out = []

  const noDomain = rivals.filter(c => !str(c.domain) && c.resolution !== 'unresolvable')
  if (noDomain.length) {
    out.push({
      gap: `${noDomain.length} rival${noDomain.length === 1 ? ' has' : 's have'} no confirmed domain`,
      detail: `${noDomain.map(c => c.subject).join(', ')}. More than one company can share a name, so these ` +
        'cannot be researched without one — and a guess would be worse than the gap.',
      ask: 'Sales confirms the website.',
    })
  }

  const unresolvable = rivals.filter(c => c.resolution === 'unresolvable')
  if (unresolvable.length) {
    out.push({
      gap: `${unresolvable.length} name${unresolvable.length === 1 ? '' : 's'} could not be identified at all`,
      detail: `${unresolvable.map(c => c.subject).join(', ')}. No public record found under this name.`,
      ask: 'Sales supplies a website, a legal name, or a location.',
    })
  }

  const never = rivals.filter(c => !signals.some(s => sameName(s.competitor, c.subject)))
  if (never.length) {
    out.push({
      gap: `${never.length} of ${rivals.length} rivals have never returned a single finding`,
      detail: `${never.slice(0, 6).map(c => c.subject).join(', ')}${never.length > 6 ? `, and ${never.length - 6} more` : ''}. ` +
        'That is not a quiet rival — it is one we have not yet looked at.',
      ask: 'Time. Each weekly run reaches a few more.',
    })
  }

  if (!rivals.some(c => c.tier)) {
    out.push({
      gap: 'No rival has a tier',
      detail: 'Tier is how often we actually meet a company on a shortlist, and it decides which rivals the ' +
        'weekly search budget reaches first. Nobody but sales can set it, so it is empty rather than guessed.',
      ask: 'Sales rates each rival 1 to 3.',
    })
  }

  const lineDeals = deals.filter(d => (line ? lower(d.line) === lower(line) : true))
  if (!lineDeals.length) {
    out.push({
      gap: 'No contested bid has been recorded',
      detail: 'Where we lose and why is internal — it is not on any website, and no amount of research ' +
        'substitutes for it. It is the first thing on this page and the only block nothing else can fill.',
      ask: 'Six fields after any contested or lost bid.',
    })
  }

  return out
}

// ─── The verdict ───────────────────────────────────────────────────────────

/**
 * One sentence. Assembled in code from what the other blocks established, so
 * it can never claim more than the page behind it.
 */
export function verdict({ lose, brd, mv, line = '' } = {}) {
  const what = line ? `In ${line}` : 'Across the watchlist'
  if (lose?.established) {
    const top = lose.rows[0]
    const reason = DECIDED_BY_LABEL[top.topReason] || 'a reason nobody recorded'
    return `${what}, we have contested ${lose.contested} recorded deal${lose.contested === 1 ? '' : 's'} and lost ` +
      `${lose.lost}. ${top.competitor} accounts for the most, usually on ${reason}.`
  }
  if (brd?.established && brd.researched === 0) {
    return `${what}, ${brd.rows.length} rivals are being watched and none has returned a finding yet. ` +
      'There is nothing to conclude from this line, and nothing here pretends otherwise.'
  }
  if (brd?.established) {
    const n = mv?.established ? mv.rows.length : 0
    return `${what}, ${brd.researched} of ${brd.rows.length} rivals have returned findings and ` +
      `${n ? `${n} thing${n === 1 ? '' : 's'} moved recently` : 'nothing moved recently'}. ` +
      'How we fare against them in a bid is not yet recorded, so this is a picture of activity, not of position.'
  }
  return `${what}, there is not yet enough to say anything true.`
}

// ─── The page ──────────────────────────────────────────────────────────────

export function businessView({ watchlist = [], signals = [], brands = [], deals = [], now = new Date() } = {}) {
  const lines = linesOf(watchlist)
  return lines.map(line => {
    const lose = losing(deals, line)
    const brd = board({ watchlist, signals, brands, line, now })
    const mv = moved({ signals, watchlist, line, now })
    return {
      line,
      label: line ? line[0].toUpperCase() + line.slice(1) : 'Unassigned',
      verdict: verdict({ lose, brd, mv, line }),
      losing: lose,
      board: brd,
      moved: mv,
      unknown: unknown({ watchlist, signals, deals, line }),
    }
  })
}
