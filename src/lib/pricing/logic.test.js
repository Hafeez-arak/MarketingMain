import { describe, it, expect } from 'vitest'
import {
  parseNumber, numOrNull, filterSheets, searchSheets, sortSheets, groupSheets, pageOf, marginPct, isLowMargin, groupIssues, sheetActions, statusPath,
  openLeads, parseCategory, parseDelimited, parseBoq, validateLines, linesPayload, validateQuote, quoteHeaderPayload, chargesKnown,
  offersPayload, validateOffers, altsPayload, bestCost, offerGrid, expired, describeAudit, BOQ_TEMPLATE_HEAD,
} from './logic'

describe('numbers', () => {
  it('reads Excel and keyboard numbers, Arabic digits too', () => {
    expect(parseNumber('1,250.5')).toBe(1250.5)
    expect(parseNumber('١٢٣٫٥')).toBe(123.5)
    expect(parseNumber(' 7 ')).toBe(7)
    expect(parseNumber('abc')).toBeNull()
    expect(parseNumber('')).toBeNull()
  })
  it('empty is unknown, never 0', () => {
    expect(numOrNull('')).toBeNull()
    expect(numOrNull('0')).toBe(0)
  })
})

const leads = { a: { lead_no: 'L-1', title: 'Tower', bid_due_date: '2026-12-10' }, b: { lead_no: 'L-2', title: 'Mall', bid_due_date: null }, c: { lead_no: 'L-3', title: 'Villa', bid_due_date: '2026-12-01' } }
const sheets = [
  { id: 1, sheet_no: 'PS-2026-000001', title: 'Tower lobby', status: 'approved', lead_id: 'a', created_by: 'me' },
  { id: 2, sheet_no: 'PS-2026-000002', title: 'Mall car park', status: 'draft', lead_id: 'b', created_by: 'you' },
  { id: 3, sheet_no: 'PS-2026-000003', title: 'Villa', status: 'submitted', lead_id: 'c', created_by: 'me' },
  { id: 4, sheet_no: 'PS-2026-000004', title: 'Villa extra', status: 'cancelled', lead_id: 'c', created_by: 'you' },
]

describe('the list', () => {
  it('statuses are OR within their group, "mine" is AND', () => {
    expect(filterSheets(sheets, []).length).toBe(4)
    expect(filterSheets(sheets, ['draft', 'submitted']).map(s => s.id)).toEqual([2, 3])
    expect(filterSheets(sheets, ['draft', 'submitted', 'mine'], 'me').map(s => s.id)).toEqual([3])
    expect(filterSheets(sheets, ['mine'], null)).toEqual([])
  })
  it('searches sheet and opportunity number and title', () => {
    expect(searchSheets(sheets, 'villa', leads).map(s => s.id)).toEqual([3, 4])
    expect(searchSheets(sheets, 'L-2', leads).map(s => s.id)).toEqual([2])
    expect(searchSheets(sheets, 'ps-2026-000001', leads).map(s => s.id)).toEqual([1])
    expect(searchSheets(sheets, '  ', leads).length).toBe(4)
  })
  it('puts work in progress first, by bid date with unknown dates last', () => {
    expect(sortSheets(sheets, leads).map(s => s.id)).toEqual([3, 2, 4, 1])
  })
  it('groups by status in the workflow order, skipping empty groups', () => {
    expect(groupSheets(sheets, 'status').map(g => g.key)).toEqual(['draft', 'submitted', 'approved', 'cancelled'])
    expect(groupSheets(sheets.slice(0, 2), 'status').map(g => g.key)).toEqual(['draft', 'approved'])
    expect(groupSheets(sheets, '')).toEqual([{ key: '', rows: sheets }])
  })
  it('pages, clamping the page number', () => {
    const rows = Array.from({ length: 65 }, (_, i) => i)
    expect(pageOf(rows, 3).rows.length).toBe(5)
    expect(pageOf(rows, 99).page).toBe(3)
    expect(pageOf(rows, 'x').page).toBe(1)
    expect(pageOf([], 1)).toMatchObject({ pages: 1, rows: [] })
  })
  it('lists open opportunities, nearest bid first', () => {
    const ls = [{ id: 1, status: 'won' }, { id: 2, status: 'open', bid_due_date: null, lead_no: 'L-2' }, { id: 3, status: 'open', bid_due_date: '2026-12-01', lead_no: 'L-3' }]
    expect(openLeads(ls).map(l => l.id)).toEqual([3, 2])
  })
})

describe('margin', () => {
  it('is on the selling price, unknown stays unknown', () => {
    expect(marginPct(55, 44)).toBe(20)
    expect(marginPct(25, 22)).toBe(12)
    expect(marginPct(null, 22)).toBeNull()
    expect(marginPct(25, null)).toBeNull()
    expect(marginPct(0, 5)).toBeNull()
    expect(marginPct(10, 12)).toBe(-20)
  })
  it('marks a margin below zero or below the minimum', () => {
    expect(isLowMargin(12, 15)).toBe(true)
    expect(isLowMargin(20, 15)).toBe(false)
    expect(isLowMargin(20, null)).toBe(false)
    expect(isLowMargin(-1, null)).toBe(true)
    expect(isLowMargin(null, 15)).toBe(false)
  })
})

describe('issues and actions', () => {
  it('groups issues by code with their lines', () => {
    const g = groupIssues([
      { code: 'UNPRICED', line_no: 1, blocking: true }, { code: 'UNPRICED', line_no: 3, blocking: true },
      { code: 'MIN_MARGIN_UNSET', line_no: null, blocking: false },
    ])
    expect(g).toEqual([{ code: 'UNPRICED', blocking: true, lines: [1, 3] }, { code: 'MIN_MARGIN_UNSET', blocking: false, lines: [] }])
  })
  it('shows the buttons each level may press', () => {
    expect(sheetActions('draft', 1)).toMatchObject({ edit: false, submit: false, cancel: false, remove: false })
    expect(sheetActions('draft', 2)).toMatchObject({ edit: true, submit: true, cancel: true, remove: true, approve: false })
    expect(sheetActions('submitted', 2)).toMatchObject({ return: true, approve: false, cancel: false, edit: false })
    expect(sheetActions('submitted', 3)).toMatchObject({ return: true, approve: true, cancel: true })
    expect(sheetActions('approved', 3)).toMatchObject({ cancel: true, return: false, remove: false })
    expect(sheetActions('approved', 2).cancel).toBe(false)
    expect(sheetActions('cancelled', 3).cancel).toBe(false)
  })
  it('has a path per state', () => {
    expect(statusPath('cancelled')).toEqual(['draft', 'cancelled'])
    expect(statusPath('draft')).toEqual(['draft', 'submitted', 'approved'])
  })
})

describe('the BOQ', () => {
  it('reads categories by name, in either language, or code', () => {
    expect(parseCategory('Goods')).toBe('goods')
    expect(parseCategory('تركيب')).toBe('installation')
    expect(parseCategory('subcontract')).toBe('subcontract')
    expect(parseCategory('')).toBeNull()
    expect(parseCategory('weird')).toBeUndefined()
  })
  it('splits CSV with quotes, TSV from Excel, and semicolons', () => {
    expect(parseDelimited('a,b\n"x,1","he said ""hi"""\n')).toEqual([['a', 'b'], ['x,1', 'he said "hi"']])
    expect(parseDelimited('a\tb\r\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseDelimited('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseDelimited('a,b\n"line\nbreak",2')).toEqual([['a', 'b'], ['line\nbreak', '2']])
  })
  it('imports a clean file: headers in any order, numbers with commas, empty rows skipped', () => {
    const r = parseBoq(parseDelimited('Item,Description,Qty,Unit\nE-01,Downlight 10W,"1,000",pc\n,,,\nE-02,LED strip,50,m\n'))
    expect(r.rows).toEqual([
      { boq_ref: 'E-01', description: 'Downlight 10W', quantity: 1000, unit: 'pc', cost_category: null },
      { boq_ref: 'E-02', description: 'LED strip', quantity: 50, unit: 'm', cost_category: null },
    ])
    const ar = parseBoq(parseDelimited('الوحدة\tالكمية\tالوصف\tالتصنيف\nمتر\t٥٠\tشريط\tبضاعة'))
    expect(ar.rows[0]).toMatchObject({ unit: 'متر', quantity: 50, description: 'شريط', cost_category: 'goods' })
  })
  it('one bad row imports nothing and reports its spreadsheet row', () => {
    const r = parseBoq(parseDelimited('Item,Description,Qty,Unit,Category\nE-01,Downlight,abc,pc,\nE-02,Strip,5,,\nE-03,Cable,2,m,nonsense\n,,3,m,'))
    expect(r.rows).toBeUndefined()
    expect(r.errors).toEqual([
      { row: 2, code: 'badQuantity', value: 'abc' }, { row: 3, code: 'noUnit' }, { row: 4, code: 'badCategory', value: 'nonsense' }, { row: 5, code: 'noDescription' },
    ])
  })
  it('needs the three columns, and rows under the header', () => {
    expect(parseBoq(parseDelimited('Description,Qty\nTEST downlight,5')).errors).toEqual([{ code: 'missingColumn', value: 'unit' }])
    expect(parseBoq(parseDelimited('Description,Qty,Unit')).errors).toEqual([{ code: 'noRows' }])
    expect(parseBoq([]).errors).toEqual([{ code: 'noRows' }])
    expect(parseBoq(parseDelimited('Description,Qty,Unit\n,,\n')).errors).toEqual([{ code: 'noRows' }])
  })
  it('refuses more than 2000 rows', () => {
    const body = Array.from({ length: 2001 }, (_, i) => `d${i},1,pc`).join('\n')
    expect(parseBoq(parseDelimited(`Description,Qty,Unit\n${body}`)).errors).toEqual([{ code: 'tooMany', value: 2000 }])
  })
  it('has a template header in both languages with the same five columns', () => {
    expect(BOQ_TEMPLATE_HEAD.en).toHaveLength(5)
    expect(BOQ_TEMPLATE_HEAD.ar).toHaveLength(5)
    // The template's own headers import back.
    for (const lang of ['en', 'ar']) {
      const r = parseBoq([BOQ_TEMPLATE_HEAD[lang], ['1', 'x', '2', 'pc', '']])
      expect(r.rows).toHaveLength(1)
    }
  })
  it('checks the editor rows and shapes them for saving', () => {
    expect(validateLines([{ description: 'a', quantity: '2', unit: 'm' }])).toEqual({})
    expect(validateLines([{ description: ' ', quantity: '0', unit: '' }])).toEqual({ 0: { description: 'required', quantity: 'positive', unit: 'required' } })
    expect(validateLines([])).toEqual({ _: { rows: 'atLeastOne' } })
    expect(linesPayload([{ id: 'x', boq_ref: ' ', description: ' d ', quantity: '1.5', unit: ' m ', catalog_item_id: '', cost_category: '' }]))
      .toEqual([{ id: 'x', boq_ref: null, description: 'd', quantity: 1.5, unit: 'm', catalog_item_id: null, cost_category: null }])
  })
})

describe('supplier quotes', () => {
  const ok = { status: 'received', requested_on: '2026-12-01', received_on: '2026-12-02', valid_until: '2026-12-30' }
  it('received needs its date; validity cannot precede it; rate and charges are numbers', () => {
    expect(validateQuote(ok)).toEqual({})
    expect(validateQuote({ ...ok, received_on: '' })).toEqual({ received_on: 'required' })
    expect(validateQuote({ ...ok, valid_until: '2026-12-01' })).toEqual({ valid_until: 'beforeReceived' })
    expect(validateQuote({ ...ok, fx_rate: '0' })).toEqual({ fx_rate: 'positive' })
    expect(validateQuote({ ...ok, freight_amount: '-1', customs_amount: 'x' })).toEqual({ freight_amount: 'nonNegative', customs_amount: 'nonNegative' })
    expect(validateQuote({ status: 'requested', requested_on: '' })).toEqual({ requested_on: 'required' })
  })
  it('keeps empty charges unknown and a quote in SAR without a typed rate', () => {
    expect(quoteHeaderPayload({ ...ok, currency: 'USD', fx_rate: '3.75', freight_amount: '0', customs_amount: '', other_charges: '200' }))
      .toMatchObject({ fx_rate: '3.75', freight_amount: '0', customs_amount: '', other_charges: '200' })
    expect(quoteHeaderPayload({ ...ok, currency: 'SAR', fx_rate: '3.75' }).fx_rate).toBe('')
    expect(chargesKnown({ freight_amount: 0, customs_amount: 0, other_charges: 0 })).toBe(true)
    expect(chargesKnown({ freight_amount: 0, customs_amount: null, other_charges: 0 })).toBe(false)
  })
  it('checks offers and drops empty alternatives', () => {
    expect(validateOffers([{ id: 'a', quantity: '5', unit_price: '', lead_time_days: '' }])).toEqual({})
    expect(validateOffers([{ id: 'a', quantity: '0', unit_price: '-2', lead_time_days: '1.5' }])).toEqual({ a: { quantity: 'positive', unit_price: 'nonNegative', lead_time_days: 'wholeNumber' } })
    expect(offersPayload([{ id: 'a', quantity: '5', unit_price: '', brand: ' B ', model_no: '', offered_description: '', lead_time_days: '7' }]))
      .toEqual([{ id: 'a', quantity: 5, unit_price: '', brand: 'B', model_no: '', offered_description: '', lead_time_days: '7' }])
    expect(altsPayload([{ pricing_line_id: '', unit_price: '5' }, { pricing_line_id: 'l', unit_price: '', brand: '', model_no: '' }, { pricing_line_id: 'l', unit_price: '3.5', brand: 'X' }]))
      .toEqual([{ pricing_line_id: 'l', unit_price: '3.5', quantity: '', brand: 'X', model_no: '', offered_description: '' }])
  })
})

describe('comparison', () => {
  it('finds the lowest known landed cost, ignoring unknowns', () => {
    expect(bestCost([{ landed_unit_cost: '44.0000' }, { landed_unit_cost: null }, { landed_unit_cost: '30' }])).toBe(30)
    expect(bestCost([{ landed_unit_cost: null }])).toBeNull()
    expect(bestCost([])).toBeNull()
  })
  it('lays offers out per line and quote, the main offer before its alternatives', () => {
    const g = offerGrid([{ pricing_line_id: 'l', quote_id: 'q', is_alternative: true, id: 2 }, { pricing_line_id: 'l', quote_id: 'q', is_alternative: false, id: 1 }])
    expect(g['l-q'].map(o => o.id)).toEqual([1, 2])
  })
  it('knows an expired quote', () => {
    expect(expired('2026-12-01', '2026-12-02')).toBe(true)
    expect(expired('2026-12-02', '2026-12-02')).toBe(false)
    expect(expired(null, '2026-12-02')).toBe(false)
  })
})

describe('history', () => {
  it('lists what changed on an update, not the stamps', () => {
    const d = describeAudit({ table_name: 'pricing_sheets', action: 'update', old_data: { title: 'a', status: 'draft', updated_at: '1' }, new_data: { title: 'a', status: 'submitted', updated_at: '2' } })
    expect(d.changes).toEqual([['status', 'draft', 'submitted']])
    expect(describeAudit({ table_name: 'pricing_sheets', action: 'insert', old_data: null, new_data: { title: 'T' } })).toMatchObject({ changes: [], label: 'T' })
  })
})
