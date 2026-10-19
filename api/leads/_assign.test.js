import { describe, it, expect, beforeEach } from 'vitest'
import { assignLead, teamList, teamSave, teamCheckOdoo, FORWARD_STUCK_MS } from './_assign.js'
import { scopesFor, SEND_SCOPES, forwardNote } from './_mail.js'
import { READ_SCOPES } from '../email/_graph.js'

// Assigning a lead (2026-10-13): the owner, the forward of the customer's
// email from the mailbox it arrived in, and the salesperson in Odoo. Fake
// PostgREST, fake Microsoft Graph and a fake Odoo. Made-up people only (this
// repo is public).

const WS = '11111111-1111-4111-8111-111111111111'
const L1 = '22222222-2222-4222-8222-222222222222'
const WEB = '33333333-3333-4333-8333-333333333333'
const ARIF = { id: '44444444-4444-4444-8444-444444444444', email: 'arif@example.com', full_name: 'Arif' }
const OMAR = { id: '55555555-5555-4555-8555-555555555555', email: 'omar@example.com', full_name: 'Omar Saleh' }
const HUDA = { id: '66666666-6666-4666-8666-666666666666', email: 'huda@example.com', full_name: 'Huda' }
const STRANGER = '77777777-7777-4777-8777-777777777777'
const MB = { id: 'mb-1', workspace_id: WS, email: 'a.box@example.com', label: 'info@example.com', tenant: '', status: 'active', can_send: true, created_at: '2026-10-01' }

function world({ canSend = true, graphRefuses = false, crm = null } = {}) {
  const state = {
    now: '2026-10-13T09:00:00Z',
    leads: [
      { id: L1, workspace_id: WS, source: 'email', mailbox: 'info@example.com', source_ref: '<rfq-1@client.example>', name: 'Khalid', company: 'Example Dev', email: 'khalid@client.example', subject: 'RFQ', summary: 'Downlights for a villa', message: 'Please quote.', assigned_to: null, forward_status: null, crm_status: null, crm_id: '', approved_at: null, updated_at: '2026-10-13T08:00:00Z' },
      { id: WEB, workspace_id: WS, source: 'website_form', mailbox: '', source_ref: 'row-9', name: 'Nora', company: '', email: 'nora@client.example', phones: ['+966 55 000 2222'], summary: 'Garden lights', message: 'Need <b>12</b> bollards.', assigned_to: null, forward_status: null, crm_status: null, crm_id: '', approved_at: null, updated_at: '2026-10-13T08:00:00Z' },
    ],
    people: [
      { user_id: ARIF.id, email: ARIF.email, full_name: ARIF.full_name, status: 'approved', role: 'sales', leads_approver: true },
      { user_id: OMAR.id, email: OMAR.email, full_name: OMAR.full_name, status: 'approved', role: 'sales', leads_approver: false },
      { user_id: HUDA.id, email: HUDA.email, full_name: HUDA.full_name, status: 'approved', role: 'sales', leads_approver: false },
    ],
    seats: [
      { user_id: ARIF.id, workspace_id: WS, all_website_leads: false, odoo_login: '', odoo_user_id: null },
      { user_id: OMAR.id, workspace_id: WS, all_website_leads: true, odoo_login: '', odoo_user_id: null },
      { user_id: HUDA.id, workspace_id: WS, all_website_leads: false, odoo_login: '', odoo_user_id: null },
    ],
    mailboxes: [{ ...MB, can_send: canSend }],
    crm,
    sent: [], // what Graph was asked to send
    odoo: { writes: [], users: { 'omar@example.com': 21, 'huda@example.com': 23 } },
  }
  const leadOf = (path) => state.leads.find((l) => path.includes(`id=eq.${l.id}`))
  const db = async (path, { method = 'GET', body } = {}) => {
    if (path.startsWith('leads?')) {
      const row = leadOf(path)
      if (!row || !path.includes(`workspace_id=eq.${WS}`)) return []
      if (method === 'GET') return [{ ...row }]
      if (path.includes('or=(forward_status.is.null')) {
        const stuck = new Date(Date.parse(state.now) - FORWARD_STUCK_MS).toISOString()
        if (row.forward_status === 'sending' && !(row.updated_at < stuck)) return []
      }
      Object.assign(row, body)
      return [{ ...row }]
    }
    if (path.startsWith('sales_seats?')) {
      const rows = state.seats.filter((s) => path.includes(`workspace_id=eq.${s.workspace_id}`) && (!path.includes('user_id=eq.') || path.includes(`user_id=eq.${s.user_id}`)))
      if (method === 'PATCH') { rows.forEach((r) => Object.assign(r, body)); return rows }
      return rows.map((r) => ({ ...r }))
    }
    if (path.startsWith('user_access?')) return state.people.filter((p) => path.includes(p.user_id))
    if (path.startsWith('lead_mailboxes?')) {
      return state.mailboxes.filter((m) => !path.includes('can_send=eq.true') || m.can_send)
    }
    if (path.startsWith('lead_mailbox_secrets?')) return [{ mailbox_id: MB.id, secret: JSON.stringify({ rt: 'r', at: 'tok', exp: Date.parse(state.now) + 3_600_000 }) }]
    if (path.startsWith('lead_crm?')) return state.crm ? [state.crm] : []
    throw new Error(`fake db: ${method} ${path}`)
  }
  const fetchFn = async (url, init = {}) => {
    const u = String(url)
    if (u.endsWith('/jsonrpc')) {
      const { params } = JSON.parse(init.body)
      const ok = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))
      if (params.method === 'authenticate') return ok(7)
      const [, , , model, m, a] = params.args
      if (model === 'res.users' && m === 'search') { const id = state.odoo.users[String(a[0][1][2]).toLowerCase()]; return ok(id ? [id] : []) }
      if (model === 'crm.lead' && m === 'write') { state.odoo.writes.push(a); return ok(true) }
      return new Response(JSON.stringify({ error: { data: { message: `fake odoo: ${model}.${m}` } } }))
    }
    if (u.includes('/me/messages?')) return new Response(JSON.stringify({ value: [{ id: 'graph-id-1' }] }), { status: 200 })
    if (u.endsWith('/forward') || u.endsWith('/me/sendMail')) {
      if (graphRefuses) return new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } }), { status: 403 })
      state.sent.push({ url: u, auth: init.headers.Authorization, body: JSON.parse(init.body) })
      return new Response(null, { status: 202 })
    }
    throw new Error(`fake fetch: ${u}`)
  }
  const deps = {
    db, fetch: fetchFn, now: () => new Date(state.now),
    open: (s) => s, seal: (s) => s, ms: { configured: true, clientId: 'c', secret: 's', tenant: 'our-tenant' },
  }
  return { state, deps }
}

const connected = { workspace_id: WS, url: 'https://erp.example.com', db: 'erp', login: 'agent@example.com', api_key: 'key', odoo_uid: 7 }
const assign = (w, leadId, to, over = {}) => assignLead(w.deps, { workspaceId: WS, leadId, to, user: ARIF, appUrl: 'https://leads.example.com', ...over })

describe('assigning an email lead', () => {
  let w
  beforeEach(() => { w = world() })

  it('records the owner and FORWARDS the customer\'s email from the mailbox it came in, to them', async () => {
    const r = await assign(w, L1, OMAR.id)
    expect(r.forward).toEqual({ ok: true, from: 'info@example.com' })
    expect(r.lead).toMatchObject({ assigned_to: OMAR.id, assigned_by: ARIF.id, forward_status: 'sent', forward_to: OMAR.email, forward_error: '' })
    expect(w.state.sent).toHaveLength(1)
    const [sent] = w.state.sent
    expect(sent.url).toBe('https://graph.microsoft.com/v1.0/me/messages/graph-id-1/forward')
    expect(sent.body.toRecipients).toEqual([{ emailAddress: { address: OMAR.email, name: 'Omar Saleh' } }])
    expect(sent.body.comment).toBe(forwardNote({ toName: 'Omar Saleh', byName: 'Arif', appUrl: 'https://leads.example.com' }))
    expect(sent.body.comment).toMatch(/^Omar, this enquiry is assigned to you by Arif\./)
  })

  it('a mailbox that may only read: assigned all the same, the forward marked failed with what to do', async () => {
    w = world({ canSend: false })
    const r = await assign(w, L1, OMAR.id)
    expect(r.forward.ok).toBe(false)
    expect(r.lead).toMatchObject({ assigned_to: OMAR.id, forward_status: 'failed' })
    expect(r.lead.forward_error).toMatch(/info@example\.com can only read.*Allow forwarding/)
    expect(w.state.sent).toEqual([])
  })

  it('Microsoft refusing (permission taken away) says the same, not a raw code', async () => {
    w = world({ graphRefuses: true })
    const r = await assign(w, L1, OMAR.id)
    expect(r.lead.forward_error).toMatch(/can only read/)
  })

  it('a double click forwards once: the second is refused while the first is sending; a stuck one may retry', async () => {
    w.state.leads[0].forward_status = 'sending'
    w.state.leads[0].updated_at = '2026-10-13T08:59:30Z'
    const r = await assign(w, L1, OMAR.id)
    expect(r.status).toBe(409)
    expect(w.state.sent).toEqual([])
    w.state.leads[0].updated_at = '2026-10-13T08:50:00Z'
    expect((await assign(w, L1, OMAR.id)).forward.ok).toBe(true)
    expect(w.state.sent).toHaveLength(1)
  })

  it('assigning the same person again sends the email again and keeps when it was assigned', async () => {
    await assign(w, L1, OMAR.id)
    const first = w.state.leads[0].assigned_at
    w.state.now = '2026-10-13T10:00:00Z'
    await assign(w, L1, OMAR.id)
    expect(w.state.sent).toHaveLength(2)
    expect(w.state.leads[0].assigned_at).toBe(first)
  })

  it('only someone on this company\'s sales team', async () => {
    const r = await assign(w, L1, STRANGER)
    expect(r).toMatchObject({ status: 400, error: expect.stringMatching(/sales team/) })
    expect(w.state.leads[0].assigned_to).toBeNull()
    expect(w.state.sent).toEqual([])
  })

  it('never to a sales admin: they hand leads out (the owner, 2026-10-19)', async () => {
    const r = await assign(w, L1, ARIF.id)
    expect(r).toEqual({ status: 400, error: 'A sales admin assigns leads and does not work them. Choose a salesperson.' })
    expect(w.state.leads[0].assigned_to).toBeNull()
    expect(w.state.sent).toEqual([])
  })

  it('a lead of another company is not found', async () => {
    const r = await assignLead(w.deps, { workspaceId: '99999999-9999-4999-8999-999999999999', leadId: L1, to: OMAR.id, user: ARIF })
    expect(r.status).toBe(404)
  })
})

describe('assigning a website enquiry', () => {
  it('has no email to forward: it is written out and sent from the first mailbox that may send, the customer as Reply-To', async () => {
    const w = world()
    const r = await assign(w, WEB, OMAR.id)
    expect(r.forward).toEqual({ ok: true, from: 'info@example.com' })
    const [sent] = w.state.sent
    expect(sent.url).toBe('https://graph.microsoft.com/v1.0/me/sendMail')
    expect(sent.body.message.subject).toBe('Website enquiry: Garden lights')
    expect(sent.body.message.replyTo).toEqual([{ emailAddress: { address: 'nora@client.example', name: 'Nora' } }])
    expect(sent.body.message.body.content).toContain('+966 55 000 2222')
    // Their words are text, never markup.
    expect(sent.body.message.body.content).toContain('&lt;b&gt;12&lt;/b&gt;')
    expect(sent.body.saveToSentItems).toBe(true)
  })

  it('no mailbox may send yet: assigned, forward failed, says how', async () => {
    const w = world({ canSend: false })
    const r = await assign(w, WEB, OMAR.id)
    expect(r.lead).toMatchObject({ assigned_to: OMAR.id, forward_status: 'failed' })
    expect(r.lead.forward_error).toMatch(/No connected mailbox may send yet/)
  })
})

describe('taking a lead off everyone', () => {
  it('before approval: cleared, nothing sent', async () => {
    const w = world()
    await assign(w, L1, OMAR.id)
    const r = await assign(w, L1, null)
    expect(r.lead).toMatchObject({ assigned_to: null, forward_status: null, forward_to: '' })
    expect(w.state.sent).toHaveLength(1)
  })

  it('an approved lead always has someone: refused', async () => {
    const w = world()
    Object.assign(w.state.leads[0], { assigned_to: OMAR.id, approved_at: '2026-10-13T08:30:00Z', crm_status: 'queued' })
    const r = await assign(w, L1, null)
    expect(r.status).toBe(409)
    expect(w.state.leads[0].assigned_to).toBe(OMAR.id)
  })
})

describe('reassigning a lead already in Odoo', () => {
  it('changes the salesperson in Odoo too, and forwards to the new person', async () => {
    const w = world({ crm: connected })
    Object.assign(w.state.leads[0], { assigned_to: OMAR.id, approved_at: '2026-10-13T08:30:00Z', crm_status: 'sent', crm_id: '140' })
    const r = await assign(w, L1, HUDA.id)
    expect(r.odooError).toBe('')
    expect(w.state.odoo.writes).toEqual([[[140], { user_id: 23 }]])
    expect(w.state.sent[0].body.toRecipients[0].emailAddress.address).toBe(HUDA.email)
    expect(w.state.seats.find((s) => s.user_id === HUDA.id).odoo_user_id).toBe(23)
  })

  it('Odoo not reachable: reassigned here, and the page is told Odoo was not changed', async () => {
    const w = world({ crm: null })
    Object.assign(w.state.leads[0], { assigned_to: OMAR.id, approved_at: '2026-10-13T08:30:00Z', crm_status: 'sent', crm_id: '140' })
    const r = await assign(w, L1, HUDA.id)
    expect(r.lead.assigned_to).toBe(HUDA.id)
    expect(r.odooError).toMatch(/Odoo is not connected/)
  })

  it('a lead only waiting for Odoo is not written to Odoo', async () => {
    const w = world({ crm: connected })
    Object.assign(w.state.leads[0], { assigned_to: OMAR.id, approved_at: '2026-10-13T08:30:00Z', crm_status: 'queued' })
    await assign(w, L1, HUDA.id)
    expect(w.state.odoo.writes).toEqual([])
  })
})

describe('the sales team settings', () => {
  it('lists the team with who sees the website leads and who they are in Odoo', async () => {
    const w = world()
    const team = await teamList(w.deps, WS)
    expect(team.map((m) => m.full_name)).toEqual(['Arif', 'Huda', 'Omar Saleh'])
    expect(team.find((m) => m.user_id === OMAR.id)).toMatchObject({ all_website_leads: true, approver: false, odoo_user_id: null })
    expect(team.find((m) => m.user_id === ARIF.id).approver).toBe(true)
  })

  it('a new Odoo login forgets the user found for the old one', async () => {
    const w = world()
    w.state.seats[1].odoo_user_id = 21
    const r = await teamSave(w.deps, WS, { user_id: OMAR.id, odoo_login: ' Omar.S@Example.com ' })
    expect(r.team.find((m) => m.user_id === OMAR.id)).toMatchObject({ odoo_login: 'omar.s@example.com', odoo_user_id: null })
    const r2 = await teamSave(w.deps, WS, { user_id: HUDA.id, all_website_leads: true })
    expect(r2.team.find((m) => m.user_id === HUDA.id).all_website_leads).toBe(true)
  })

  it('checking Odoo finds who is there and names who is not', async () => {
    const w = world({ crm: connected })
    const r = await teamCheckOdoo(w.deps, WS)
    expect(r.missing).toEqual(['arif@example.com'])
    expect(r.team.find((m) => m.user_id === OMAR.id).odoo_user_id).toBe(21)
    expect((await teamCheckOdoo(world().deps, WS)).status).toBe(409)
  })
})

describe('the mailbox token keeps to what it was granted', () => {
  it('a read-only mailbox renews read only; one allowed to forward renews with Mail.Send', () => {
    expect(scopesFor({ can_send: false })).toBe(READ_SCOPES)
    expect(scopesFor({})).toBe(READ_SCOPES)
    expect(scopesFor({ can_send: true })).toBe(SEND_SCOPES)
    expect(SEND_SCOPES).toMatch(/Mail\.Read .*Mail\.Send$/)
    expect(SEND_SCOPES).not.toMatch(/ReadWrite/)
  })
})
