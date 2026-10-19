import { describe, it, expect } from 'vitest'
import { addLead, trackLead, deleteLead } from './_pipeline.js'
import { saveCard } from './_card.js'

// Leads added by hand, and stages, against an in-memory database that
// understands the PostgREST calls _pipeline.js and _card.js make. Made-up
// people only (this repo is public).

const WS = '11111111-1111-4111-8111-111111111111'
const SALES = { id: '44444444-4444-4444-8444-444444444444' }
const OTHER = '55555555-5555-4555-8555-555555555555'
const ADMIN = { id: '66666666-6666-4666-8666-666666666666' } // the access admin, no seat

const BOSS = '77777777-7777-4777-8777-777777777777' // a sales admin

function fakeDb({ seats = [SALES.id, OTHER, BOSS] } = {}) {
  const state = { leads: [], cards: [] }
  let n = 0
  state.db = async (path, { method = 'GET', body } = {}) => {
    if (path.startsWith('sales_seats')) return seats.filter((u) => path.includes(`user_id=eq.${u}`)).map((user_id) => ({ user_id }))
    if (path.startsWith('user_access')) {
      return seats.filter((u) => path.includes(`user_id=eq.${u}`))
        .map((user_id) => ({ user_id, email: `${user_id.slice(0, 4)}@example.com`, full_name: '', status: 'approved', role: 'sales', leads_approver: user_id === BOSS }))
    }
    if (path === 'leads' && method === 'POST') {
      const row = { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, '0')}`, ...body }
      state.leads.push(row)
      return [row]
    }
    if (path.startsWith('leads?') && path.includes('email=ilike')) return []
    if (path.startsWith('leads?')) {
      const lead = state.leads.find((l) => path.includes(`id=eq.${l.id}`) && path.includes(`workspace_id=eq.${l.workspace_id}`))
      if (method === 'PATCH') { if (!lead) return []; Object.assign(lead, body); return [lead] }
      if (method === 'DELETE') { if (!lead) return []; state.leads = state.leads.filter((l) => l !== lead); return [lead] }
      return lead ? [lead] : []
    }
    if (path.startsWith('lead_cards')) {
      if (method === 'POST') { if (!state.cards.some((c) => c.lead_id === body.lead_id)) state.cards.push({ decision: '', quote_due: null, target_price: '', decides: '', competitors: '', ...body }); return null }
      const card = state.cards.find((c) => path.includes(`lead_id=eq.${c.lead_id}`))
      if (method === 'PATCH') { Object.assign(card, body); return [card] }
      return card ? [card] : []
    }
    return []
  }
  return state
}
const deps = (state) => ({ db: state.db, now: () => new Date('2026-10-18T10:00:00Z') })
const BODY = { company: 'Example Fit-Out', name: 'Sara', phone: '055 1', channel: 'phone', summary: 'Linear profiles for an office, Riyadh', location: 'Riyadh', follow_up: '2026-10-20' }

describe('addLead', () => {
  it('saves a salesperson\'s lead as theirs, in the pipeline, with its battle card', async () => {
    const st = fakeDb()
    const out = await addLead(deps(st), { workspaceId: WS, user: SALES, body: { ...BODY, assign_to: OTHER } })
    expect(out.lead).toMatchObject({
      workspace_id: WS, source: 'manual', channel: 'phone', stage: 'new', verdict: 'qualified', human_verdict: 'qualified',
      // Not a sales admin: assign_to is ignored, the lead is their own.
      assigned_to: SALES.id, added_by: SALES.id, follow_up: '2026-10-20', received_at: '2026-10-18T10:00:00.000Z',
    })
    expect(out.lead.source_ref).toMatch(/^manual:/)
    expect(out.card.card.facts.wants).toBe('Linear profiles for an office, Riyadh · Riyadh')
    expect(st.cards).toHaveLength(1)
  })
  it('lets a sales admin give it to someone on the team, and no one else', async () => {
    const st = fakeDb()
    expect((await addLead(deps(st), { workspaceId: WS, user: SALES, body: { ...BODY, assign_to: OTHER }, canAssign: true })).lead.assigned_to).toBe(OTHER)
    const bad = await addLead(deps(st), { workspaceId: WS, user: SALES, body: { ...BODY, assign_to: ADMIN.id }, canAssign: true })
    expect(bad).toEqual({ status: 400, error: 'That person is not on this company\'s sales team.' })
  })
  it('never gives it to a sales admin, and a sales admin\'s own lead waits for a salesperson', async () => {
    const st = fakeDb()
    expect(await addLead(deps(st), { workspaceId: WS, user: SALES, body: { ...BODY, assign_to: BOSS }, canAssign: true }))
      .toEqual({ status: 400, error: 'A sales admin assigns leads and does not work them. Choose a salesperson.' })
    expect((await addLead(deps(st), { workspaceId: WS, user: { id: BOSS }, body: BODY })).lead.assigned_to).toBeNull()
  })
  it('leaves the access admin\'s lead with no one when they choose no one', async () => {
    const st = fakeDb()
    expect((await addLead(deps(st), { workspaceId: WS, user: ADMIN, body: BODY, canAssign: true })).lead.assigned_to).toBeNull()
    expect((await addLead(deps(st), { workspaceId: WS, user: ADMIN, body: { ...BODY, assign_to: null }, canAssign: true })).lead).toMatchObject({ assigned_to: null, assigned_at: null })
  })
  it('refuses a lead with nothing in it', async () => {
    expect(await addLead(deps(fakeDb()), { workspaceId: WS, user: SALES, body: { company: 'X' } })).toEqual({ status: 400, error: 'Say what they want.' })
  })
})

describe('trackLead', () => {
  it('moves the stage and stamps who and when; Lost needs a reason', async () => {
    const st = fakeDb()
    const { lead } = await addLead(deps(st), { workspaceId: WS, user: SALES, body: BODY })
    const later = { db: st.db, now: () => new Date('2026-10-19T08:00:00Z') }
    const moved = await trackLead(later, { workspaceId: WS, leadId: lead.id, user: SALES, body: { stage: 'quotation' } })
    expect(moved.lead).toMatchObject({ stage: 'quotation', stage_at: '2026-10-19T08:00:00.000Z', stage_by: SALES.id })
    expect((await trackLead(later, { workspaceId: WS, leadId: lead.id, user: SALES, body: { stage: 'lost' } })).error).toBe('Say why it was lost.')
    const step = await trackLead(deps(st), { workspaceId: WS, leadId: lead.id, user: SALES, body: { next_step: 'Call', follow_up: '2026-10-22' } })
    expect(step.lead).toMatchObject({ stage: 'quotation', stage_at: '2026-10-19T08:00:00.000Z', next_step: 'Call', follow_up: '2026-10-22' })
  })
  it('only moves a lead that is in the pipeline', async () => {
    const st = fakeDb()
    st.leads.push({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', workspace_id: WS, stage: null })
    expect(await trackLead(deps(st), { workspaceId: WS, leadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user: SALES, body: { stage: 'won' } }))
      .toEqual({ status: 409, error: 'This lead joins the pipeline when it is approved.' })
  })
})

describe('the card\'s next step', () => {
  it('saves the next step and follow-up date on the lead', async () => {
    const st = fakeDb()
    const { lead, card } = await addLead(deps(st), { workspaceId: WS, user: SALES, body: BODY })
    const out = await saveCard(deps(st), { workspaceId: WS, leadId: lead.id, user: SALES, body: { card: card.card, next_step: 'Send quote', follow_up: '2026-10-23' } })
    expect(out.lead).toMatchObject({ next_step: 'Send quote', follow_up: '2026-10-23' })
    expect((await saveCard(deps(st), { workspaceId: WS, leadId: lead.id, user: SALES, body: { follow_up: 'soon' } })).error).toBe('The follow-up date is not a date.')
  })
})

describe('deleteLead', () => {
  it('lets a salesperson delete only what they added, and a sales admin anything', async () => {
    const st = fakeDb()
    const { lead: mine } = await addLead(deps(st), { workspaceId: WS, user: SALES, body: BODY })
    const { lead: theirs } = await addLead(deps(st), { workspaceId: WS, user: { id: OTHER }, body: BODY })
    st.leads.push({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', workspace_id: WS, source: 'email', added_by: null, crm_status: 'sent' })
    expect((await deleteLead(deps(st), { workspaceId: WS, leadId: theirs.id, user: SALES })).status).toBe(403)
    expect((await deleteLead(deps(st), { workspaceId: WS, leadId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', user: SALES })).status).toBe(403)
    expect(await deleteLead(deps(st), { workspaceId: WS, leadId: mine.id, user: SALES })).toEqual({ deleted: mine.id, inOdoo: false })
    expect(await deleteLead(deps(st), { workspaceId: WS, leadId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', user: SALES, canAll: true })).toEqual({ deleted: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', inOdoo: true })
    expect(st.leads.map((l) => l.id)).toEqual([theirs.id])
    expect((await deleteLead(deps(st), { workspaceId: WS, leadId: mine.id, user: SALES, canAll: true })).status).toBe(404)
  })
  it('waits while the lead is being sent to Odoo', async () => {
    const st = fakeDb()
    st.leads.push({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', workspace_id: WS, source: 'email', crm_status: 'sending' })
    expect((await deleteLead(deps(st), { workspaceId: WS, leadId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', user: SALES, canAll: true })).status).toBe(409)
  })
})
