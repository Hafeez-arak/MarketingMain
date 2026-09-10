import { describe, it, expect } from 'vitest'
import { BRIEF_SCHEMA, mergeBrief, planPrompt } from './brief'
import { volatileFragment, buildRequest } from './prompt'

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
    const merged = mergeBrief(gathered, {
      headline: 'x',
      competitor_reads: [{ name: 'Technolight', read: 'Pushing tunnel lighting.' }],
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
  const brief = {
    headline: 'x',
    market: [
      { finding: 'cited', sources: [{ url: 'https://real.example/a' }], confidence: 0.7, novelty: 'new' },
      { finding: 'invented', sources: [{ url: 'https://fake.example/b' }], confidence: 0.9, novelty: 'new' },
    ],
    proposed_rules: [
      { rule: 'Keep it', detail: '', scope: 'caption', sources: ['https://real.example/a'], confidence: 0.7 },
      { rule: 'Drop it', detail: '', scope: 'caption', sources: ['https://fake.example/b'], confidence: 0.9 },
    ],
  }

  it('a finding that loses its sources is KEPT and flagged uncited', () => {
    // It may still be true and a person can judge it. Deleting it would hide
    // the model's reasoning rather than qualify it.
    const merged = mergeBrief(gathered, brief, allowed)
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

  it('a fabricated URL never survives, however plausible', () => {
    const merged = mergeBrief(gathered, brief, allowed)
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
