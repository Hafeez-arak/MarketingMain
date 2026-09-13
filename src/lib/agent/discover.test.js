import { describe, it, expect } from 'vitest'
import {
  isKnown, newCompetitors, agendaRowsFor, discoverPrompt, discoverSummary,
  DISCOVER_SCHEMA, MAX_PROPOSALS,
} from './discover.js'

const c = (name, extra = {}) => ({ name, evidence_url: 'https://example.com/a', why: 'same buyers', ...extra })

describe('isKnown — the duplicate check that must not need a model', () => {
  it('matches an exact name', () => {
    expect(isKnown(c('Technolight'), [{ name: 'Technolight' }])).toBe(true)
  })

  it('matches across spacing and punctuation', () => {
    // "Techno Light" and "Technolight" are one company written two ways.
    expect(isKnown(c('Techno Light'), [{ name: 'Technolight' }])).toBe(true)
  })

  it('matches a legal suffix against a trading name', () => {
    expect(isKnown(c('Techno Light Establishment'), [{ name: 'Technolight' }])).toBe(true)
  })

  it('treats a shared domain as conclusive even when the names differ', () => {
    expect(isKnown(
      c('Alfanar Electrical Systems', { website: 'https://alfanar.com/x' }),
      [{ name: 'Alfanar Group', website: 'alfanar.com' }],
    )).toBe(true)
  })

  it('does NOT merge two genuinely different rivals with similar names', () => {
    // The resolver's warning applies here too: Ozee and Ozeyl are two
    // companies, and collapsing them loses one permanently.
    expect(isKnown(c('Ozeyl'), [{ name: 'Ozee' }])).toBe(false)
  })

  it('refuses an unnamed candidate rather than proposing a blank row', () => {
    expect(isKnown({ name: '' }, [])).toBe(true)
  })

  it('accepts a plain string watchlist, not just objects', () => {
    expect(isKnown(c('Technolight'), ['Technolight'])).toBe(true)
    expect(isKnown(c('Lumina'), ['Technolight'])).toBe(false)
  })
})

describe('newCompetitors', () => {
  it('keeps only what is genuinely new', () => {
    const out = newCompetitors(
      [c('Technolight'), c('Lumina'), c('Delta Lighting')],
      [{ name: 'Technolight' }],
    )
    expect(out.map(x => x.name)).toEqual(['Lumina', 'Delta Lighting'])
  })

  it('drops a proposal with no source, whatever the prompt asked for', () => {
    // A rule, not a request: a rival nobody can check is homework, not a
    // proposal.
    const out = newCompetitors([{ name: 'Ghost Co', why: 'trust me' }], [])
    expect(out).toEqual([])
  })

  it('deduplicates within one response', () => {
    // A model asked for rivals routinely returns the trading name and the
    // legal name of one company in the same answer.
    const out = newCompetitors([c('Technolight'), c('Techno Light Est.')], [])
    expect(out).toHaveLength(1)
  })

  it('caps the list so a wall of names does not get ignored wholesale', () => {
    // Genuinely distinct names. An earlier version of this test used
    // "Rival 0 Unique", "Rival 1 Unique"… which all reduce to the same two
    // significant tokens once the digit is dropped — so the deduplicator
    // correctly collapsed all twenty into one, and the test was wrong rather
    // than the code.
    const words = ['Lumina', 'Delta', 'Orion', 'Zenith', 'Vertex', 'Apex',
                   'Kestrel', 'Solace', 'Marlin', 'Juniper', 'Cobalt', 'Ember']
    const many = words.map(w => c(`${w} Works`))
    expect(newCompetitors(many, []).length).toBe(MAX_PROPOSALS)
  })

  it('does not merge two companies that share only one significant word', () => {
    // The failure the two-token rule exists to prevent: "Delta Lighting" and
    // "Delta Electric" are not one company.
    const out = newCompetitors([c('Delta Electric')], [{ name: 'Delta Lighting' }])
    expect(out).toHaveLength(1)
  })

  it('defaults an unstated overlap to direct rather than dropping the row', () => {
    expect(newCompetitors([c('Lumina')], [])[0].overlap).toBe('direct')
    expect(newCompetitors([c('Lumina', { overlap: 'adjacent' })], [])[0].overlap).toBe('adjacent')
  })

  it('survives nonsense input', () => {
    expect(newCompetitors(null, null)).toEqual([])
    expect(newCompetitors([null, {}, { name: '  ' }], [])).toEqual([])
  })
})

describe('agendaRowsFor — the write boundary, in one function', () => {
  const rows = agendaRowsFor('ws-1', [
    { name: 'Lumina', website: 'lumina.sa', why: 'same buyers', evidence_url: 'https://x/1', overlap: 'direct' },
  ])

  it('writes to the agent watchlist as a proposal, never as active', () => {
    expect(rows[0].status).toBe('proposed')
    expect(rows[0].kind).toBe('competitor')
    expect(rows[0].created_by).toBe('agent')
  })

  it('never claims a handle it has not resolved', () => {
    // Found is not verified. Downstream filters on ig_status, and an agent
    // that set this to resolved would attach a week of numbers to a guess.
    expect(rows[0].ig_status).toBe('unresolved')
    expect(rows[0].ig_handle).toBe('')
  })

  it('carries the evidence into why, so a person can judge it without re-searching', () => {
    expect(rows[0].why).toContain('same buyers')
    expect(rows[0].why).toContain('https://x/1')
  })

  it('produces no field that could reach the Brand Brain', () => {
    // §5a asserted rather than assumed: these rows go to research_agenda and
    // the directory columns are not even present to be misrouted.
    const keys = Object.keys(rows[0])
    for (const forbidden of ['brand_profile', 'section_id', 'row_id', 'brand_directory_row']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('bounds why, so one verbose answer cannot bloat every row', () => {
    const long = agendaRowsFor('ws', [{
      name: 'X', why: 'y'.repeat(2000), evidence_url: 'https://x', website: '',
    }])
    expect(long[0].why.length).toBeLessThanOrEqual(600)
  })
})

describe('discoverPrompt', () => {
  it('names what is already watched so the model does not return it', () => {
    const p = discoverPrompt({ brandName: 'Arak' }, { known: ['Technolight'] })
    expect(p).toContain('ALREADY ON THE WATCHLIST')
    expect(p).toContain('Technolight')
  })

  it('says so plainly when the watchlist is empty — the Alo Kheyatah case', () => {
    const p = discoverPrompt({ brandName: 'Alo Kheyatah' }, { known: [] })
    expect(p).toContain('Nothing is on the watchlist yet')
  })

  it('asks for the local language when there is one', () => {
    expect(discoverPrompt({}, { language: 'Arabic' })).toContain('Arabic')
  })

  it('hardcodes no industry', () => {
    const p = discoverPrompt({ brandName: 'X', descriptor: 'tailoring' }, {})
    expect(p.toLowerCase()).not.toContain('lighting')
  })
})

describe('discoverSummary', () => {
  it('tells "found nothing" apart from "found only duplicates"', () => {
    expect(discoverSummary({ proposed: [], seen: 0 }).note).toContain('thin market')
    expect(discoverSummary({ proposed: [], seen: 5 }).note).toContain('already on the watchlist')
  })

  it('is quiet when it actually proposed something', () => {
    expect(discoverSummary({ proposed: [{ name: 'a' }], seen: 3 }).note).toBe('')
  })
})

describe('DISCOVER_SCHEMA', () => {
  it('requires a reason on every competitor', () => {
    expect(DISCOVER_SCHEMA.schema.properties.competitors.items.required).toContain('why')
    expect(DISCOVER_SCHEMA.schema.properties.competitors.items.required).toContain('name')
  })
})
