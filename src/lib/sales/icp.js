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
        // Optional: this segment's own share of a project's value, when it
        // differs from the company-wide one (a hotel's interiors carry more of
        // our category than a warehouse does). Null means "use the default".
        share: shareOf(s?.share),
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
    // ── WHAT SHARE OF A PROJECT IS OURS ──
    //
    // Added 2026-10-17. Sources announce a PROJECT's value ("SAR 100M school
    // complex"); `size` above is a PACKAGE size ("best under 500k"). Comparing
    // the two directly was the bug: a SAR 100M school and a SAR 2.7bn hotel
    // programme were both marked "larger than we usually win", so the list
    // could not tell a near-miss from a giga-project. The owner's rule of
    // thumb is that our category is a few percent of a project, so a project
    // value is converted to an estimated package value before it is scored.
    // Percent, min and max. Null means values are taken as package values, the
    // behaviour before this existed.
    share: shareOf(c.share),
    regions: list(c.regions).map(lower).filter(Boolean),
    red_flags: list(c.red_flags)
      .map(f => ({ label: str(f?.label), match: list(f?.match).map(lower).filter(Boolean), advice: str(f?.advice) }))
      .filter(f => f.label),
    ask_first: list(c.ask_first).map(str).filter(Boolean),
    win_levers: list(c.win_levers).map(str).filter(Boolean),
    pains: list(c.pains)
      .map(p => ({ pain: str(p?.pain), angle: str(p?.angle) }))
      .filter(p => p.pain),
    // ── WHAT WE SELL, AND WHEN WE ARE HIRED ──
    //
    // Added 2026-10-20 for Ghusn. Arak's ICP assumed one kind of sale: a
    // package on a project, specified at design stage. A landscape company
    // sells that too, but is hired late (external works, near handover), and
    // its steadiest money is a yearly maintenance contract with a site that
    // already exists. Without these two lines the openings lens chased
    // design-stage projects for a business that cannot be specified there,
    // and nothing anywhere knew that a recurring contract was on offer.
    //
    //   offers      what we sell, each one-off or recurring. The prospect
    //               search picks one per company by key.
    //   hire_stage  when in a project's life buyers hire us. When written it
    //               outranks the generic stage order in the openings lens.
    offers: list(c.offers)
      .map(o => ({
        key: str(o?.key) || slug(o?.label),
        label: str(o?.label) || str(o?.key),
        kind: o?.kind === 'recurring' ? 'recurring' : 'one_off',
        note: str(o?.note),
      }))
      .filter(o => o.key),
    hire_stage: str(c.hire_stage),
  }
}

export const hasIcp = icp => {
  const n = normaliseIcp(icp)
  return Boolean(n.summary || n.segments.length)
}

/** {min, max} in percent, or null. A single number is a fixed share. */
function shareOf(v) {
  if (!v || typeof v !== 'object') return null
  let min = num(v.min)
  let max = num(v.max)
  if (min === null && max === null) return null
  if (min === null) min = max
  if (max === null) max = min
  if (min <= 0 || max <= 0 || min > 100 || max > 100) return null
  if (min > max) [min, max] = [max, min]
  return { min, max, note: str(v.note) }
}

/**
 * What our package on a target is worth, as a range.
 *
 * A target can carry two values: `value_sar` (as written — usually the whole
 * project) with `value_kind` saying which it is, and `package_value_sar` when
 * the lens found the value of the specific piece that fits us. A stated
 * package value always wins over an estimate.
 *
 * Returns { min, max, estimated, project } or null when nothing is known.
 */
export function packageEstimate(t = {}, rawIcp = {}, seg = null) {
  const icp = normaliseIcp(rawIcp)
  const pkg = num(t.package_value_sar) ?? parseAmount(t.package_value_sar)
  if (pkg !== null) return { min: pkg, max: pkg, estimated: false, project: null }
  const value = num(t.value_sar) ?? parseAmount(t.value_sar)
  if (value === null) return null
  const share = seg?.share || icp.share
  const kind = lower(t.value_kind)
  // Targets stored before 2026-10-17 carry no value_kind, and the old prompt
  // asked for "the package or project value as written" — so it is either.
  // A value already inside our package range is read as a package: no
  // building project costs SAR 450k, and shrinking it to "our share 14k"
  // would bury exactly the jobs we win most.
  const looksLikePackage = !kind && icp.size.ok_max && value <= icp.size.ok_max
  // A value the lens says is already a package, or a company that set no
  // share, is scored as it stands — exactly the old behaviour.
  if (kind === 'package' || looksLikePackage || !share) {
    return { min: value, max: value, estimated: false, project: null }
  }
  return {
    min: (value * share.min) / 100,
    max: (value * share.max) / 100,
    estimated: true,
    project: value,
  }
}

const rangeText = (r, currency) => (r.min === r.max
  ? formatAmount(r.min, currency)
  : `${formatAmount(r.min, currency).replace(` ${currency}`, '')}–${formatAmount(r.max, currency)}`)

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
  // Scored on our PACKAGE, not the headline. The low end of an estimate
  // decides: if even the low end is above what we handle, the project is a
  // programme to be split, and saying so is more useful than a bare warning.
  const pkg = packageEstimate(t, icp, seg)
  const { sweet_max, ok_max, currency } = icp.size
  if (pkg && (sweet_max || ok_max)) {
    const est = pkg.estimated
      ? `${formatAmount(pkg.project, currency)} project, our share about ${rangeText(pkg, currency)}`
      : formatAmount(pkg.min, currency)
    const named = str(t.package)
    if (sweet_max && pkg.min <= sweet_max) {
      score += 20
      reasons.push(`${est} — the size we win most`)
    } else if (ok_max && pkg.min <= ok_max) {
      score += 10
      reasons.push(`${est} — within range`)
    } else if (ok_max && pkg.min <= ok_max * 2) {
      // Just over the line is a phone call, not a programme. Raya Al-Tajdeed's
      // SAR 100M school job (our share ~3–5M) is the case this exists for.
      score += 5
      reasons.push(`${est} — a little above our usual size; worth a call`)
    } else if (named) {
      // Too big as a whole, but the lens named the piece that fits us. That
      // piece is the target; the headline value is context.
      score += 10
      reasons.push(`${est} — too big as one job; go for: ${named}`)
    } else if (track === 'broader') {
      score += 5
      reasons.push(`${est} — larger than we usually win; growth target`)
      flags.push('Too big as one job — find the package that fits us and who holds it')
    } else {
      flags.push(`${est} — too big as one job; find the package that fits us and who holds it`)
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
  return [
    icp.summary ? `WHO WE TARGET\n${icp.summary}` : '',
    icp.evidence ? `Built from: ${icp.evidence}` : '',
    seg('core').length ? `CORE TRACK — what our own history says we win:\n${seg('core').join('\n')}` : '',
    seg('broader').length ? `BROADER TRACK — where we want to grow:\n${seg('broader').join('\n')}` : '',
    buyers.length ? `BUYERS:\n${buyers.join('\n')}` : '',
    icp.offers.length
      ? `WHAT WE SELL:\n${icp.offers.map(o => `- ${o.label}${o.kind === 'recurring' ? ' (recurring: a yearly contract)' : ''}${o.note ? ` — ${o.note}` : ''}`).join('\n')}`
      : '',
    icpFitText(icp),
    icp.red_flags.length
      ? `RED FLAGS (still report the target, but name the flag):\n${icp.red_flags.map(f => `- ${f.label}${f.advice ? ` — ${f.advice}` : ''}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n')
}

/**
 * The size, share and region lines alone.
 *
 * The targets lens gets the whole ICP; the openings lens gets only these, so
 * it can size a project before proposing it without being turned into a
 * second targets lens.
 */
export function icpFitText(rawIcp = {}) {
  const icp = normaliseIcp(rawIcp)
  const { sweet_max, ok_max, currency, note } = icp.size
  return [
    icp.hire_stage
      ? `WHEN WE ARE HIRED: ${icp.hire_stage} Look for projects at THIS stage; it outranks any general advice about which stage is worth most.`
      : '',
    sweet_max || ok_max
      ? `PACKAGE SIZE: best under ${formatAmount(sweet_max, currency) || '—'}; fine up to ${formatAmount(ok_max, currency) || '—'}.${note ? ` ${note}` : ''}`
      : '',
    icp.share
      ? `OUR SHARE OF A PROJECT: about ${icp.share.min === icp.share.max ? icp.share.min : `${icp.share.min}–${icp.share.max}`}% of a project's total value is our category.` +
        (sweet_max || ok_max ? ` So the projects whose share lands in our package size are worth roughly ${projectBand(icp)}.` : '') +
        (icp.share.note ? ` ${icp.share.note}` : '') +
        (icp.segments.some(s => s.share) ? ` Segments that differ: ${icp.segments.filter(s => s.share).map(s => `${s.label} ${s.share.min}–${s.share.max}%`).join(', ')}.` : '')
      : '',
    icp.regions.length ? `REGION: ${icp.regions.join(', ')}` : '',
  ].filter(Boolean).join('\n\n')
}

/** "SAR 10M–67M": the project values whose share lands in our package size. */
function projectBand(icp) {
  const { sweet_max, ok_max, currency } = icp.size
  const top = ok_max || sweet_max
  const lowTop = sweet_max || ok_max
  const fmt = n => formatAmount(n, currency)
  return `${fmt((lowTop * 100) / icp.share.max)} to ${fmt((top * 100) / icp.share.min)} in total`
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

/** "3-5" for a range, "4" for a fixed share. */
const shareText = sh => (sh.min === sh.max ? String(sh.min) : `${sh.min}-${sh.max}`)

/** "3-5", "3 – 5%", "4" → {min, max}, or null. */
export function parseShare(text) {
  const m = /(\d+(?:\.\d+)?)\s*(?:[-–to]+\s*(\d+(?:\.\d+)?))?/.exec(String(text || ''))
  if (!m) return null
  return shareOf({ min: Number(m[1]), max: m[2] != null ? Number(m[2]) : Number(m[1]) })
}

/** The ICP as the editor's fields. */
export function icpToForm(raw = {}) {
  const icp = normaliseIcp(raw)
  return {
    summary: icp.summary,
    evidence: icp.evidence,
    core: String(icp.mix.core),
    segments: icp.segments
      .map(s => [s.label, s.track, s.weight, joinWords(s.match), s.note, s.share ? shareText(s.share) : ''].join(' | ').replace(/( \| )+$/, ''))
      .join('\n'),
    buyers: Object.fromEntries(BUYER_KEYS.map(k => [k, String(icp.buyers.find(b => b.key === k)?.weight ?? 0)])),
    buyerNotes: Object.fromEntries(BUYER_KEYS.map(k => [k, icp.buyers.find(b => b.key === k)?.note || ''])),
    sweet_max: icp.size.sweet_max == null ? '' : String(icp.size.sweet_max),
    ok_max: icp.size.ok_max == null ? '' : String(icp.size.ok_max),
    size_note: icp.size.note,
    share: icp.share ? shareText(icp.share) : '',
    share_note: icp.share?.note || '',
    regions: joinWords(icp.regions),
    red_flags: icp.red_flags.map(f => [f.label, f.advice, joinWords(f.match)].join(' | ')).join('\n'),
    ask_first: icp.ask_first.join('\n'),
    win_levers: icp.win_levers.join('\n'),
    pains: icp.pains.map(p => [p.pain, p.angle].join(' | ')).join('\n'),
    offers: icp.offers.map(o => [o.label, o.kind === 'recurring' ? 'recurring' : 'one-off', o.note].join(' | ').replace(/( \| )+$/, '')).join('\n'),
    hire_stage: icp.hire_stage,
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
  const prev = normaliseIcp(previous)
  const keyByLabel = new Map(prev.segments.map(s => [lower(s.label), s.key]))
  const offerKeyByLabel = new Map(prev.offers.map(o => [lower(o.label), o.key]))
  return normaliseIcp({
    summary: form.summary,
    evidence: form.evidence,
    mix: { core: form.core },
    segments: linesOf(form.segments).map(l => {
      const [label, track, weight, words, note, share] = parts(l)
      return { key: keyByLabel.get(lower(label)) || '', label, track: lower(track), weight, match: splitWords(words), note, share: parseShare(share) }
    }),
    buyers: BUYER_KEYS
      .map(k => ({ key: k, weight: num(form.buyers?.[k]), note: str(form.buyerNotes?.[k]) }))
      .filter(b => b.weight !== null && b.weight !== 0),
    size: { sweet_max: num(form.sweet_max), ok_max: num(form.ok_max), currency: 'SAR', note: form.size_note },
    share: form.share ? { ...parseShare(form.share), note: form.share_note } : null,
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
    offers: linesOf(form.offers).map(l => {
      const [label, kind, note] = parts(l)
      return { key: offerKeyByLabel.get(lower(label)) || '', label, kind: /recur|year|annual|month/i.test(kind || '') ? 'recurring' : 'one_off', note }
    }),
    hire_stage: form.hire_stage,
  })
}
