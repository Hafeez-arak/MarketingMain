import { describe, it, expect, vi, beforeEach } from 'vitest'

// The CEO panel's server side (2026-10-18): routing by the rules, the marks
// a salesperson makes, his targets, and the once-a-day alert. Fake
// PostgREST, made-up people only (this repo is public). Assigning itself is
// _assign.js's job and tested there; here it is a stub that records calls.

vi.mock('./_assign.js', () => ({ assignLead: vi.fn(async () => ({ lead: {}, forward: { ok: true } })) }))

const { assignLead } = await import('./_assign.js')
const { routeWaiting, markLead, saveTargets, runDailyAlerts, gatherControl, weeklyIfDue, MIGRATION_MISSING } = await import('./_control.js')

const WS = '11111111-1111-4111-8111-111111111111'
const OMAR = '55555555-5555-4555-8555-555555555555'
const HUDA = '66666666-6666-4666-8666-666666666666'
const NOW = new Date('2026-10-18T09:00:00Z')
const hAgo = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const lid = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`

function world({ targets = {}, rules = [], leads = [], missing = false, sendOk = true, flags = null } = {}) {
  const state = {
    targets: { workspace_id: WS, routing_enabled: false, routing_since: null, routing_fallback: null, alert_emails: ['boss@example.com'], brief_emails: [], ...targets },
    rules, leads,
    people: [
      { user_id: OMAR, email: 'omar@example.com', full_name: 'Omar', status: 'approved', role: 'sales', leads_approver: false },
      { user_id: HUDA, email: 'huda@example.com', full_name: 'Huda', status: 'approved', role: 'sales', leads_approver: false },
    ],
    notifications: [], mails: [], patches: [], flags,
  }
  const db = async (path, { method = 'GET', body } = {}) => {
    const table = path.split('?')[0]
    if (missing && (table === 'company_targets' || table === 'lead_routing_rules')) throw new Error('Supabase 404: {"code":"PGRST205","message":"Could not find the table"}')
    if (table === 'company_targets') {
      if (method === 'GET') return [{ ...state.targets }]
      Object.assign(state.targets, body)
      return [{ ...state.targets }]
    }
    if (table === 'lead_routing_rules') return state.rules
    if (table === 'leads') {
      const id = /[?&]id=eq\.([0-9a-f-]{36})/.exec(path)?.[1]
      if (method === 'PATCH') {
        state.patches.push({ id, body })
        const row = state.leads.find((l) => l.id === id)
        if (!row) return []
        Object.assign(row, body)
        return [{ ...row }]
      }
      if (id) return state.leads.filter((l) => l.id === id).map((l) => ({ ...l }))
      if (path.includes('source=eq.website_form')) return []
      return state.leads.map((l) => ({ ...l }))
    }
    if (table === 'sales_seats') return state.people.map((p) => ({ user_id: p.user_id }))
    if (table === 'user_access') return state.people
    if (table === 'notifications') { state.notifications.push(...body); return null }
    if (table === 'workspaces') return [{ name: 'Example Co' }]
    if (table === 'ceo_briefs') return state.briefs || []
    if (table === 'project_flags') {
      if (!state.flags) throw new Error('Supabase 404: {"code":"PGRST205"}')
      if (method === 'PATCH') {
        const ids = (/odoo_project_id=in\.\(([^)]*)\)/.exec(path)?.[1] || '').split(',').map(Number)
        for (const f of state.flags) if (ids.includes(f.odoo_project_id)) Object.assign(f, body)
        return null
      }
      return state.flags.map((f) => ({ ...f }))
    }
    return []
  }
  const deps = {
    db, now: () => NOW,
    sendAlert: vi.fn(async (mail) => { state.mails.push(mail); return sendOk ? { ok: true } : { ok: false, error: new Error('mailbox refused') } }),
  }
  return { state, deps }
}

const qualified = (o) => ({ verdict: 'qualified', human_verdict: null, duplicate_of: null, assigned_to: null, details: {}, late_alerted: {}, ...o })

beforeEach(() => { assignLead.mockClear() })

describe('routeWaiting', () => {
  it('does nothing while routing is off', async () => {
    const { deps } = world({ leads: [qualified({ id: lid(1), received_at: hAgo(1) })] })
    expect(await routeWaiting(deps, { workspaceId: WS })).toEqual({ off: true })
    expect(assignLead).not.toHaveBeenCalled()
  })

  it('assigns by the first matching rule and records which rule', async () => {
    const rule = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', position: 1, sender_type: 'contractor', region: '', project_type: '', assign_to: HUDA }
    const { state, deps } = world({
      targets: { routing_enabled: true, routing_since: hAgo(24), routing_fallback: OMAR },
      rules: [rule],
      leads: [
        qualified({ id: lid(1), received_at: hAgo(2), sender_type: 'contractor' }),
        qualified({ id: lid(2), received_at: hAgo(2), sender_type: 'consultant' }),
        qualified({ id: lid(3), received_at: hAgo(48), sender_type: 'contractor' }), // before routing was on
      ],
    })
    const out = await routeWaiting(deps, { workspaceId: WS })
    expect(out.routed.map((r) => [r.lead, r.to])).toEqual([[lid(1), HUDA], [lid(2), OMAR]])
    expect(assignLead).toHaveBeenCalledTimes(2)
    expect(assignLead.mock.calls[0][1]).toMatchObject({ workspaceId: WS, leadId: lid(1), to: HUDA, user: { id: null } })
    expect(state.patches).toContainEqual({ id: lid(1), body: { routed_by_rule: rule.id } })
  })

  it('stays quiet before the migration is applied', async () => {
    const { deps } = world({ missing: true })
    expect(await routeWaiting(deps, { workspaceId: WS })).toEqual({ off: true })
  })
})

describe('markLead', () => {
  it('a quote sent is also the first reply, with its value', async () => {
    const { state, deps } = world({ leads: [qualified({ id: lid(1), received_at: hAgo(5), first_reply_at: null })] })
    const out = await markLead(deps, { workspaceId: WS, body: { lead_id: lid(1), what: 'quote_sent', deal_value_sar: '250000' } })
    expect(out.lead).toMatchObject({ quote_sent_at: NOW.toISOString(), first_reply_at: NOW.toISOString(), deal_value_sar: 250000 })
    expect(state.leads[0].first_reply_at).toBe(NOW.toISOString())
  })

  it('refuses a negative value and moves a future date back to now', async () => {
    const { deps } = world({ leads: [qualified({ id: lid(1) })] })
    expect((await markLead(deps, { workspaceId: WS, body: { lead_id: lid(1), what: 'quote_sent', deal_value_sar: -5 } })).status).toBe(400)
    const out = await markLead(deps, { workspaceId: WS, body: { lead_id: lid(1), what: 'replied', at: '2030-01-01T00:00:00Z' } })
    expect(out.lead.first_reply_at).toBe(NOW.toISOString())
    expect((await markLead(deps, { workspaceId: WS, body: { lead_id: lid(1), what: 'bogus' } })).status).toBe(400)
  })
})

describe('saveTargets', () => {
  it('checks every number and cleans the email lists', async () => {
    const { deps } = world()
    expect((await saveTargets(deps, { workspaceId: WS, body: { first_reply_hours: 0 } })).status).toBe(400)
    expect((await saveTargets(deps, { workspaceId: WS, body: { win_rate_pct: 140 } })).status).toBe(400)
    expect((await saveTargets(deps, { workspaceId: WS, body: { quote_hours: '' } })).status).toBe(400)
    const out = await saveTargets(deps, { workspaceId: WS, body: { revenue_month_sar: '4000000', pipeline_sar: '', alert_emails: 'Boss@Example.com, not-an-email; sales@example.com' } })
    expect(out.targets).toMatchObject({ revenue_month_sar: 4000000, pipeline_sar: null, alert_emails: ['boss@example.com', 'sales@example.com'] })
  })

  it('starts the routing clock when routing is switched on, not on every save', async () => {
    const { state, deps } = world()
    await saveTargets(deps, { workspaceId: WS, body: { routing_enabled: true } })
    expect(state.targets.routing_since).toBe(NOW.toISOString())
    state.targets.routing_since = hAgo(10)
    await saveTargets(deps, { workspaceId: WS, body: { routing_enabled: true } })
    expect(state.targets.routing_since).toBe(hAgo(10))
  })

  it('refuses a fallback who is not on the sales team', async () => {
    const { deps } = world()
    const out = await saveTargets(deps, { workspaceId: WS, body: { routing_fallback: '99999999-9999-4999-8999-999999999999' } })
    expect(out.status).toBe(400)
  })
})

describe('runDailyAlerts', () => {
  const lateLead = () => qualified({ id: lid(1), company: 'Example Build', received_at: hAgo(80), assigned_to: OMAR, first_reply_at: hAgo(70) })

  it('emails the new items once, tells the owner in their bell, and remembers', async () => {
    const { state, deps } = world({ leads: [lateLead(), qualified({ id: lid(2), received_at: hAgo(3) })] })
    const out = await runDailyAlerts(deps, { workspaceId: WS })
    expect(out).toMatchObject({ items: 2, sent: true, to: ['boss@example.com'] })
    expect(state.mails[0].subject).toContain('2 items')
    expect(state.notifications).toHaveLength(1)
    expect(state.notifications[0]).toMatchObject({ user_id: OMAR, kind: 'late_quote' })
    expect(state.leads[0].late_alerted.late_quote).toBe(NOW.toISOString())
    expect(state.targets.last_alerts_at).toBe(NOW.toISOString())
    // The same day again: skipped. Forced: nothing new to say, so no email.
    expect(await runDailyAlerts(deps, { workspaceId: WS })).toEqual({ skipped: true })
    const again = await runDailyAlerts(deps, { workspaceId: WS, force: true })
    expect(again.items).toBe(0)
    expect(state.mails).toHaveLength(1)
  })

  it('a project that turned red is told once, first, with the stage named in both languages', async () => {
    const flags = [
      { odoo_project_id: 402, name: 'Tower phase 1', level: 'red', reasons: [{ kind: 'stage_late', level: 'red', days: 11, stage: 'client_review' }, { kind: 'at_risk', level: 'amber' }], red_since: hAgo(5), alerted_at: null },
      { odoo_project_id: 404, name: 'Hotel lobby', level: 'red', reasons: [{ kind: 'past_end', level: 'red', days: 3 }, { kind: 'off_track', level: 'red' }], red_since: hAgo(30), alerted_at: hAgo(20) },
      { odoo_project_id: 401, name: 'Clinic', level: 'green', reasons: [], red_since: null, alerted_at: null },
    ]
    const { state, deps } = world({ flags })
    const out = await runDailyAlerts(deps, { workspaceId: WS })
    expect(out).toMatchObject({ items: 1, sent: true })
    expect(state.mails[0].text).toContain('مشاريع أصبحت حمراء (1)')
    expect(state.mails[0].text).toContain('Tower phase 1: 11 days over in Client review')
    expect(state.mails[0].text).toContain('متأخر 11 يومًا في مراجعة العميل')
    expect(state.mails[0].text).not.toContain('Hotel lobby') // told yesterday
    expect(state.flags[0].alerted_at).toBe(NOW.toISOString())
    const again = await runDailyAlerts(deps, { workspaceId: WS, force: true })
    expect(again.items).toBe(0)
  })

  it('the panel carries Technical\'s project flags (its at-risk count and the alert read them)', async () => {
    const { deps } = world({ flags: [{ odoo_project_id: 1, level: 'red', reasons: [] }, { odoo_project_id: 2, level: 'amber', reasons: [] }] })
    const f = await gatherControl(deps, WS, NOW)
    expect(f.projectFlags).toHaveLength(2)
  })

  it('marks nothing when the email could not be sent, so tomorrow tries again', async () => {
    const { state, deps } = world({ leads: [lateLead()], sendOk: false })
    const out = await runDailyAlerts(deps, { workspaceId: WS })
    expect(out.error).toBe('mailbox refused')
    expect(state.leads[0].late_alerted).toEqual({})
    expect(state.targets.last_alerts_at).toBeUndefined()
  })
})

describe('gatherControl', () => {
  it('names the missing migration instead of failing obscurely', async () => {
    const { deps } = world({ missing: true })
    await expect(gatherControl(deps, WS, NOW)).rejects.toThrow(MIGRATION_MISSING)
  })
})

describe('weeklyIfDue', () => {
  const brief = { found: [{ tone: 'good', text: { en: 'Leads up.', ar: 'زادت الاستفسارات.' } }] }

  it('sends the five lines once on a Riyadh Sunday, with that morning\'s brief', async () => {
    const { state, deps } = world({ targets: { brief_emails: ['boss@example.com'] } })
    state.briefs = [{ brief }]
    deps.now = () => new Date('2026-10-18T05:10:00Z') // Sunday 08:10 Riyadh
    const out = await weeklyIfDue(deps, { workspaceId: WS })
    expect(out.sent).toBe(true)
    expect(out.lines).toHaveLength(5)
    expect(out.lines[0].en).toBe('Improved: Leads up.')
    expect(state.mails[0].to).toEqual(['boss@example.com'])
    expect(await weeklyIfDue(deps, { workspaceId: WS })).toEqual({ skipped: true })
  })

  it('stays quiet on other days', async () => {
    const { deps } = world({ targets: { brief_emails: ['boss@example.com'] } })
    deps.now = () => new Date('2026-10-19T05:10:00Z') // Monday
    expect(await weeklyIfDue(deps, { workspaceId: WS })).toEqual({ off: true })
  })
})
