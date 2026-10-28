import { describe, it, expect } from 'vitest'
import {
  listName, partyOf, weighted, bidChip, dueState, nextActivities, sortLeads, applyFilters, searchLeads,
  boardLeads, boardColumns, activityBar, pipelineFigures, groupRows, leadGroupKey, pageOf, filterActivities,
  recordActivities, homeCounts, validateLead, leadRow, validateActivity, settingsOrder, nextSequence,
  validateListItem, reportFacts, measure, reportScope, pivot, quickRanges, fmtMeasure, pivotCsv, describeHistory,
  riyadhToday, BOARD_MAX,
} from './logic'

const TODAY = '2026-10-28'
const lead = (id, extra = {}) => ({
  id, lead_no: `L-2026-00000${id}`, title: `Lead ${id} (test)`, status: 'open', stage_id: 's1', priority: 0,
  created_at: `2026-10-0${id}T08:00:00Z`, expected_revenue: null, probability: null, ...extra,
})

describe('names and figures', () => {
  it('names a list item in the reader\'s language', () => {
    expect(listName({ name: 'جديدة', name_en: 'New' }, 'en')).toBe('New')
    expect(listName({ name: 'جديدة', name_en: 'New' }, 'ar')).toBe('جديدة')
    expect(listName({ name: 'جديدة' }, 'en')).toBe('جديدة')
  })

  it('says who an opportunity is with: client, then organisation, then person', () => {
    const clients = { c1: { name: 'Client (test)', name_ar: 'عميل (تجربة)' } }
    expect(partyOf({ client_org_id: 'c1', organization: 'Org' }, clients, 'ar')).toBe('عميل (تجربة)')
    expect(partyOf({ organization: 'Org', contact_name: 'Sara' })).toBe('Org')
    expect(partyOf({ contact_name: 'Sara' })).toBe('Sara')
  })

  it('weighs a value only when both figures are known', () => {
    expect(weighted({ expected_revenue: '100000', probability: 40 })).toBe(40000)
    expect(weighted({ expected_revenue: 100000, probability: null })).toBeNull()
    expect(weighted({ expected_revenue: null, probability: 50 })).toBeNull()
  })

  it('warns about a bid due within seven days, open opportunities only', () => {
    expect(bidChip({ status: 'open', bid_due_date: '2026-11-04' }, TODAY)).toEqual({ days: 7, tone: 'soon' })
    expect(bidChip({ status: 'open', bid_due_date: '2026-11-05' }, TODAY)).toEqual({ days: 8, tone: 'ok' })
    expect(bidChip({ status: 'open', bid_due_date: '2026-10-27' }, TODAY)).toEqual({ days: -1, tone: 'past' })
    expect(bidChip({ status: 'won', bid_due_date: '2026-10-27' }, TODAY)).toBeNull()
  })

  it('places a date against today, and finds each next activity', () => {
    expect(dueState('2026-10-27', TODAY)).toBe('late')
    expect(dueState(TODAY, TODAY)).toBe('today')
    expect(dueState('2026-10-29', TODAY)).toBe('planned')
    expect(dueState('', TODAY)).toBe('none')
    expect(nextActivities([
      { lead_id: 'a', due_date: '2026-11-02' }, { lead_id: 'a', due_date: '2026-10-30' },
      { lead_id: 'a', due_date: '2026-10-01', done_at: 'x' }, { lead_id: 'b', due_date: '2026-10-31' },
    ])).toEqual({ a: '2026-10-30', b: '2026-10-31' })
  })

  it('takes today from Riyadh\'s clock', () => {
    expect(riyadhToday(new Date('2026-10-28T22:30:00Z'))).toBe('2026-10-29')
  })
})

describe('the list: order, filters, search, groups', () => {
  const leads = [
    lead(1, { assigned_to: 'me', priority: 0 }),
    lead(2, { status: 'won', assigned_to: 'other', priority: 2 }),
    lead(3, { status: 'lost', priority: 0 }),
    lead(4, { assigned_to: 'me', priority: 1, created_at: '2026-09-15T08:00:00Z' }),
  ]
  const acts = [{ lead_id: 1, due_date: '2026-10-20' }, { lead_id: 4, due_date: '2026-11-01' }]
  const ctx = { me: 'me', today: TODAY, next: nextActivities(acts), openActs: { 1: [acts[0]], 4: [acts[1]] } }
  const ids = rows => rows.map(r => r.id)

  it('orders by priority, then newest', () => {
    expect(ids(sortLeads(leads))).toEqual([2, 4, 3, 1])
  })

  it('ORs filters inside a group and ANDs across groups', () => {
    expect(ids(applyFilters(leads, ['won', 'lost'], ctx))).toEqual([2, 3])
    expect(ids(applyFilters(leads, ['open', 'mine'], ctx))).toEqual([1, 4])
    expect(ids(applyFilters(leads, ['unassigned'], ctx))).toEqual([3])
    expect(ids(applyFilters(leads, ['overdue'], ctx))).toEqual([1])
    expect(ids(applyFilters([...leads, lead(5)], ['no_activity'], ctx))).toEqual([5])
    expect(ids(applyFilters(leads, ['starred'], ctx))).toEqual([2, 4])
    expect(ids(applyFilters(leads, ['this_month'], ctx))).toEqual([1, 2, 3])
  })

  it('searches the title, number, phone, client and tags', () => {
    const rows = [lead(1, { phone: '+966 50 111' }), lead(2, { client_org_id: 'c' }), lead(3)]
    const opts = { clientsById: { c: { name: 'Nour Towers (test)' } }, tagsOf: id => (id === 3 ? [{ name: 'GRMS' }] : []) }
    expect(ids(searchLeads(rows, '50 111', opts))).toEqual([1])
    expect(ids(searchLeads(rows, 'nour', opts))).toEqual([2])
    expect(ids(searchLeads(rows, 'grms', opts))).toEqual([3])
    expect(ids(searchLeads(rows, 'L-2026-000003', opts))).toEqual([3])
  })

  it('groups in order of first appearance, and pages', () => {
    const g = groupRows(sortLeads(leads), l => leadGroupKey(l, 'status'))
    expect(g.map(x => x.key)).toEqual(['won', 'open', 'lost'])
    expect(leadGroupKey({ source_id: null }, 'source')).toBe('')
    expect(pageOf([1, 2, 3, 4, 5], 1, 2)).toEqual([3, 4])
  })
})

describe('the pipeline', () => {
  const stages = [
    { id: 's2', sequence: 20, is_active: true }, { id: 's1', sequence: 10, is_active: true },
    { id: 's9', sequence: 5, is_active: false }, { id: 's8', sequence: 30, is_active: false },
  ]

  it('shows open opportunities unless a status filter is on, at most 800', () => {
    const rows = [lead(1), lead(2, { status: 'won' })]
    expect(boardLeads(rows, [])).toHaveLength(1)
    expect(boardLeads(rows, ['won'])).toHaveLength(2)
    expect(boardLeads(Array.from({ length: 900 }, (_, i) => lead(i)), [])).toHaveLength(BOARD_MAX)
  })

  it('keeps an archived stage only while something sits in it, and sums the known values', () => {
    const rows = [lead(1, { stage_id: 's1', expected_revenue: '100' }), lead(2, { stage_id: 's1' }), lead(3, { stage_id: 's9', expected_revenue: 5 })]
    const cols = boardColumns(stages, rows)
    expect(cols.map(c => c.stage.id)).toEqual(['s9', 's1', 's2'])
    expect(cols[1]).toMatchObject({ total: 100, unknown: 1 })
    expect(cols[2]).toMatchObject({ total: null, unknown: 0 })
  })

  it('draws each column\'s activity bar from its open opportunities', () => {
    const rows = [lead(1), lead(2), lead(3), lead(4), lead(5, { status: 'won' })]
    const next = { 1: '2026-10-01', 2: TODAY, 3: '2026-12-01' }
    expect(activityBar(rows, next, TODAY)).toEqual({ late: 1, today: 1, planned: 1, none: 1 })
  })

  it('computes the four figures: unknown is counted, never zero', () => {
    const rows = [lead(1, { expected_revenue: 1000, probability: 50 }), lead(2, { expected_revenue: 500 }), lead(3), lead(4, { status: 'won', expected_revenue: 9 })]
    const acts = [{ lead_id: 1, due_date: '2026-10-01' }, { lead_id: 1, due_date: '2026-10-02' }, { lead_id: 2, due_date: '2026-11-01' }, { lead_id: 4, due_date: '2026-10-01' }]
    expect(pipelineFigures(rows, acts, TODAY)).toEqual({ open: 3, noValue: 1, expected: 1500, weighted: 500, noWeight: 2, late: 2 })
    expect(pipelineFigures([lead(1, { status: 'lost' })], [], TODAY)).toBeNull()
  })
})

describe('activities', () => {
  const acts = [
    { id: 1, lead_id: 'a', assigned_to: 'me', due_date: '2026-10-20', summary: 'Call back' },
    { id: 2, lead_id: 'a', assigned_to: 'me', due_date: TODAY, summary: 'Send sample' },
    { id: 3, lead_id: 'b', assigned_to: 'other', due_date: '2026-11-02', summary: 'Visit site' },
    { id: 4, lead_id: 'b', assigned_to: 'me', due_date: '2026-10-01', summary: 'Done one', done_at: 'x' },
  ]
  const leadsById = { a: { title: 'Villa (test)', lead_no: 'L-2026-000001' }, b: { title: 'Tower (test)', lead_no: 'L-2026-000002' } }

  it('shows mine unless "everyone", by when, and searches the opportunity too', () => {
    const f = o => filterActivities(acts, { me: 'me', today: TODAY, leadsById, ...o }).map(a => a.id)
    expect(f({})).toEqual([1, 2])
    expect(f({ active: ['all_users'] })).toEqual([1, 2, 3])
    expect(f({ active: ['all_users', 'upcoming'] })).toEqual([3])
    expect(f({ active: ['overdue', 'today'] })).toEqual([1, 2])
    expect(f({ active: ['all_users'], q: 'tower' })).toEqual([3])
  })

  it('lists a record\'s activities planned first, then done', () => {
    expect(recordActivities(acts).map(a => a.id)).toEqual([1, 2, 3, 4])
  })

  it('counts Home\'s three items', () => {
    const leads = [{ id: 'a', status: 'open', assigned_to: 'me' }, { id: 'c', status: 'open', assigned_to: 'me' }, { id: 'd', status: 'won', assigned_to: 'me' }]
    expect(homeCounts({ activities: acts, leads, me: 'me', today: TODAY })).toEqual({ late: 1, today: 1, idle: 1 })
  })

  it('checks a planned activity', () => {
    expect(validateActivity({ activity_type: 'call', summary: 'x', due_date: TODAY, assigned_to: 'u' })).toEqual({})
    expect(validateActivity({ activity_type: 'fax', summary: ' ', due_date: '', assigned_to: '' }))
      .toEqual({ activity_type: 'required', summary: 'required', due_date: 'required', assigned_to: 'required' })
  })
})

describe('the opportunity form', () => {
  it('needs a title, a stage and someone to talk to', () => {
    expect(validateLead({ title: ' ', stage_id: '' })).toEqual({ title: 'required', contact_name: 'someone', stage_id: 'required' })
    expect(validateLead({ title: 'x', stage_id: 's', client_org_id: 'c' })).toEqual({})
  })

  it('checks lengths, email, money, percent and priority as his form does', () => {
    const e = validateLead({ title: 'x'.repeat(256), stage_id: 's', organization: 'o', phone: '1'.repeat(31), email: 'nope', expected_revenue: '-5', probability: '101', priority: 4 })
    expect(e).toEqual({ title: 'too_long', phone: 'too_long', email: 'email', expected_revenue: 'money', probability: 'percent', priority: 'priority' })
    expect(validateLead({ title: 'x', stage_id: 's', organization: 'o', expected_revenue: '1250.50', probability: '0' })).toEqual({})
  })

  it('turns the form into a row: blanks are null, unknown values stay unknown', () => {
    const row = leadRow({ title: ' Villa ', organization: ' ', expected_revenue: '', probability: '40', priority: '2', stage_id: 's' })
    expect(row).toMatchObject({ title: 'Villa', organization: null, expected_revenue: null, probability: 40, priority: 2, stage_id: 's' })
  })
})

describe('settings', () => {
  it('orders active first, stages by number', () => {
    const items = [{ id: 1, name: 'b', sequence: 20, is_active: true }, { id: 2, name: 'a', sequence: 30, is_active: false }, { id: 3, name: 'c', sequence: 10, is_active: true }]
    expect(settingsOrder('stages', items).map(i => i.id)).toEqual([3, 1, 2])
    expect(settingsOrder('sources', items).map(i => i.id)).toEqual([1, 3, 2])
    expect(nextSequence(items)).toBe(40)
  })

  it('refuses a taken name, a bad number and a second stage for one event', () => {
    const others = [{ id: 1, name: 'New', auto_event: 'pricing' }]
    expect(validateListItem('stages', { name: 'New', sequence: '10000', auto_event: 'pricing' }, others))
      .toEqual({ name: 'taken', sequence: 'sequence', auto_event: 'taken' })
    expect(validateListItem('stages', { id: 1, name: 'New', sequence: '', auto_event: 'pricing' }, others)).toEqual({})
  })
})

describe('the analysis report', () => {
  const stagesById = { s1: { name: 'جديدة', name_en: 'New' }, s2: { name: 'تفاوض', name_en: 'Negotiation' } }
  const leads = [
    lead(1, { stage_id: 's1', expected_revenue: 1000, probability: 50, created_at: '2026-09-10T08:00:00Z' }),
    lead(2, { stage_id: 's1', status: 'won', expected_revenue: 3000, probability: 100 }),
    lead(3, { stage_id: 's2', status: 'lost', lost_reason_id: 'r1' }),
    lead(4, { stage_id: 's2', status: 'won' }),
  ]
  const facts = reportFacts(leads, { stagesById, reasonsById: { r1: { name: 'السعر', name_en: 'Price' } }, lang: 'en' })

  it('names every dimension, with — for none', () => {
    expect(facts[2]).toMatchObject({ stage: 'Negotiation', source: '—', assignee: '—', lost_reason: 'Price', expected: null })
  })

  it('computes measures without inventing zeros, and the win rate on each set', () => {
    expect(measure(facts, 'count')).toBe(4)
    expect(measure(facts, 'expected')).toBe(4000)
    expect(measure(facts, 'weighted')).toBe(3500)
    expect(measure(facts, 'unknown')).toBe(2)
    expect(measure(facts, 'won')).toBe(2)
    expect(measure(facts, 'win_rate')).toBeCloseTo(66.67, 1)
    expect(measure([facts[0]], 'win_rate')).toBeNull()
    expect(measure([facts[2]], 'expected')).toBeNull()
  })

  it('pivots by row and column, totals on each set, statuses in order', () => {
    const p = pivot(facts, { row: 'status', col: 'stage', m: 'count' })
    expect(p.rows).toEqual(['open', 'won', 'lost'])
    expect(p.cols).toEqual(['New', 'Negotiation'])
    expect(p.cells.won).toEqual({ New: 1, Negotiation: 1 })
    expect(p.rowTotals).toEqual({ open: 1, won: 2, lost: 1 })
    expect(p.grand).toBe(4)
    const rate = pivot(facts, { row: 'stage', m: 'win_rate' })
    expect(rate.rowTotals).toEqual({ New: 100, Negotiation: 50 })
    expect(rate.grand).toBeCloseTo(66.67, 1)
    expect(pivot(facts, { row: 'month', m: 'count' }).rows).toEqual(['2026-09', '2026-10'])
  })

  it('filters open / closed and the date range', () => {
    expect(reportScope(facts, { active: ['closed'] })).toHaveLength(3)
    expect(reportScope(facts, { active: ['open', 'closed'] })).toHaveLength(4)
    expect(reportScope(facts, { from: '2026-10-01', to: '2026-10-31' })).toHaveLength(3)
  })

  it('offers his quick ranges and formats each measure', () => {
    expect(quickRanges('2026-01-15')).toMatchObject({ last_month: ['2025-12-01', '2025-12-31'], this_quarter: ['2026-01-01', '2026-03-31'] })
    expect(quickRanges('2026-02-10').this_month).toEqual(['2026-02-01', '2026-02-28'])
    expect(fmtMeasure(1234.5, 'expected')).toBe('1,234.50')
    expect(fmtMeasure(66.666, 'win_rate')).toBe('66.7%')
    expect(fmtMeasure(null, 'weighted')).toBe('—')
  })

  it('exports the pivot as CSV', () => {
    const p = pivot(facts, { row: 'stage', m: 'expected' })
    const csv = pivotCsv(p, { title: 'CRM, "test"', range: 'All', rowLabel: 'Stage', totalLabel: 'Total', m: 'expected' })
    expect(csv.split('\n')).toEqual(['"CRM, ""test"""', 'All', 'Stage,Total', 'New,4000.00', 'Negotiation,', 'Total,4000.00'])
  })
})

describe('the history', () => {
  it('describes a change field by field in the reader\'s words', () => {
    const d = describeHistory({ action: 'update', label: 'Villa', changes: { stage_id: ['s1', 's2'], notes: [null, 'x'] } }, (f, v) => (f === 'stage_id' ? `stage ${v}` : v))
    expect(d).toEqual({ who: 'lead', action: 'update', label: 'Villa', changes: [['stage_id', 'stage s1', 'stage s2'], ['notes', '—', 'x']] })
    expect(describeHistory({ action: 'insert', activity_id: 'a', changes: {} }).who).toBe('activity')
  })
})
