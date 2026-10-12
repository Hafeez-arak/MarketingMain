import { describe, it, expect } from 'vitest'
import {
  buildLeadCard, brandRule, matchAccount, documentsIn, wantsIn, cardKind, vendorBodies,
  normaliseLeadCard, afterCallFields, cardChips, senderDomain, DEFAULT_PLAYBOOK,
} from './leadCard'

// Made-up leads, companies and accounts. The real ones live in the database.
const SUPPLIERS = ['C°LB', 'Reggiani', 'Zennio', 'Ledvance', 'p.u.k.', 'ABB']
const ACCOUNTS = [
  { name: 'Northwind Joint Venture (Alpha – Beta – FALCONCO)', orders: 16, value_sar: 12300000, last_order: '2024-01-01', status: 'new' },
  { name: 'Palm Grand Hotel Riyadh', orders: 2, value_sar: 260000, last_order: '2026-04-01', status: 'new' },
  { name: 'Quiet Telecom Company', orders: 6, value_sar: 990000, last_order: '2026-08-01', status: 'parked' },
]
const FACTS = 'Founded 1990\nRegistered vendor / prequalified with (example.com/about): Giga City, Harbour Authority\nHQ: Riyadh'

const tender = {
  id: 'l1', received_at: '2026-09-12T12:00:00Z', company: '', email: 'buyer@falconco.com.sa',
  subject: 'RFQ - Giga City landscape lighting',
  message: 'Please submit your offer with prequalification and material submittal. BOQ, drawings and specs on the SharePoint link. Sample board mandatory.',
  summary: 'Offer, prequalification and submittals for landscape lighting at Giga City.',
  details: { location: 'Giga City', stage: 'RFQ', products: 'Landscape lighting fixtures', quantity: '', brands: '', urgency: 'Earliest response' },
  ask_next: ['What quantities are in the BOQ?'],
  sender_type: 'contractor', source_check: 'verified', project_type: 'tender', project_final: 'tender', philips: 'none', category: 'quotation_request',
}

const trader = {
  id: 'l2', received_at: '2026-10-04T05:00:00Z', company: 'Bolt Supplies', email: 'buy@boltsupplies.co',
  subject: 'RFQ supply of LED tubes', message: 'Best discounted price and availability for 300 T8 tubes, Philips or equivalent. Urgent.',
  summary: 'Quote 300 T8 LED tubes, Philips or equivalent.',
  details: { products: 'T8 LED tubes', quantity: '300 pcs', brands: 'Philips or equivalent', urgency: 'ASAP', location: 'Dammam' },
  ask_next: ['Where should they be delivered?'],
  sender_type: 'trader', source_check: 'verified', project_type: '', project_final: '', philips: 'or_equivalent', category: 'quotation_request',
}

describe('brandRule', () => {
  it('names our brands and flags the rest', () => {
    const r = brandRule({ details: { brands: 'Zennio, Acme Lights; equivalent models acceptable' } }, SUPPLIERS)
    expect(r.text).toBe('We carry Zennio. Not ours: Acme Lights. Offer our own or an approved equal, or say early that we can\'t. Equivalents accepted.')
    expect(r.signals).toEqual({ brand_ours: true, brand_not_ours: false, brand_equivalent: true })
  })
  it('matches names written without their punctuation', () => {
    expect(brandRule({ details: { brands: 'CLB or PUK' } }, SUPPLIERS).text).toBe('We carry C°LB, p.u.k..')
  })
  it('turns Philips or equivalent into an offer of ours, and says nothing when nothing is named', () => {
    expect(brandRule(trader, SUPPLIERS).text).toBe('Philips or equivalent: offer one of ours.')
    expect(brandRule({ details: { brands: '' } }, SUPPLIERS)).toMatchObject({ text: '', known: false })
  })
})

describe('matchAccount', () => {
  it('finds a partner named inside a joint venture, by domain', () => {
    expect(matchAccount(tender, ACCOUNTS)?.orders).toBe(16)
  })
  it('matches on the company name, and never on short or free-mail roots', () => {
    expect(matchAccount({ company: 'Palm Grand Hotel', email: 'x@gmail.com' }, ACCOUNTS)?.value_sar).toBe(260000)
    expect(matchAccount({ company: 'Palm', email: 'x@abc.sa' }, ACCOUNTS)).toBeNull()
    expect(senderDomain({ email: 'x@Gmail.com' })).toBe('')
  })
})

describe('reading the email without a model', () => {
  it('finds the documents they sent and what else they want', () => {
    expect(documentsIn(tender)).toBe('BOQ, drawings, specification (attached or linked)')
    expect(wantsIn(tender)).toBe('Material submittal, prequalification, samples or a mock-up')
    expect(documentsIn({ subject: 'Hi', message: 'Price please' })).toBe('')
  })
  it('reads the registered-vendor line from the company facts', () => {
    expect(vendorBodies(FACTS)).toEqual(['Giga City', 'Harbour Authority'])
    expect(vendorBodies('No such line')).toEqual([])
  })
  it('tells a project from a quick quote', () => {
    expect(cardKind(tender)).toBe('project')
    expect(cardKind(trader)).toBe('quick')
  })
})

describe('buildLeadCard', () => {
  it('builds a tender card from our records and the playbook', () => {
    const c = buildLeadCard(tender, { accounts: ACCOUNTS, suppliers: SUPPLIERS, companyFacts: FACTS, earlier: [] })
    expect(c.kind).toBe('project')
    expect(c.customer).toBe('existing')
    expect(c.headline).toBe('falconco.com.sa: Offer, prequalification and submittals for landscape lighting at Giga City.')
    expect(c.history[0]).toBe('Existing customer (name match, confirm): Northwind Joint Venture (Alpha – Beta – FALCONCO), 16 orders, SAR 12.3M, last order Jan 2024.')
    expect(c.history).toContain('We are a registered vendor with Giga City.')
    // Not awarded, no brand named: both win-factor questions stay; then the agent's.
    expect(c.ask.map((a) => a.q)).toEqual([DEFAULT_PLAYBOOK.questions[0].text, DEFAULT_PLAYBOOK.questions[1].text, 'What quantities are in the BOQ?'])
    expect(c.pushback.map((p) => p.objection)).toEqual(['We have not won the job yet; just send a price.', 'Send the certificates / you are not prequalified.'])
  })

  it('builds a short quick-quote card for a repeat trader, skipping questions the email answers', () => {
    const earlier = [{ received_at: '2026-09-21T08:00:00Z' }, { received_at: '2026-09-07T08:00:00Z' }]
    const c = buildLeadCard(trader, { accounts: ACCOUNTS, suppliers: SUPPLIERS, earlier })
    expect(c.kind).toBe('quick')
    expect(c.customer).toBe('repeat')
    expect(c.history[0]).toBe('Earlier enquiries from boltsupplies.co: 7 Sep, 21 Sep. Check they were answered.')
    const qs = c.ask.map((a) => a.q)
    expect(qs).not.toContain(DEFAULT_PLAYBOOK.questions[0].text) // award: a quick quote
    expect(qs).not.toContain(DEFAULT_PLAYBOOK.questions[1].text) // brand: Philips or equivalent is known
    expect(qs).toContain('Where should they be delivered?')
    expect(c.pushback.map((p) => p.objection)).toEqual(['Your price is higher than the others.', 'We need it this week.'])
  })

  it('warns on a parked account', () => {
    const c = buildLeadCard({ ...trader, company: 'Quiet Telecom', email: 'a@quiettelecom.sa' }, { accounts: ACCOUNTS })
    expect(c.customer).toBe('parked')
    expect(c.history[0]).toMatch(/^Parked account: Quiet Telecom Company\./)
  })

  it('uses the company\'s own playbook when it has one', () => {
    const playbook = { lessons: [{ when: 'quick', text: 'Our own lesson.' }], objections: [{ when: 'urgent', objection: 'Now!', answer: 'Today.' }] }
    const c = buildLeadCard(trader, { playbook })
    expect(c.history).toContain('Our own lesson.')
    expect(c.pushback).toEqual([{ objection: 'Now!', answer: 'Today.' }])
    expect(c.ask.length).toBe(3) // questions fall back to the defaults
  })
})

describe('saving', () => {
  it('cuts anything sent back to the card\'s shape', () => {
    const c = normaliseLeadCard({ kind: 'nonsense', headline: 'x'.repeat(900), facts: { project: 'P', extra: 'no' }, history: ['a', '', 'b'], ask: [{ q: '' }, { q: 'Q', a: 'A' }], pushback: 'no' })
    expect(c.kind).toBe('project')
    expect(c.headline.length).toBe(500)
    expect(c.facts).toEqual({ project: 'P', scope: '', brand: '', documents: '', also_want: '', due: '' })
    expect(c.history).toEqual(['a', 'b'])
    expect(c.ask).toEqual([{ q: 'Q', a: 'A' }])
    expect(c.pushback).toEqual([])
  })
  it('checks the after-call fields', () => {
    expect(afterCallFields({ decision: 'park', quote_due: '2026-10-20', target_price: ' 1.2M ', decides: 'PM' })).toEqual({ values: { decision: 'park', quote_due: '2026-10-20', target_price: '1.2M', decides: 'PM' } })
    expect(afterCallFields({ decision: 'maybe' }).error).toBe('Unknown decision.')
    expect(afterCallFields({ quote_due: 'next week' }).error).toBe('The quote date is not a date.')
    expect(afterCallFields({}).values.quote_due).toBeNull()
  })
  it('shows the header chips in order', () => {
    expect(cardChips(tender, { kind: 'project', customer: 'existing' }).map((c) => c.text)).toEqual(['Project quote', 'Contractor · verified', 'Tender', 'Existing customer'])
  })
})
