import { describe, it, expect } from 'vitest'
import { BRIEF_SCHEMA, mergeBrief, planPrompt, withRefs, withGapIds, bindIdeas, datedRule, briefEmptiness, SYNTHESISE_PROMPT } from './brief'
import { volatileFragment, buildRequest } from './prompt'
import { stripRefs, cleanBriefProse } from './refs'
import { readableReport } from '../researchBrief'

const gathered = {
  headline: 'Nothing moved measurably this week.',
  baseline: false,
  quiet_week: true,
  period: { start: '2026-09-01', end: '2026-09-08', days: 7 },
  movements: [],
  competitor_board: [
    { name: 'Technolight', handle: 'technolight', data: 'instagram', followers: 9000, engagement_per_1k: 4 },
  ],
  unanswered: ['Could not read Alnasser (@alnasser): not found'],
  stage_reached: 'gather',
}

describe('the model never gets to restate the numbers', () => {
  it('the schema has no field for the board, movements or period', () => {
    // These are computed in code and are the numbers a reader trusts without
    // checking. A model that can restate them is a model that can get them
    // wrong, so the contract simply does not offer the field.
    const props = Object.keys(BRIEF_SCHEMA.schema.properties)
    expect(props).not.toContain('competitor_board')
    expect(props).not.toContain('movements')
    expect(props).not.toContain('period')
    expect(props).not.toContain('baseline')
  })

  it('the merge keeps the measured fields even if the model sent its own', () => {
    const merged = mergeBrief(gathered, {
      headline: 'Technolight doubled down on video.',
      // A model ignoring the schema and sending these anyway must not win.
      movements: [{ what: 'invented' }],
      competitor_board: [{ name: 'Fabricated', followers: 999999 }],
      period: { start: 'wrong' },
    }, new Set())
    expect(merged.movements).toEqual([])
    expect(merged.competitor_board).toHaveLength(1)
    expect(merged.competitor_board[0].name).toBe('Technolight')
    expect(merged.period).toEqual(gathered.period)
    expect(merged.baseline).toBe(false)
  })

  it('a per-competitor read is merged onto the measured card, not over it', () => {
    // The read now comes from competitor_moves; competitor_reads was dropped
    // from the schema to keep the grammar under the API limit.
    const merged = mergeBrief(gathered, {
      headline: 'x',
      competitor_moves: [{ competitor: 'Technolight', what_changed: 'Pushing tunnel lighting.', picture: '', effect_on_us: '', relevance: 'medium', refs: [] }],
    }, new Set())
    expect(merged.competitor_board[0]).toMatchObject({
      name: 'Technolight', followers: 9000, read: 'Pushing tunnel lighting.',
    })
  })

  it('a failed synthesis leaves the measured headline standing', () => {
    const merged = mergeBrief(gathered, { headline: '' }, new Set())
    expect(merged.headline).toBe('Nothing moved measurably this week.')
  })
})

describe('citations are checked, and the asymmetry is deliberate', () => {
  const allowed = new Set(['https://real.example/a'])
  // Market trends are assembled from lens findings now, so the citation rule
  // is exercised on the findings handed to mergeBrief.
  const findings = [
    { lens: 'category', ref: 'F1', headline: 'cited', sources: [{ url: 'https://real.example/a' }], confidence: 0.7, novelty: 'new' },
    { lens: 'category', ref: 'F2', headline: 'invented', sources: [{ url: 'https://fake.example/b' }], confidence: 0.9, novelty: 'new' },
    { lens: 'rivals', ref: 'F3', headline: 'about a rival', competitor: 'Technolight', sources: [{ url: 'https://real.example/a' }] },
    { lens: 'category', ref: 'F4', headline: 'background', relevance: 'low', sources: [{ url: 'https://real.example/a' }] },
  ]
  const brief = {
    headline: 'x',
    proposed_rules: [
      { rule: 'Keep it', detail: '', scope: 'caption', sources: ['https://real.example/a'], confidence: 0.7 },
      { rule: 'Drop it', detail: '', scope: 'caption', sources: ['https://fake.example/b'], confidence: 0.9 },
    ],
  }

  it('a finding that loses its sources is KEPT and flagged uncited', () => {
    // It may still be true and a person can judge it. Deleting it would hide
    // the model's reasoning rather than qualify it.
    const merged = mergeBrief(gathered, brief, allowed, findings)
    const invented = merged.market.find(m => m.finding === 'invented')
    expect(invented).toBeDefined()
    expect(invented.uncited).toBe(true)
    expect(invented.sources).toEqual([])
  })

  it('a RULE that loses its sources is DROPPED, silently', () => {
    // The strict side. A rule steers every future caption this brand
    // generates and nobody reviews it again once accepted, so an uncited one
    // must never reach the review queue at all.
    const merged = mergeBrief(gathered, brief, allowed)
    expect(merged.proposed_rules.map(r => r.rule)).toEqual(['Keep it'])
    expect(merged.rules_dropped_uncited).toBe(1)
  })

  it('market holds trends only — not a rival, and not what was rated low', () => {
    const merged = mergeBrief(gathered, brief, allowed, findings)
    expect(merged.market.map(m => m.finding)).toEqual(['cited', 'invented'])
  })

  it('a fabricated URL never survives, however plausible', () => {
    const merged = mergeBrief(gathered, brief, allowed, findings)
    const urls = JSON.stringify(merged.market) + JSON.stringify(merged.proposed_rules)
    expect(urls).not.toContain('fake.example')
  })

  it('unanswered from both halves is carried, not replaced', () => {
    // The gather caveats say which numbers are shaky; the model's say which
    // questions it could not answer. Losing either makes the brief read more
    // confident than it is.
    const merged = mergeBrief(gathered, { ...brief, unanswered: ['No data on tunnel lighting.'] }, allowed)
    expect(merged.unanswered).toContain('Could not read Alnasser (@alnasser): not found')
    expect(merged.unanswered).toContain('No data on tunnel lighting.')
  })
})

describe('the prompts do not poison the cache', () => {
  it('the plan prompt carries no timestamp or run id', () => {
    // A prompt builder is exactly where a "today is" line gets added without
    // thinking, and prompt caching fails silently when it happens — the answer
    // is still correct, at roughly ten times the price on the prefix.
    const text = planPrompt({
      report: gathered,
      agenda: [{ subject: 'Is anyone pushing tunnel lighting?', why: 'New segment' }],
      priorHeadlines: ['Last week was quiet.'],
    })
    expect(volatileFragment(text)).toBeNull()
  })

  it('states the numbers as given facts', () => {
    const text = planPrompt({ report: gathered, agenda: [], priorHeadlines: [] })
    expect(text).toMatch(/do not recompute/i)
    expect(text).toContain('Technolight')
  })

  it('allows the honest empty answer rather than demanding findings', () => {
    const text = planPrompt({ report: gathered, agenda: [], priorHeadlines: [] })
    expect(text).toMatch(/quiet week is a real outcome/i)
  })
})

describe('structured output is requested the current way', () => {
  it('format sits inside output_config, not at the top level', () => {
    // The top-level output_format parameter is deprecated; sending it would be
    // ignored and the brief would come back as prose that then fails to parse.
    const req = buildRequest({
      model: 'claude-opus-5', identity: 'i', brand: 'b',
      messages: [{ role: 'user', content: 'x' }],
      outputFormat: BRIEF_SCHEMA,
    })
    expect(req.output_config.format).toBe(BRIEF_SCHEMA)
    expect(req.output_config.effort).toBe('high')
    expect(req.output_format).toBeUndefined()
  })

  it('is absent entirely when no caller asked for it', () => {
    // An empty format key would change the bytes of every other request and is
    // one more thing that can be wrong.
    const req = buildRequest({
      model: 'claude-opus-5', identity: 'i', brand: 'b',
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(req.output_config).toEqual({ effort: 'high' })
  })

  it('still uses adaptive thinking with no token budget', () => {
    // budget_tokens is rejected outright by the models this app uses.
    const req = buildRequest({ model: 'claude-opus-5', identity: 'i', brand: 'b', messages: [] })
    expect(req.thinking).toEqual({ type: 'adaptive' })
    expect(req.thinking.budget_tokens).toBeUndefined()
  })
})

describe('the references that bind an idea to what it answers', () => {
  it('stamps finding refs in code, never leaving them to the model', () => {
    // A model asked to invent stable ids across a 16k-token response will
    // occasionally reuse one, and a duplicate files two ideas under the wrong
    // finding with nothing on screen saying so.
    const out = withRefs([{ headline: 'a' }, { headline: 'b' }])
    expect(out.map(f => f.ref)).toEqual(['F1', 'F2'])
    expect(out[0].headline).toBe('a')
  })

  it('re-stamps gap ids and keeps what the model claimed, so its own pointers still resolve', () => {
    const gaps = withGapIds([{ gap: 'x', id: 'Gap 1' }, { gap: 'y' }])
    expect(gaps.map(g => g.id)).toEqual(['G1', 'G2'])
    const bound = bindIdeas([{ title: 'i', answers: 'Gap 1' }], gaps, [])
    expect(bound[0].answers_ref).toEqual({ kind: 'gap', id: 'G1' })
  })

  it('survives a model that numbers its gaps twice', () => {
    const gaps = withGapIds([{ gap: 'x', id: 'G1' }, { gap: 'y', id: 'G1' }])
    expect(gaps.map(g => g.id)).toEqual(['G1', 'G2'])
  })

  it('resolves a pointer at a finding, carrying the headline for the chip', () => {
    const bound = bindIdeas(
      [{ title: 'i', answers: 'f2' }], [],
      [{ ref: 'F1', headline: 'one' }, { ref: 'F2', headline: 'two' }],
    )
    expect(bound[0].answers_ref).toEqual({ kind: 'finding', ref: 'F2', headline: 'two' })
  })

  it('drops a pointer at something that does not exist rather than rendering it', () => {
    // A chip reading "because: G4" when there is no G4 is worse than no chip,
    // and the idea's own rationale already says it in prose.
    const bound = bindIdeas([{ title: 'i', answers: 'G9' }, { title: 'j', answers: '' }], [], [])
    expect(bound[0].answers_ref).toBeNull()
    expect(bound[1].answers_ref).toBeNull()
    expect(bound).toHaveLength(2)
  })

  it('merges the direction and the bindings onto the measured half', () => {
    const merged = mergeBrief(
      { competitor_board: [], headline: 'measured' },
      {
        headline: 'written',
        market_direction: [{ movement: 'they are moving', basis: 'web' }],
        gaps: [{ gap: 'a gap' }],
        proposed_ideas: [{ title: 'an idea', answers: 'G1' }],
      },
      new Set(),
      [],
    )
    expect(merged.market_direction).toHaveLength(1)
    expect(merged.gaps[0].id).toBe('G1')
    expect(merged.proposed_ideas[0].answers_ref).toEqual({ kind: 'gap', id: 'G1' })
  })

  it('still merges a brief that carries neither, so nothing regresses', () => {
    const merged = mergeBrief({ competitor_board: [] }, { headline: 'h' }, new Set())
    expect(merged.market_direction).toEqual([])
    expect(merged.gaps).toEqual([])
    expect(merged.proposed_ideas).toEqual([])
  })
})

describe('a rule with a date on it is not a rule', () => {
  it('catches the proposal that made this necessary', () => {
    // Sat in the review queue from 17 Aug until the day before the event, with
    // nothing on the card saying it had a clock on it.
    expect(datedRule(
      'Create at least one piece of content tied to INDEX Saudi Arabia 2026 (LIGHTSPACE Saudi ' +
      'Arabia lighting showcase, Sept 15-17, Riyadh International Convention & Exhibition Center) ' +
      'to position Arak within the Kingdom\'s flagship lighting/design trade event.',
    )).toBe(true)
  })

  it('catches a date in any of the shapes a model writes one', () => {
    expect(datedRule('Post the recap on 2026-09-23.')).toBe(true)
    expect(datedRule('Publish the compliance brief before 1 December.')).toBe(true)
    expect(datedRule('Run the campaign from Sept 15 to the 17th.')).toBe(true)
    expect(datedRule('Prepare for National Day 2026.')).toBe(true)
  })

  it('leaves a standing rule alone', () => {
    expect(datedRule(
      'When describing project or product content, tie lighting choices explicitly to ' +
      'energy-efficiency and sustainability outcomes rather than only aesthetics.',
    )).toBe(false)
    expect(datedRule(
      "When referencing Arak's heritage against competitors, explicitly state the numeric " +
      "contrast (45+ years vs. Technolight's stated 35 years) rather than citing heritage alone.",
    )).toBe(false)
    expect(datedRule('Keep captions under three lines; demand may increase but the format holds.'))
      .toBe(false)
  })

  it('does not mistake a standard\'s designation for a deadline', () => {
    // The case a naive year check gets wrong. SASO 2663:2025 is a document
    // number; a rule citing it is durable, and dropping it would be a worse
    // failure than the one this guard prevents.
    expect(datedRule('Reference SASO 2663:2025 and SASO-2874:2025 compliance in technical posts.'))
      .toBe(false)
  })

  it('flags rather than drops, so the person approving still decides', () => {
    const merged = mergeBrief({ competitor_board: [] }, {
      proposed_rules: [
        { rule: 'Create content for INDEX Saudi Arabia 2026.', sources: ['https://a.com'] },
        { rule: 'Tie project posts to energy outcomes.', sources: ['https://a.com'] },
      ],
    }, new Set(['https://a.com']))
    expect(merged.proposed_rules).toHaveLength(2)
    expect(merged.proposed_rules[0].dated).toBe(true)
    expect(merged.proposed_rules[1].dated).toBe(false)
  })
})

describe('briefEmptiness', () => {
  it('names the shape that cost a whole run: a confident headline over nothing', () => {
    const out = briefEmptiness({ headline: 'Two landmark Riyadh projects named their design teams.' })
    expect(out.empty).toBe(true)
    expect(out.blankUnderAHeadline).toBe(true)
    expect(out.written).toBe(0)
  })

  it('does not call a normal brief empty', () => {
    const out = briefEmptiness({
      headline: 'x', top_three: [1, 2, 3], gaps: [1], proposed_ideas: [1, 2],
    })
    expect(out.empty).toBe(false)
    expect(out.written).toBe(6)
    expect(out.sections.top_three).toBe(3)
  })

  it('counts every section, so a week can be compared with the week before', () => {
    const out = briefEmptiness({})
    expect(Object.keys(out.sections).sort()).toEqual([
      'agenda_changes', 'competitor_moves', 'gaps', 'market_direction',
      'new_competitors', 'proposed_ideas', 'proposed_rules', 'top_three', 'unanswered',
    ])
  })

  it('separates a blank brief from a failed call — no headline is not the same thing', () => {
    expect(briefEmptiness({}).blankUnderAHeadline).toBe(false)
    expect(briefEmptiness({}).empty).toBe(true)
  })

  it('survives a brief whose fields are not arrays at all', () => {
    const out = briefEmptiness({ headline: 'x', top_three: null, gaps: 'nope' })
    expect(out.written).toBe(0)
  })
})

describe('the brief is written to be read once', () => {
  const text = String(SYNTHESISE_PROMPT)

  it('says who is actually reading it and under what conditions', () => {
    expect(text).toContain('second language')
    expect(text).toContain('on a phone')
  })

  it('gives rules a writer can follow, not an adjective', () => {
    expect(text).toContain('Short sentences')
    expect(text).toContain('Say the thing first')
    expect(text).toContain('Everyday words')
  })

  it('protects the industry words rather than flattening them', () => {
    expect(text).toContain('Industry words ARE allowed')
    expect(text).toContain('KNX')
  })
})

// ─── Rules cite refs, and refs have to resolve ─────────────────────────────
// The synthesis is told to cite "F3"/"S2". mergeBrief filtered rule sources as
// URLs, so every ref-cited rule was dropped and research proposed none.
describe('mergeBrief — rule sources', () => {
  const base = { headline: 'x', competitor_board: [], unanswered: [] }
  const findings = withRefs([
    { headline: 'Tunnel tenders up', sources: ['https://read.example/a', 'https://unread.example/z'] },
    { headline: 'Other', sources: ['https://read.example/b'] },
  ])
  const signals = [{ ref: 'S1', source_url: 'https://old-run.example/s' }]
  const allowed = new Set(['https://read.example/a', 'https://read.example/b', 'https://read.example/c'])
  const rule = (sources, r = 'Lead with energy savings.') => ({ rule: r, detail: '', scope: 'caption', sources, confidence: 0.7 })

  it('keeps a rule that cites a finding, with the URLs that finding read', () => {
    const merged = mergeBrief(base, { proposed_rules: [rule(['F1'])] }, allowed, findings, signals)
    expect(merged.proposed_rules).toHaveLength(1)
    expect(merged.proposed_rules[0].sources).toEqual(['https://read.example/a'])
    expect(merged.rules_dropped_uncited).toBe(0)
  })

  it('resolves stored-signal refs and plain read URLs, case-insensitively', () => {
    const merged = mergeBrief(base, { proposed_rules: [rule(['s1', 'https://read.example/c', 'f2'])] }, allowed, findings, signals)
    expect(merged.proposed_rules[0].sources).toEqual(['https://old-run.example/s', 'https://read.example/c', 'https://read.example/b'])
  })

  it('drops a rule whose sources resolve to nothing read, and says so in the report', () => {
    const merged = mergeBrief(base, { proposed_rules: [rule(['F9', 'https://nobody.example'], 'Invented.')] }, allowed, findings, signals)
    expect(merged.proposed_rules).toEqual([])
    expect(merged.rules_dropped_uncited).toBe(1)
    expect(merged.rules_dropped[0]).toMatchObject({ rule: 'Invented.', cited: ['F9', 'https://nobody.example'] })
  })
})

// On 2026-10-25 a reader met "(F19, F23, F32)" at the end of a sentence and
// took F19 for project 19 on the page. The page never shows refs.
describe('refs never reach a sentence a reader sees', () => {
  const gapIds = ['G1', 'G2', 'G3', 'G4']

  it.each([
    ['Huda opened a showroom (F12).', 'Huda opened a showroom.'],
    ['Huda is buying presence (F19, F23, F32).', 'Huda is buying presence.'],
    ['One stored trace (S2) points the same way.', 'One stored trace points the same way.'],
    ['This closes the spec gap (G4).', 'This closes the spec gap.'],
    ['Huda is expanding, see F3.', 'Huda is expanding.'],
    ['Huda is expanding (see F3 and S2) in Riyadh.', 'Huda is expanding in Riyadh.'],
    ['Tenders are up [F3; F7].', 'Tenders are up.'],
    ['Three pieces agree (three signals: F3, F7, S2).', 'Three pieces agree (three signals).'],
    ['A new stand (F3, from the expo page) at INDEX.', 'A new stand (from the expo page) at INDEX.'],
    ['Searches are rising — F19, F23.', 'Searches are rising.'],
    ['Pitch the tower first, (F3), then the mall.', 'Pitch the tower first, then the mall.'],
  ])('%s', (input, expected) => {
    expect(stripRefs(input, { gapIds })).toBe(expected)
  })

  it('leaves a lamp base alone when it is not one of the brief\'s gaps', () => {
    expect(stripRefs('Capsule lamps (G9) are selling.', { gapIds })).toBe('Capsule lamps (G9) are selling.')
    expect(stripRefs('Capsule lamps (G4) are selling.')).toBe('Capsule lamps (G4) are selling.')
  })

  it('leaves text with no refs exactly as it was', () => {
    const s = 'KNX and DALI (both open standards) win the spec , often.'
    expect(stripRefs(s, { gapIds })).toBe(s)
    expect(stripRefs('Reached 2,300 members (n=3).', { gapIds })).toBe('Reached 2,300 members (n=3).')
  })

  it('does not touch a ref written as the subject of a sentence', () => {
    // Removing it would break the sentence; the prompt is what stops these.
    expect(stripRefs('Mondrian Riyadh now has a contractor.')).toBe('Mondrian Riyadh now has a contractor.')
  })

  const brief = {
    headline: 'Huda is buying physical presence (F1, S1).',
    top_three: [{ finding: 'Huda opened a showroom (F1).', action: 'Visit it, see F1.', team: 'sales', refs: ['F1', 'S1'] }],
    competitor_moves: [{
      competitor: 'Technolight', what_changed: 'New stand at INDEX (F2).', picture: 'Two pieces (F1, F2).',
      effect_on_us: 'Book ours (G1).', relevance: 'high', refs: ['F1', 'F2'],
    }],
    market_direction: [{ movement: 'Rivals buy floor space (F1).', basis: 'web', so_what: 'We need a stand (G1).' }],
    gaps: [{ id: 'G1', gap: 'No showroom (F1).', basis: 'web', our_position: 'None (S1).', suggested_response: 'Open one (F2).' }],
    proposed_rules: [{ rule: 'Lead with showroom visits (F1).', detail: 'Two rivals did (F1, F2).', scope: 'caption', sources: ['F1'], confidence: 0.6 }],
    proposed_ideas: [{ title: 'Showroom tour (G1)', angle: 'Walk it (F1).', rationale: 'Closes the showroom gap (see G1).', answers: 'G1', suggested_format: 'reel' }],
    agenda_changes: [{ action: 'add', subject: 'Showrooms (F1)', why: 'Two rivals (F1, F2).' }],
    new_competitors: [{ name: 'Lumo', why: 'Same market (F2).', source_url: '' }],
    unanswered: ['Alnasser was not reached (F9).'],
  }
  const findings = withRefs([
    { headline: 'Huda showroom', sources: ['https://read.example/a'] },
    { headline: 'Technolight stand', sources: ['https://read.example/b'] },
  ])
  const allowed = new Set(['https://read.example/a', 'https://read.example/b'])
  const signals = [{ ref: 'S1', source_url: 'https://old-run.example/s' }]
  const merged = mergeBrief(gathered, brief, allowed, findings, signals)
  const prose = r => JSON.stringify([
    r.headline, r.top_three.map(t => [t.finding, t.action]),
    r.competitor_moves.map(m => [m.what_changed, m.picture, m.effect_on_us]),
    r.competitor_board.map(c => c.read), r.market_direction.map(m => [m.movement, m.so_what]),
    r.gaps.map(g => [g.gap, g.our_position, g.suggested_response]), r.proposed_rules.map(x => [x.rule, x.detail]),
    r.proposed_ideas.map(i => [i.title, i.angle, i.rationale]), r.agenda_changes.map(a => [a.subject, a.why]),
    r.new_competitors.map(c => c.why), r.unanswered,
  ])

  it('mergeBrief stores no ref in any written sentence', () => {
    expect(prose(merged)).not.toMatch(/\b[FSG]\d+\b/)
    expect(merged.headline).toBe('Huda is buying physical presence.')
    expect(merged.competitor_board[0].read).toBe('New stand at INDEX.')
  })

  it('mergeBrief keeps every structured ref, so sources and bindings still resolve', () => {
    expect(merged.top_three[0].refs).toEqual(['F1', 'S1'])
    expect(merged.competitor_moves[0].refs).toEqual(['F1', 'F2'])
    expect(merged.gaps[0].id).toBe('G1')
    expect(merged.proposed_rules[0].sources).toEqual(['https://read.example/a'])
    expect(merged.proposed_ideas[0].answers).toBe('G1')
    expect(merged.proposed_ideas[0].answers_ref).toEqual({ kind: 'gap', id: 'G1' })
  })

  it('a report stored before the fix reads clean at render time', () => {
    const old = { ...brief, gaps: withGapIds(brief.gaps), competitor_board: [{ name: 'Technolight', read: 'New stand (F2).' }] }
    const shown = readableReport(old)
    expect(shown.top_three[0].finding).toBe('Huda opened a showroom.')
    expect(shown.top_three[0].refs).toEqual(['F1', 'S1'])
    expect(shown.gaps[0].gap).toBe('No showroom.')
    expect(shown.competitor_board[0].read).toBe('New stand.')
    expect(shown.proposed_ideas[0].answers).toBe('G1')
    expect(old.top_three[0].finding).toBe('Huda opened a showroom (F1).') // the stored copy is not mutated
    expect(cleanBriefProse(null)).toBe(null)
    expect(readableReport(undefined)).toEqual({})
  })

  it('the synthesis prompt keeps refs out of sentences', () => {
    expect(SYNTHESISE_PROMPT).toMatch(/REFS ARE FOR CODE, NEVER FOR THE READER/)
    expect(SYNTHESISE_PROMPT).toMatch(/never in the sentence/)
  })
})
