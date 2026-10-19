import { describe, it, expect } from 'vitest'
import {
  STAGES, stageMap, settingsOf, submittalItems, latestUpdate, projectHealth, projectBoard, stageLogChanges, plannedReminders,
} from './projects.js'
import { fakeOdooData } from '../../../dev/v2db/fakeOdoo.js'

const NOW = Date.parse('2026-10-19T09:00:00Z')
const DAY = 86_400_000
const iso = d => new Date(NOW - d * DAY).toISOString()
const odooDay = d => iso(d).slice(0, 10)

describe('the nine stages', () => {
  it('are in order, each with a limit and both languages', () => {
    expect(STAGES.map(s => s.key)).toEqual(['awarded', 'submittal', 'client_review', 'purchase_order', 'production', 'delivery', 'installation', 'handover', 'collection'])
    for (const s of STAGES) { expect(s.days).toBeGreaterThan(0); expect(s.ar).toBeTruthy() }
  })

  it('maps Odoo stage names, English or Arabic', () => {
    const m = stageMap([
      { id: 1, name: 'Awarded' }, { id: 2, name: 'Tech Submittal' }, { id: 3, name: 'Submittal review (consultant)' },
      { id: 4, name: 'PO issued' }, { id: 5, name: 'تصنيع وشحن' }, { id: 6, name: 'Delivery' },
      { id: 7, name: 'Installation' }, { id: 8, name: 'Hand-over' }, { id: 9, name: 'Maintenance' }, { id: 10, name: 'Cancelled' },
    ])
    expect(m).toEqual({ 1: 'awarded', 2: 'submittal', 3: 'client_review', 4: 'purchase_order', 5: 'production', 6: 'delivery', 7: 'installation', 8: 'handover', 9: 'collection' })
  })

  it('handover with a space, a hyphen or none; nine unnamed stages map by order', () => {
    for (const name of ['Hand over', 'Hand-over', 'Handover', 'التسليم']) expect(stageMap([{ id: 8, name }])).toEqual({ 8: 'handover' })
    const nine = Array.from({ length: 9 }, (_, i) => ({ id: 20 + i, name: `Step ${i + 1}`, sequence: i }))
    expect(Object.values(stageMap(nine))).toEqual(STAGES.map(s => s.key))
  })
})

describe('settings', () => {
  it('fill gaps with the defaults and ignore nonsense', () => {
    const s = settingsOf({ stage_days: { client_review: 21, production: -3 }, update_every_days: 'x' })
    expect(s.stage_days.client_review).toBe(21)
    expect(s.stage_days.production).toBe(60)
    expect(s.update_every_days).toBe(7)
  })
})

describe('submittals', () => {
  it('each item stands where its latest round stands', () => {
    const items = submittalItems([
      { id: 'a1', title: 'Fixtures', round: 1, submitted_at: odooDay(30), code: 'C', returned_at: odooDay(20) },
      { id: 'a2', title: 'Fixtures', round: 2, submitted_at: odooDay(12), code: null },
      { id: 'b1', title: 'Shop drawings', round: 1, submitted_at: odooDay(9), code: 'B', returned_at: odooDay(2) },
      { id: 'c1', title: 'Controls', round: 1, submitted_at: odooDay(8), code: 'D', returned_at: odooDay(3) },
      { id: 'd1', title: 'Samples', round: 1 },
    ], NOW)
    const by = Object.fromEntries(items.map(i => [i.title, i]))
    expect(by.Fixtures).toMatchObject({ state: 'waiting', round: 2, days: 12 })
    expect(by['Shop drawings']).toMatchObject({ state: 'approved' })
    expect(by.Controls).toMatchObject({ state: 'again', days: 3 })
    expect(by.Samples.state).toBe('draft')
  })
})

describe('projectHealth', () => {
  const update = { at: NOW - 2 * DAY, status: 'on_track' }
  it('green inside the stage\'s days with a fresh update', () => {
    expect(projectHealth({ stageKey: 'production', enteredAt: iso(10), update, now: NOW }).level).toBe('green')
  })
  it('red once the stage is over its days, amber near them', () => {
    const late = projectHealth({ stageKey: 'client_review', enteredAt: iso(20), update, now: NOW })
    expect(late.level).toBe('red')
    expect(late.reasons[0]).toMatchObject({ kind: 'stage_late', days: 6 })
    expect(projectHealth({ stageKey: 'client_review', enteredAt: iso(11), update, now: NOW }).reasons[0].kind).toBe('stage_near')
  })
  it('red when the delivery date passed before handover, not after', () => {
    expect(projectHealth({ project: { date: odooDay(3) }, stageKey: 'installation', enteredAt: iso(1), update, now: NOW }).level).toBe('red')
    expect(projectHealth({ project: { date: odooDay(3) }, stageKey: 'handover', enteredAt: iso(1), update, now: NOW }).level).toBe('green')
  })
  it('the update\'s status: off track is red, at risk amber; no update in 7 days is amber', () => {
    expect(projectHealth({ stageKey: 'awarded', enteredAt: iso(1), update: { ...update, status: 'off_track' }, now: NOW }).level).toBe('red')
    expect(projectHealth({ stageKey: 'awarded', enteredAt: iso(1), update: { ...update, status: 'at_risk' }, now: NOW }).level).toBe('amber')
    const stale = projectHealth({ stageKey: 'awarded', enteredAt: iso(1), update: { at: NOW - 7 * DAY, status: 'on_track' }, now: NOW })
    expect(stale.reasons.map(r => r.kind)).toEqual(['update_missing'])
  })
  it('a submittal with the client too long is amber; a resubmission overdue is red', () => {
    const waiting = [{ title: 'Fixtures', round: 1, state: 'waiting', days: 10, last: {} }]
    expect(projectHealth({ stageKey: 'client_review', enteredAt: iso(1), update, submittals: waiting, now: NOW }).reasons[0].kind).toBe('review_waiting')
    const again = [{ title: 'Fixtures', round: 1, state: 'again', days: 8, last: { code: 'C' } }]
    expect(projectHealth({ stageKey: 'submittal', enteredAt: iso(1), update, submittals: again, now: NOW }).level).toBe('red')
  })
})

describe('latestUpdate', () => {
  it('takes the newest from Campai or Odoo', () => {
    const u = latestUpdate([{ written_at: iso(5), status: 'at_risk' }], [{ date: odooDay(2), status: 'on_track', user_id: [9, 'Sara PM'] }])
    expect(u).toMatchObject({ status: 'on_track', source: 'odoo', by: 'Sara PM' })
  })
})

describe('the board from the fake Odoo', () => {
  const records = fakeOdooData()
  const now = Date.now()
  const board = projectBoard({ records, now })
  const by = Object.fromEntries(board.map(p => [p.id, p]))

  it('leaves archived projects out and puts red first', () => {
    expect(board.map(p => p.id)).not.toContain(406)
    expect(board.slice(0, 2).map(p => p.health.level)).toEqual(['red', 'red'])
  })
  it('reads each project\'s stage, manager and Odoo tasks', () => {
    expect(by[402]).toMatchObject({ stageKey: 'client_review', pm: 'Khalid PM', tasksOpen: 2, tasksLate: 1 })
    expect(by[402].health.reasons.map(r => r.kind)).toContain('stage_late')
    expect(by[404].health.reasons.map(r => r.kind)).toEqual(expect.arrayContaining(['past_end', 'off_track']))
    expect(by[401].health.level).toBe('green')
  })
})

describe('stageLogChanges', () => {
  const records = fakeOdooData()
  it('first sight takes Odoo\'s stage date; a changed stage is entered now', () => {
    const first = stageLogChanges({ records, log: [], now: NOW })
    expect(first.close).toEqual([])
    expect(first.open).toHaveLength(5)
    expect(first.open.every(r => !r.estimated)).toBe(true)
    const log = first.open.map((r, i) => ({ ...r, id: `l${i}` }))
    records['project.project'][0] = { ...records['project.project'][0], stage_id: [16, 'Delivery to site'] }
    const next = stageLogChanges({ records, log, now: NOW })
    expect(next.close).toEqual([401])
    expect(next.open).toEqual([expect.objectContaining({ odoo_project_id: 401, stage_key: 'delivery', entered_at: new Date(NOW).toISOString(), estimated: false })])
  })
  it('without a stage date in Odoo, the last change is used and marked estimated', () => {
    const r = { 'project.project.stage': records['project.project.stage'], 'project.project': [{ id: 1, active: true, stage_id: [11, 'Awarded'], write_date: '2026-10-01 08:00:00' }] }
    expect(stageLogChanges({ records: r, now: NOW }).open[0]).toMatchObject({ estimated: true, entered_at: '2026-10-01T08:00:00.000Z' })
  })
})

describe('plannedReminders', () => {
  it('one per late stage entry, missing update and waiting submittal, for the PM', () => {
    const board = projectBoard({ records: fakeOdooData(), now: Date.now() })
    const { make, keep } = plannedReminders(board, { pmUsers: { 402: 'u-khalid' }, logIds: { 402: 'log-1' }, now: NOW })
    const late = make.find(t => t.auto_key === 'stage_late:402:log-1')
    expect(late).toMatchObject({ assigned_to: 'u-khalid', priority: 'high', odoo_project_id: 402 })
    expect(late.title).toMatch(/Crescent tower phase 1: \d+ days over in Client review/)
    expect(make.filter(t => t.auto_key.startsWith('update_due:'))).toHaveLength(4)
    expect(make.find(t => t.auto_key.startsWith('update_due:403:')).assigned_to).toBeNull()
    expect(keep.size).toBe(make.length)
  })
})
