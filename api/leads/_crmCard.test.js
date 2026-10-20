import { describe, it, expect, beforeEach } from 'vitest'
import { ensureTeamFields, pushCard, pullCards, maybePullCards, setCrmTeam, crmTeams } from './_crmCard.js'
import { approveLead } from './_crm.js'
import { saveCard } from './_card.js'
import { PROPS } from '../../src/lib/sales/odooCard.js'

// The battle card in Odoo, both ways (2026-10-20), against a fake Odoo that
// behaves like 18.0 where it matters: a lead's Properties are written WHOLE,
// a lead shows only the fields its team defines, and changing a team needs
// Sales: Administrator. Our side is a small in-memory PostgREST. Made-up
// people and companies only (this repository is public).

const WS = '11111111-1111-4111-8111-111111111111'
const L1 = '22222222-2222-4222-8222-222222222222'
const ARIF = { id: '44444444-4444-4444-8444-444444444444' }
const OMAR = '55555555-5555-4555-8555-555555555555'
const TEAM = 42

// ── A fake Odoo ──────────────────────────────────────────────────────────
function fakeOdoo({ salesAdmin = true } = {}) {
  const o = { activities: {}, nextAct: 300, teams: { [TEAM]: { id: TEAM, name: 'Test team', lead_properties_definition: [] }, 10: { id: 10, name: 'Projects', lead_properties_definition: [] } }, leads: {}, notes: [], writes: [], nextId: 900 }
  const shown = (lead) => {
    const def = o.teams[lead.team_id]?.lead_properties_definition || []
    return def.map((d) => ({ ...d, value: d.type === 'separator' ? undefined : (lead.props[d.name] ?? false) }))
  }
  o.fetch = async (url, init) => {
    const { params } = JSON.parse(init.body)
    const ok = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))
    const err = (message) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'Odoo Server Error', data: { message } } }))
    if (params.service === 'common') return ok(7)
    const [, , , model, m, a, kw = {}] = params.args
    if (model === 'crm.team' && m === 'read') return ok(a[0].map((id) => o.teams[id]).filter(Boolean))
    if (model === 'crm.team' && m === 'search_read') return ok(Object.values(o.teams).map((t) => ({ id: t.id, name: t.name, user_id: false, member_ids: [], use_leads: true })))
    if (model === 'crm.team' && m === 'write') {
      if (!salesAdmin) return err("You are not allowed to modify 'Sales Team' (crm.team) records.")
      o.teams[a[0][0]].lead_properties_definition = a[1].lead_properties_definition
      return ok(true)
    }
    if (model === 'crm.lead' && m === 'search') return ok([])
    if (model === 'crm.lead' && m === 'create') {
      const id = o.nextId++
      o.leads[id] = { id, ...a[0], props: {} }
      return ok(id)
    }
    if (model === 'crm.lead' && m === 'read') return ok(a[0].map((id) => o.leads[id]).filter(Boolean).map((l) => ({ id: l.id, team_id: [l.team_id, 't'], user_id: [l.user_id || 21, 'Owner'], lead_properties: shown(l) })))
    if (model === 'ir.model' && m === 'search') return ok([77])
    if (model === 'mail.activity.type' && m === 'search') return ok([4])
    if (model === 'mail.activity' && m === 'create') { const id = o.nextAct++; o.activities[id] = { id, ...a[0] }; return ok(id) }
    if (model === 'mail.activity' && m === 'write') { Object.assign(o.activities[a[0][0]], a[1]); return ok(true) }
    if (model === 'mail.activity' && m === 'action_feedback') { o.activities[a[0][0]].done = kw.feedback; delete o.activities[a[0][0]]; return ok(1) }
    if (model === 'mail.activity' && m === 'search_read') return ok(Object.values(o.activities).filter((x) => a[0][0][2].includes(x.id)).map((x) => ({ id: x.id, summary: x.summary, date_deadline: x.date_deadline })))
    if (model === 'crm.lead' && m === 'write') {
      if (a[1].lead_properties) {
        o.writes.push({ ...a[1].lead_properties })
        // Odoo 18 writes the set whole: what is not sent is gone.
        o.leads[a[0][0]].props = { ...a[1].lead_properties }
      }
      return ok(true)
    }
    if (model === 'crm.lead' && m === 'message_post') { o.notes.push({ lead: a[0][0], ...kw }); return ok(1) }
    if (model === 'crm.tag') return ok(m === 'search' ? [1] : 1)
    if (model === 'res.users') return ok([21])
    return err(`fake odoo: ${model}.${m}`)
  }
  return o
}

// ── A small in-memory PostgREST ──────────────────────────────────────────
function cond(row, c) {
  const m = c.match(/^(\w+)\.(eq|neq|lt|is|in)\.(.*)$/)
  if (!m) throw new Error(`fake db: condition ${c}`)
  const [, col, op, raw] = m
  const v = row[col]
  if (op === 'is') return raw === 'null' ? v == null : String(v) === raw
  if (op === 'eq') return String(v ?? '') === raw
  if (op === 'neq') return String(v ?? '') !== raw
  if (op === 'lt') return v != null && String(v) < raw
  if (op === 'in') return raw.replace(/^\(|\)$/g, '').split(',').includes(String(v))
  return false
}
function orMatch(row, expr) {
  // or=(a.is.null,b.eq.x,and(c.eq.y,d.lt.z))
  const parts = []
  let depth = 0; let cur = ''
  for (const ch of expr.replace(/^\(|\)$/g, '')) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  parts.push(cur)
  return parts.some((p) => (p.startsWith('and(') ? orAnd(row, p.slice(4, -1)) : cond(row, p)))
}
const orAnd = (row, inner) => inner.split(',').every((c) => cond(row, c))

function fakeDb(tables) {
  const keyOf = { leads: 'id', lead_cards: 'lead_id', lead_crm: 'workspace_id', user_access: 'user_id', sales_seats: 'user_id' }
  return async (path, { method = 'GET', body } = {}) => {
    const [table, query = ''] = path.split('?')
    const rows = tables[table]
    if (!rows) throw new Error(`fake db: table ${table}`)
    const params = new URLSearchParams(query)
    const match = (row) => {
      for (const [k, v] of params) {
        if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue
        if (k === 'or') { if (!orMatch(row, v)) return false; continue }
        if (!cond(row, `${k}.${v}`)) return false
      }
      return true
    }
    if (method === 'GET') return rows.filter(match).map((r) => structuredClone(r))
    if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, structuredClone(body))); return hit.map((r) => structuredClone(r)) }
    if (method === 'POST') {
      const k = keyOf[table]
      const ex = rows.find((r) => r[k] === body[k])
      if (ex) return [structuredClone(ex)]
      rows.push(structuredClone(body)); return [structuredClone(body)]
    }
    throw new Error(`fake db: ${method} ${path}`)
  }
}

const theCard = {
  kind: 'project', customer: 'new', headline: 'Example Dev: facade lighting',
  facts: { who: 'Contractor, verified', wants: 'Facade lighting', brand: '', due: 'Two weeks' },
  fit: { band: 'possible', text: 'Office segment' }, references: ['Tower One'], history: ['New to us.'],
  ask: [{ q: 'Is the main contract awarded?', a: '' }], pushback: [],
}

function world({ salesAdmin = true, teamId = TEAM, sent = false } = {}) {
  const odoo = fakeOdoo({ salesAdmin })
  const tables = {
    lead_crm: [{ workspace_id: WS, url: 'https://erp.example.com', db: 'erp', login: 'agent', api_key: 'sealed:key', odoo_uid: 7, team_id: teamId, team_name: 'Test team', last_pull_at: null, last_pull_error: '' }],
    leads: [{
      id: L1, workspace_id: WS, source: 'email', company: 'Example Dev', name: 'Khalid', email: 'k@example-dev.sa', summary: 'Facade lighting', subject: 'RFQ',
      verdict: 'qualified', human_verdict: null, criteria_version: 2, assigned_to: OMAR, approved_at: null, approved_by: null,
      crm_status: sent ? 'sent' : null, crm_id: sent ? '900' : '', crm_url: '', crm_error: '', next_step: '', follow_up: null, updated_at: '2026-10-20T08:00:00Z',
    }],
    lead_cards: [{ lead_id: L1, workspace_id: WS, card: structuredClone(theCard), decision: '', quote_due: null, target_price: '', decides: '', competitors: '', crm_props: null, crm_sync_error: '', updated_at: '2026-10-20T08:00:00Z' }],
    user_access: [{ user_id: ARIF.id, email: 'arif@example.com', full_name: 'Arif' }, { user_id: OMAR, email: 'omar@example.com', full_name: 'Omar' }],
    sales_seats: [{ user_id: OMAR, workspace_id: WS, odoo_login: '', odoo_user_id: 21 }],
  }
  const state = { now: '2026-10-20T08:00:00Z' }
  const deps = { db: fakeDb(tables), fetch: odoo.fetch, now: () => new Date(state.now), open: (s) => s.replace(/^sealed:/, ''), seal: (s) => `sealed:${s}` }
  if (sent) odoo.leads[900] = { id: 900, team_id: teamId, props: {} }
  return { odoo, tables, deps, state }
}

describe('the team carries the card fields', () => {
  it('written once, in full; again only when our version changes', async () => {
    const w = world()
    const conn = { ...w.tables.lead_crm[0], url: 'https://erp.example.com', apiKey: 'key', ready: true }
    expect(await ensureTeamFields(w.deps, conn)).toEqual({ ok: true, changed: true })
    expect(w.odoo.teams[TEAM].lead_properties_definition.map((p) => p.name)).toEqual(PROPS.map((p) => p.name))
    expect(await ensureTeamFields(w.deps, conn)).toEqual({ ok: true, changed: false })
  })

  it('choosing a team adds the fields first; without Sales: Administrator the team is not chosen, and it says why', async () => {
    const w = world({ salesAdmin: false, teamId: null })
    const out = await setCrmTeam(w.deps, WS, 10)
    expect(out.status).toBe(409)
    expect(out.error).toMatch(/Sales: Administrator/)
    expect(w.tables.lead_crm[0].team_id).toBeNull()
    const ok = world({ teamId: null })
    expect((await setCrmTeam(ok.deps, WS, 10)).ok).toBe(true)
    expect(ok.tables.lead_crm[0]).toMatchObject({ team_id: 10, team_name: 'Projects' })
    expect((await crmTeams(ok.deps, WS)).current).toBe(10)
  })
})

describe('approving sends the card with the lead', () => {
  it('into the chosen team: the brief in Internal Notes, the six fields empty until the call, one line in its history', async () => {
    const w = world()
    const conn = { ...w.tables.lead_crm[0], apiKey: 'key', ready: true }
    await ensureTeamFields(w.deps, conn)
    const out = await approveLead(w.deps, { workspaceId: WS, leadId: L1, user: ARIF })
    expect(out.crm).toBe('sent')
    const odooLead = w.odoo.leads[900]
    expect(odooLead.team_id).toBe(TEAM)
    expect(odooLead.description).toMatch(/^<p><b>⚔ BATTLE CARD<\/b>/)
    expect(odooLead.description).toContain('1) Is the main contract awarded?')
    expect(odooLead.description).toContain(`Lead Agent ref: ${L1}`)
    expect(w.odoo.writes).toEqual([]) // nothing filled yet, so no field write
    expect(Object.keys(w.odoo.activities)).toEqual([])
    expect(w.odoo.notes).toHaveLength(1)
    expect(w.odoo.notes[0].body).toBe('<p>From the Arak leads platform, approved by Arif (arif@example.com). The brief to read before the call is in Internal Notes.</p>')
    expect(w.odoo.notes[0]).toMatchObject({ body_is_html: true, subtype_xmlid: 'mail.mt_note' })
    expect(w.tables.lead_cards[0].crm_sync_error).toBe('')
  })
})

describe('a card saved here, on a lead already in Odoo', () => {
  let w
  beforeEach(async () => {
    w = world({ sent: true })
    await ensureTeamFields(w.deps, { ...w.tables.lead_crm[0], apiKey: 'key', ready: true })
    await pushCard(w.deps, { workspaceId: WS, leadId: L1 })
    w.odoo.notes = []
  })

  it('writes only what changed here, keeps an edit made in Odoo meanwhile, and notes who changed what', async () => {
    w.odoo.leads[900].props.la_decides = 'Set in Odoo by the salesperson'
    const answered = { ...theCard, ask: [{ q: 'Is the main contract awarded?', a: 'Yes' }] }
    const out = await saveCard(w.deps, { workspaceId: WS, leadId: L1, user: { id: OMAR }, body: { card: answered, target_price: '180k SAR', decision: 'project_quote' } })
    expect(out.odoo).toMatchObject({ ok: true, changed: ['la_decision', 'la_target_price', 'la_call_notes'] })
    expect(w.odoo.leads[900].props).toEqual({ la_target_price: '180k SAR', la_decision: 'project_quote', la_call_notes: '1) Yes', la_decides: 'Set in Odoo by the salesperson', la_quote_due: false, la_competitors: false })
    expect(w.odoo.notes[0].body).toBe('<p>Battle card updated on the Arak leads platform by Omar: Decision: Project quote, with a date; Target price: 180k SAR; Call notes: 1) Yes.</p>')
  })

  it('the next step becomes the salesperson\'s to-do in Odoo; changed, it moves; cleared, it is marked done', async () => {
    const out = await saveCard(w.deps, { workspaceId: WS, leadId: L1, user: { id: OMAR }, body: { card: theCard, next_step: 'Send samples', follow_up: '2026-10-25' } })
    expect(out.odoo).toMatchObject({ ok: true, changed: ['next_step'] })
    const [id] = Object.keys(w.odoo.activities)
    expect(w.odoo.activities[id]).toMatchObject({ res_model_id: 77, res_id: 900, activity_type_id: 4, summary: 'Send samples', date_deadline: '2026-10-25', user_id: 21 })
    await saveCard(w.deps, { workspaceId: WS, leadId: L1, user: { id: OMAR }, body: { card: theCard, next_step: 'Send samples', follow_up: '2026-10-27' } })
    expect(Object.keys(w.odoo.activities)).toEqual([id])
    expect(w.odoo.activities[id].date_deadline).toBe('2026-10-27')
    await saveCard(w.deps, { workspaceId: WS, leadId: L1, user: { id: OMAR }, body: { card: theCard, next_step: '', follow_up: '' } })
    expect(w.odoo.activities).toEqual({})
    expect(w.tables.lead_cards[0].crm_activity_id).toBeNull()
    expect(w.odoo.notes.at(-1).body).toContain('Next step: done/cleared')
  })

  it('a save that changes nothing writes nothing', async () => {
    const writes = w.odoo.writes.length
    const out = await saveCard(w.deps, { workspaceId: WS, leadId: L1, user: { id: OMAR }, body: { card: theCard } })
    expect(out.odoo).toEqual({ ok: true, changed: [] })
    expect(w.odoo.writes.length).toBe(writes)
    expect(w.odoo.notes).toEqual([])
  })

  it('Odoo refusing: the save stands here, the error is kept, and the next read sends it first', async () => {
    const realFetch = w.deps.fetch
    w.deps.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { data: { message: 'Odoo is down' } } }))
    const out = await saveCard(w.deps, { workspaceId: WS, leadId: L1, user: { id: OMAR }, body: { card: theCard, decides: 'The owner' } })
    expect(out.card.decides).toBe('The owner')
    expect(out.odoo.ok).toBe(false)
    expect(w.tables.lead_cards[0].crm_sync_error).toMatch(/Odoo is down/)
    w.deps.fetch = realFetch
    const pulled = await pullCards(w.deps, WS)
    expect(pulled.failed).toBe(0)
    expect(w.odoo.leads[900].props.la_decides).toBe('The owner')
    expect(w.tables.lead_cards[0].crm_sync_error).toBe('')
  })
})

describe('reading back from Odoo (Odoo is the master)', () => {
  let w
  beforeEach(async () => {
    w = world({ sent: true })
    await ensureTeamFields(w.deps, { ...w.tables.lead_crm[0], apiKey: 'key', ready: true })
    await pushCard(w.deps, { workspaceId: WS, leadId: L1 })
  })

  it('takes what the salesperson filled in Odoo into our card', async () => {
    Object.assign(w.odoo.leads[900].props, { la_decision: 'park', la_call_notes: '1) Not yet, award in March | spoke to the PM' })
    const out = await pullCards(w.deps, WS)
    expect(out).toEqual({ read: 1, updated: 1, failed: 0 })
    const row = w.tables.lead_cards[0]
    expect(row.decision).toBe('park')
    expect(row.card.ask).toEqual([{ q: 'Is the main contract awarded?', a: 'Not yet, award in March' }, { q: 'Call note', a: 'spoke to the PM' }])
    expect(row.card.facts.who).toBe('Contractor, verified')
    // Nothing changed since: the next read changes nothing.
    expect(await pullCards(w.deps, WS)).toEqual({ read: 1, updated: 0, failed: 0 })
  })

  it('a to-do rescheduled in Odoo moves our follow-up; marked done there, our next step clears', async () => {
    w.tables.leads[0].next_step = 'Send samples'
    w.tables.leads[0].follow_up = '2026-10-25'
    await pushCard(w.deps, { workspaceId: WS, leadId: L1 })
    const [id] = Object.keys(w.odoo.activities)
    w.odoo.activities[id].date_deadline = '2026-10-29'
    await pullCards(w.deps, WS)
    expect(w.tables.leads[0]).toMatchObject({ next_step: 'Send samples', follow_up: '2026-10-29' })
    delete w.odoo.activities[id]
    await pullCards(w.deps, WS)
    expect(w.tables.leads[0]).toMatchObject({ next_step: '', follow_up: null })
    expect(w.tables.lead_cards[0].crm_activity_id).toBeNull()
  })

  it('runs from the heartbeat once at 07:50 and once at 13:00 Riyadh, never in between', async () => {
    w.state.now = '2026-10-20T04:51:00Z' // 07:51 Riyadh
    expect(await maybePullCards(w.deps, { workspaceId: WS })).toMatchObject({ read: 1 })
    w.state.now = '2026-10-20T04:56:00Z'
    expect(await maybePullCards(w.deps, { workspaceId: WS })).toBeNull()
    w.state.now = '2026-10-20T09:55:00Z'
    expect(await maybePullCards(w.deps, { workspaceId: WS })).toBeNull()
    w.state.now = '2026-10-20T10:02:00Z' // 13:02 Riyadh
    expect(await maybePullCards(w.deps, { workspaceId: WS })).toMatchObject({ read: 1 })
    expect(w.tables.lead_crm[0].last_pull_counts).toMatchObject({ read: 1 })
  })

  it('with no team chosen, nothing is read', async () => {
    w.tables.lead_crm[0].team_id = null
    expect(await maybePullCards(w.deps, { workspaceId: WS })).toBeNull()
  })
})
