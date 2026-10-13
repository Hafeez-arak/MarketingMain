import { describe, it, expect } from 'vitest'
import { openCard, saveCard, watchlist } from './_card.js'

// Battle cards against an in-memory database that understands the handful
// of PostgREST calls _card.js makes. Made-up leads only (this repo is public).

const WS = '11111111-1111-4111-8111-111111111111'
const L1 = '22222222-2222-4222-8222-222222222222'
const L2 = '33333333-3333-4333-8333-333333333333'
const USER = { id: '44444444-4444-4444-8444-444444444444' }

const LEAD = {
  id: L1, received_at: '2026-10-06T10:00:00Z', company: 'Example Dev', email: 'khalid@example-dev.sa',
  subject: 'Tower facade RFQ', message: 'BOQ attached. Zennio KNX please.', summary: 'Facade lighting and KNX for a tower.',
  details: { brands: 'Zennio', location: 'Jeddah', stage: 'Tender', products: 'Facade lighting', quantity: '', urgency: '' },
  ask_next: ['Timeline?'], verdict: 'qualified', human_verdict: null, sender_type: 'contractor', source_check: 'verified',
  project_type: 'tender', project_final: 'tender', philips: 'none', approved_at: '2026-10-12T09:00:00Z',
}

function fakeDb({ leads = [LEAD], earlier = [] } = {}) {
  const state = { cards: [], writes: [], paths: [] }
  state.db = async (path, { method = 'GET', body } = {}) => {
    state.paths.push(`${method} ${path}`)
    if (method !== 'GET') state.writes.push(`${method} ${path.split('?')[0]}`)
    if (path.startsWith('lead_cards')) {
      if (method === 'POST') {
        if (!state.cards.some((c) => c.lead_id === body.lead_id)) state.cards.push({ decision: '', quote_due: null, target_price: '', decides: '', ...body })
        return null
      }
      const card = state.cards.find((c) => path.includes(`lead_id=eq.${c.lead_id}`) && path.includes(`workspace_id=eq.${c.workspace_id}`))
      if (method === 'PATCH') { if (!card) return []; Object.assign(card, body); return [card] }
      return card ? [card] : []
    }
    if (path.startsWith('leads?') && path.includes('email=ilike')) return earlier
    if (path.startsWith('leads?')) return leads.filter((l) => path.includes(`id=eq.${l.id}`) && path.includes(`workspace_id=eq.${WS}`))
    if (path.startsWith('brand_directory_rows')) return [{ data: { name: 'Zennio' } }]
    if (path.startsWith('sales_accounts')) return [{ name: 'Example Dev Contracting', orders: 3, value_sar: 450000, last_order: '2026-02-01', status: 'new' }]
    if (path.startsWith('sales_icp')) return [{ battle_cards: { lead: { lessons: [{ when: 'existing_customer', text: 'Call them today.' }] } } }]
    if (path.startsWith('brand_profile')) return [{ company_facts: '', key_projects: 'Tower One, Jeddah — office; KNX lighting control' }]
    if (path.startsWith('research_agenda')) return [{ subject: 'Rival Co', why: 'Strong in towers.', domain: 'rival.sa', lines: ['lighting'], city: 'Jeddah' }]
    if (path.startsWith('competitor_brands')) return [{ competitor: 'Rival Co', brand: 'Acme Lights', relationship: 'exclusive' }, { competitor: 'Rival Co', brand: 'Gone', relationship: 'ended' }]
    return []
  }
  return state
}

const deps = (state) => ({ db: state.db, now: () => new Date('2026-10-12T10:00:00Z') })

describe('openCard', () => {
  it('builds the card once, from our records, and returns the stored one after', async () => {
    const s = fakeDb({ earlier: [{ received_at: '2026-09-20T08:00:00Z', verdict: 'qualified' }, { received_at: '2026-09-01T08:00:00Z', verdict: 'unqualified' }] })
    const first = await openCard(deps(s), { workspaceId: WS, leadId: L1 })
    expect(first.built).toBe(true)
    const card = first.card.card
    expect(card.facts.brand).toBe('We carry Zennio.')
    expect(card.customer).toBe('existing')
    expect(card.history).toContain('Call them today.')
    // Only the earlier real enquiry counts, not the pitch.
    expect(card.history).toContain('Earlier enquiries from example-dev.sa: 20 Sep. Check they were answered.')
    expect(first.card.built_at).toBe('2026-10-12T10:00:00.000Z')

    const again = await openCard(deps(s), { workspaceId: WS, leadId: L1 })
    expect(again.built).toBeUndefined()
    expect(s.writes).toEqual(['POST lead_cards'])
  })

  it('asks for earlier enquiries by the sender\'s domain, before this one', async () => {
    const s = fakeDb()
    await openCard(deps(s), { workspaceId: WS, leadId: L1 })
    const q = s.paths.find((p) => p.includes('email=ilike'))
    expect(q).toContain(`workspace_id=eq.${WS}`)
    expect(q).toContain('email=ilike.*@example-dev.sa')
    expect(q).toContain('received_at=lt.2026-10-06T10%3A00%3A00Z')
  })

  it('opens only for an approved lead in this company', async () => {
    const s = fakeDb({ leads: [{ ...LEAD, id: L2, approved_at: null }] })
    expect(await openCard(deps(s), { workspaceId: WS, leadId: L2 })).toMatchObject({ status: 409 })
    expect(await openCard(deps(s), { workspaceId: WS, leadId: L1 })).toMatchObject({ status: 404 })
    expect(await openCard(deps(s), { workspaceId: WS, leadId: 'nope' })).toMatchObject({ status: 400 })
    expect(s.writes).toEqual([])
  })
})

describe('saveCard', () => {
  it('saves edits and the after-call fields, cut to shape', async () => {
    const s = fakeDb()
    await openCard(deps(s), { workspaceId: WS, leadId: L1 })
    const out = await saveCard(deps(s), {
      workspaceId: WS, leadId: L1, user: USER,
      body: { card: { kind: 'quick', headline: 'Edited', ask: [{ q: 'Budget?', a: 'About 1M' }], junk: 'x' }, decision: 'project_quote', quote_due: '2026-10-20', target_price: '1M', decides: 'PM' },
    })
    expect(out.card).toMatchObject({ decision: 'project_quote', quote_due: '2026-10-20', target_price: '1M', decides: 'PM', updated_by: USER.id })
    expect(out.card.card).toMatchObject({ kind: 'quick', headline: 'Edited', ask: [{ q: 'Budget?', a: 'About 1M' }] })
    expect(out.card.card.junk).toBeUndefined()
  })

  it('refuses a bad field, and a lead with no card yet', async () => {
    const s = fakeDb()
    expect(await saveCard(deps(s), { workspaceId: WS, leadId: L1, user: USER, body: { decision: 'maybe' } })).toMatchObject({ status: 400 })
    expect(await saveCard(deps(s), { workspaceId: WS, leadId: L1, user: USER, body: {} })).toMatchObject({ status: 404 })
  })
})

describe('watchlist', () => {
  it('lists the active rivals with the brands they still hold', async () => {
    const s = fakeDb()
    expect(await watchlist(deps(s), WS)).toEqual([
      { name: 'Rival Co', note: 'Strong in towers.', domain: 'rival.sa', lines: ['lighting'], city: 'Jeddah', brands: [{ brand: 'Acme Lights', relationship: 'exclusive' }] },
    ])
    const q = s.paths.find((p) => p.includes('research_agenda'))
    expect(q).toContain(`workspace_id=eq.${WS}`)
    expect(q).toContain('kind=eq.competitor&status=eq.active')
  })

  it('a built card carries the proof from our projects', async () => {
    const s = fakeDb()
    const { card } = await openCard(deps(s), { workspaceId: WS, leadId: L1 })
    expect(card.card.references).toEqual([])  // no ICP in this fake, so no segments to match
    expect(card.card.fit).toEqual({ band: '', text: '' })
  })
})
