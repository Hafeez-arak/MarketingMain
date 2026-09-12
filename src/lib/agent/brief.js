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
    required: ['headline', 'market', 'gaps', 'proposed_rules', 'proposed_ideas', 'agenda_changes', 'unanswered'],
    properties: {
      headline: {
        type: 'string',
        description:
          'One sentence: what actually changed this week. If nothing changed, say exactly that — ' +
          '"nothing moved this week" is a complete and correct headline, and manufacturing a ' +
          'finding to justify having run is the failure this whole report is designed to avoid.',
      },
      // Per-competitor reading. Keyed by name so it merges onto the board that
      // stage 0 already computed, rather than replacing it.
      competitor_reads: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'read'],
          properties: {
            name: { type: 'string', description: 'Exactly as it appears on the board.' },
            read: { type: 'string', description: 'What they appear to be doing, in one sentence.' },
          },
        },
      },
      market: {
        type: 'array',
        description: 'Trends and explanations. EVERY item must carry sources you actually read.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['finding', 'sources', 'confidence', 'novelty'],
          properties: {
            finding: { type: 'string' },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['url'],
                properties: {
                  url: { type: 'string' },
                  title: { type: 'string' },
                  quote: { type: 'string', description: 'The sentence that actually supports this.' },
                },
              },
            },
            confidence: { type: 'number', description: '0 to 1.' },
            novelty: { type: 'string', enum: ['new', 'continuing', 'changed', 'resolved'] },
          },
        },
      },
      gaps: {
        type: 'array',
        description: 'The "so what for us". The highest-value section — what a person acts on.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['gap', 'basis', 'our_position', 'suggested_response'],
          properties: {
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
          'specific. A rule steers every future caption this brand generates.',
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
          required: ['title', 'rationale'],
          properties: {
            title: { type: 'string' },
            angle: { type: 'string' },
            rationale: { type: 'string', description: 'Which finding this answers.' },
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
  'The competitor board, the movements and the period are already computed and will be attached',
  'to your output — do not restate them, and do not contradict them.',
  '',
  'What you write is the judgement: what the movements MEAN, what the market is doing, where',
  'our gap is, and what a person should do about it.',
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
  'Hard rules:',
  '- Every market finding carries the sources you actually read. No source, no finding.',
  '- Say when a sample is too small to carry a conclusion. "n=3" is a fact, not a hedge.',
  '- "Nothing moved this week" is a complete headline. Do not manufacture a finding to',
  '  justify having run — the weeks where something did happen only mean anything if the',
  '  quiet ones were reported honestly.',
  '- Propose at most four rules, and none at all if nothing supports one. A rule steers every',
  '  future caption this brand generates.',
].join('\n')

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
export function mergeBrief(gathered, brief, allowedUrls) {
  const allow = allowedUrls instanceof Set ? allowedUrls : new Set(allowedUrls || [])
  const keep = s => allow.has(typeof s === 'string' ? s : s?.url)

  const market = (brief?.market || []).map(m => {
    const sources = (m.sources || []).filter(keep)
    return { ...m, sources, uncited: sources.length === 0 }
  })

  const proposedRules = (brief?.proposed_rules || [])
    .map(r => ({ ...r, sources: (r.sources || []).filter(keep) }))
    // Silently dropped, not flagged. This is the strict side of the asymmetry.
    .filter(r => r.sources.length > 0)

  const readByName = new Map(
    (brief?.competitor_reads || []).map(r => [String(r.name || '').toLowerCase(), r.read]),
  )

  return {
    ...gathered,
    // The model's headline replaces stage 0's placeholder, but only if it
    // wrote one — a failed synthesis leaves the measured headline standing.
    headline: brief?.headline || gathered.headline,
    competitor_board: (gathered.competitor_board || []).map(c => ({
      ...c,
      read: readByName.get(String(c.name || '').toLowerCase()) || '',
    })),
    market,
    gaps: brief?.gaps || [],
    proposed_rules: proposedRules,
    proposed_ideas: brief?.proposed_ideas || [],
    agenda_changes: brief?.agenda_changes || [],
    unanswered: [...(gathered.unanswered || []), ...(brief?.unanswered || [])],
    rules_dropped_uncited:
      (brief?.proposed_rules || []).length - proposedRules.length,
    stage_reached: 'synthesise',
  }
}
