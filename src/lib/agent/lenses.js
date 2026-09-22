import { daysUntil } from './calendar.js'

// ─── The lenses ────────────────────────────────────────────────────────────
// A marketing person answers a handful of recurring questions. The run used to
// answer one of them — "what did competitors post" — because Instagram was the
// only input and everything downstream hung off it.
//
// There are seven now, not six, and the count is deliberately not in this
// heading any more: it changed once and the heading did not, which is how a
// file starts lying about itself. `LENSES` below is the list.
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
    leads: ['openings', 'events', 'rivals'],
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
    // ZERO. This lens makes no model call at all any more.
    //
    // Its dates are computed from free APIs — Aladhan for the Hijri calendar,
    // Nager.Date and a built-in Gulf table for public holidays. The model used
    // to be asked two extra things on top: what this brand should DO about a
    // date, and which trade shows are coming. Both moved:
    //
    //   "what should we do about it"  ->  synthesis, which already reads every
    //                                     finding and has the brand context,
    //                                     so it costs nothing extra there.
    //   "which trade shows"           ->  the openings lens, which is already
    //                                     searching this market for events.
    //
    // That saved ~$0.17 a week for output that, on the run of 2026-09-12, was
    // literally nothing: the model half hit its 150s budget and was stopped
    // while the free computed half produced the only real finding in the brief.
    // A lens whose valuable half is free should not carry a bill.
    budget: { searches: 0, maxTokens: 0, effort: 'low' },
    // Every brand has a calendar. There is no business for which "what is
    // coming" is not a question, which is why this one is never disabled.
    universal: true,
  },
  {
    key: 'openings',
    label: 'Projects & openings',
    question: 'Who is about to need what we sell, and can we still reach them?',
    perishability: PERISHABLE,
    cadence: 'weekly',
    // The anchor of the weekly run, and the only lens with a proven hit: on
    // 2026-09-12 it surfaced a 300-key Waldorf Astoria conversion sitting in
    // DESIGN phase — a live specification window — plus a smart-city
    // masterplan and a project whose window had already closed.
    //
    // The demand side is where a specification business grows. Competitors are
    // an input to that, not the subject of it.
    //
    // Six searches, down from eight on 2026-09-15: its events job moved to the
    // events lens, so every search it has now goes to projects.
    budget: { searches: 6, maxTokens: 10_000, effort: 'medium' },
    universal: true,
  },
  {
    key: 'events',
    label: 'Events & expos',
    question: 'Which expos, conferences and events should our teams attend, exhibit at, or know just happened?',
    perishability: PERISHABLE,
    cadence: 'weekly',
    // Its own lens since 2026-09-15. Events used to be the openings lens's
    // SECOND job — "only with whatever searches are left", with an explicit
    // note that reporting no events at all was the correct trade. It was
    // obeyed: every brief's Events section held Saudi National Day and nothing
    // else, while the buyers' own property expos and a major technology
    // conference went unmentioned. A job that is allowed to get nothing gets
    // nothing, so it gets its own budget.
    //
    // Three rings, all generic: the brand's own industry shows, the events
    // where its BUYERS gather (for a specification business, developers' and
    // contractors' expos), and the conferences that shape what buyers ask for.
    // Recent editions count too — who exhibited and what was announced is a
    // finding, and so are the next edition's dates.
    budget: { searches: 6, maxTokens: 10_000, effort: 'medium' },
    universal: true,
  },
  {
    key: 'demand',
    label: 'Buyers',
    question: 'What do the people who specify and buy from us actually care about right now?',
    perishability: DURABLE,
    cadence: 'weekly',
    // Rewritten, not just relabelled. It used to ask "what do people complain
    // about regarding COMPETITORS", which anchored a buyer-understanding
    // question to rivals who, being SMEs, mostly do nothing in a given week.
    // It now asks about our buyers directly.
    //
    // ── SIX AGAIN, AND THE CUT TO FOUR IS WHY THIS LENS DIED ──
    //
    // It was cut 6 → 4 on 2026-09-15 to pay for the competitor lens going
    // weekly, on the reasoning that the 14 Sep findings came from its first
    // three searches. The ledger says otherwise, and the correlation is exact:
    //
    //   09-14   6 searches   $0.326   3 findings
    //   09-15   4 searches   $0.222   0 findings
    //   09-17   4 searches   $0.484   0 findings
    //
    // It has never produced a finding since the cut. The 09-17 run isolates it:
    // after the schema fix, every lens with six or more searches recovered
    // (events 6, category 6, rivals 8) and the only one that did not is the
    // only one left on four.
    //
    // Note the cost column — the starved lens is DEARER. It exhausts its
    // allowance, then burns tokens on calls the API answers with
    // max_uses_exceeded. Paying for silence is the worst trade here.
    //
    // Fetches are named explicitly rather than left to the default: since #71
    // this lens reads DOCUMENTS, and a document must be fetched to be cited.
    budget: { searches: 6, fetches: 10, maxTokens: 8_000, effort: 'medium' },
    universal: true,
  },
  {
    key: 'category',
    label: 'Category',
    question: 'What is changing in our industry that we should have a view on?',
    perishability: SLOW,
    cadence: 'weekly',
    // New. Nothing in the old set asked what was happening to the CATEGORY —
    // standards, regulation, technology, procurement policy. For a Saudi
    // specification business that is where the largest forces live (Vision
    // 2030 mandates, efficiency codes, smart-building requirements), and none
    // of it depends on a competitor posting anything.
    budget: { searches: 6, maxTokens: 8_000, effort: 'medium' },
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
    key: 'search',
    label: 'Search demand',
    question: 'What are people actually typing on their way to us, and where do we appear without being chosen?',
    perishability: DURABLE,
    cadence: 'weekly',
    // The only FIRST-PARTY demand signal in the whole run.
    //
    // Every other lens infers what buyers want from something second-hand — a
    // rival's post, a trade article, a tender listing. This one reads what
    // people typed into Google on the way to our own site, in both languages,
    // including the searches where we appeared and nobody clicked. That last
    // set is the valuable one: the impressions prove the demand and the
    // ranking exist, so what is missing is a page worth choosing.
    //
    // Zero budget, like Calendar and Ourselves: this is a measured API read,
    // not a model call. It is listed as a lens rather than folded into
    // `ourselves` for one reason — so a broken credential is reported as
    // FAILED instead of quiet. A dead key that reads as "nothing found" looks
    // exactly like nobody searching for us, and this agent has already been
    // bitten twice by a silent empty.
    budget: { searches: 0, maxTokens: 0, effort: 'low' },
    // Universal, and the distinction is worth stating because it looks
    // otherwise at first glance: this lens needs CONFIGURATION (a verified
    // property, a service account added to it) but it is not DOMAIN-SPECIFIC.
    // Every brand in every industry has customers who search for what it
    // sells. A brand that has not configured a property gets a lens that
    // reports itself unconfigured — which is a setup step, not a reason the
    // question does not apply.
    universal: true,
  },
  {
    key: 'rivals',
    label: 'Competitors',
    question: 'What are competitors doing across every channel, and how does it affect us?',
    perishability: DURABLE,
    // WEEKLY again, since 2026-09-15, and asking a different question.
    //
    // It was demoted to monthly on 2026-09-12 because it asked "what did they
    // POST", and SME rivals mostly post nothing — Technolight had no posts in
    // the period that prompted it. That was the wrong question, not the wrong
    // cadence. The team does not care about follower counts; it cares what
    // rivals are DOING — a brand signed, a project won, a KNX engineer hired,
    // a stand booked at Elenex — and those leave small traces on websites,
    // LinkedIn pages, job boards, exhibitor lists and the trade press every
    // week whether or not anyone posts. Each trace is stored as a signal
    // (intel.js) and synthesis combines weeks of them into a move.
    //
    // Eight searches rather than five, because it now reads many channels per
    // rival. Roughly +$0.35 a week over the monthly cadence.
    cadence: 'weekly',
    // ── ONE PASS PER BUSINESS LINE ──
    //
    // This lens runs once for EACH line the watchlist actually uses, as
    // `rivals_lighting`, `rivals_controls`, and so on. The budget below is
    // therefore PER PASS, not for the whole watchlist.
    //
    // It was one pass over one shared budget until 2026-09-17, and that is a
    // bug the prompt could not fix. The roll is ordered by the sequence a
    // person typed the names in; Arak entered lighting first; so with 17 names
    // and 8 searches the lens reached seven rivals and reported five unreached
    // — SAS Systems Engineering and Prime Star Technologies among them, both
    // controls-only. The controls half of the business was structurally
    // unresearchable, every week, and the report could only say it was quiet.
    // A shared budget spent in list order always starves whichever line was
    // entered last. Separate passes is the only fix that does not depend on a
    // model choosing to ration itself.
    //
    // Six per pass rather than eight: two passes at six is twelve searches
    // against today's eight, and the second pass is the one that was returning
    // nothing at all.
    perLine: true,
    budget: { searches: 6, maxTokens: 10_000, effort: 'medium' },
    universal: true,
  },
  {
    key: 'global',
    label: 'Global industry',
    question: 'What is happening in the world industry — the manufacturers, technologies and prices upstream of our market?',
    // Months, not weeks. A European standard or a Chinese price movement
    // changes what we should be saying for a season, not for a Thursday.
    perishability: SLOW,
    // ── WHY THIS IS NOT THE CATEGORY LENS ──
    //
    // `category` researches THIS MARKET — it is grounded in the brand's own
    // geography, and every finding it returned on 2026-09-17 was Saudi: SASO
    // 2870, New Murabba, Qiddiya, municipal streetlight tenders. That is
    // correct and it is the whole point of it.
    //
    // It means nothing upstream is ever looked at. Where fixtures are actually
    // made, what the European and Chinese manufacturers are launching, which
    // way component prices are moving, which standards are about to arrive —
    // none of that has a Saudi search result until it is already here. This
    // lens is deliberately NOT given the brand's geography, and asks the
    // question the other one cannot.
    cadence: 'weekly',
    // Six, not five. `lenses.test.js` holds every searching lens at six or
    // more, and the ledger is why: demand on four searches cost MORE than
    // demand on six ($0.484 against $0.326) and returned nothing, because it
    // exhausted its allowance and then burned tokens on calls the API answered
    // with max_uses_exceeded. A starved lens is not a cheap lens.
    budget: { searches: 6, maxTokens: 8_000, effort: 'medium' },
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

/**
 * The lens a key names — including a per-line pass like `rivals_controls`.
 *
 * Exact match first, always, so a lens whose own key contains an underscore
 * can never be mistaken for a pass of something else. Only if that fails is
 * the key read as `<perLine lens>_<line>`.
 */
export function lensByKey(key) {
  const exact = LENSES.find(l => l.key === key) || null
  if (exact) return exact
  const base = baseKeyOf(key)
  return base === key ? null : LENSES.find(l => l.key === base) || null
}

/** `rivals_controls` -> `rivals`. Any other key is returned unchanged. */
export function baseKeyOf(key = '') {
  const k = String(key || '')
  const cut = k.indexOf('_')
  if (cut < 1) return k
  const head = k.slice(0, cut)
  const lens = LENSES.find(l => l.key === head)
  return lens?.perLine ? head : k
}

/** The business line a lens key is a pass for, or '' for an ordinary lens. */
export function lineOfLensKey(key = '') {
  const k = String(key || '')
  const base = baseKeyOf(k)
  return base === k ? '' : k.slice(base.length + 1)
}

/** One pass per line, for the lenses that take one. */
export const lensKeyFor = (base, line) => (line ? `${base}_${line}` : base)

/**
 * Expand the per-line lenses into one entry per line this brand actually has
 * rivals in.
 *
 * Driven by the WATCHLIST rather than by the configured lines, and that is the
 * distinction that keeps this honest: Arak configures three lines but has no
 * smart-pole rival on the list, so a `rivals_poles` pass would spend six
 * searches to discover the empty set it was handed. A line nobody competes
 * with us on is not a line to research; it is a line to write about.
 *
 * A brand with no lines configured, or whose watchlist records none, keeps the
 * single undivided lens — which is every brand but this one today.
 */
export function expandPerLine(lenses = [], lineKeys = []) {
  const lines = [...new Set((lineKeys || []).map(l => String(l || '').trim()).filter(Boolean))]
  return (lenses || []).flatMap(l => {
    if (!l?.perLine || !lines.length) return [l]
    return lines.map(line => ({
      ...l,
      key: lensKeyFor(l.key, line),
      base: l.key,
      line,
      label: `${l.label} — ${line}`,
    }))
  })
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

/**
 * Which standing questions belong in a run of this cadence.
 *
 * `research_agenda.cadence` has existed since the table did and nothing read
 * it, so a question a person marked monthly was asked every single week —
 * spending searches re-answering something whose answer moves quarterly, which
 * is the exact waste the lens cadences exist to avoid.
 *
 * Same rule as the lenses: a monthly run is a SUPERSET of a weekly one, so it
 * asks everything. Returned as a PostgREST fragment rather than applied here
 * because the filter belongs in the query — pulling every row back to drop
 * half of them in JavaScript is the kind of thing that is fine at six rows and
 * quietly is not at six hundred.
 */
export function agendaFilterFor(cadence = 'weekly') {
  return cadence === 'monthly' ? '' : '&cadence=eq.weekly'
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
  'for_whom', 'technical_note',
  // Added 2026-09-15 for the three-reader report. `relevance` is how much it
  // MATTERS, which confidence (how sure) never said; `competitor`, `channel`
  // and `category` make a finding a storable signal; `lead` and `event` make
  // it a tracked row the sales team can work.
  'relevance', 'competitor', 'channel', 'category', 'lead', 'event',
  // Added 2026-09-16. Which BUSINESS LINE a finding belongs to, for a brand
  // that sells more than one thing to more than one buyer. Never asked of a
  // model and never inferred from a lens's subject: it is stamped in code from
  // something factual — the landing page a search resolved to, the watchlist
  // entry a signal came from — against lines the brand itself configured. An
  // empty string means unclassified, which is honest; a finding filed under
  // the wrong business is worse than an unfiled one, because someone acts on it.
  'line',
]

// ─── Who a finding is for ──────────────────────────────────────────────────
//
// A research run aimed at marketing keeps turning up things that are true,
// sourced, and not marketing's to act on: a SASO certification deadline for
// low-voltage lighting, a building-code revision, a standards change. They are
// worth knowing and they were expensive to find, but a reader scanning for
// what to publish this Thursday has to step over them.
//
// The tempting fix — a separate Technical page — is wrong, and the SASO case
// is why. A mandatory certification deadline is technical in SUBJECT and
// marketing in USE: "every fixture we ship is already certified, here is what
// specifiers must check before December" is one of the strongest posts this
// brand can make, and it exists only because a compliance date was found. Send
// that to another page and marketing never sees its best angle of the week.
//
// So the axis is not subject, it is OWNERSHIP:
//
//   marketing   there is something to publish. The default, and the common case.
//   sales       someone to call, a tender to bid, a project to get specified
//               on. Added 2026-09-15: the 14 Sep brief filed three live leads
//               as "marketing", so they sat among post ideas where the people
//               who work leads never looked.
//   both        publishable AND the technical team needs to know. Stays in the
//               marketing flow; carries a line for the other team.
//   technical   genuinely nothing to publish. Kept, but out of the way.
export const FOR_WHOM = ['marketing', 'sales', 'both', 'technical']

/**
 * Whether a finding belongs out of the marketing flow entirely.
 *
 * `both` is deliberately NOT technical-only. It is the case the whole field
 * exists to serve — a finding with a publishable angle that someone else also
 * needs — and treating it as technical would hide exactly what we set out to
 * keep.
 */
export const isTechnicalOnly = f => f?.for_whom === 'technical'

/**
 * @param {string} lensKey
 * @param {object} raw            what the model returned
 * @param {string} [defaultLine]  the line this lens pass was researching
 *
 * `defaultLine` is evidence of the strongest kind available: a finding that
 * came back from the controls pass is about controls because that is the only
 * thing that pass was asked about and the only roster it was given. It beats
 * the keyword stamp in lines.js, which has to guess from a headline — so it is
 * applied here, at the source, and `lineForFinding` leaves an existing value
 * alone. The model may still override it per finding, which is right for a
 * rival that turns out to sell into the other line too.
 */
export function makeFinding(lensKey, raw = {}, defaultLine = '') {
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
    ...audienceOf(raw),
    relevance: ['high', 'medium', 'low'].includes(raw.relevance) ? raw.relevance : 'medium',
    competitor: String(raw.competitor || '').trim(),
    channel: String(raw.channel || '').trim(),
    category: String(raw.category || '').trim(),
    lead: objectWithName(raw.lead),
    event: objectWithName(raw.event),
    line: String(raw.line || defaultLine || '').trim(),
  }
}

/** A lead or event is only kept when it names the thing — the store keys on it. */
function objectWithName(v) {
  return v && typeof v === 'object' && String(v.name || '').trim() ? v : null
}

/**
 * Decide who a finding is for, and refuse a technical label that is not earned.
 *
 * ── WHY THE GUARD IS IN CODE AND NOT IN THE PROMPT ──
 *
 * The moment a model has a bucket labelled "not marketing's problem", it has
 * somewhere to put anything it could not turn into an action. Nothing about
 * that is malicious — filing a hard finding under `technical` reads, from
 * inside the generation, like being tidy. The result is a marketing brief that
 * thins out a little every week while the run keeps reporting the same number
 * of findings, and nobody can see it happening because the findings are all
 * still there, just somewhere else.
 *
 * The prompt asks for a reason. This ENFORCES it: `technical` without a
 * `technical_note` saying what the other team does about it is not a
 * classification, it is a shrug, and a shrug goes back in the marketing flow
 * where a person will read it. Same reason repeats are caught in code rather
 * than by asking the model not to repeat itself.
 */
function audienceOf(raw = {}) {
  const note = String(raw.technical_note || '').trim()
  const claimed = FOR_WHOM.includes(raw.for_whom) ? raw.for_whom : 'marketing'
  // A bare "technical" is a shrug. Marketing gets to see it and decide.
  const for_whom = claimed === 'technical' && !note ? 'marketing' : claimed
  // The note only means anything alongside a technical audience. Carrying it on
  // a purely marketing finding would put an empty "for the technical team" line
  // under cards that have nothing to do with them.
  return { for_whom, technical_note: ['both', 'technical'].includes(for_whom) ? note : '' }
}

/**
 * Days until a finding goes stale, or null when it never does.
 *
 * Date-only arithmetic, midnight to midnight, and that is not a detail.
 * Subtracting the current TIME OF DAY from a date-only deadline makes the
 * answer drift through the day: the brief rendered "Saudi National Day is 11
 * days away" from the stored calendar number directly above a badge reading
 * "in 10 days", because this ran at 15:57 and 10.3 rounds down. Same date,
 * same page, two answers.
 *
 * `daysUntil` in calendar.js has always done it correctly. This defers to it
 * rather than keeping a second implementation, because the two must agree and
 * the only way to guarantee that is for there to be one of them.
 */
export function daysLeft(finding, now = new Date()) {
  if (!finding?.perishable_until) return null
  return daysUntil(String(finding.perishable_until).slice(0, 10), now)
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
// ── "QUIET" HID A THIRD STATE, AND IT IS THE EXPENSIVE ONE ──
//
// On 2026-09-15 three lenses read 130 sources between them and returned zero
// findings. Every one of them was reported as "looked and found nothing",
// which is what a genuinely still market looks like — so the brief said the
// week was quiet when what had actually happened was that three questions were
// researched and then discarded. That is a different fact, with a different
// fix, and it is invisible unless the number of sources READ is carried
// alongside the number of findings KEPT.
//
// So a lens that read sources and reported nothing is `searched`, not `quiet`,
// and every row carries what it read against what it was allowed to spend.
export function lensSummary(results) {
  return (results || []).map(r => {
    const count = (r.findings || []).length
    const sources = (r.sources || []).length
    const allowance = lensByKey(r.lens)?.budget?.searches ?? 0
    // A per-line pass carries its line in the label, or the report shows two
    // rows both called "Competitors" and a reader cannot tell which business
    // came back quiet.
    const line = lineOfLensKey(r.lens)
    const base = lensByKey(r.lens)?.label || r.lens
    return {
      lens: r.lens,
      line,
      label: line ? `${base} — ${line}` : base,
      ran: r.ok !== false,
      count,
      sources,
      allowance,
      error: r.error || '',
      state: r.ok === false ? 'failed' : count ? 'found' : (sources ? 'searched' : 'quiet'),
    }
  })
}
