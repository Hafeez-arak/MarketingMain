import { describe, it, expect } from 'vitest'
import {
  PROPS, CALL_NOTE, cardToProps, propsFromRead, propsToCard, changedProps, mergeProps, mergeDefinition,
  definitionCurrent, changeNote, callNotes, applyCallNotes, briefHtml, historyFacts, splitHistory, splitWalkAway, activityOf, sameActivity, lastSlot, pullDue,
} from './odooCard.js'

// The battle card in Odoo, simplified (2026-10-20): a brief in Internal
// Notes, six fields, the next step as an Activity. Made-up content only.

const card = {
  kind: 'project', customer: 'new', headline: 'Example Dev: facade lighting, Jeddah tower',
  facts: { who: 'Example Dev · Contractor (verified)', wants: 'Facade lighting · 20 floors\nSent: BOQ', brand: 'Philips or equivalent: offer one of ours.', due: 'Two weeks' },
  fit: { band: 'strong', text: 'Strong fit (core): Offices, In our region.' },
  references: ['Tower One, Riyadh — lighting control', 'Palm Grand Hotel — fittings'],
  history: ['Tender quotes from email: 0 of 39 won.'],
  ask: [{ q: 'Is the main contract awarded?', a: '' }, { q: 'Who is the consultant?', a: 'Example Consult' }, { q: 'Budget?', a: '' }],
  pushback: [{ objection: 'Just send a price.', answer: 'Budget price only; ask the award date.' }],
}
const after = { decision: 'project_quote', quote_due: '2026-10-28', target_price: '180k SAR', decides: "Owner's PM", competitors: '' }

describe('six fields, not twenty-six', () => {
  it('the block is a heading and the six things recorded after the call', () => {
    expect(PROPS.map((p) => p.name)).toEqual(['la_sep_card', 'la_decision', 'la_quote_due', 'la_target_price', 'la_decides', 'la_competitors', 'la_call_notes'])
  })

  it('fills them from the card; empty is false (how Odoo stores empty)', () => {
    expect(cardToProps(card, after)).toEqual({
      la_decision: 'project_quote', la_quote_due: '2026-10-28', la_target_price: '180k SAR', la_decides: "Owner's PM",
      la_competitors: false, la_call_notes: '2) Example Consult',
    })
  })

  it('round trip through Odoo: the same card and answers come back', () => {
    const p = cardToProps(card, after)
    const read = PROPS.filter((x) => x.type !== 'separator').map((x) => ({ name: x.name, type: x.type, value: p[x.name] }))
    const back = propsToCard(propsFromRead(read), card, {})
    expect(back.card.ask).toEqual(card.ask)
    expect(back.after).toEqual({ ...after, competitors: '' })
  })
})

describe('call notes: numbered answers, one line', () => {
  it('"1) … | 2) …" answers the questions by number; anything else is kept as a call note', () => {
    const c = applyCallNotes(card, '1) Yes, last week | 3) About 90k | spoke to the PM, wants samples')
    expect(c.ask).toEqual([
      { q: 'Is the main contract awarded?', a: 'Yes, last week' },
      { q: 'Who is the consultant?', a: '' },
      { q: 'Budget?', a: 'About 90k' },
      { q: CALL_NOTE, a: 'spoke to the PM, wants samples' },
    ])
    expect(callNotes(c)).toBe('1) Yes, last week | 3) About 90k | spoke to the PM, wants samples')
  })

  it('a number with no such question is a note, not lost', () => {
    expect(applyCallNotes(card, '7) odd').ask.at(-1)).toEqual({ q: CALL_NOTE, a: '7) odd' })
  })

  it('emptied in Odoo empties the answers (Odoo is the master)', () => {
    expect(applyCallNotes(card, '').ask.every((a) => a.a === '')).toBe(true)
  })
})

describe('Odoo history in words', () => {
  const NOW = new Date('2026-10-20T08:00:00Z')
  const base = { matchedBy: 'email domain', companies: [{ id: 5, name: 'Example Dev Co' }], deals: [], orders: [] }

  it('names the customer it matched and how, then orders, quotations and deals', () => {
    const f = historyFacts({
      ...base,
      orders: [
        { state: 'sale', amount_total: 85000, date_order: '2026-01-10 09:00:00', user_id: [69, 'Ammar Ahmed - Sales'] },
        { state: 'draft', amount_total: 40000, date_order: '2025-11-01 09:00:00' },
        { state: 'sale', amount_total: 325000, date_order: '2024-03-05 09:00:00' },
      ],
      deals: [
        { active: true, probability: 100 },
        { active: false, probability: 0, lost_reason_id: [3, 'Price'], date_closed: '2026-03-14 09:00:00' },
      ],
    }, NOW)
    expect(f.lines).toEqual([
      'In Odoo as Example Dev Co (matched by email domain).',
      '2 orders since Mar 2024, SAR 410,000; last Jan 2026 (Ammar Ahmed - Sales).',
      '1 quotation that did not become an order.',
      'Deals: 1 won · 1 lost (last Mar 2026: Price) · 0 open.',
    ])
    expect(f.alert).toBe('')
    expect(f.move).toBe('They went elsewhere on price last time (Mar 2026): open with a budget option, then the full offer.')
  })

  it('an open deal is the warning: probably the same enquiry when it is fresh, someone else\'s customer when older', () => {
    const fresh = historyFacts({ ...base, deals: [{ active: true, probability: 10, create_date: '2026-10-15 07:00:00', user_id: [46, 'Haitham Khairi'] }] }, NOW)
    expect(fresh.alert).toBe('Probably this same enquiry: Haitham Khairi opened a deal for them on 2026-10-15. Check before working it twice.')
    const old = historyFacts({ ...base, deals: [{ active: true, probability: 20, create_date: '2026-02-01 07:00:00', user_id: [59, 'Mohamed Gamal'] }] }, NOW)
    expect(old.alert).toBe('Mohamed Gamal already has an open deal with them (since Feb 2026). Talk to them before calling.')
    expect(old.move).toBe('')
  })

  it('not found says so (never "new to us"); unreadable says nothing', () => {
    expect(historyFacts({ matchedBy: null, deals: [], orders: [] }).lines[0]).toMatch(/^Not found in Odoo/)
    expect(historyFacts(null)).toEqual({ lines: [], alert: '', move: '' })
  })

  it('bought before, or quoted often without an order: the move says what to do with that', () => {
    expect(historyFacts({ ...base, orders: [{ state: 'sale', amount_total: 1, date_order: '2025-06-01 00:00:00', user_id: [1, 'Reda'] }] }, NOW).move)
      .toBe('They have bought from us (last Jun 2025, Reda): name that order and ask how it went.')
    expect(historyFacts({ ...base, orders: [1, 2, 3].map(() => ({ state: 'draft', amount_total: 1, date_order: '2025-06-01 00:00:00' })) }, NOW).move)
      .toBe('We have quoted them 3 times without an order: ask what decides it this time.')
  })
})

describe('the battle card: who they are, what to do, after the call', () => {
  const armed = {
    ...card,
    history: [
      'Earlier enquiries from example-dev.sa: 3 Sep. Check they were answered.',
      'Tender quotes from email: 0 of 39 won. Find out if the main contract is awarded before a full estimate.',
      'Lighting and control from one company is our edge.',
    ],
    pushback: [{ objection: 'Just send a price.', answer: 'Send a budget price, not a full estimate. Walk away if: an unawarded bid.' }],
  }
  const history = { matchedBy: 'email domain', companies: [{ id: 5, name: 'Example Dev Co' }], orders: [], deals: [{ active: true, probability: 10, create_date: '2026-02-01 07:00:00', user_id: [59, 'Mohamed Gamal'] }] }

  it('three parts, in order', () => {
    const html = briefHtml(armed, { project_type: 'tender' }, history, new Date('2026-10-20T08:00:00Z'))
    const at = ['⚔ BATTLE CARD', '1. Who they are', '2. What to do', '3. After the call'].map((h) => html.indexOf(h))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(html).toContain('<b>⚔ BATTLE CARD</b> · Project quote · Tender · Strong fit')
  })

  it('who they are: the warnings first (Odoo\'s open deal, earlier enquiries), the lead, then their history with us', () => {
    const html = briefHtml(armed, {}, history, new Date('2026-10-20T08:00:00Z'))
    const who = html.slice(html.indexOf('1. Who they are'), html.indexOf('2. What to do'))
    expect(who.indexOf('⚠ Mohamed Gamal already has an open deal')).toBeLessThan(who.indexOf('<b>Who:</b>'))
    expect(who).toContain('⚠ Earlier enquiries from example-dev.sa')
    expect(who).toContain('<b>Brand · deadline:</b> Philips or equivalent: offer one of ours. · Two weeks')
    expect(who).toContain('<b>With us:</b> In Odoo as Example Dev Co (matched by email domain).')
  })

  it('what to do: two to four moves, most specific first', () => {
    const html = briefHtml(armed, {}, null)
    const moves = html.slice(html.indexOf('2. What to do'), html.indexOf('3. After the call')).match(/<li>/g)
    expect(moves.length).toBeGreaterThanOrEqual(2)
    expect(moves.length).toBeLessThanOrEqual(4)
    expect(html).toContain('<li>Tender quotes from email: 0 of 39 won.')
    expect(html).toContain('<li>Ask: 1) Is the main contract awarded? 2) Who is the consultant? 3) Budget?</li>')
    expect(html).toContain('<li>Offer: Philips or equivalent: offer one of ours.</li>')
    const priced = briefHtml(armed, {}, { matchedBy: 'email domain', companies: [], orders: [], deals: [{ active: false, probability: 0, lost_reason_id: [1, 'Price'], date_closed: '2026-03-01 00:00:00' }] })
    expect(priced.slice(priced.indexOf('2. What to do'))).toMatch(/^2\. What to do<\/b><\/p><ul><li>They went elsewhere on price/)
  })

  it('escapes what people wrote; nothing without a card', () => {
    expect(briefHtml({ ...card, facts: { ...card.facts, who: '<b>x</b>' } }, {})).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(briefHtml(null)).toBe('')
  })

  it('splits as the card builder writes them', () => {
    expect(splitWalkAway('Say this. Walk away if: That.')).toEqual({ say: 'Say this.', walk: 'That.' })
    expect(splitHistory(['Parked account: X.', 'New to us: none.', 'A tactic.'])).toEqual({ alerts: ['Parked account: X.'], tactics: ['A tactic.'] })
  })
})

describe('the next step as an activity', () => {
  it('a next step or a date makes one; neither makes none', () => {
    expect(activityOf({ next_step: 'Send samples', follow_up: '2026-10-25' })).toEqual({ summary: 'Send samples', date: '2026-10-25' })
    expect(activityOf({ next_step: '', follow_up: '2026-10-25' })).toEqual({ summary: 'Follow up', date: '2026-10-25' })
    expect(activityOf({ next_step: 'Call', follow_up: null })).toEqual({ summary: 'Call', date: null })
    expect(activityOf({})).toBeNull()
    expect(sameActivity(null, null)).toBe(true)
    expect(sameActivity({ summary: 'a', date: '2026-10-25' }, { summary: 'a', date: '2026-10-26' })).toBe(false)
  })
})

describe('changes', () => {
  it('names only the fields that differ; a write keeps what Odoo holds (Odoo writes the set whole)', () => {
    const a = cardToProps(card, after)
    const b = cardToProps(card, { ...after, target_price: '200k SAR' })
    expect(changedProps(a, b)).toEqual(['la_target_price'])
    expect(mergeProps({ la_decides: 'Set in Odoo', x_theirs: 'kept' }, b, ['la_target_price'])).toEqual({ la_decides: 'Set in Odoo', la_target_price: '200k SAR', x_theirs: 'kept' })
  })

  it('the history line: who, and what changed to what, escaped', () => {
    expect(changeNote(['la_decision', 'la_competitors'], { la_decision: 'park' }, 'Ammar <x>', { summary: 'Call back', date: '2026-11-02' }))
      .toBe('<p>Battle card updated on the Arak leads platform by Ammar &lt;x&gt;: Decision: Park until the award; Who else is quoting: cleared; Next step: Call back (by 2026-11-02).</p>')
    expect(changeNote([], {}, '', null)).toContain('Next step: done/cleared')
  })

  it('the team definition replaces our older version (the 26 fields) and keeps anyone else\'s', () => {
    const theirs = { name: 'abc123', string: 'Their field', type: 'char' }
    const merged = mergeDefinition([theirs, { name: 'la_who', string: 'Who they are', type: 'char' }, { name: 'la_q1', string: 'Question 1', type: 'char' }])
    expect(merged[0]).toEqual(theirs)
    expect(merged.slice(1).map((p) => p.name)).toEqual(PROPS.map((p) => p.name))
    expect(definitionCurrent(merged)).toBe(true)
    expect(definitionCurrent([theirs, ...PROPS, { name: 'la_who', string: 'old', type: 'char' }])).toBe(false)
  })
})

describe('when Odoo is read: 07:50 and 13:00 Riyadh', () => {
  it('the latest slot at or before now, and due once per slot', () => {
    expect(lastSlot(new Date('2026-10-20T04:49:00Z')).toISOString()).toBe('2026-10-19T10:00:00.000Z')
    expect(lastSlot(new Date('2026-10-20T04:50:00Z')).toISOString()).toBe('2026-10-20T04:50:00.000Z')
    expect(pullDue(new Date('2026-10-20T04:52:00Z'), '2026-10-19T10:03:00Z')).toBe(true)
    expect(pullDue(new Date('2026-10-20T09:00:00Z'), '2026-10-20T04:52:00Z')).toBe(false)
    expect(pullDue(new Date('2026-10-20T10:01:00Z'), '2026-10-20T04:52:00Z')).toBe(true)
  })
})
