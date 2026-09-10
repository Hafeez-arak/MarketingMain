// ─── What each lens actually asks ──────────────────────────────────────────
// The prompts are functions of the brand, not constants, and that is the whole
// mechanism by which this system is domain-agnostic. Nothing here names
// lighting, spas or tailoring. Every specific — the industry, the city, the
// buyer, the season — arrives from the Brand Brain at call time.
//
// Two rules hold across all six:
//
//   1. An empty answer is a correct answer. Every prompt says so explicitly,
//      because a model asked to research something will otherwise find
//      something, and a brief padded with weak findings is worse than a short
//      one — it trains the reader to skim.
//
//   2. No invented dates. `perishable_until` drives the "act now" section, so
//      a hallucinated deadline does not just add noise, it outranks real work.
//
// Pure. No timestamps, no ids — a prompt builder is exactly where a "today is"
// line gets added without thinking, and that silently invalidates the cache.

/**
 * The two or three lines every lens needs about who it is researching for.
 *
 * Kept short deliberately: the full brand context is already the cached system
 * block, so repeating it here would pay for the same tokens twice.
 */
function who({ brandName, descriptor, audience, geography }) {
  return [
    `Brand: ${brandName || 'this brand'}`,
    descriptor ? `What they do: ${descriptor}` : '',
    audience ? `Who they sell to: ${audience}` : '',
    geography ? `Where they operate: ${geography}` : '',
  ].filter(Boolean).join('\n')
}

const CLOSING = [
  '',
  'Rules:',
  '- Return an empty findings array if you found nothing worth reporting. That is a',
  '  correct and common answer. Do not pad.',
  '- Every finding needs a source you actually read. No source, no finding.',
  '- Only set perishable_until when a real date exists. Never invent one.',
  '- suggested_action must be something the brand can actually do this month.',
].join('\n')

/**
 * CALENDAR — what is coming.
 *
 * The highest value-to-cost lens in the set, because most of its answer is a
 * lookup rather than a search, and because every business on earth has a
 * calendar. The date range is passed in rather than computed here so the
 * prompt stays cache-stable.
 */
export function calendarPrompt(brand, { from, to }) {
  return [
    who(brand),
    '',
    `Identify what is coming between ${from} and ${to} that should change what this brand`,
    'publishes or offers.',
    '',
    'Consider, and only where genuinely relevant to THIS brand and THIS audience:',
    '- Religious and cultural dates (Ramadan, Eid, Hajj) and the preparation window',
    '  BEFORE each one, which is usually when the buying happens.',
    '- National and civic dates for the country they operate in.',
    '- Seasonal patterns: weather, school terms, wedding and travel seasons.',
    '- Local events, exhibitions and trade shows their buyers attend.',
    '- Industry cycles: budget years, procurement windows, project phases.',
    '',
    'For each, the useful output is not the date itself — everyone has a calendar. It is',
    'the LEAD TIME: when this brand must start publishing to be ready, and what the buyer',
    'is doing in the weeks before. Set perishable_until to the date the opportunity closes,',
    'not the date of the event.',
    '',
    'VERIFY EVERY DATE WITH A SEARCH before reporting it, and cite what you found.',
    'This matters more here than anywhere else: you know roughly when Ramadan and the',
    'national holidays fall, so it is tempting to answer from memory — but a finding with',
    'no source is dropped before anyone reads it, and an exhibition you half-remember on',
    'the wrong week sends a month of content out at the wrong time. Search first. If you',
    'cannot confirm a date, leave it out rather than reporting it unconfirmed.',
    CLOSING,
  ].join('\n')
}

/**
 * OPENINGS — what just changed that we can move into.
 *
 * The generalised form of "new projects arrived". For a specification business
 * that is a tender; for a local service it is a new neighbourhood, a rival
 * closing, or an event needing suppliers. Same question, different target.
 */
export function openingsPrompt(brand, { motion }) {
  const byMotion = {
    specification: [
      '- New projects, tenders or contract awards where this brand\'s category is in scope.',
      '- Projects entering DESIGN stage — the moment a product can still be specified.',
      '  After tender it is usually too late, so an early-stage project is worth more',
      '  than a larger one already out to bid.',
      '- Consultants, contractors or developers newly active in their market.',
    ],
    local_service: [
      '- New residential, retail or commercial developments completing in their area —',
      '  a concentration of their customer with no incumbent supplier.',
      '- Events, openings or gatherings that create sudden demand for what they sell.',
      '- Competitors closing, pausing, or visibly failing to serve an area.',
      '- Partners with the same customer and a different service, worth approaching.',
    ],
    product: [
      '- Retailers, marketplaces or stockists newly open to their category.',
      '- Creators or communities newly discussing the category.',
      '- Supply or regulatory changes that open or close a segment.',
    ],
  }

  return [
    who(brand),
    '',
    'Find things that have RECENTLY appeared in this brand\'s market that they could act on.',
    'Recent means the last few weeks. Something that has been true for a year is not an',
    'opening, however relevant.',
    '',
    'Look for:',
    ...(byMotion[motion] || byMotion.local_service),
    '',
    'An opening is only useful if it is still open. Set perishable_until to when the window',
    'closes — a tender deadline, an event date, an opening week. If you cannot establish a',
    'date, say so in the detail rather than guessing one.',
    CLOSING,
  ].join('\n')
}

/**
 * DEMAND — what people actually want.
 *
 * The richest single source is complaints about competitors: an unmet need,
 * stated by the customer, about someone who is not us. That is market research
 * the customer performed for free.
 */
export function demandPrompt(brand, { competitors = [] }) {
  return [
    who(brand),
    competitors.length ? `Known competitors: ${competitors.slice(0, 8).join(', ')}` : '',
    '',
    'Find out what this brand\'s customers are actually asking for, worrying about, and',
    'complaining about.',
    '',
    'The most valuable material is negative: complaints and unanswered questions about',
    'COMPETITORS. Each one is an unmet need stated by the customer about someone who is',
    'not us — that is a positioning opportunity and often a post.',
    '',
    'Look at review sites, forums, public comments, and any place this audience discusses',
    'the category. Prioritise:',
    '- Recurring questions nobody answers well.',
    '- The specific fear that stops someone buying (trust, risk, timing, price).',
    '- Complaints about competitors that this brand does not have that problem with.',
    '- The words customers use, which are rarely the words the industry uses.',
    '',
    'A finding here should usually carry a suggested_action that is a piece of content:',
    'if customers keep asking something, answering it publicly is the action.',
    CLOSING,
  ].join('\n')
}

/**
 * RIVALS — what competitors are doing.
 *
 * The only lens that existed before, widened past posting cadence. Posting
 * frequency is a lagging, low-value signal; offers, pricing, launches and
 * hiring are what precede a move rather than report one.
 */
export function rivalsPrompt(brand, { competitors = [], board = [], movements = [] }) {
  const measured = board.length
    ? board.map(c =>
        `- ${c.name}${c.handle ? ` (@${c.handle})` : ''}: ${c.followers ?? '?'} followers, ` +
        `${c.activity || 'activity unknown'}, engagement/1k ${c.engagement_per_1k ?? 'unknown'}`,
      ).join('\n')
    : '(no competitor could be measured this period)'

  const moved = movements.length
    ? movements.map(m => `- ${m.what}: ${m.from} → ${m.to} (${m.change_pct}%, ${m.significance})`).join('\n')
    : '(nothing moved measurably)'

  return [
    who(brand),
    competitors.length ? `Competitors to watch: ${competitors.slice(0, 8).join(', ')}` : '',
    '',
    'MEASURED NUMBERS — these are computed in code and are given facts. Do not recompute,',
    'estimate around, or contradict them.',
    '',
    'Board:',
    measured,
    '',
    'Movements:',
    moved,
    '',
    'Now find out what is happening with these competitors BEYOND their posting. Posting',
    'frequency is a lagging indicator; these are leading ones:',
    '- New offers, packages, services or pricing changes.',
    '- Product launches, new brands carried, new partnerships or distribution.',
    '- Hiring — who they are recruiting says what they are staffing up to deliver.',
    '- Expansion, new locations, new markets.',
    '- Anything they are saying publicly that suggests a change of direction.',
    '',
    'If the numbers above raise a question, chase THAT rather than researching generally.',
    'A competitor whose posting doubled is worth asking about; one that did not move is not.',
    CLOSING,
  ].join('\n')
}

/**
 * CRAFT — how to say it.
 *
 * Genuinely useful, genuinely the least urgent, and monthly rather than weekly
 * because the answer moves quarterly. Running it every week would pay
 * repeatedly for the same answer.
 */
export function craftPrompt(brand, { platforms = [] }) {
  return [
    who(brand),
    platforms.length ? `Platforms in use: ${platforms.join(', ')}` : '',
    '',
    'Identify what is currently working in terms of FORMAT and PLATFORM for brands like',
    'this one — not what to say, but how to say it.',
    '',
    'Consider: format shifts (short video vs carousel vs stills vs long-form), platform',
    'changes that affect reach, and posting conventions this audience now expects.',
    '',
    'Be sceptical. Most "trends" reporting is recycled and applies to consumer brands',
    'regardless of whether it applies here. A finding is only worth reporting if it would',
    'plausibly change what this specific brand does next month. If nothing has meaningfully',
    'changed, return nothing — that is the usual and correct answer.',
    CLOSING,
  ].join('\n')
}

export const LENS_PROMPTS = {
  calendar: calendarPrompt,
  openings: openingsPrompt,
  demand: demandPrompt,
  rivals: rivalsPrompt,
  craft: craftPrompt,
}
