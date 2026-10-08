import { describe, it, expect } from 'vitest'
import { normaliseCard, hasCard, byPhase, cardCounts, cardAsText } from './battleCard'

// A made-up card. The real ones are data in the database.
const CARD = {
  title: 'Outbound battle card',
  purpose: 'Before, during and after the first call.',
  sections: [
    { key: 'deal', title: 'The deal', phase: 'before', fields: [
      { label: 'Project', example: 'Palm Hotel', required: true },
      { label: 'Stage', type: 'choice', options: ['design', 'awarded'], example: 'awarded' },
    ] },
    { key: 'ask', title: 'Ask first', phase: 'during', fields: [{ label: 'Target price?', example: '1.2M', required: true }] },
    { key: 'empty', title: 'Nothing in it', phase: 'after', fields: [] },
    { key: 'bad', title: '', fields: [{ label: 'orphan' }] },
  ],
  objections: [
    { objection: 'Too expensive', answer: 'Offer the house brand', proof: 'Spec sheet', walk_away: 'Below cost', example: 'Raised on the call' },
    { objection: 'No answer given' },
  ],
}

describe('a battle card is read whole', () => {
  it('drops untitled and empty sections and objections with no answer', () => {
    const c = normaliseCard(CARD)
    expect(c.sections.map(s => s.key)).toEqual(['deal', 'ask'])
    expect(c.objections).toHaveLength(1)
    expect(hasCard(CARD)).toBe(true)
    expect(hasCard({})).toBe(false)
  })

  it('a field with an unknown type is plain text, and an unknown phase is the call itself', () => {
    const c = normaliseCard({ sections: [{ title: 'x', phase: 'later', fields: [{ label: 'a', type: 'weird' }] }] })
    expect(c.sections[0].phase).toBe('during')
    expect(c.sections[0].fields[0].type).toBe('text')
  })

  it('groups by phase in call order and counts what must be filled', () => {
    expect(byPhase(CARD).map(p => p.label)).toEqual(['Before the call', 'On the call'])
    expect(cardCounts(CARD)).toEqual({ fields: 3, required: 2 })
  })
})

describe('the card as text', () => {
  it('prints an empty card with blanks, choices and required marks', () => {
    const t = cardAsText(CARD)
    expect(t).toContain('*Project: ______')
    expect(t).toContain('Stage: [design / awarded]')
    expect(t).toContain('"Too expensive" → Offer the house brand (proof: Spec sheet) · walk away if: Below cost')
    expect(t).not.toContain('on this deal')
  })

  it('prints the filled example with what happened on the deal', () => {
    const t = cardAsText(CARD, { filled: true })
    expect(t).toContain('*Project: Palm Hotel')
    expect(t).toContain('on this deal: Raised on the call')
  })
})
