import { describe, it, expect } from 'vitest'
import {
  PROPS, CALL_NOTE, cardToProps, propsFromRead, propsToCard, changedProps, mergeProps, mergeDefinition,
  definitionCurrent, changeNote, callNotes, applyCallNotes, briefHtml, splitHistory, splitWalkAway, activityOf, sameActivity, lastSlot, pullDue,
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

describe('the battle card in Internal Notes: the weapons', () => {
  const armed = {
    ...card,
    customer: 'existing',
    history: [
      'Existing customer (name match, confirm): Example Dev Co, 4 orders.',
      'Earlier enquiries from example-dev.sa: 3 Sep. Check they were answered.',
      'Tender quotes from email: 0 of 39 won. Find out if the main contract is awarded before a full estimate.',
      'Lighting and control from one company is our edge: offer DALI / KNX with the fittings.',
    ],
    pushback: [
      { objection: 'Just send a price.', answer: 'Send a budget price, not a full estimate. Ask when the award is due. Walk away if: Do not spend a full estimate on an unawarded bid.' },
      { objection: 'Too expensive.', answer: 'Compare like for like: driver, warranty, controls.' },
      { objection: 'Third one', answer: 'Not shown: two at most.' },
    ],
  }

  it('in order: the deal, what could blow up, the target, how we win, why us, ask first, if they say, don\'t', () => {
    const html = briefHtml(armed, { project_type: 'tender' })
    const order = ['⚔ BATTLE CARD', '⚠ Watch out', 'The target', 'How we win this one', 'Why us: name these', 'Ask first', 'If they say…', "Don&#39;t", 'After the call'].map((h) => h.replace('&#39;', "'"))
    const at = order.map((h) => html.indexOf(h))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(html).toContain('<b>⚔ BATTLE CARD</b> · Project quote · Tender · Existing customer · Strong fit')
  })

  it('the account facts are warnings; the playbook lines are the tactics; the proof keeps what we did', () => {
    const html = briefHtml(armed, {})
    const watch = html.slice(html.indexOf('⚠ Watch out'), html.indexOf('The target'))
    expect(watch).toContain('Existing customer (name match, confirm)')
    expect(watch).toContain('Earlier enquiries from example-dev.sa')
    const win = html.slice(html.indexOf('How we win'), html.indexOf('Why us'))
    expect(win).toContain('0 of 39 won')
    expect(win).toContain('Lighting and control from one company is our edge')
    expect(html).toContain('Tower One, Riyadh — lighting control')
  })

  it('every objection answer in full, two at most, and the walk-away under Don\'t', () => {
    const html = briefHtml(armed, {})
    expect(html).toContain('“Just send a price.” → Send a budget price, not a full estimate. Ask when the award is due.')
    expect(html).toContain('“Too expensive.” → Compare like for like')
    expect(html).not.toContain('Third one')
    expect(html.slice(html.indexOf("Don't"))).toContain('Do not spend a full estimate on an unawarded bid.')
    expect(html.slice(html.indexOf('If they say'), html.indexOf("Don't"))).not.toContain('Walk away')
  })

  it('a new lead with no warnings shows no Watch out; escapes what people wrote; nothing without a card', () => {
    const html = briefHtml({ ...card, facts: { ...card.facts, who: '<b>x</b>' }, history: ['New to us: no order and no earlier enquiry on record.'] }, {})
    expect(html).not.toContain('Watch out')
    expect(html).not.toContain('New to us: no order')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(briefHtml(null)).toBe('')
  })

  it('splits as the card builder writes them', () => {
    expect(splitWalkAway('Say this. Walk away if: That.')).toEqual({ say: 'Say this.', walk: 'That.' })
    expect(splitWalkAway('Only this.')).toEqual({ say: 'Only this.', walk: '' })
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
