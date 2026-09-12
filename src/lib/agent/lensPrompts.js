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
  '- Plan your searches before you spend them, and never repeat a query you have',
  '  already run. Your search budget is small and a duplicate query buys nothing.',
  '- IF YOU RUN OUT OF SEARCHES, REPORT WHAT YOU ALREADY CONFIRMED. A finding you',
  '  verified with your third search is not made worthless by your seventh failing.',
  '  Returning nothing because you could not finish is the single most expensive',
  '  mistake you can make here — it discards real work and looks identical to having',
  '  found nothing. Report what you have and note what you could not reach.',
].join('\n')

/**
 * CALENDAR — what is coming.
 *
 * Restructured after the first live runs, and the rewrite is worth explaining
 * because the old shape failed in a way that looked like success.
 *
 * It used to ask a model "what is coming in the next 8 weeks?" and require it
 * to verify every date by searching. On 2026-09-12 that cost $0.28, ran 49
 * seconds, issued four searches — two of them the SAME query — then hit
 * max_uses_exceeded seven times and returned an EMPTY findings array, having
 * already confirmed Saudi National Day in its first three searches. It threw
 * that away because this prompt told it "if you cannot confirm a date, leave
 * it out", and it had run out of budget partway through verifying.
 *
 * Dates are now computed before this prompt is ever built — see
 * src/lib/agent/calendar.js — and arrive here as GIVEN FACTS, the same
 * treatment stage 0 gives measured Instagram numbers. That leaves the model
 * the two jobs that actually need a model:
 *
 *   1. What should THIS brand do about a date everyone already knows.
 *   2. Trade shows and industry events, which no API lists and which are
 *      therefore a genuine search problem — now with the entire budget
 *      instead of competing with lookups it should never have been doing.
 */
export function calendarPrompt(brand, { from, to, events = [], country = '' }) {
  const known = events.length
    ? events.map(e => {
        const when = e.window_open
          ? `PREPARATION WINDOW IS OPEN — ${e.days_until} days away`
          : `${e.days_until} days away, preparation should start ${e.act_by}`
        return [
          `- ${e.name} — ${e.date}${e.ends_on ? ` to ${e.ends_on}` : ''} (${when})`,
          e.hijri ? `  Hijri: ${e.hijri}` : '',
          e.note ? `  ${e.note}` : '',
        ].filter(Boolean).join('\n')
      }).join('\n')
    : '(nothing dated falls in this window — which is a normal and common answer)'

  return [
    who(brand),
    country ? `Country whose calendar applies: ${country}` : '',
    '',
    'CONFIRMED DATES — these were computed from the Hijri calendar and public holiday',
    'records, not researched. They are given facts. Do not re-verify them, do not search',
    'to confirm them, and do not contradict them.',
    '',
    known,
    '',
    `Your job has two parts, for the window ${from} to ${to}.`,
    '',
    'PART ONE — what this brand should DO about the dates above.',
    'Everyone has a calendar, so the date itself is not the finding. The finding is what',
    'this specific brand, selling this specific thing to these specific people, should be',
    'publishing or offering in the weeks BEFORE it, and why that beats what they would',
    'have posted otherwise. A date with a generic "post about it" action is worth less',
    'than no finding at all. If a date genuinely does not matter to this brand — and many',
    'will not — say nothing about it rather than manufacturing a reason.',
    '',
    'PART TWO — the dates nobody publishes in a calendar.',
    'Search for these; they are the only thing here worth spending searches on:',
    '- Trade shows, exhibitions and conferences this brand\'s BUYERS attend.',
    '- Industry cycles: budget years, procurement windows, project phases.',
    '- Seasonal patterns specific to this business — weather, school terms, wedding or',
    '  travel seasons — where they change what the customer wants.',
    '',
    'For anything you find by searching, cite it. For the confirmed dates above you do',
    'not need a source — they already have one.',
    CLOSING,
  ].filter(Boolean).join('\n')
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
