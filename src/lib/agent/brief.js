// ─── The output contract ───────────────────────────────────────────────────
// RESEARCH-AGENT.md §8: "This is the part that matters. Everything above is
// machinery for producing this, and if this shape is wrong the machinery is
// wasted."
//
// The schema is enforced by the API through output_config.format rather than
// by parsing prose and hoping. That matters more here than in most places: a
// brief that fails to parse costs the whole investigation, and stage 0's
// numbers are the only thing standing between that and a wasted run.
//
// Pure — the schema, the prompts, and the merge. No network, no model.

/**
 * What the model is allowed to return from stage 4.
 *
 * Deliberately NOT the whole report shape. `competitor_board`, `movements`,
 * `period` and `baseline` are stage 0's, computed in code, and the model never
 * gets to restate them — if it could, it could get them wrong, and the numbers
 * are the one thing a reader will trust without checking.
 *
 * So the model writes only the parts that are genuinely judgement: what the
 * movements mean, what the market is doing, where our gap is, and what to do.
 */
export const BRIEF_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    // ── Nothing in this schema is optional ──
    // The API compiles a schema into a grammar and refuses one that is too
    // large. On 2026-09-15 this one was refused ("The compiled grammar is too
    // large") after the three-reader sections were added, and every optional
    // property multiplies the grammar far more than a required one does. So
    // every field is required — an empty string or an empty list is how the
    // model says "none" — and schemaLimits.test.js holds it at zero.
    required: [
      'headline', 'top_three', 'competitor_moves', 'market_direction', 'gaps',
      'proposed_rules', 'proposed_ideas', 'agenda_changes', 'new_competitors', 'unanswered',
    ],
    properties: {
      // ── The three-reader report, added 2026-09-15 ──
      // Marketing, sales and the technical team read this brief. `top_three`
      // is the only part most of them will read; `competitor_moves` is where
      // small signals from many channels and many weeks become one claim.
      top_three: {
        type: 'array',
        description:
          'The three things that most need doing this week, across ALL three teams, most important ' +
          'first. Fewer than three when fewer deserve it. Each is a finding plus the action — never ' +
          'a restated number. Only what is NEW or CHANGED this week: a lead the team already tracks, ' +
          'unchanged, is not a top item however large it is.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['finding', 'action', 'team', 'refs'],
          properties: {
            finding: { type: 'string', description: 'One sentence.' },
            action: { type: 'string', description: 'What to do, concretely, and by when if there is a date.' },
            team: { type: 'string', enum: ['marketing', 'sales', 'technical'] },
            refs: { type: 'array', items: { type: 'string' }, description: 'F- or S-refs this rests on.' },
          },
        },
      },
      competitor_moves: {
        type: 'array',
        description:
          'One entry per competitor that did something worth knowing. Combine the small signals — ' +
          'this week\'s findings (F-refs) AND the history already stored (S-refs) — into what they ' +
          'are actually doing. A job advert alone is trivia; a job advert, a new brand on the website ' +
          'and a stand at an expo in the same month is a move. Never a follower count. Omit a ' +
          'competitor with nothing new rather than writing "no change".',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['competitor', 'what_changed', 'picture', 'effect_on_us', 'relevance', 'refs'],
          properties: {
            competitor: { type: 'string', description: 'Exactly as on the watchlist.' },
            what_changed: { type: 'string', description: 'What is new THIS week, in one sentence.' },
            picture: {
              type: 'string',
              description: 'What the pieces add up to across weeks and channels. Say how many pieces and ' +
                'how firm the reading is — "three signals in a month" is not the same as "one post".',
            },
            effect_on_us: { type: 'string', description: 'How it affects us, and what we should do.' },
            relevance: { type: 'string', enum: ['high', 'medium', 'low'] },
            // No `teams` here: which teams a move concerns is derived in code
            // from the findings it cites, and the extra optional array was one
            // of the things that pushed this schema's compiled grammar over the
            // API's size limit on 2026-09-15.
            refs: { type: 'array', items: { type: 'string' }, description: 'Every F- and S-ref it combines.' },
          },
        },
      },
      new_competitors: {
        type: 'array',
        description:
          'Companies acting as competitors that are NOT on the watchlist, found in this week\'s ' +
          'findings. A person decides whether to add them. Empty when none surfaced.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'why', 'source_url'],
          properties: {
            name: { type: 'string' },
            why: { type: 'string', description: 'What they do that overlaps with us.' },
            source_url: { type: 'string', description: 'Where you saw them, or an empty string.' },
          },
        },
      },
      headline: {
        type: 'string',
        description:
          'One sentence: what actually changed this week. If nothing changed, say exactly that — ' +
          '"nothing moved this week" is a complete and correct headline, and manufacturing a ' +
          'finding to justify having run is the failure this whole report is designed to avoid.',
      },
      // ── Where the market is moving ──
      // The one section allowed to be a SYNTHESIS rather than a single cited
      // finding: it reads the board, the movements and the web findings
      // together and says what direction they point in. It exists because the
      // pieces that answer "what are rivals doing, and so what" were split
      // across three cards a screen apart — the per-rival reads at the bottom
      // of the board, the gaps in the middle, the ideas above them — and a
      // reader had to assemble the sentence themselves, every week.
      market_direction: {
        type: 'array',
        description:
          'At most three. Each statement names WHO is moving and WHAT they are doing — ' +
          '"rivals are getting more active" is not a direction; "Huda is buying physical ' +
          'presence: a 737 sqm showroom and three posts a week at 1.2/1k" is. Rests on the ' +
          'board, the movements and the market findings you already have; introduces no new ' +
          'claim. If the week points nowhere, return an empty array — a manufactured direction ' +
          'is worse than none, and "the board did not move" is a complete answer.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['movement', 'basis', 'so_what'],
          properties: {
            movement: { type: 'string', description: 'One sentence. Who is moving, and what they are doing.' },
            basis: {
              type: 'string',
              enum: ['instagram', 'web', 'our_analytics', 'calendar'],
              description: 'What this rests on. Instagram PROVES, web EXPLAINS — never blur them.',
            },
            so_what: { type: 'string', description: 'One clause: what it means for us. An empty string rather than padding.' },
          },
        },
      },
      // ── `competitor_reads` and `market` are no longer asked for ──
      // Both were removed on 2026-09-15 to bring the compiled grammar under the
      // API's size limit; with them in, synthesis was refused outright. Neither
      // is lost: a rival's one-line read is `competitor_moves[].what_changed`,
      // and `market` is assembled in code from the lens findings in mergeBrief —
      // which the synthesis only ever restated (all 7 items in the 14 Sep brief
      // were rewordings of a finding), and which carry their own sources.
      gaps: {
        type: 'array',
        description: 'The "so what for us". The highest-value section — what a person acts on.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'gap', 'basis', 'our_position', 'suggested_response'],
          properties: {
            // Referenced by proposed_ideas. Written by you, in the order you
            // write them, so an idea can say which gap it executes rather than
            // leaving a reader to match two paragraphs by eye.
            id: { type: 'string', description: 'G1, G2, G3 — in the order you write them.' },
            gap: { type: 'string' },
            basis: { type: 'string', enum: ['instagram', 'web', 'our_analytics'] },
            our_position: { type: 'string', description: 'What we actually did, with the number.' },
            suggested_response: { type: 'string' },
          },
        },
      },
      proposed_rules: {
        type: 'array',
        description:
          'At most 4, fewer is better, none at all is correct when the research supports nothing ' +
          'specific. A rule steers every future caption this brand generates, FOREVER — there is ' +
          'no expiry and nothing reviews it again. So a rule must be true in six months: a way of ' +
          'framing things, a claim to make, a thing to avoid. NEVER a dated instruction. ' +
          '"Tie project posts to energy-efficiency outcomes" is a rule. "Create content for INDEX ' +
          'Saudi Arabia 2026 (Sept 15-17)" is NOT — it is an idea, it goes in proposed_ideas, and ' +
          'as a rule it would still be instructing the planner about that trade show next year.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rule', 'detail', 'scope', 'sources', 'confidence'],
          properties: {
            rule: { type: 'string', description: 'One imperative sentence.' },
            detail: { type: 'string', description: 'What supports this, and how strong that evidence is.' },
            scope: { type: 'string', enum: ['global', 'plan', 'timing', 'caption', 'image', 'competitor', 'trend'] },
            sources: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number' },
          },
        },
      },
      proposed_ideas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'angle', 'rationale', 'answers', 'suggested_format'],
          properties: {
            title: { type: 'string' },
            angle: { type: 'string' },
            rationale: { type: 'string', description: 'Which finding this answers, in prose.' },
            // The same link as `rationale`, but as a reference rather than as
            // prose, so the page can render the idea UNDER the thing it
            // answers instead of in a separate card. Prose alone meant the
            // connection existed only in a reader's memory.
            answers: {
              type: 'string',
              description:
                'The id of one of your gaps ("G2"), or the ref of one of the findings you were ' +
                'given ("F3"). Empty string only when it genuinely answers neither — an idea ' +
                'with nothing behind it is one the research did not earn.',
            },
            suggested_format: { type: 'string' },
          },
        },
      },
      agenda_changes: {
        type: 'array',
        description: 'Questions worth adding to the standing agenda, or retiring from it.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'subject', 'why'],
          properties: {
            action: { type: 'string', enum: ['add', 'retire'] },
            subject: { type: 'string' },
            why: { type: 'string' },
          },
        },
      },
      unanswered: {
        type: 'array',
        description: 'Agenda questions this run could not answer, and why. Never leave this empty to look thorough.',
        items: { type: 'string' },
      },
    },
  },
}

// ─── Prompts ───────────────────────────────────────────────────────────────
// Written as functions of the run's data rather than as constants, but note
// what is NOT in them: no timestamp, no run id. Those would sit in the
// volatile tail anyway, but a prompt builder is exactly where one gets added
// without thinking, and prompt caching fails silently when it happens.

export function planPrompt({ report, agenda, priorHeadlines }) {
  const board = (report?.competitor_board || [])
    .map(c => `- ${c.name} (@${c.handle}, ${c.data}): ${c.followers ?? '?'} followers, ` +
      `${c.posts_per_week ?? '?'}/wk (was ${c.posts_per_week_prev ?? '?'}), ` +
      `engagement/1k ${c.engagement_per_1k ?? 'unknown'}, n=${c.sample_size ?? 0}`)
    .join('\n') || '(no competitor could be measured)'

  const moves = (report?.movements || [])
    .map(m => `- ${m.what}: ${m.from} → ${m.to} ${m.unit} (${m.change_pct}%, ${m.significance})`)
    .join('\n') || '(nothing moved measurably)'

  return [
    'These are this week\'s MEASURED numbers. They are computed in code and are given facts —',
    'do not recompute them, do not estimate around them, and do not contradict them.',
    '',
    'COMPETITOR BOARD',
    board,
    '',
    'MOVEMENTS',
    moves,
    '',
    'STANDING QUESTIONS a person has asked you to keep watching:',
    (agenda || []).map(a => `- ${a.subject}${a.why ? ` — ${a.why}` : ''}`).join('\n') || '(none)',
    '',
    'PREVIOUS RUNS:',
    (priorHeadlines || []).map(h => `- ${h}`).join('\n') || '(this is the first run)',
    '',
    'Decide what is worth investigating on the open web this week. Be specific and be few:',
    'name at most three questions that the numbers above actually raise, and say for each what',
    'would answer it. If the numbers raise nothing — a quiet week is a real outcome — say so',
    'and propose nothing. Do not invent a question to look busy.',
  ].join('\n')
}

export function searchPrompt(plan) {
  return [
    'Investigate the questions below using web search. You have a hard cap on searches, so',
    'spend them on the questions that matter rather than on confirming what you already know.',
    '',
    plan,
    '',
    'Rules:',
    '- Instagram findings PROVE. Web findings EXPLAIN. Never let a web article override a',
    '  measured number.',
    '- Record the URL for anything you intend to claim. A claim you cannot cite will be dropped.',
    '- If you cannot find anything on a question, that is a result. Say so.',
  ].join('\n')
}

export const REFLECT_PROMPT = [
  'What is still unanswered, and is any of it worth one more round of searching?',
  '',
  'Answer in two short parts:',
  '1. What you now know, with the sources.',
  '2. What you could not establish — and whether one more search would actually close it,',
  '   or whether it is simply not on the public web.',
  '',
  'Be honest about the second. Most weeks the answer is that it is not findable, and saying',
  'so is more useful than another round of searching that finds nothing.',
].join('\n')

export const SYNTHESISE_PROMPT = [
  'Write the brief.',
  '',
  'THREE TEAMS READ THIS, AND EACH NEEDS SOMETHING DIFFERENT.',
  '  Marketing  how to position us and what to publish.',
  '  Sales      leads, tenders, projects and events to act on — someone to call, a bid to decide.',
  '  Technical  products, standards and technologies competitors are pushing.',
  '`top_three` is written for all three at once and is the only part many will read. Put the',
  'single most consequential item first whichever team owns it. A tender deadline this week can',
  'outrank the best post idea of the month.',
  '',
  'ONLY WHAT IS NEW OR CHANGED. Findings carry a `store` verdict computed against what the team',
  'already tracks: "seen" means it was already known and nothing moved, "changed" names what moved.',
  'A seen finding is context, never a top item and never a headline. A changed one leads with the',
  'change ("Mondrian Riyadh now has a contractor"), not with the project.',
  '',
  'COMBINE THE SMALL PIECES. The competitor history below is signals already stored from earlier',
  'weeks, each with an S-ref. This week\'s findings have F-refs. `competitor_moves` is where you',
  'put them together: several small, sourced traces on different channels pointing the same way',
  'are worth more than any one of them, and saying how many pieces a reading rests on is what lets',
  'a reader trust it. Do not invent a pattern from one piece — say it is one piece.',
  'Followers and posting frequency are never a competitor move.',
  '',
  'EVENTS ARE FOR SALES AS MUCH AS MARKETING. An exhibitor deadline closing this month, or a buyers\'',
  'expo where every exhibitor is a prospect, can be a top item. A recent event is worth a line in',
  'competitor_moves when a competitor showed something there.',
  '',
  'Findings marked relevance "low" are stored, not reported: do not put them in top_three, gaps,',
  'ideas or competitor_moves.',
  '',
  // Every competitor move in the 15 Sep report was rated Medium, including one
  // the same paragraph called "confirmation of current state, not momentum".
  // Relevance stopped discriminating because it was carrying two questions.
  'RELEVANCE IS HOW MUCH IT MATTERS, NOT HOW NEW IT IS.',
  'A standing fact about a serious rival — a capability they have had for a year, a page that has',
  'not changed — can be HIGH relevance and is still not news; whether it moved this week is read in',
  'code from the store and reported separately. So do not discount something because it is old, and',
  'do not inflate something to medium because it is recent. If every move you write is medium, you',
  'have not used the scale.',
  '',
  'The competitor board, the movements, our own per-platform performance and the period are',
  'already computed and will be attached to your output — do not restate them, and do not',
  'contradict them.',
  '',
  'What you write is the judgement: what the movements MEAN, what the market is doing, where',
  'our gap is, and what a person should do about it.',
  '',
  // ── THE THREE-WAY CONTRADICTION OF 15 SEP ──
  // One report said our Instagram went "from 4 to 7 posts a week" in its Top 3,
  // "5 posts" in the social table, and "7 posts/week" in the limitations. Each
  // number came from a different instrument and the model was never told they
  // were different instruments, so it treated them as one and picked whichever
  // suited the sentence. Both figures now arrive labelled, with the reason they
  // differ written out, and the only remaining failure would be writing a
  // fourth.
  'THE NUMBERS FOR OUR OWN CHANNELS ARE GIVEN TO YOU. DO NOT PRODUCE A DIFFERENT ONE.',
  '`our_channels` below carries, per platform, how many posts WE published, how many are on the',
  'account itself, how many could be measured, and the average engagement of those. Where the two',
  'post counts differ, the note says why — the account number counts everything on the profile,',
  'ours counts what we can measure. Quote a number only in the form it is given, name which of the',
  'two you mean, and never average, round or re-derive them. If a sentence needs a figure that is',
  'not in that block, the sentence is wrong.',
  '',
  'AND DO NOT COMPARE TWO THINGS MEASURED DIFFERENTLY.',
  'Interactions per post, page impressions, clicks and follower gains are four different units. A',
  'recommendation to shift weight between channels has to compare like with like or say plainly',
  'that it is directional: "LinkedIn reached 2,300 members while Instagram averaged 0.67',
  'interactions across 3 measured posts — these are different measurements, so this is a direction,',
  'not a result" is honest. Presenting them as one league table is not. Any conclusion resting on',
  'fewer than five measured posts says so in the same sentence, not in a footnote.',
  '',
  'SEARCH FINDINGS ARE MEASUREMENTS, AND THEIR CLICK COUNTS ARE USUALLY TOO THIN TO NARRATE.',
  'Findings from the `search` lens come from Google Search Console — what people typed on the way',
  'to our own site. They are measured, so quote them exactly and never re-derive one. But at this',
  'site\'s volume a click count is noise: a query going from three clicks to six is two people, not',
  'a doubling, and a report that calls it a trend every week is wrong every week. Work in',
  'IMPRESSIONS, QUERY TEXT and POSITION, which are stable at low volume. "We appeared 400 times for',
  'this search at position 14 and were not chosen" needs no clicks at all to be true and is the',
  'most actionable thing in the section. If a search finding says the clicks are too thin to read,',
  'that sentence is the finding — do not replace it with a percentage.',
  '',
  'EVERY FACT ABOUT THIS BRAND COMES FROM THE BRAND BLOCK OR A FINDING. DO NOT DERIVE ONE.',
  'Do not compute an age, an anniversary, a length of trading or a market share from a founding',
  'year or any other figure — a "45-year Saudi house" computed from a 1976 founding is wrong by',
  'five years and contradicts the brand\'s own line, and a reader who catches one derived number',
  'stops trusting the measured ones.',
  '',
  'OUR CHANNELS AND THEIRS ARE NOT MEASURED THE SAME WAY, AND YOU MUST NOT BLUR THEM.',
  'Our own numbers cover every platform we publish to — Instagram, TikTok and LinkedIn — because',
  'we published those posts and the platform reports back on them. A COMPETITOR can only be',
  'measured on Instagram: business_discovery is the only public endpoint of its kind, and no',
  'equivalent exists for TikTok or LinkedIn at any price. So:',
  '- "Our TikTok engagement fell 30%" is a measured fact. Say it plainly.',
  '- "Rivals are winning on TikTok" is NOT measurable here. If you believe it, it must rest on',
  '  web sources like any other market claim, and it must be labelled as that — never implied',
  '  to be a number.',
  'A reader who cannot tell which of those two they are looking at will trust the wrong one.',
  '',
  'SOME FINDINGS ARE NOT MARKETING\'S TO ACT ON, AND THEY CARRY A LABEL SAYING SO.',
  'Each finding has a `for_whom`. Read it before you use the finding:',
  '- "marketing" and "both" are yours. A "both" finding is FULLY yours — it happens to also',
  '  concern the product or technical team, and its technical_note is for them, but the',
  '  publishable angle is the reason it is in front of you. Treat it exactly like any other',
  '  finding: it can carry the headline, it can drive a gap, it can become an idea.',
  '- "technical" is not yours. It reached the report because it is true and somebody in the',
  '  building needs it, not because there is anything to publish. NEVER let one of these be',
  '  the headline, a gap, or an idea. A brief whose lead story is a certification deadline',
  '  the marketing team can do nothing about has wasted the one sentence a reader reads.',
  'If a finding is labelled "technical" but you can see a real publishable angle in it, say',
  'so in `gaps` and write the angle. The label is the lens\'s judgement, not a lock.',
  '',
  'THE STANDING QUESTIONS ARE A PROMISE.',
  'If a person asked you to watch something, every brief owes them an answer — including',
  '"nothing changed", which is an answer, and "I could not find out", which is a different',
  'one. Any standing question this run did not answer goes in `unanswered`, named. A watch',
  'list that silently stops being watched is worse than no watch list, because they think',
  'it is covered.',
  '',
  'THE DATED FINDINGS ARE YOURS TO JUDGE.',
  'Findings from the calendar lens are computed, not researched — the date is certain and',
  'needs no source. But their suggested_action is a PLACEHOLDER written by code that knows',
  'nothing about this brand, and you are the only step that has both the date and the brand',
  'in front of it. Replace it.',
  'Everyone has the same calendar, so the date itself is never the finding. The finding is',
  'what THIS brand — selling this thing, to these buyers, in this market — should publish or',
  'offer in the weeks before it, and why that beats what they would have posted anyway. Tie',
  'it to something only they have: a project they delivered, a capability nobody else has, a',
  'number from their own history.',
  'If a date genuinely does not matter to this brand, say so in one line and move on. Many',
  'will not matter. A date carrying a generic "post about it" is worth less than no finding,',
  'and manufacturing a reason to care is the failure mode here.',
  '',
  'WHERE THE MARKET IS MOVING, AND WHAT WE DO ABOUT IT, ARE ONE THOUGHT.',
  'A reader arrives with one question — "what should we do?" — and the honest answer has two',
  'halves that only mean something together: where the market is going, and what that costs or',
  'offers us. Write them as one chain:',
  '  market_direction  the direction of travel. Who is moving and what they are doing, from the',
  '                    board, the movements and what you read. At most three. No new claims —',
  '                    this is a synthesis of evidence you already have, not another finding.',
  '  gaps              where that direction and our own position do not line up.',
  '  proposed_ideas    the content that closes a gap, each one pointing at the gap or finding it',
  '                    answers via `answers`.',
  'Every idea carries an `answers` reference — "G2" for one of your own gaps, or "F3" for one of',
  'the findings you were given above. The page renders the idea underneath the thing it answers,',
  'so a wrong reference files it under the wrong finding and an empty one leaves it orphaned at',
  'the bottom. If an idea answers nothing on this list, that is a reason to reconsider proposing',
  'it, not a reason to invent a reference.',
  '',
  'A RULE IS FOREVER. AN IDEA IS FOR THIS WEEK. DO NOT CONFUSE THEM.',
  'An approved rule is appended to the brand context of every future generation until a person',
  'deletes it by hand. There is no expiry and nothing reviews it a second time. So before you',
  'propose one, ask whether it is still true and still worth following in six months.',
  '  A rule:  a way of framing things, a claim worth making, a thing to avoid, a contrast to draw.',
  '  NOT a rule: anything with a date, a deadline, a season or a named event in it. That is an',
  '              IDEA — put it in proposed_ideas, where it is read next to the finding that',
  '              produced it and expires with this brief.',
  'A dated item proposed as a rule is not a small mistake: it either gets approved and keeps',
  'instructing the planner about an event that has passed, or it sits in a review queue with no',
  'clock on it until the window closes. Both have happened.',
  '',
  'WHAT YOU COULD NOT COVER IS PART OF THE REPORT.',
  'The watchlist is given to you below. If a competitor on it produced no finding this run, name it',
  'in `unanswered` — "Technolight was not reached this run" is a fact a reader needs, and its silent',
  'absence reads as "nothing is happening there", which is a claim nobody made. The same goes for a',
  'lens that read sources and reported nothing.',
  '',
  'Hard rules:',
  '- Between two and four marketing recommendations. Each is a gap with the content that closes it;',
  '  a fifth proposal dilutes the four that matter, and an unnumbered one at the bottom is read last',
  '  however time-critical it is.',
  '- Every claim rests on a finding or a stored signal you were given, named by its ref. No ref, no claim.',
  '- Say when a sample is too small to carry a conclusion. "n=3" is a fact, not a hedge.',
  '- "Nothing moved this week" is a complete headline. Do not manufacture a finding to',
  '  justify having run — the weeks where something did happen only mean anything if the',
  '  quiet ones were reported honestly.',
  '- Propose at most four rules, and none at all if nothing supports one. A rule steers every',
  '  future caption this brand generates.',
].join('\n')

// ─── A rule with a date on it is not a rule ────────────────────────────────
// `brand_memory` has no expiry column. An approved rule is appended to the
// Learned Guidance block of every matching generation until a person retires
// it by hand — so "create content tied to INDEX Saudi Arabia 2026 (Sept 15-17)"
// approved once keeps instructing the planner about a trade show that ended,
// in November, in March, forever. That proposal sat in the review queue from
// 17 Aug to the day before the event, which is the other half of the problem:
// nothing about a rule communicates that it is perishable, because rules are
// not supposed to be.
//
// The dated thing belongs in `proposed_ideas`, which is read beside the
// finding that produced it and dies with the brief.
//
// Deliberately a WARNING rather than a filter. A durable rule can legitimately
// name a year — "reference SASO 2663:2025 compliance in technical posts" is a
// standing instruction that happens to contain 2025 — and silently dropping
// that would be a worse failure than showing a caution nobody needed. The
// person approving is already the gate; this gives them the one fact they
// cannot see from the sentence.

const MONTH =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?' +
  '|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'

/**
 * Does this rule name a moment in time?
 *
 * @param {string} rule the rule sentence itself — never the detail, which is
 *   evidence and is expected to carry dates.
 * @returns {boolean}
 */
export function datedRule(rule) {
  const t = ` ${String(rule || '')} `
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(t)) return true
  if (new RegExp(`\\b\\d{1,2}\\s*(?:st|nd|rd|th)?\\s+${MONTH}\\b`, 'i').test(t)) return true
  if (new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}\\b`, 'i').test(t)) return true
  // A standalone year. Not one inside a standard's designation — SASO
  // 2663:2025 is a document number, not a deadline, and the colon is what
  // separates the two cases in every example this app has seen.
  if (/(?<![:\-\d])\b20[2-9]\d\b/.test(t)) return true
  return false
}

// ─── References ────────────────────────────────────────────────────────────
// Two things in a brief point at other things in the same brief: an idea says
// which gap or finding it executes. Before this the pointer was a sentence of
// prose and the reader did the matching, which in practice meant they did not.
//
// Refs are assigned in CODE, never by the model. A model asked to invent stable
// ids across a 16k-token response will occasionally reuse one, and a duplicate
// id silently files two ideas under the wrong finding.

/** Stamp F1…Fn onto the findings, in the order the synthesis will see them. */
export function withRefs(findings = []) {
  return findings.map((f, i) => ({ ...f, ref: `F${i + 1}` }))
}

/**
 * Re-stamp gap ids as G1…Gn.
 *
 * The model is asked for these so it can point its ideas at them, but what it
 * writes is a suggestion: a missing id, a duplicate, or "Gap 2" instead of
 * "G2" would all break the binding silently. The model's own value is kept as
 * `claimed_id` so a pointer written against it can still be resolved.
 */
export function withGapIds(gaps = []) {
  return gaps.map((g, i) => ({ ...g, id: `G${i + 1}`, claimed_id: String(g.id || '').trim() }))
}

const normRef = v => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Resolve each idea's `answers` pointer against the gaps and findings it could
 * be pointing at.
 *
 * An unresolvable pointer is DROPPED rather than rendered: a chip reading
 * "because: G4" when there is no G4 is worse than no chip, and the idea's
 * `rationale` already says the same thing in prose. Nothing is lost.
 */
export function bindIdeas(ideas = [], gaps = [], findings = []) {
  const byGap = new Map()
  for (const g of gaps) {
    byGap.set(normRef(g.id), g.id)
    if (g.claimed_id) byGap.set(normRef(g.claimed_id), g.id)
  }
  const byFinding = new Map(findings.map(f => [normRef(f.ref), f]))

  return ideas.map(idea => {
    const ref = normRef(idea.answers)
    if (!ref) return { ...idea, answers_ref: null }
    if (byGap.has(ref)) {
      return { ...idea, answers_ref: { kind: 'gap', id: byGap.get(ref) } }
    }
    const f = byFinding.get(ref)
    if (f) {
      return { ...idea, answers_ref: { kind: 'finding', ref: f.ref, headline: f.headline || '' } }
    }
    return { ...idea, answers_ref: null }
  })
}

// ─── Merging the model's half onto the measured half ───────────────────────

/**
 * Fold the model's brief into stage 0's report.
 *
 * The measured fields win, always and without exception. The model cannot
 * overwrite the board, the movements, the period or the baseline flag, because
 * those are the numbers a reader trusts without checking — and a model that
 * restates them is a model that can get them wrong.
 *
 * `sources` on every claim are filtered against `allowedUrls` by the caller
 * before this runs. Here the asymmetry from loop.js is applied: a market
 * finding that lost all its sources is KEPT and flagged `uncited`, because a
 * person can still judge it; a proposed RULE that lost all its sources is
 * DROPPED, because a rule steers generation and nobody reviews it again.
 */
/**
 * The market trends in a set of lens findings: what searched lenses found about
 * the market itself — not a competitor, a lead, an event, or our own numbers,
 * which each have their own section — and not what was rated low relevance.
 */
export function marketFromFindings(findings = []) {
  return (findings || [])
    .filter(f => f && !['calendar', 'ourselves'].includes(f.lens) && f.relevance !== 'low' &&
      !String(f.competitor || '').trim() && !f.lead && !f.event && String(f.headline || '').trim())
    .map(f => ({
      finding: f.headline,
      sources: f.sources || [],
      confidence: f.confidence ?? null,
      novelty: f.novelty || 'new',
      ref: f.ref || '',
    }))
}

export function mergeBrief(gathered, brief, allowedUrls, findings = []) {
  const allow = allowedUrls instanceof Set ? allowedUrls : new Set(allowedUrls || [])
  const keep = s => allow.has(typeof s === 'string' ? s : s?.url)

  // Market trends, assembled from the lens findings rather than written by
  // the model (see the note in BRIEF_SCHEMA). The same citation rule applies:
  // a source nobody actually read is removed, and a trend left with none is
  // kept and flagged rather than hidden.
  const market = marketFromFindings(findings).map(m => {
    const sources = (m.sources || []).filter(keep)
    return { ...m, sources, uncited: sources.length === 0 }
  })

  const proposedRules = (brief?.proposed_rules || [])
    .map(r => ({ ...r, sources: (r.sources || []).filter(keep), dated: datedRule(r.rule) }))
    // Silently dropped, not flagged. This is the strict side of the asymmetry.
    .filter(r => r.sources.length > 0)

  // Stamped before the ideas are bound, because the binding resolves against
  // these ids rather than against whatever the model wrote.
  const gaps = withGapIds(brief?.gaps || [])

  const readByName = new Map(
    (brief?.competitor_moves || []).map(m => [String(m.competitor || '').toLowerCase(), m.what_changed || '']),
  )

  return {
    ...gathered,
    // The model's headline replaces stage 0's placeholder, but only if it
    // wrote one — a failed synthesis leaves the measured headline standing.
    headline: brief?.headline || gathered.headline,
    top_three: (brief?.top_three || []).slice(0, 3),
    competitor_moves: (brief?.competitor_moves || []).filter(m => m?.competitor && m.relevance !== 'low'),
    new_competitors: (brief?.new_competitors || []).filter(c => String(c?.name || '').trim()),
    competitor_board: (gathered.competitor_board || []).map(c => ({
      ...c,
      read: readByName.get(String(c.name || '').toLowerCase()) || '',
    })),
    market,
    market_direction: brief?.market_direction || [],
    gaps,
    proposed_rules: proposedRules,
    proposed_ideas: bindIdeas(brief?.proposed_ideas || [], gaps, findings),
    agenda_changes: brief?.agenda_changes || [],
    unanswered: [...(gathered.unanswered || []), ...(brief?.unanswered || [])],
    rules_dropped_uncited:
      (brief?.proposed_rules || []).length - proposedRules.length,
    stage_reached: 'synthesise',
  }
}
