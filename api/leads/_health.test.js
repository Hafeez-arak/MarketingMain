import { describe, it, expect } from 'vitest'
import { healthIssues, plan, alertEmail, runHealth, REMIND_MS } from './_health.js'

const NOW = new Date('2026-10-07T12:00:00Z')
const minsAgo = (m) => new Date(NOW.getTime() - m * 60_000).toISOString()
const healthy = { last_intake_at: minsAgo(3), last_export_at: minsAgo(4) }
const keys = (issues) => issues.map((i) => i.key)

describe('healthIssues', () => {
  it('all quiet when everything called in recently', () => {
    expect(healthIssues({ settings: healthy, mailboxes: [{ email: 'a@x.sa', status: 'active', last_checked_at: minsAgo(4) }], key: { valid: true, limitRemaining: 40 }, spent: 1, cap: 30, now: NOW })).toEqual([])
  })
  it('a Sheet silent for more than 30 minutes, and one never connected is not a problem', () => {
    expect(keys(healthIssues({ settings: { last_intake_at: minsAgo(45), last_export_at: minsAgo(3) }, now: NOW }))).toEqual(['website_sheet'])
    expect(keys(healthIssues({ settings: { last_intake_at: minsAgo(3), last_export_at: minsAgo(90) }, now: NOW }))).toEqual(['workbook'])
    expect(healthIssues({ settings: { last_intake_at: null, last_export_at: null }, now: NOW })).toEqual([])
  })
  it('mailboxes: reconnect, a failing read, and a stale one, but not stale while the Sheet is down', () => {
    const mbs = [
      { email: 'a.rak@x.sa', label: 'info@x.sa', status: 'reconnect', last_error: 'Refused' },
      { email: 'b@x.sa', status: 'active', last_error: 'Throttled', last_checked_at: minsAgo(2) },
      { email: 'c@x.sa', status: 'active', last_error: '', last_checked_at: minsAgo(60) },
    ]
    const all = healthIssues({ settings: healthy, mailboxes: mbs, now: NOW })
    expect(keys(all)).toEqual(['mailbox_reconnect:a.rak@x.sa', 'mailbox_error:b@x.sa', 'mailbox_stale:c@x.sa'])
    expect(all[0].title).toContain('info@x.sa')
    const sheetDown = healthIssues({ settings: { ...healthy, last_intake_at: minsAgo(60) }, mailboxes: [mbs[2]], now: NOW })
    expect(keys(sheetDown)).toEqual(['website_sheet'])
  })
  it('AI errors, a refused key, low credit, and the budget', () => {
    expect(keys(healthIssues({ settings: healthy, failed: [{ error: 'Rate limit' }], now: NOW }))).toEqual(['ai_errors'])
    expect(keys(healthIssues({ settings: healthy, key: { valid: false }, now: NOW }))).toEqual(['ai_key'])
    expect(keys(healthIssues({ settings: healthy, key: { valid: true, limitRemaining: 3.2 }, now: NOW }))).toEqual(['ai_credit_low'])
    expect(healthIssues({ settings: healthy, key: { valid: null }, now: NOW })).toEqual([]) // OpenRouter unreachable: no verdict
    expect(keys(healthIssues({ settings: healthy, spent: 25, cap: 30, now: NOW }))).toEqual(['budget_80'])
    expect(keys(healthIssues({ settings: healthy, spent: 30, cap: 30, now: NOW }))).toEqual(['budget_used'])
  })
})

describe('the weekly research', () => {
  const CREDIT = '400 {"error":{"message":"Your credit balance is too low to access the Anthropic API."}}'
  const dead = [{ status: 'complete', stage: 'gather', error: CREDIT, trigger: 'scheduled', started_at: minsAgo(2 * 24 * 60) }]

  it('a run that researched nothing is an issue, in plain words', () => {
    const [i] = healthIssues({ settings: healthy, researchRuns: dead, now: NOW })
    expect(i.key).toBe('research_run')
    expect(i.title).toBe('Weekly research: The last run did not research anything: the Anthropic AI credit has run out')
    expect(i.fix).toMatch(/Plans & Billing/)
  })

  it('a good run, or no research at all, is quiet', () => {
    const good = [{ status: 'complete', stage: 'synthesise', error: '', trigger: 'scheduled', started_at: minsAgo(60) }]
    expect(healthIssues({ settings: healthy, researchRuns: good, now: NOW })).toEqual([])
    expect(healthIssues({ settings: healthy, researchRuns: [], now: NOW })).toEqual([])
  })

  it('is reminded weekly, not daily', () => {
    const [i] = healthIssues({ settings: healthy, researchRuns: dead, now: NOW })
    const first = plan([i], {}, NOW)
    expect(first.fresh).toHaveLength(1)
    const nextDay = plan([i], first.state, new Date(NOW.getTime() + REMIND_MS + 1))
    expect(nextDay.remind).toHaveLength(0)
    const nextWeek = plan([i], first.state, new Date(NOW.getTime() + 7 * 24 * 3_600_000 + 1))
    expect(nextWeek.remind).toHaveLength(1)
  })
})

describe('plan', () => {
  const issue = (key, extra = {}) => ({ key, title: key, detail: '', fix: '', ...extra })
  it('a new problem is emailed once, then stays quiet', () => {
    const first = plan([issue('workbook')], {}, NOW)
    expect(first.fresh).toHaveLength(1)
    const second = plan([issue('workbook')], first.state, new Date(NOW.getTime() + 10 * 60_000))
    expect(second.fresh.length + second.remind.length).toBe(0)
  })
  it('a problem with a grace period waits until it has lasted that long', () => {
    const g = issue('mailbox_error:b@x.sa', { grace: 20 * 60_000 })
    const first = plan([g], {}, NOW)
    expect(first.fresh).toHaveLength(0)
    const later = plan([g], first.state, new Date(NOW.getTime() + 25 * 60_000))
    expect(later.fresh).toHaveLength(1)
  })
  it('reminds after a day, and reports fixed only what was emailed', () => {
    const s = { workbook: { since: NOW.toISOString(), sentAt: NOW.toISOString(), title: 'workbook' }, 'mailbox_error:b': { since: NOW.toISOString(), sentAt: null, title: 'quiet' } }
    const day = plan([issue('workbook')], s, new Date(NOW.getTime() + REMIND_MS + 1))
    expect(day.remind).toHaveLength(1)
    const gone = plan([], s, NOW)
    expect(gone.fixed.map((f) => f.key)).toEqual(['workbook'])
    expect(gone.state).toEqual({})
  })
})

describe('alertEmail', () => {
  it('names the problem in the subject and says what to do', () => {
    const m = alertEmail({ fresh: [{ key: 'workbook', title: 'The leads workbook has stopped updating', detail: 'D', fix: 'F' }], pageUrl: 'https://app/leads' })
    expect(m.subject).toBe('⚠️ Arak agents: The leads workbook has stopped updating')
    expect(m.text).toContain('What to do: F')
    expect(m.html).toContain('href="https://app/leads"')
    expect(alertEmail({ fixed: [{ title: 'A' }, { title: 'B' }] }).subject).toBe('✅ Arak agents: 2 problems fixed')
  })
})

describe('runHealth', () => {
  function world({ settings = {}, claimed = true, sendOk = true } = {}) {
    const state = { settings: { workspace_id: 'ws', enabled: true, alert_emails: ['junaid@x.sa'], alert_state: {}, ...healthy, ...settings }, sent: [], patches: [] }
    const db = async (path, init = {}) => {
      if (path.startsWith('lead_agent_settings?') && init.method === 'PATCH') {
        state.patches.push(path)
        if (init.body.last_health_at) return claimed ? [state.settings] : []
        Object.assign(state.settings, init.body); return []
      }
      if (path.startsWith('lead_mailboxes?')) return []
      if (path.startsWith('leads?')) return []
      if (path.startsWith('workspaces?')) return [{ name: 'Example Co', agent_monthly_cap_usd: 30 }]
      if (path.startsWith('agent_usage?')) return []
      throw new Error(path)
    }
    const deps = { db, now: () => NOW, keyInfo: async () => ({ valid: true, limitRemaining: 40 }), sendAlert: async (m) => { state.sent.push(m); return sendOk ? { ok: true } : { ok: false, error: 'Graph down' } } }
    return { state, deps }
  }
  it('another check ran in the last 10 minutes: does nothing', async () => {
    const w = world({ claimed: false })
    expect(await runHealth(w.deps, { workspaceId: 'ws' })).toEqual({ skipped: true })
    expect(w.state.patches[0]).toContain('last_health_at.lt.')
  })
  it('emails a new problem to the alert address and remembers it', async () => {
    const w = world({ settings: { last_export_at: minsAgo(60) } })
    const out = await runHealth(w.deps, { workspaceId: 'ws' })
    expect(out.fresh).toBe(1)
    expect(w.state.sent[0]).toMatchObject({ workspaceId: 'ws', to: ['junaid@x.sa'] })
    expect(w.state.settings.alert_state.workbook.sentAt).toBe(NOW.toISOString())
  })
  it('if the email fails, nothing is remembered, so the next check tries again', async () => {
    const w = world({ settings: { last_export_at: minsAgo(60) }, sendOk: false })
    const out = await runHealth(w.deps, { workspaceId: 'ws' })
    expect(out.error).toBe('Graph down')
    expect(w.state.settings.alert_state).toEqual({})
  })
  it('switched off: no alerts', async () => {
    const w = world({ settings: { enabled: false, last_export_at: minsAgo(60) } })
    expect(await runHealth(w.deps, { workspaceId: 'ws' })).toEqual({ off: true })
    expect(w.state.sent).toHaveLength(0)
  })
})
