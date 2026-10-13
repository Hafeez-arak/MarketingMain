import { describe, it, expect } from 'vitest'
import {
  buildLeadCard, brandRule, matchAccount, documentsIn, wantsIn, cardKind, vendorBodies,
  normaliseLeadCard, afterCallFields, cardChips, senderDomain, DEFAULT_PLAYBOOK,
  buyerOf, icpFit, pickReferences, heldBy, objectionsFromCards, matchCompetitors,
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
    expect(afterCallFields({ decision: 'park', quote_due: '2026-10-20', target_price: ' 1.2M ', decides: 'PM', competitors: ' Rival Co ' })).toEqual({ values: { decision: 'park', quote_due: '2026-10-20', target_price: '1.2M', decides: 'PM', competitors: 'Rival Co' } })
    expect(afterCallFields({ decision: 'maybe' }).error).toBe('Unknown decision.')
    expect(afterCallFields({ quote_due: 'next week' }).error).toBe('The quote date is not a date.')
    expect(afterCallFields({}).values.quote_due).toBeNull()
  })
  it('shows the header chips in order', () => {
    expect(cardChips(tender, { kind: 'project', customer: 'existing' }).map((c) => c.text)).toEqual(['Project quote', 'Contractor · verified', 'Tender', 'Existing customer'])
  })
})

// ─── Fit, proof and competition (2026-10-12) ───────────────────────────────

const ICP = {
  segments: [
    { key: 'hospitality', label: 'Hotels', track: 'core', weight: 3, match: ['hotel', 'resort'] },
    { key: 'controls', label: 'Lighting control', track: 'core', weight: 3, match: ['knx', 'lighting control'] },
    { key: 'large_dev', label: 'Giga projects', track: 'broader', weight: 2, match: ['giga city'] },
  ],
  buyers: [
    { key: 'contractor_awarded', weight: 3, note: 'Holds the job' },
    { key: 'operator', weight: 1, note: 'End user' },
    { key: 'contractor_bidding', weight: -2, note: 'Still bidding: quote light' },
  ],
  regions: ['riyadh'],
  size: { sweet_max: 500000, ok_max: 2000000, currency: 'SAR' },
}
const PROJECTS = 'Palm Grand Hotel, Riyadh — hotel; light fittings\nTower One, Riyadh — office; KNX lighting control\nCity Mall — retail mall'

describe('the ICP fit', () => {
  it('maps who wrote and the phase to the ICP buyer', () => {
    expect(buyerOf({ sender_type: 'contractor', project_final: 'jih' })).toBe('contractor_awarded')
    expect(buyerOf({ sender_type: 'contractor', project_final: 'tender' })).toBe('contractor_bidding')
    expect(buyerOf({ sender_type: 'contractor', project_final: '', subject: 'Office fit-out' })).toBe('fitout')
    expect(buyerOf({ sender_type: 'end_client' })).toBe('operator')
  })
  it('scores like Targets, with the reasons and what to watch', () => {
    const hotel = { sender_type: 'contractor', project_final: 'jih', summary: 'Hotel lobby lighting', details: { location: 'Riyadh' } }
    expect(icpFit(hotel, ICP)).toEqual({ band: 'strong', text: 'Strong fit (core): Hotels, Contractor already holding the job, In our region.' })
    expect(icpFit(tender, ICP).text).toBe('Weak fit (growth): Giga projects (growth segment). Watch: Still bidding: quote light.')
    expect(icpFit(trader, ICP).text).toMatch(/^Weak fit: no segment.*Watch: A trader: a stock deal, not a project\.$/)
    expect(icpFit(hotel, null)).toEqual({ band: '', text: '' })
  })
  it('counts an existing customer, as the ICP says to', () => {
    const r = icpFit({ sender_type: 'end_client', summary: 'Spare parts', details: { location: 'Riyadh' } }, ICP, { existing: true })
    expect(r.band).toBe('possible')
    expect(r.text).toMatch(/^Possible fit: Existing customer, /)
  })
})

describe('proof and competition', () => {
  it('names our projects in the lead\'s segment, two at most', () => {
    expect(pickReferences({ summary: 'KNX for a hotel' }, PROJECTS, ICP)).toEqual(['Palm Grand Hotel, Riyadh — hotel; light fittings', 'Tower One, Riyadh — office; KNX lighting control'])
    expect(pickReferences({ summary: 'Street poles' }, PROJECTS, ICP)).toEqual([])
    expect(pickReferences({ summary: 'Hotel' }, '', ICP)).toEqual([])
  })
  it('says which competitor holds a brand we do not carry', () => {
    const cb = [{ competitor: 'Rival Co', brand: 'Acme Lights', relationship: 'exclusive' }, { competitor: 'Old Co', brand: 'Acme Lights', relationship: 'ended' }]
    expect(heldBy(['Acme Lights', 'Other'], cb)).toEqual(['Acme Lights: Rival Co (exclusive).'])
    const card = buildLeadCard({ ...tender, details: { ...tender.details, brands: 'Acme Lights' } }, { suppliers: SUPPLIERS, competitorBrands: cb })
    expect(card.facts.brand).toBe('Not ours: Acme Lights. Offer our own or an approved equal, or say early that we can\'t. Acme Lights: Rival Co (exclusive).')
  })
  it('takes objection answers from the Agent Brief cards, once each, with the walk-away', () => {
    const cards = {
      inbound: { objections: [{ objection: 'Too dear.', answer: 'Ask their target.', walk_away: 'Gap above 20%.', when: 'price_pressure' }, { objection: 'No tag.', answer: 'x' }] },
      outbound: { objections: [{ objection: 'Too dear.', answer: 'Other answer.', when: 'price_pressure' }, { objection: 'Not awarded.', answer: 'Budget price.', walk_away: '—', when: 'bidding' }] },
    }
    const objections = objectionsFromCards(cards)
    expect(objections).toEqual([
      { when: 'price_pressure', objection: 'Too dear.', answer: 'Ask their target. Walk away if: Gap above 20%.' },
      { when: 'bidding', objection: 'Not awarded.', answer: 'Budget price.' },
    ])
    expect(buildLeadCard(tender, { objections }).pushback).toEqual([{ objection: 'Not awarded.', answer: 'Budget price.' }])
  })
  it('finds watchlist competitors by name, domain or a brand they hold', () => {
    const rivals = [
      { name: 'Nouran Lighting', domain: 'nouran.net', brands: [] },
      { name: 'Lumiere (which one? ask sales)', domain: '', brands: [] },
      { name: 'Rival Co', domain: '', brands: [{ brand: 'Acme Lights' }] },
    ]
    expect(matchCompetitors('nouran, LUMIERE and someone with acme lights', rivals).map((c) => c.name)).toEqual(['Nouran Lighting', 'Lumiere (which one? ask sales)', 'Rival Co'])
    expect(matchCompetitors('', rivals)).toEqual([])
  })
  it('keeps the fit and references through a save, and drops a bad band', () => {
    const c = normaliseLeadCard({ fit: { band: 'great', text: 'Fits' }, references: ['A', '', 'B'] })
    expect(c.fit).toEqual({ band: '', text: 'Fits' })
    expect(c.references).toEqual(['A', 'B'])
    expect(cardChips({}, { fit: { band: 'strong' } }).map((x) => x.text)).toContain('Strong fit')
  })
})
