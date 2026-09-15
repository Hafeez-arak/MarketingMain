// ─── What each lens actually asks ──────────────────────────────────────────
// The prompts are functions of the brand, not constants, and that is the whole
// mechanism by which this system is domain-agnostic. Nothing here names
// lighting, spas or tailoring. Every specific — the industry, the city, the
// buyer, the season — arrives from the Brand Brain at call time.
//
// Two rules hold across all of them:
//
//   1. Report what you found, with an honest confidence, and let the reader
//      judge. This REPLACED "an empty answer is a correct answer" on
//      2026-09-12 — see the note above CLOSING. The old rule was written to
//      stop padding and instead produced four lenses that read 99 relevant
//      pages and reported nothing.
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

// ── THE INSTRUCTION THAT COST US EVERY FINDING ──
//
// This used to say: "Return an empty findings array if you found nothing worth
// reporting. That is a correct and common answer. Do not pad."
//
// It was obeyed, and it was catastrophic. On 2026-09-12 four of five lenses
// returned NOTHING while between them reading 99 pages from MEED, Construction
// Week, MEP Middle East, Arab News and half a dozen job boards. The searching
// was never the problem.
//
// Proven by A/B on the same week, same lens, same sources — only these lines
// changed:
//
//   before   0 findings, 37 sources read
//   after    3 findings, 20 sources read
//
// One of the three was a 300-key Waldorf Astoria conversion sitting in DESIGN
// phase: a live specification window, in the sources the whole time, thrown
// away by this instruction.
//
// The mistake was asking for a BINARY report/don't-report decision when the
// schema already has a confidence field. Anything under the model's internal
// bar became silence — and a reader can discount a 0.35, but cannot discount
// nothing. Silence is also indistinguishable from never having looked.
/**
 * Search the market's own language, not only English.
 *
 * ── WHY ──
 *
 * Fixing the instruction that made four lenses report nothing exposed what was
 * underneath it: all 99 pages they had read were in English. For Saudi Arabia
 * that is a ceiling rather than a preference. Tender portals, municipal
 * announcements, contract awards and much of the trade press publish in Arabic
 * first and in English late, partially, or never — so an English-only search
 * sees a market weeks after it moved, and sees the government half of it
 * barely at all. That government half is exactly where a specification
 * business finds work.
 *
 * Deliberately NOT a list of Saudi websites. Naming etimad.sa or a set of Gulf
 * trade publications would work for one brand and rot for every other, and it
 * would put a country into a file whose entire claim is that it names no
 * industry and no place. The language comes from the brand's own market, the
 * same way every other specific here does.
 */
function localLanguage(language) {
  if (!language) return ''
  return [
    '',
    `SEARCH IN ${language.toUpperCase()} AS WELL AS ENGLISH.`,
    `Run some of your searches with ${language} terms. Government, municipal and official`,
    'sources in this market publish there first and in English late, partially, or never —',
    'and those are the sources that carry tenders, awards, permits and policy. An',
    'English-only pass sees this market after it has already moved.',
    'Quote sources in their original language and say what they mean; do not silently',
    'translate a quote into something the page does not say.',
  ].join('\n')
}

/**
 * The standing questions a person asked the agent to keep watching.
 *
 * ── WHY THIS EXISTS ──
 *
 * `research_agenda` is described in AGENT.md §5b as the steering wheel: the
 * list of things a person wants watched, editable by them, in the place they
 * are already looking. It was not connected to anything that steers.
 *
 * The questions were loaded, and handed only to SYNTHESIS — which reads what
 * the lenses already found and has no search tool. So asking the agent to
 * "watch for tunnel-lighting tenders" could change how the week was written up
 * and could never change what was looked for. The one thing the feature is for
 * was the one thing it could not do.
 *
 * Now every searching lens receives them. Which lens should answer which
 * question is left to the lens rather than to a schema column, because the
 * alternative is asking a person to tag each question with a lens key — a
 * concept they have no reason to know about, and one more thing to get wrong.
 * The instruction below is explicit that ignoring the ones that do not fit is
 * the correct behaviour, so five lenses seeing a calendar question costs a few
 * tokens rather than five wasted searches.
 */
function standing(agenda = []) {
  const rows = (agenda || []).filter(a => a && a.subject)
  if (!rows.length) return ''
  return [
    '',
    'STANDING QUESTIONS — a person on this team asked you to keep watching these.',
    'If any of them fall inside the question YOU are being asked, they come first: spend',
    'your searches there before exploring generally, and say what you found even if the',
    'answer is "no change since last time". If none of them fit your question, ignore them',
    'entirely — another lens is asking something they do fit, and a forced answer is worse',
    'than no answer.',
    ...rows.slice(0, 10).map(a => `- ${a.subject}${a.why ? ` (why it matters: ${a.why})` : ''}`),
  ].join('\n')
}

/**
 * What the team already tracks, so a lens reports changes instead of repeats.
 *
 * Built by `knownIntelPrompt` in intel.js from the store. Passed in as text
 * rather than rows so this file stays free of the store's shape.
 */
function known(text) {
  return text ? ['', text] .join('\n') : ''
}

// ── LABELLING — added 2026-09-15 for the three-reader report ──
//
// The brief is read by marketing, sales and the technical team, and each needs
// a different slice. These fields are how a finding lands in the right slice
// and, when it carries a name, in the store that remembers it across weeks.
const LABELS = [
  '',
  'Label every finding:',
  '- relevance — how much it MATTERS, separate from how sure you are:',
  '    high    affects a live deal or tender, an event within 60 days, or is a direct competitor',
  '            move in the segments this brand sells into.',
  '    medium  useful context for the next one to three months.',
  '    low     background only. It is stored and left out of the report — so use it honestly',
  '            rather than inflating everything to medium.',
  '- competitor — the competitor\'s name exactly as listed, when the finding is about one. Empty',
  '  when it is about the market.',
  '- channel — where you actually saw it: website, linkedin, instagram, tiktok, x, youtube, news,',
  '  jobs, tender_portal, event_site, government, other.',
  '- category — project, partnership, product, pricing, hiring, expansion, content, event, award,',
  '  leadership, regulation, gigaproject, tech, tender, other.',
  '- for_whom "sales" when the thing to do is contact someone, bid, or get specified — a lead is not',
  '  a post idea, and filing it as marketing hides it from the people who work leads.',
  '- lead — fill it for any tender, project or named prospect: name (the project\'s or tender\'s OWN',
  '  name, the same every week, e.g. "Mondrian Riyadh" — never a sentence), type (tender | project |',
  '  lead), client, contractor, consultant, location, scope, stage, deadline (a real date or leave',
  '  it out), timing (open | closed | unconfirmed). Leave out a field you did not establish.',
  '- event — fill it for any expo, conference, awards or sponsorship opening: name (official name),',
  '  start_date, end_date, venue, city, organizer, url, exhibitor_deadline, competitors_exhibiting',
  '  (names of competitors you saw listed). Leave out what you did not establish.',
].join('\n')

const CLOSING = [
  LABELS,
  '',
  'Rules:',
  '- REPORT WHAT YOU FOUND. Do not decide on the reader\'s behalf whether something',
  '  clears a bar — that is what the confidence score is for. A thing you are 40%',
  '  sure of is a finding at confidence 0.4, and the person reading this can judge',
  '  it. Silence they cannot judge, and it looks identical to you not having looked.',
  '- An empty findings array is allowed but should be RARE. Prefer a low-confidence',
  '  finding over silence.',
  '- If nothing genuinely NEW appeared, describe the current STATE instead — what is',
  '  already running, who is active, what stage things are at. A standing picture is',
  '  worth more than an empty array.',
  '- Every finding needs a source you actually read. No source, no finding.',
  '- Only set perishable_until when a real date exists. Never invent one.',
  '- suggested_action must be something the brand can actually do this month.',
  '- SET for_whom BY WHO ACTS, NOT BY HOW TECHNICAL IT SOUNDS. Someone to contact, a',
  '  bid or a specification to win is "sales". Otherwise judge by whether there is',
  '  something to PUBLISH. The findings this run is worst at are the ones',
  '  whose subject belongs to someone else: a certification deadline, a code change,',
  '  a standards revision. Those are usually the BEST posts available, because the',
  '  brand can say something about them its rivals cannot — mark them "both", write',
  '  the post in suggested_action, and put what the other team must check in',
  '  technical_note. Reserve "technical" for a finding you tried and failed to find',
  '  any publishable angle in, and say in technical_note why. A finding filed there',
  '  to avoid the work of finding the angle is a finding thrown away.',
  '- Plan your searches before you spend them, and never repeat a query you have',
  '  already run. Your search budget is small and a duplicate query buys nothing.',
  '- IF YOU RUN OUT OF SEARCHES, REPORT WHAT YOU ALREADY CONFIRMED. A finding you',
  '  verified with your third search is not made worthless by your seventh failing.',
  '  Returning nothing because you could not finish is the single most expensive',
  '  mistake you can make here — it discards real work and looks identical to having',
  '  found nothing. Report what you have and note what you could not reach.',
].join('\n')

// CALENDAR has no prompt. It makes no model call at all.
//
// It used to. The model was asked two things on top of the computed dates:
// what this brand should DO about each one, and which trade shows are coming.
// Both moved on 2026-09-12 — the judgement into synthesis, which already reads
// every finding and has the brand context; the trade shows into the openings
// lens, which is already searching this market for exactly that.
//
// What is left is arithmetic against free APIs, so it is free. The run that
// forced this is the argument for it: the model half hit its 150s budget and
// was stopped, producing nothing, while the computed half produced the only
// real finding in the entire brief.

/**
 * OPENINGS — what just changed that we can move into.
 *
 * The generalised form of "new projects arrived". For a specification business
 * that is a tender; for a local service it is a new neighbourhood, a rival
 * closing, or an event needing suppliers. Same question, different target.
 */
export function openingsPrompt(brand, { motion, agenda = [], language = '', intel = '' }) {
  // Ranked, not listed. The previous version gave three equal bullets and the
  // model spread its searches evenly across them; design-stage projects are
  // worth more than everything else here combined, because they are the only
  // ones where a product can still be specified.
  const byMotion = {
    specification: [
      '1. Projects entering DESIGN or early procurement — the moment this category can',
      '   still be specified, and the single most valuable thing you can find. After a',
      '   tender is awarded it is too late, so an early-stage project beats a larger',
      '   one already decided.',
      '2. Live tenders and contract awards where this category is in scope — INCLUDING',
      '   ones you can only see as a listing on a tender portal.',
      '3. Consultants, contractors or developers newly active in this market. They carry',
      '   the specification decision across many projects at once.',
    ],
    local_service: [
      '1. New residential, retail or commercial developments completing in their area —',
      '   a concentration of their customer with no incumbent supplier.',
      '2. Events, openings or gatherings that create sudden demand for what they sell.',
      '3. Competitors closing, pausing, or visibly failing to serve an area.',
      '4. Partners with the same customer and a different service, worth approaching.',
    ],
    product: [
      '1. Retailers, marketplaces or stockists newly open to their category.',
      '2. Creators or communities newly discussing the category.',
      '3. Supply or regulatory changes that open or close a segment.',
    ],
  }

  return [
    who(brand),
    '',
    'One question: WHO IS ABOUT TO NEED WHAT THIS BRAND SELLS, and can we still reach them.',
    '',
    'Look for, in this order of value:',
    ...(byMotion[motion] || byMotion.local_service),
    '',
    // ── THE INSTRUCTION THIS LENS KEPT FAILING ON ──
    //
    // It used to open with "An opening is only useful if it is still open" and
    // require perishable_until to be the window's closing date. Combined with
    // CLOSING's "never invent a date", that made a VERIFIABLE DATE a
    // precondition for reporting anything at all.
    //
    // Which is fatal here specifically, because the dates in this lens are the
    // hardest thing in the whole system to verify: tender portals put the
    // deadline behind a login. On 2026-09-12 the lens read 63 sources —
    // tendersontime, globaltenders, tendersarabia, tenderimpulse's Saudi
    // lighting tenders, The Avenues Riyadh, 45 hotels in the pipeline — and
    // reported ZERO findings, with no error and no timeout. It found the work
    // and discarded it for want of a closing date.
    //
    // That is the calendar bug again, one lens over: a verification
    // requirement the model cannot satisfy makes it throw away what it already
    // established. The fix is the same shape — separate the thing from its
    // date, and let confidence carry the uncertainty.
    'HOW TO REPORT TIMING. Read this carefully; it is where this lens has gone wrong before.',
    '',
    'A project or tender you found IS a finding. Whether you could establish its dates is a',
    'SEPARATE question and never a reason to leave it out. Tender portals and project',
    'databases routinely put the detail behind a login, so the deadline is often simply',
    'unreachable — that is a fact about the source, not a reason to discard the project.',
    '',
    'Report one of three states, explicitly, in the detail:',
    '- OPEN — you established a date and it has not passed. Set perishable_until to it.',
    '- CLOSED — you established a date and it has passed. Say so in one line and say what to',
    '  watch instead. Knowing not to chase something is worth as much as knowing to chase it.',
    '- TIMING UNCONFIRMED — you found the project but could not reach the date. Report it,',
    '  say where you saw it and what the listing said, and lower the confidence. Do NOT set',
    '  perishable_until.',
    '',
    'TIMING UNCONFIRMED is a normal, expected and useful answer. A named project with an',
    'unknown deadline is something a salesperson can act on this week — they can call the',
    'consultant, or open the portal themselves. Silence is not actionable by anyone.',
    '',
    'Prefer the last few weeks, but older still counts when the work has not been awarded.',
    'Say how old it is and let the reader judge.',
    '',
    'SECOND, and only with whatever searches are left: the dated events this market runs on',
    '— trade shows and exhibitions this brand\'s buyers attend, and the procurement or budget',
    'cycles that decide when they can commit. Projects come FIRST. If you spend everything on',
    'projects and report no events at all, that is the correct trade and not a failure.',
    'For an event, also look for who is EXHIBITING — a competitor with a stand booked is a finding.',
    known(intel),
    standing(agenda),
    localLanguage(language),
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
export function demandPrompt(brand, { competitors = [], agenda = [], language = '' }) {
  return [
    who(brand),
    '',
    'Find out what the people who actually specify, approve and buy from this brand care',
    'about RIGHT NOW.',
    '',
    'Not the general public — the specific roles named above. For each, the useful question',
    'is what is making their job harder this quarter, and what they are being asked to',
    'deliver that they were not asked for last year.',
    '',
    'Look for:',
    '- What they are publicly asking, arguing about, or complaining about. Professional',
    '  forums, LinkedIn, industry press, association material, conference programmes.',
    '- The requirement that keeps appearing in briefs — the thing suppliers now have to',
    '  answer for that used to be optional.',
    '- The fear that stalls a decision: risk, lead time, compliance, after-sales support.',
    '- The words THEY use, which are rarely the words the industry uses.',
    '- Where they are losing time, since that is what a supplier can remove.',
    '',
    // Competitors are an input here, not the subject. The previous version of
    // this prompt made rival complaints the PRIMARY material, which quietly
    // made a buyer-understanding question depend on rivals being active — and
    // these rivals are SMEs who mostly are not.
    competitors.length
      ? [
          `If complaints about a specific supplier surface (${competitors.slice(0, 6).join(', ')}), they`,
          'are useful evidence of an unmet need — but they are one source among many here, not',
          'the point of the question. Do not go looking for them if the buyers themselves are',
          'telling you something more directly.',
        ].join('\n')
      : '',
    '',
    'A finding here should usually carry a suggested_action that is a piece of content: if',
    'buyers keep asking something, answering it publicly is the action.',
    standing(agenda),
    localLanguage(language),
    CLOSING,
  ].filter(Boolean).join('\n')
}

/**
 * CATEGORY — what is changing around us.
 *
 * New in the 2026-09-12 rebalance, and the clearest gap in the old set: nothing
 * asked what was happening to the CATEGORY. Five of six lenses were anchored to
 * competitors, which for a market of SMEs who post irregularly meant the honest
 * answer most weeks was "nothing moved" — not because the market was still, but
 * because we were only looking at the part of it that was.
 *
 * Standards, regulation and procurement policy move whether or not a rival
 * posts, and for a specification business they decide what can be sold at all.
 */
export function categoryPrompt(brand, { agenda = [], language = '', intel = '' } = {}) {
  // No `Market:` line: `who()` already carries geography, and it is now
  // resolved for every lens rather than only this one. Two lines saying the
  // same thing in one prompt is how a model starts weighting it twice.
  return [
    who(brand),
    '',
    'Find what is changing in this brand\'s INDUSTRY — not in their competitors, and not',
    'in their own accounts. The forces that apply to everyone selling this category.',
    '',
    'Look for:',
    '- Regulation, standards and codes: new requirements, tightening thresholds,',
    '  certification that is becoming mandatory, deadlines already announced.',
    '- Government and institutional programmes that change what buyers must specify —',
    '  national strategies, efficiency mandates, procurement rules.',
    '- Technology shifts that change what is possible or expected, and how fast the',
    '  market is actually adopting them rather than how fast vendors say it is.',
    '- Supply, pricing and lead-time conditions that affect whether a project can',
    '  proceed at all.',
    '- Which way demand in this category is moving, and on what evidence.',
    '',
    'The test for a finding here is: does this change what this brand should be SAYING or',
    'OFFERING in the next quarter? A trend that is real but changes nothing for them is',
    'not worth a line. A requirement arriving in eighteen months that they could own the',
    'conversation about now, is.',
    '',
    'Say plainly how established each one is. "Announced, with a date" and "being discussed',
    'in the trade press" are different things and should not read the same.',
    '',
    'Include giga-project and major-programme news when it changes what gets specified or bought:',
    'contracts awarded, phases announced, packages released. A named package with a contractor',
    'is also a lead — fill `lead` for it.',
    known(intel),
    standing(agenda),
    localLanguage(language),
    CLOSING,
  ].filter(Boolean).join('\n')
}

/**
 * COMPETITORS — what they are doing, across every channel, and what it means.
 *
 * Rewritten 2026-09-15. It used to lead with a board of follower counts and
 * posting cadence and ask what happened "beyond their posting". The team said
 * plainly they do not care about followers: they want to know what rivals are
 * DOING and how it affects us, built from "little little information from
 * here and there" combined into something useful.
 *
 * So the lens now gathers small, dated, sourced traces — each one a finding,
 * each one stored as a signal — and synthesis does the combining, across this
 * week and the weeks already in the store. A single job advert is trivia; a
 * job advert, a new brand on the website and a stand at Elenex in the same
 * month is a move.
 */
export function rivalsPrompt(brand, { competitors = [], board = [], agenda = [], language = '', intel = '' }) {
  // Posting activity only, never follower counts: what they posted ABOUT is a
  // trace of what they are doing; how many people follow them is not a move.
  const activity = board
    .filter(c => c.activity || (c.top_posts || []).length)
    .map(c => {
      const hooks = (c.top_posts || []).slice(0, 3).map(t => t.hook).filter(Boolean)
      return `- ${c.name}: ${c.activity || 'activity unknown'}${hooks.length ? `; recent posts: ${hooks.map(h => `"${h}"`).join(' / ')}` : ''}`
    }).join('\n')

  return [
    who(brand),
    competitors.length ? `Competitors to watch: ${competitors.slice(0, 12).join(', ')}` : '',
    '',
    'One question: WHAT ARE THESE COMPETITORS DOING, AND HOW DOES IT AFFECT US?',
    '',
    'Not follower counts and not posting frequency. Real activity leaves small public traces every',
    'week, on different channels. Collect those traces. Each one you can source is a finding on its',
    'own — one fact, one source, one date — even if it looks minor. The combining into a picture',
    'happens later, across weeks, so a small trace you report now is what makes next month\'s',
    'conclusion possible. Do not wait until you have a full story.',
    '',
    'Where to look, for each competitor (spread your searches across competitors and channels rather',
    'than spending them all on one):',
    '- Their WEBSITE: news, projects or references pages, new brands or product lines, new branches.',
    '- LINKEDIN: the company page\'s public posts (projects handed over, partnerships, awards,',
    '  events), and senior people joining or leaving. Use what search results and public pages',
    '  show; never anything behind a login.',
    '- JOB BOARDS: roles advertised (LinkedIn Jobs, Bayt, Indeed and similar). A KNX engineer, a',
    '  Jeddah sales manager or a tender specialist says where they are investing before they say it.',
    '- INSTAGRAM / TIKTOK / X / YOUTUBE: what their recent posts are ABOUT — a project reveal, a new',
    '  brand, a showroom, an offer. The subject of the post is the trace, not its likes.',
    '- TRADE PRESS and news: contracts won, projects completed, distribution agreements.',
    '- TENDER AWARDS and EXHIBITOR LISTS: a name on an award notice or a stand at an expo.',
    '- Pricing signals: public promotions, quoted rates in tender results.',
    '',
    'For every finding: set `competitor` to the name exactly as listed above, `channel` to where you',
    'saw it, and `category`. Put the "so what for us" in suggested_action — what our sales, marketing',
    'or technical team should do given this — and set for_whom to whoever acts.',
    '',
    activity ? ['What their Instagram shows this period (measured in code — a starting point, not a finding):', activity].join('\n') : '',
    '',
    'A competitor you could find nothing new about this week is normal — do not pad. But if you',
    'find a company acting like a competitor that is NOT on the list above, report it as a finding',
    'with competitor set to its name and say why it competes: that is how the watchlist grows.',
    known(intel),
    standing(agenda),
    localLanguage(language),
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
export function craftPrompt(brand, { platforms = [], agenda = [], language = '' }) {
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
    standing(agenda),
    localLanguage(language),
    CLOSING,
  ].join('\n')
}

export const LENS_PROMPTS = {
  // No `calendar` entry: that lens makes no model call any more. Its dates are
  // computed, the "what should we do about it" judgement moved to synthesis,
  // and its trade-show hunt moved into openings.
  openings: openingsPrompt,
  demand: demandPrompt,
  category: categoryPrompt,
  rivals: rivalsPrompt,
  craft: craftPrompt,
}
