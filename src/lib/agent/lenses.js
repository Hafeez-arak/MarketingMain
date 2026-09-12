// ─── The six lenses ────────────────────────────────────────────────────────
// A marketing person answers six recurring questions. The run used to answer
// one of them — "what did competitors post" — because Instagram was the only
// input and everything downstream hung off it.
//
// A lens is a fixed KIND of question with a variable TARGET. Nothing about
// lighting, spas or tailoring is hardcoded anywhere in this file: the target
// comes from the brand's own descriptor, audience, geography and sales motion.
// That is what lets one system serve Arak, Aqeeq and Alo Kheyatah — and a
// fourth brand in a fourth industry — without new code.
//
// ── WHY LENSES RATHER THAN A LONGER PIPELINE ──
//
// The old shape was serial: instagram → plan → search → reflect → write. Three
// things were wrong with it, and all three are properties of the shape rather
// than of any stage:
//
//   • One failure cost everything. Instagram was blocked on 2026-09-10 and the
//     entire run had nothing to say, though five other questions were still
//     perfectly answerable.
//   • One budget could not express six appetites. Calendar is nearly free —
//     it is a date lookup. Openings deserves real search spend.
//   • One clock forced one cadence. Craft is worth a month; Openings might be
//     worth a day.
//
// A lens produces FINDINGS, never a brief. Synthesis happens once, over all of
// them. That separation is what makes a new lens an addition rather than a
// rewrite.

// ── Perishability ──
// How fast a finding goes stale. This is the axis the brief sorts on, because
// "act by Thursday" outranks "video is doing well generally" no matter how
// interesting the second is.
export const PERISHABLE = 'perishable'   // has a deadline; worth interrupting for
export const DURABLE    = 'durable'      // true for weeks; informs planning
export const SLOW        = 'slow'        // true for months; informs style

/**
 * How a brand sells. The single field that decides which lenses lead.
 *
 * It is not in the Brand Brain yet — `motionOf` below infers it, badly but
 * usefully, until someone sets it explicitly. Adding it there is the cheapest
 * way to make every future brand work without code.
 */
export const MOTIONS = {
  specification: {
    label: 'Specification sale',
    note: 'Long cycle. Won by being named in a spec before the tender. Buyers are professionals, not consumers.',
    leads: ['openings', 'rivals'],
  },
  local_service: {
    label: 'Local service',
    note: 'Short cycle, high repeat, bought on trust and timing. Season and locality drive demand.',
    leads: ['calendar', 'demand'],
  },
  product: {
    label: 'Product / e-commerce',
    note: 'Impulse and trend driven. Format and creator behaviour move the needle.',
    leads: ['craft', 'demand'],
  },
}

export const DEFAULT_MOTION = 'local_service'

/**
 * Guess how a brand sells from what the Brand Brain already says.
 *
 * A guess, and labelled as one — `explicit: false` travels with it so a caller
 * can tell an inference from a decision. The right fix is a field a person
 * sets; this only stops the system being useless until they do.
 */
export function motionOf(profile) {
  const explicit = String(profile?.customFields?.sales_motion || '').trim()
  if (MOTIONS[explicit]) return { motion: explicit, explicit: true }

  const hay = [
    profile?.customFields?.brand_descriptor,
    profile?.positioning,
    profile?.targetPersonas,
  ].join(' ').toLowerCase()

  // Professional buyers named in the audience is the strongest signal there
  // is: architects and contractors do not buy the way consumers do.
  if (/architect|contractor|consultant|specif|tender|engineer|procurement|b2b/.test(hay)) {
    return { motion: 'specification', explicit: false }
  }
  if (/at-home|on-demand|salon|spa|clinic|service|appointment|booking|delivered to/.test(hay)) {
    return { motion: 'local_service', explicit: false }
  }
  return { motion: DEFAULT_MOTION, explicit: false }
}

// ─── The registry ──────────────────────────────────────────────────────────

export const LENSES = [
  {
    key: 'calendar',
    label: 'Calendar',
    question: 'What is coming in the next 2–8 weeks that changes what we should be saying?',
    perishability: PERISHABLE,
    cadence: 'weekly',
    // Raising this from 2 to 4 was the previous attempt at the same problem and
    // it did not work: the model spent all four (two on an identical query),
    // hit max_uses_exceeded seven times, and returned nothing at all — throwing
    // away the dates it had already confirmed. The budget was never the bug.
    //
    // Dates are now computed in calendar.js before this lens runs, so these
    // searches are no longer spent on lookups. They go to the one part of
    // "what is coming" that no API answers: trade shows, exhibitions and
    // industry cycles. Six is enough for that and, unlike before, the lens
    // returns its dates whether or not a single search succeeds.
    //
    // Effort rises from low to medium for the same reason. The old job was
    // recall, which low handles; the new job is judgement about what a
    // particular brand should do with a date, which it does not — and the
    // duplicate query was itself a symptom of a model given no room to plan.
    budget: { searches: 6, maxTokens: 8_000, effort: 'medium' },
    // Every brand has a calendar. There is no business for which "what is
    // coming" is not a question, which is why this one is never disabled.
    universal: true,
  },
  {
    key: 'openings',
    label: 'Openings',
    question: 'What just appeared in the market that we could target?',
    perishability: PERISHABLE,
    cadence: 'weekly',
    budget: { searches: 6, maxTokens: 8_000, effort: 'medium' },
    universal: true,
  },
  {
    key: 'demand',
    label: 'Demand',
    question: 'What are people asking for, and what are they unhappy about?',
    perishability: DURABLE,
    cadence: 'weekly',
    budget: { searches: 5, maxTokens: 8_000, effort: 'medium' },
    universal: true,
  },
  {
    key: 'rivals',
    label: 'Rivals',
    question: 'What are competitors doing, and does it matter?',
    perishability: DURABLE,
    cadence: 'weekly',
    budget: { searches: 5, maxTokens: 8_000, effort: 'medium' },
    universal: true,
  },
  {
    key: 'ourselves',
    label: 'Ourselves',
    question: 'What has actually worked for us?',
    perishability: DURABLE,
    cadence: 'weekly',
    // No model call at all — this reads our own tables and computes. Listed as
    // a lens anyway so the brief can report it as checked-and-quiet rather
    // than silently absent.
    budget: { searches: 0, maxTokens: 0, effort: 'low' },
    universal: true,
  },
  {
    key: 'craft',
    label: 'Craft',
    question: 'How should we be saying it right now — which formats and platforms are working?',
    perishability: SLOW,
    cadence: 'monthly',
    budget: { searches: 3, maxTokens: 6_000, effort: 'low' },
    universal: true,
  },
]

export function lensByKey(key) {
  return LENSES.find(l => l.key === key) || null
}

/**
 * Which lenses run for this brand, in the order the brief should read them.
 *
 * Ordered by perishability first — a deadline outranks an observation — then
 * by whether this brand's sales motion leads with it. A specification business
 * gets Openings before Calendar; a local service the other way round.
 */
export function lensesFor({ motion = DEFAULT_MOTION, only = null, cadence = 'weekly' } = {}) {
  const leads = MOTIONS[motion]?.leads || []
  const rank = { [PERISHABLE]: 0, [DURABLE]: 1, [SLOW]: 2 }

  return LENSES
    .filter(l => (only ? only.includes(l.key) : true))
    // A monthly lens is skipped on a weekly run. Running Craft every week
    // would spend money re-answering a question whose answer moves quarterly.
    .filter(l => cadence === 'monthly' || l.cadence === 'weekly')
    .slice()
    .sort((a, b) =>
      rank[a.perishability] - rank[b.perishability] ||
      (leads.includes(b.key) ? 1 : 0) - (leads.includes(a.key) ? 1 : 0) ||
      LENSES.indexOf(a) - LENSES.indexOf(b))
}

/** Total searches a run may make, so a cap can be checked before spending. */
export function searchBudgetFor(lenses) {
  return (lenses || []).reduce((n, l) => n + (l.budget?.searches || 0), 0)
}

// ─── Findings ──────────────────────────────────────────────────────────────

/**
 * The shape every lens returns. Deliberately NOT a brief — a lens produces raw
 * material and synthesis happens once, over all of them.
 *
 * Two fields here do not exist in the old report and are the reason the brief
 * can become a list of actions rather than a list of observations:
 *
 *   perishable_until  a date after which this is worthless. What lets the
 *                     brief say "act by Thursday" and sort on urgency.
 *   suggested_action  what to actually DO. A finding without one is trivia,
 *                     however true it is.
 */
export const FINDING_FIELDS = [
  'lens', 'headline', 'detail', 'sources', 'confidence',
  'novelty', 'perishable_until', 'suggested_action', 'evidence',
]

export function makeFinding(lensKey, raw = {}) {
  return {
    lens: lensKey,
    headline: String(raw.headline || '').trim(),
    detail: String(raw.detail || '').trim(),
    sources: Array.isArray(raw.sources) ? raw.sources : [],
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : null,
    novelty: ['new', 'continuing', 'changed', 'resolved'].includes(raw.novelty) ? raw.novelty : 'new',
    // Null means evergreen, not "expired". Callers must treat the two
    // differently or every undated finding sorts to the top as overdue.
    perishable_until: raw.perishable_until || null,
    suggested_action: String(raw.suggested_action || '').trim(),
    evidence: raw.evidence && typeof raw.evidence === 'object' ? raw.evidence : {},
  }
}

/** Days until a finding goes stale, or null when it never does. */
export function daysLeft(finding, now = new Date()) {
  if (!finding?.perishable_until) return null
  const when = new Date(finding.perishable_until)
  if (Number.isNaN(when.getTime())) return null
  return Math.round((when.getTime() - now.getTime()) / 86_400_000)
}

/**
 * Order findings the way a person should read them.
 *
 * Anything with a live deadline leads, soonest first. Everything else follows
 * by confidence. An expired finding sinks rather than disappearing — it may
 * explain why something was missed.
 */
export function rankFindings(findings, now = new Date()) {
  return [...(findings || [])].sort((a, b) => {
    const da = daysLeft(a, now)
    const db = daysLeft(b, now)
    const aLive = da !== null && da >= 0
    const bLive = db !== null && db >= 0
    if (aLive !== bLive) return aLive ? -1 : 1
    if (aLive && bLive && da !== db) return da - db
    const aDead = da !== null && da < 0
    const bDead = db !== null && db < 0
    if (aDead !== bDead) return aDead ? 1 : -1
    return (b.confidence ?? 0) - (a.confidence ?? 0)
  })
}

/**
 * What each lens had to say, including the ones that had nothing.
 *
 * A lens that found nothing and a lens that broke look identical unless the
 * brief distinguishes them, and that distinction is the whole difference
 * between a report someone trusts and one they skim. This is why `ran` and
 * `error` are separate from `count`.
 */
export function lensSummary(results) {
  return (results || []).map(r => ({
    lens: r.lens,
    label: lensByKey(r.lens)?.label || r.lens,
    ran: r.ok !== false,
    count: (r.findings || []).length,
    error: r.error || '',
    state: r.ok === false ? 'failed' : (r.findings || []).length ? 'found' : 'quiet',
  }))
}
