import { describe, it, expect } from 'vitest'
import {
  PROPS, cardToProps, propsFromRead, propsToCard, changedProps, mergeProps, mergeDefinition,
  definitionCurrent, changeNote, lastSlot, pullDue,
} from './odooCard.js'

// The battle card as Odoo fields (2026-10-20). Made-up content only.

const card = {
  kind: 'project', customer: 'new', headline: 'Example Dev: facade lighting, Jeddah tower',
  facts: { who: 'Contractor, verified', wants: 'Facade lighting · 20 floors\nSent: BOQ', brand: 'Philips or equivalent', due: 'Two weeks' },
  fit: { band: 'possible', text: 'Office segment, Jeddah' },
  references: ['Tower One, Riyadh', 'Palm Grand Hotel'],
  history: ['New to us: no order and no earlier enquiry on record.'],
  ask: [{ q: 'Is the main contract awarded?', a: '' }, { q: 'Who is the consultant?', a: 'Example Consult' }, { q: 'Budget?', a: '' }, { q: 'Samples needed?', a: 'Yes, 2' }],
  pushback: [{ objection: 'Too expensive', answer: 'We match the spec, not the price.' }],
}
const after = { decision: 'project_quote', quote_due: '2026-10-28', target_price: '180k SAR', decides: "Owner's PM", competitors: '' }
const lead = { next_step: 'Send samples', follow_up: '2026-10-25' }

describe('the card as Odoo fields', () => {
  it('fills every field the card has, empty ones false (how Odoo stores empty)', () => {
    const p = cardToProps(card, after, lead)
    expect(p).toMatchObject({
      la_kind: 'project', la_customer: 'new', la_who: 'Contractor, verified', la_fit: 'possible',
      la_references: 'Tower One, Riyadh\nPalm Grand Hotel',
      la_q1: 'Is the main contract awarded?', la_a1: false, la_a2: 'Example Consult',
      la_more: 'Samples needed? → Yes, 2', la_pushback: 'Too expensive → We match the spec, not the price.',
      la_decision: 'project_quote', la_quote_due: '2026-10-28', la_competitors: false,
      la_next_step: 'Send samples', la_follow_up: '2026-10-25',
    })
    // One value per field we define, none for the section headings.
    expect(Object.keys(p).sort()).toEqual(PROPS.filter((x) => x.type !== 'separator').map((x) => x.name).sort())
  })

  it('a card read back from Odoo is the same card: nothing lost on the round trip', () => {
    const p = cardToProps(card, after, lead)
    const read = PROPS.filter((x) => x.type !== 'separator').map((x) => ({ name: x.name, type: x.type, value: p[x.name] }))
    const back = propsToCard(propsFromRead(read), {}, {}, {})
    expect(back.card).toEqual({ ...card, facts: card.facts })
    expect(back.after).toEqual({ ...after, competitors: '' })
    expect(back.track).toEqual(lead)
  })

  it('only our properties are read; a field Odoo does not have leaves ours alone', () => {
    const read = [{ name: 'la_decides', type: 'char', value: 'The CEO' }, { name: 'x_other', type: 'char', value: 'not ours' }, { name: 'la_sep_after', type: 'separator' }]
    const props = propsFromRead(read)
    expect(props).toEqual({ la_decides: 'The CEO' })
    const back = propsToCard(props, card, after, lead)
    expect(back.after.decides).toBe('The CEO')
    expect(back.after.target_price).toBe('180k SAR')
    expect(back.card.facts.who).toBe('Contractor, verified')
  })
})

describe('changes, both ways', () => {
  it('names only the fields that differ', () => {
    const a = cardToProps(card, after, lead)
    const b = cardToProps(card, { ...after, target_price: '200k SAR' }, { ...lead, follow_up: '' })
    expect(changedProps(a, b)).toEqual(['la_target_price', 'la_follow_up'])
    expect(changedProps(a, a)).toEqual([])
  })

  it('a write keeps everything Odoo holds and replaces only what changed here (Odoo writes the set whole)', () => {
    const odooNow = { la_decides: 'Set in Odoo', la_target_price: '150k', x_theirs: 'kept' }
    expect(mergeProps(odooNow, { la_target_price: '200k', la_decides: 'Ours, stale' }, ['la_target_price'])).toEqual({ la_decides: 'Set in Odoo', la_target_price: '200k', x_theirs: 'kept' })
  })

  it('the history note says who changed what, escaped, with choices by name', () => {
    const html = changeNote(['la_decision', 'la_competitors'], { la_decision: 'park', la_competitors: false }, 'Ammar <script>')
    expect(html).toContain('by Ammar &lt;script&gt;')
    expect(html).toContain('<b>Decision:</b> Park until the award')
    expect(html).toContain('<b>Who else is quoting:</b> <i>cleared</i>')
    expect(changeNote(['la_who'], { la_who: 'x' }, '', 'Battle card from the platform.')).toMatch(/^<p>Battle card from the platform\.<\/p>/)
  })
})

describe('the team definition', () => {
  it('adds ours after anyone else\'s, and replaces an older version of ours', () => {
    const theirs = { name: 'abc123', string: 'Their field', type: 'char' }
    const merged = mergeDefinition([theirs, { name: 'la_who', string: 'Old label', type: 'char' }])
    expect(merged[0]).toEqual(theirs)
    expect(merged.slice(1).map((p) => p.name)).toEqual(PROPS.map((p) => p.name))
    expect(definitionCurrent(merged)).toBe(true)
    expect(definitionCurrent([theirs])).toBe(false)
    expect(definitionCurrent(merged.map((p) => (p.name === 'la_who' ? { ...p, string: 'Old' } : p)))).toBe(false)
  })
})

describe('when Odoo is read: 07:50 and 13:00 Riyadh', () => {
  // Riyadh is UTC+3: 07:50 = 04:50Z, 13:00 = 10:00Z.
  it('the latest slot at or before now', () => {
    expect(lastSlot(new Date('2026-10-20T04:49:00Z')).toISOString()).toBe('2026-10-19T10:00:00.000Z')
    expect(lastSlot(new Date('2026-10-20T04:50:00Z')).toISOString()).toBe('2026-10-20T04:50:00.000Z')
    expect(lastSlot(new Date('2026-10-20T09:59:00Z')).toISOString()).toBe('2026-10-20T04:50:00.000Z')
    expect(lastSlot(new Date('2026-10-20T22:30:00Z')).toISOString()).toBe('2026-10-20T10:00:00.000Z')
  })
  it('due once per slot, never in between', () => {
    expect(pullDue(new Date('2026-10-20T04:52:00Z'), null)).toBe(true)
    expect(pullDue(new Date('2026-10-20T04:52:00Z'), '2026-10-19T10:03:00Z')).toBe(true)
    expect(pullDue(new Date('2026-10-20T04:57:00Z'), '2026-10-20T04:52:00Z')).toBe(false)
    expect(pullDue(new Date('2026-10-20T09:00:00Z'), '2026-10-20T04:52:00Z')).toBe(false)
    expect(pullDue(new Date('2026-10-20T10:01:00Z'), '2026-10-20T04:52:00Z')).toBe(true)
  })
})
