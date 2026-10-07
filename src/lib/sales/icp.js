import { num } from '../agent/num.js'

// ─── The ideal customer, and how well a target fits it ─────────────────────
// Sales asked for one list of who to go after. A list ranked by a model's
// enthusiasm is a list nobody can argue with, so the FIT is computed here, in
// code, against an ICP the company wrote down — and every point carries the
// reason it was given. A salesperson who disagrees can see exactly which line
// of the ICP to change.
//
// The ICP is data (sales_icp.config), one per company. Nothing in this file
// names an industry, a city or a product: Arak's hotels and schools, a spa's
// corporate wellness accounts and a tailor's wedding planners are all just
// `segments` with words to match. That is what lets the same scoring serve a
// fourth brand without new code.
//
// ── TWO TRACKS, ON PURPOSE ──
//
// Arak's history says small and mid packages, contractors who already hold the
// job, hotels and schools win. A list built only on that would keep the
// company exactly where it is, and the owner asked for the opposite as well:
// keep most of the effort on what we usually win, AND go after the bigger and
// newer kinds of work (fit-out companies, larger packages). So every segment
// belongs to a track:
//
//   core      what our own history says we win. Scored strictly.
//   broader   where we want to grow. Scored on fit, never penalised for being
//             unlike the past — being unlike the past is the point of it.
//
// `mix` says how the lens splits its searches between them, and the page shows
// the two side by side so neither silently crowds out the other.
//
// Pure. No network, no clock unless passed in.

export const TRACKS = ['core', 'broader']

export const BUYERS = [
  ['contractor_awarded', 'Contractor already holding the job'],
  ['owner_developer', 'Owner or developer buying direct'],
  ['fitout', 'Fit-out or interiors company'],
  ['operator', 'Operator or end user'],
  ['contractor_bidding', 'Contractor still bidding the main contract'],
  ['consultant', 'Consultant or designer (influences, does not buy)'],
  ['other', 'Other'],
]
export const BUYER_KEYS = BUYERS.map(([k]) => k)
export const buyerLabel = key => BUYERS.find(([k]) => k === key)?.[1] || ''

export const PLAYS = [
  ['reactivate', 'Reactivate'],
  ['next_phase', 'Next phase / variations'],
  ['cross_sell', 'Cross-sell the other line'],
  ['maintenance', 'Maintenance contract'],
  ['push_open', 'Push open deals'],
  ['repair', 'Repair the relationship first'],
]
export const playLabel = key => PLAYS.find(([k]) => k === key)?.[1] || key

export const ACCOUNT_STATUSES = [
  ['new', 'Not contacted'],
  ['contacted', 'Contacted'],
  ['meeting', 'Meeting held'],
  ['quoted', 'Quoted'],
  ['won', 'Won'],
  ['parked', 'Parked'],
]

const str = v => String(v ?? '').trim()
const list = v => (Array.isArray(v) ? v : [])
const lower = v => str(v).toLowerCase()

/**
 * A complete ICP, whatever was stored.
 *
 * The page and the lens both read through this, so a half-filled config (a new
 * company, an older shape) never reaches the scorer with holes in it.
 */
export function normaliseIcp(raw = {}) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const core = num(c.mix?.core)
  const coreShare = core === null ? 50 : Math.min(100, Math.max(0, Math.round(core)))
  return {
    summary: str(c.summary),
    evidence: str(c.evidence),
    mix: { core: coreShare, broader: 100 - coreShare },
    segments: list(c.segments)
      .map(s => ({
        key: str(s?.key) || slug(s?.label),
        label: str(s?.label) || str(s?.key),
        track: TRACKS.includes(s?.track) ? s.track : 'core',
        // 1 to 3. How much a match on this segment is worth.
        weight: clampWeight(s?.weight),
        match: list(s?.match).map(lower).filter(Boolean),
        note: str(s?.note),
      }))
      .filter(s => s.key),
    buyers: list(c.buyers)
      .map(b => ({ key: str(b?.key), weight: clampWeight(b?.weight, -3), note: str(b?.note) }))
      .filter(b => BUYER_KEYS.includes(b.key)),
    // Package size in the company's own currency. Below `sweet_max` is where we
    // win most; up to `ok_max` is fine; above it is a large tender, which the
    // core track treats as a warning and the broader track as normal.
    size: {
      sweet_max: num(c.size?.sweet_max),
      ok_max: num(c.size?.ok_max),
      currency: str(c.size?.currency) || 'SAR',
      note: str(c.size?.note),
    },
    regions: list(c.regions).map(lower).filter(Boolean),
    red_flags: list(c.red_flags)
      .map(f => ({ label: str(f?.label), match: list(f?.match).map(lower).filter(Boolean), advice: str(f?.advice) }))
      .filter(f => f.label),
    ask_first: list(c.ask_first).map(str).filter(Boolean),
    win_levers: list(c.win_levers).map(str).filter(Boolean),
    pains: list(c.pains)
      .map(p => ({ pain: str(p?.pain), angle: str(p?.angle) }))
      .filter(p => p.pain),
  }
}

export const hasIcp = icp => {
  const n = normaliseIcp(icp)
  return Boolean(n.summary || n.segments.length)
}

function clampWeight(v, min = 1) {
  const n = num(v)
  if (n === null) return 2
  return Math.max(min, Math.min(3, Math.round(n)))
}

function slug(v) {
  return lower(v).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '')
}

/**
 * A money amount from what a page or a model wrote.
 *
 * "SAR 1.2 million", "1,200,000", "850k", "1.5M" — all of them. Null when
 * there is no number, never zero: an unknown package size is not a small one.
 */
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  const s = lower(value).replace(/,/g, '')
  const m = /(\d+(?:\.\d+)?)\s*(bn|billion|b\b|mn|million|m\b|k\b|thousand)?/.exec(s)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2] || ''
  const mult = /^(bn|billion|b)$/.test(unit) ? 1e9 : /^(mn|million|m)$/.test(unit) ? 1e6 : /^(k|thousand)$/.test(unit) ? 1e3 : 1
  return n * mult
}

/** "1.2M SAR", "850k SAR". */
export function formatAmount(n, currency = 'SAR') {
  const v = num(n)
  if (v === null) return ''
  const s = v >= 1e9 ? `${trim(v / 1e9)}B` : v >= 1e6 ? `${trim(v / 1e6)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v))
  return `${s} ${currency}`.trim()
}
const trim = x => (Math.round(x * 10) / 10).toString()

// The words that say where a project has got to. Two windows are worth a call:
// early (it can still be specified) and buying (the contractor is placing
// orders). Anything between is still a target, just a less urgent one.
const EARLY = /feasib|concept|master ?plan|design|schematic|announc|launch|planning|pre-?qual|eoi/
const BUYING = /award|appointed|fit.?out|procure|mobilis|mobiliz|construction start|groundbreak|signed/

/**
 * How well one target fits the ICP, and why.
 *
 * Every point comes with a reason a salesperson can read, and every deduction
 * with the flag that caused it. The number is for sorting; the reasons are for
 * deciding.
 *
 * @param {object} t   a target: { name, headline, detail, scope, segment, buyer,
 *                     value_sar, location, stage, track, red_flags, ... }
 * @param {object} rawIcp
 */
export function scoreTarget(t = {}, rawIcp = {}) {
  const icp = normaliseIcp(rawIcp)
  const hay = [t.name, t.headline, t.detail, t.scope, t.segment, t.client, t.location, t.stage, t.why_fit]
    .map(lower).join(' ')
  const reasons = []
  const flags = []
  let score = 0

  // ── Segment ──
  // The lens names a segment key when it can; otherwise the words decide.
  const seg = icp.segments.find(s => s.key === lower(t.segment))
    || icp.segments.find(s => s.match.some(w => hay.includes(w)))
    || null
  if (seg) {
    score += seg.weight * 10
    reasons.push(`${seg.label}${seg.track === 'broader' ? ' (growth segment)' : ''}`)
  }
  const track = TRACKS.includes(t.track) ? t.track : (seg?.track || '')

  // ── Buyer ──
  const buyerKey = BUYER_KEYS.includes(t.buyer) ? t.buyer : ''
  const buyer = icp.buyers.find(b => b.key === buyerKey)
  if (buyer) {
    score += buyer.weight * 10
    if (buyer.weight > 0) reasons.push(buyerLabel(buyerKey))
    else flags.push(buyer.note || buyerLabel(buyerKey))
  }

  // ── Size ──
  const value = num(t.value_sar) ?? parseAmount(t.value_sar)
  const { sweet_max, ok_max, currency } = icp.size
  if (value !== null && (sweet_max || ok_max)) {
    if (sweet_max && value <= sweet_max) {
      score += 20
      reasons.push(`${formatAmount(value, currency)} — the size we win most`)
    } else if (ok_max && value <= ok_max) {
      score += 10
      reasons.push(`${formatAmount(value, currency)} — within range`)
    } else if (track === 'broader') {
      // Bigger than our history is what the broader track is FOR. Say so, and
      // do not punish it.
      score += 10
      reasons.push(`${formatAmount(value, currency)} — larger than we usually win; growth target`)
    } else {
      flags.push(`${formatAmount(value, currency)} — larger than we usually win; qualify hard`)
    }
  }

  // ── Region ──
  if (icp.regions.length && icp.regions.some(r => hay.includes(r))) {
    score += 10
    reasons.push('In our region')
  }

  // ── Timing ──
  const stage = lower(t.stage)
  if (EARLY.test(stage)) {
    score += 10
    reasons.push('Early — can still be specified')
  } else if (BUYING.test(stage)) {
    score += 10
    reasons.push('Buying now')
  }

  // ── Red flags ──
  // From the ICP's own list, matched on the words; plus whatever the lens
  // itself reported. A flag never removes a target — it tells the salesperson
  // what to ask first.
  for (const f of icp.red_flags) {
    if (f.match.some(w => hay.includes(w) || lower(t.red_flags).includes(w))) {
      score -= 10
      flags.push(f.advice ? `${f.label} — ${f.advice}` : f.label)
    }
  }
  const reported = str(t.red_flags)
  if (reported && !flags.some(f => lower(f).includes(lower(reported).slice(0, 20)))) flags.push(reported)

  const clamped = Math.max(0, Math.min(100, score))
  return {
    score: clamped,
    band: clamped >= 60 ? 'strong' : clamped >= 35 ? 'possible' : 'weak',
    track,
    segment: seg?.label || str(t.segment),
    reasons,
    flags: [...new Set(flags)],
  }
}

/**
 * The ICP as the targets lens reads it.
 *
 * Plain lines rather than JSON: the lens is told what a good target looks like
 * the way a sales manager would brief a new hire.
 */
export function icpPromptText(rawIcp = {}) {
  const icp = normaliseIcp(rawIcp)
  const seg = track => icp.segments.filter(s => s.track === track)
    .map(s => `- ${s.label} [segment key: ${s.key}]${s.note ? ` — ${s.note}` : ''}`)
  const buyers = icp.buyers.map(b =>
    `- ${buyerLabel(b.key)} [buyer key: ${b.key}]: ${b.weight > 0 ? 'good' : 'warning'}${b.note ? ` — ${b.note}` : ''}`)
  const { sweet_max, ok_max, currency, note } = icp.size
  return [
    icp.summary ? `WHO WE TARGET\n${icp.summary}` : '',
    icp.evidence ? `Built from: ${icp.evidence}` : '',
    seg('core').length ? `CORE TRACK — what our own history says we win:\n${seg('core').join('\n')}` : '',
    seg('broader').length ? `BROADER TRACK — where we want to grow:\n${seg('broader').join('\n')}` : '',
    buyers.length ? `BUYERS:\n${buyers.join('\n')}` : '',
    sweet_max || ok_max
      ? `PACKAGE SIZE: best under ${formatAmount(sweet_max, currency) || '—'}; fine up to ${formatAmount(ok_max, currency) || '—'}.${note ? ` ${note}` : ''}`
      : '',
    icp.regions.length ? `REGION: ${icp.regions.join(', ')}` : '',
    icp.red_flags.length
      ? `RED FLAGS (still report the target, but name the flag):\n${icp.red_flags.map(f => `- ${f.label}${f.advice ? ` — ${f.advice}` : ''}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n')
}

/**
 * Score and sort every target for the page.
 *
 * Open targets only, split by track, strongest first; a target with no track
 * (found by another lens) is placed by its segment, and with no segment either
 * it goes to `other` rather than being forced into one of the two.
 */
export function rankTargets(rows = [], rawIcp = {}) {
  const scored = (rows || []).map(r => ({ ...r, fit: scoreTarget(r, rawIcp) }))
  const by = (a, b) => b.fit.score - a.fit.score || String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || ''))
  return {
    core: scored.filter(r => r.fit.track === 'core').sort(by),
    broader: scored.filter(r => r.fit.track === 'broader').sort(by),
    other: scored.filter(r => !TRACKS.includes(r.fit.track)).sort(by),
  }
}

// ─── Editing the ICP as plain lines ────────────────────────────────────────
// The people who own the ICP are a sales manager and a marketing lead, not
// someone who edits JSON. Every list is one item per line, with " | " between
// the parts — the same shape a person would write on a whiteboard — and the
// page round-trips through these two functions so nothing is lost on save.

const joinWords = a => (a || []).join(', ')
const splitWords = s => String(s || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean)
const linesOf = s => String(s || '').split('\n').map(l => l.trim()).filter(Boolean)
const parts = l => l.split('|').map(p => p.trim())

/** The ICP as the editor's fields. */
export function icpToForm(raw = {}) {
  const icp = normaliseIcp(raw)
  return {
    summary: icp.summary,
    evidence: icp.evidence,
    core: String(icp.mix.core),
    segments: icp.segments
      .map(s => [s.label, s.track, s.weight, joinWords(s.match), s.note].join(' | ').replace(/( \| )+$/, ''))
      .join('\n'),
    buyers: Object.fromEntries(BUYER_KEYS.map(k => [k, String(icp.buyers.find(b => b.key === k)?.weight ?? 0)])),
    buyerNotes: Object.fromEntries(BUYER_KEYS.map(k => [k, icp.buyers.find(b => b.key === k)?.note || ''])),
    sweet_max: icp.size.sweet_max == null ? '' : String(icp.size.sweet_max),
    ok_max: icp.size.ok_max == null ? '' : String(icp.size.ok_max),
    size_note: icp.size.note,
    regions: joinWords(icp.regions),
    red_flags: icp.red_flags.map(f => [f.label, f.advice, joinWords(f.match)].join(' | ')).join('\n'),
    ask_first: icp.ask_first.join('\n'),
    win_levers: icp.win_levers.join('\n'),
    pains: icp.pains.map(p => [p.pain, p.angle].join(' | ')).join('\n'),
  }
}

/**
 * The editor's fields back into a stored ICP.
 *
 * `previous` carries each segment's KEY across by its label: stored targets
 * name their segment by key, so a key must not change just because the ICP was
 * opened and saved. A renamed segment gets a new key, and its old targets are
 * then placed by their words instead — which is what renaming should mean.
 */
export function formToIcp(form = {}, previous = {}) {
  const keyByLabel = new Map(normaliseIcp(previous).segments.map(s => [lower(s.label), s.key]))
  return normaliseIcp({
    summary: form.summary,
    evidence: form.evidence,
    mix: { core: form.core },
    segments: linesOf(form.segments).map(l => {
      const [label, track, weight, words, note] = parts(l)
      return { key: keyByLabel.get(lower(label)) || '', label, track: lower(track), weight, match: splitWords(words), note }
    }),
    buyers: BUYER_KEYS
      .map(k => ({ key: k, weight: num(form.buyers?.[k]), note: str(form.buyerNotes?.[k]) }))
      .filter(b => b.weight !== null && b.weight !== 0),
    size: { sweet_max: num(form.sweet_max), ok_max: num(form.ok_max), currency: 'SAR', note: form.size_note },
    regions: splitWords(form.regions),
    red_flags: linesOf(form.red_flags).map(l => {
      const [label, advice, words] = parts(l)
      return { label, advice, match: splitWords(words) }
    }),
    ask_first: linesOf(form.ask_first),
    win_levers: linesOf(form.win_levers),
    pains: linesOf(form.pains).map(l => {
      const [pain, angle] = parts(l)
      return { pain, angle }
    }),
  })
}
