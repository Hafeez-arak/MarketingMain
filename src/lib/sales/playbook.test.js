import { describe, it, expect } from 'vitest'
import {
  playbookKeys, matchPlaybook, playbookCardFields, needsReview, searchPlaybook, playbookStages, playbookHtml, reviewedOn,
} from './playbook.js'

// Made-up cards (the real ones are the company's data, never in this repository).
const cards = [
  { id: 'a', position: 1, title: 'Is the main contract awarded?', category: 'discovery', stage: 'RFQ received', signals: ['tender', 'bidding', 'project'], response: 'Ask first.', follow_up: 'When is the award?', avoid: ['Full estimate for a bid'] },
  { id: 'b', position: 2, title: 'Your price is too high', category: 'objection', stage: 'Quotation / Negotiation', signals: ['price_pressure'], response: 'Against what?', statement: 'Your price is higher than the others.', avoid: [] },
  { id: 'c', position: 3, title: 'Against a specified brand', category: 'competitor', stage: 'RFQ → Technical submittal', signals: ['brand_not_ours'], response: 'Equal or decline early.', avoid: [] },
  { id: 'd', position: 4, title: 'Contractor', category: 'persona', stage: 'Any', signals: ['sender_contractor'], response: 'Fast and complete.', avoid: [] },
  { id: 'e', position: 5, title: 'Reply within a day', category: 'objection', stage: 'Any', signals: ['always'], response: 'Give a date.', avoid: [] },
  { id: 'f', position: 6, title: 'Quote sent, no answer', category: 'closing', stage: 'Quotation', signals: ['quote_sent'], response: 'Day 3, 10, 30.', avoid: [] },
]

describe('matching cards to a lead', () => {
  it('turns the lead into keys: true signals, sender, stage, decision, quote sent', () => {
    const keys = playbookKeys({ tender: true, urgent: false, price_pressure: true }, { senderType: 'contractor', stage: 'quotation', decision: 'decline', quoteSent: true })
    expect([...keys].sort()).toEqual(['decision_decline', 'price_pressure', 'quote_sent', 'sender_contractor', 'stage_quotation', 'tender'])
  })
  it('puts the cards that match most first, and the library order breaks ties', () => {
    const keys = playbookKeys({ tender: true, bidding: true, project: true, price_pressure: true }, { senderType: 'contractor' })
    expect(matchPlaybook(cards, keys).map((c) => c.id)).toEqual(['a', 'b', 'd'])
  })
  it('a card for every lead only fills a place nothing real took', () => {
    expect(matchPlaybook(cards, new Set()).map((c) => c.id)).toEqual(['e'])
    expect(matchPlaybook(cards, playbookKeys({}, { quoteSent: true }), { limit: 2 }).map((c) => c.id)).toEqual(['f', 'e'])
  })
})

describe('the edit form', () => {
  it('checks the title and the category, and keeps only known signals', () => {
    expect(playbookCardFields({ title: '', category: 'objection' }).error).toMatch(/title/)
    expect(playbookCardFields({ title: 'X', category: 'nope' }).error).toMatch(/category/)
    const ok = playbookCardFields({ title: ' Price ', category: 'objection', avoid: 'Discounting first\n\nArguing', signals: ['price_pressure', 'made_up', 'price_pressure'] })
    expect(ok.values).toMatchObject({ title: 'Price', avoid: ['Discounting first', 'Arguing'], signals: ['price_pressure'] })
  })
})

describe('reviews', () => {
  const now = new Date('2026-11-07T10:00:00Z')
  it('a draft, or a card not looked at in 90 days, needs a review', () => {
    expect(needsReview({ status: 'draft' }, now)).toBe(true)
    expect(needsReview({ status: 'approved', reviewed_at: '2026-10-01T00:00:00Z' }, now)).toBe(false)
    expect(needsReview({ status: 'approved', reviewed_at: '2026-07-01T00:00:00Z' }, now)).toBe(true)
  })
  it('says the review date in Riyadh time', () => {
    expect(reviewedOn('2026-11-02T22:30:00Z')).toBe('3 Nov 2026')
    expect(reviewedOn(null)).toBe('')
  })
})

describe('search and filters', () => {
  it('finds a card by any of its words, and filters by category and stage', () => {
    expect(searchPlaybook(cards, 'higher others').map((c) => c.id)).toEqual(['b'])
    expect(searchPlaybook(cards, '"award"').map((c) => c.id)).toEqual(['a'])
    expect(searchPlaybook(cards, '', { category: 'closing' }).map((c) => c.id)).toEqual(['f'])
    expect(searchPlaybook(cards, '', { stage: 'Technical submittal' }).map((c) => c.id)).toEqual(['c'])
    expect(searchPlaybook(cards, 'discount').map((c) => c.id)).toEqual(['b']) // its signal, in words
  })
  it('lists each stage once, splitting "A → B" and "A / B"', () => {
    expect(playbookStages(cards)).toEqual(['RFQ received', 'Quotation', 'Negotiation', 'RFQ', 'Technical submittal', 'Any'])
  })
})

describe('in Odoo', () => {
  it('writes each card as say / ask / next / avoid, escaped, marked draft until reviewed', () => {
    const html = playbookHtml([{ ...cards[0], status: 'draft', next_step: 'Budget <price>' }])
    expect(html).toContain('<b>Is the main contract awarded?</b> · Discovery · draft')
    expect(html).toContain('<b>Then ask</b></td><td style="padding:2px 0">When is the award?')
    expect(html).toContain('Budget &lt;price&gt;')
    expect(playbookHtml([])).toBe('')
  })
})
