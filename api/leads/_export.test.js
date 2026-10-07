import { describe, it, expect } from 'vitest'
import { exportLeads, toRow, riyadhTime, periodOf, EXPORT_PAGE } from './_export.js'

describe('periodOf', () => {
  it('splits by arrival in Riyadh time: New leads from 1 Oct, history from 1 Jul, older not shown', () => {
    expect(periodOf('2026-09-30T20:59:00Z')).toBe('history') // 23:59 Riyadh, 30 Sep
    expect(periodOf('2026-09-30T21:00:00Z')).toBe('new') // 00:00 Riyadh, 1 Oct
    expect(periodOf('2026-07-01T00:00:00Z')).toBe('history')
    expect(periodOf('2026-06-30T20:59:00Z')).toBe('')
    expect(periodOf('')).toBe('new')
  })
})

// Made-up leads only: this repo is public.
const WS = '00000000-0000-0000-0000-0000000000ee'
const KEY = '22222222-3333-4444-5555-666666666666'

function fakeDb(leads = []) {
  const state = { paths: [], settings: { workspace_id: WS, last_export_at: null } }
  const db = async (path, init = {}) => {
    state.paths.push(path)
    if (path.startsWith('lead_agent_settings?export_key=eq.')) return path.includes(KEY) ? [state.settings] : []
    if (path.startsWith('lead_agent_settings?workspace_id=eq.')) { Object.assign(state.settings, init.body); return [] }
    if (path.startsWith('leads?')) return leads
    throw new Error(path)
  }
  return { db, state }
}
const deps = (db) => ({ db, now: () => new Date('2026-10-07T09:00:00Z') })

describe('toRow', () => {
  it('a website lead: Riyadh time, project type in the brief, the agent\'s verdict and type', () => {
    const r = toRow({ id: 'a', source: 'website_form', received_at: '2026-10-06T10:00:00Z', name: 'Omar', company: 'Nour', email: 'o@n.sa', phone: '+966 50', subject: 'Commercial / office', message: 'Quote for 40 downlights', verdict: 'qualified', category: 'quotation_request', reason: 'Asks for a quote.' })
    expect(r).toMatchObject({ received: '2026-10-06 13:00', source: 'Website', brief: 'Project type: Commercial / office\n\nQuote for 40 downlights', verdict: 'Qualified', qualified: true, type: 'quotation request', link: '' })
  })
  it('an email lead: its mailbox in Source, subject in the brief, the Outlook link', () => {
    const r = toRow({ id: 'b', source: 'email', mailbox: 'info@example.sa', received_at: '2026-10-06T10:00:00Z', subject: 'Tower facade', message: 'We need facade lighting.', verdict: 'qualified', category: 'project_enquiry', link: 'https://outlook.office.com/x' })
    expect(r).toMatchObject({ source: 'Email (info@example.sa)', brief: 'Tower facade\n\nWe need facade lighting.', link: 'https://outlook.office.com/x' })
  })
  it('a person\'s correction wins, and a duplicate and an unchecked lead say so', () => {
    expect(toRow({ verdict: 'unqualified', human_verdict: 'qualified', category: 'vendor_pitch' })).toMatchObject({ verdict: 'Qualified', qualified: true })
    expect(toRow({ verdict: 'qualified', human_verdict: 'unqualified' })).toMatchObject({ verdict: 'Unqualified', qualified: false })
    expect(toRow({ verdict: 'duplicate' }).type).toBe('duplicate')
    expect(toRow({ verdict: null, error: 'Provider overloaded' }).verdict).toBe('Not checked yet')
  })
  it('the Sheet shows qualified and doubtful leads, nothing else', () => {
    expect(toRow({ verdict: 'needs_review' })).toMatchObject({ verdict: 'Needs review', show: true, qualified: true })
    expect(toRow({ verdict: 'qualified', human_verdict: 'needs_review' })).toMatchObject({ show: true })
    for (const v of ['unqualified', 'duplicate', null]) expect(toRow({ verdict: v }).show).toBe(false)
  })
})

describe('riyadhTime', () => {
  it('reads UTC as Riyadh, across midnight', () => {
    expect(riyadhTime('2026-10-06T22:30:00Z')).toBe('2026-10-07 01:30')
    expect(riyadhTime('')).toBe('')
  })
})

describe('exportLeads', () => {
  it('refuses a bad or unknown key', async () => {
    expect((await exportLeads(deps(fakeDb().db), { key: 'x' })).status).toBe(401)
    expect((await exportLeads(deps(fakeDb().db), { key: '99999999-3333-4444-5555-666666666666' })).status).toBe(401)
  })
  it('first call reads everything, oldest change first, and notes the visit', async () => {
    const { db, state } = fakeDb([{ id: 'a1', source: 'website_form', updated_at: '2026-10-06T10:00:00+00:00', verdict: 'qualified' }])
    const out = await exportLeads(deps(db), { key: KEY, cursor: '' })
    expect(out.leads).toHaveLength(1)
    expect(out.next).toBe('2026-10-06T10:00:00+00:00|a1')
    expect(out.more).toBe(false)
    expect(state.paths.find((p) => p.startsWith('leads?'))).toContain('order=updated_at.asc,id.asc')
    expect(state.paths.find((p) => p.startsWith('leads?'))).not.toContain('or=(')
    expect(state.settings.last_export_at).toBe('2026-10-07T09:00:00.000Z')
  })
  it('later calls ask for what changed after the cursor, breaking ties by id', async () => {
    const { db, state } = fakeDb([])
    const cursor = '2026-10-06T10:00:00+00:00|00000000-0000-0000-0000-0000000000a1'
    const out = await exportLeads(deps(db), { key: KEY, cursor })
    const path = state.paths.find((p) => p.startsWith('leads?'))
    expect(path).toContain(`or=(updated_at.gt.${encodeURIComponent('2026-10-06T10:00:00+00:00')},and(updated_at.eq.`)
    expect(path).toContain('id.gt.00000000-0000-0000-0000-0000000000a1')
    expect(out.next).toBe(cursor) // nothing new: the cursor stays
  })
  it('a full page says there is more', async () => {
    const rows = Array.from({ length: EXPORT_PAGE }, (_, i) => ({ id: `r${i}`, updated_at: '2026-10-06T10:00:00+00:00' }))
    const out = await exportLeads(deps(fakeDb(rows).db), { key: KEY })
    expect(out.more).toBe(true)
  })
})
