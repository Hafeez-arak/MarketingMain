import { describe, it, expect } from 'vitest'
import {
  emptyItem, validateItem, itemRow, fieldRow, validateField, nextOrder, fieldName, formFields, specLines, specValues,
  diffSpecs, usedValues, filterItems, groupItems, sortItems, paginate, fileProblem, storedName, describeChange, PAGE_SIZE,
} from './logic'

const item = (over = {}) => ({ id: 'i', code: 'A-1', name: 'Downlight (test)', brand: null, model_no: null, category: null, unit: 'pcs', active: true, ...over })
const F = [
  { id: 'f2', name: 'Beam', name_en: 'Beam angle', unit: '°', sequence: 20, active: true },
  { id: 'f1', name: 'Power', name_en: null, unit: 'W', sequence: 10, active: true },
  { id: 'f3', name: 'Old', name_en: null, unit: null, sequence: 30, active: false },
]

describe('item form', () => {
  it('needs a code, a name and a unit', () => {
    expect(validateItem(emptyItem())).toEqual({ code: 'required', name: 'required', unit: 'required' })
    expect(validateItem({ ...emptyItem(), code: ' ', name: 'x', unit: 'pcs' })).toEqual({ code: 'required' })
    expect(validateItem({ ...emptyItem(), code: 'a', name: 'x', unit: 'pcs' })).toEqual({})
  })
  it('trims, and writes empty optional text as null', () => {
    expect(itemRow({ ...emptyItem(), code: ' A-1 ', name: ' N ', unit: ' pcs ', brand: '  ', category: ' Indoor ' }))
      .toEqual({ code: 'A-1', name: 'N', unit: 'pcs', brand: null, model_no: null, category: 'Indoor', description: null, stocked: false })
  })
})

describe('specification fields', () => {
  it('the next order is the highest plus 10', () => {
    expect(nextOrder([])).toBe(10)
    expect(nextOrder(F)).toBe(40)
  })
  it('a field needs a name; the order must be a number', () => {
    expect(validateField({ name: ' ' })).toEqual({ name: 'required' })
    expect(validateField({ name: 'x', sequence: 'abc' })).toEqual({ sequence: 'number' })
    expect(fieldRow({ name: ' Power ', name_en: '', unit: ' W ', sequence: '15' })).toEqual({ name: 'Power', name_en: null, unit: 'W', sequence: 15 })
  })
  it('names follow the language', () => {
    expect(fieldName(F[0], 'en')).toBe('Beam angle')
    expect(fieldName(F[0], 'ar')).toBe('Beam')
    expect(fieldName(F[1], 'en')).toBe('Power')
  })
})

describe('the form lists and orders the fields', () => {
  it('active fields by order, and a stopped one only while the item has a value for it', () => {
    expect(formFields(F, {}).map(f => f.id)).toEqual(['f1', 'f2'])
    expect(formFields(F, { f3: '5' }).map(f => f.id)).toEqual(['f1', 'f2', 'f3'])
    expect(formFields(F, { f3: '  ' }).map(f => f.id)).toEqual(['f1', 'f2'])
  })
  it('the item page lists recorded values with their field, in order', () => {
    const lines = specLines(F, [{ field_id: 'f2', value: '24' }, { field_id: 'f1', value: '12' }, { field_id: 'gone', value: 'x' }])
    expect(lines.map(l => [l.field.id, l.value])).toEqual([['f1', '12'], ['f2', '24']])
    expect(specValues([{ field_id: 'f1', value: '12' }])).toEqual({ f1: '12' })
  })
})

describe('saving specs', () => {
  const had = [{ id: 's1', field_id: 'f1', value: '12' }, { id: 's2', field_id: 'f2', value: '24' }]
  it('writes what is new or changed, deletes what was blanked, touches nothing else', () => {
    expect(diffSpecs(had, { f1: '12', f2: '  ', f3: 'IP65' })).toEqual({
      upserts: [{ field_id: 'f3', value: 'IP65', id: null }], deletes: ['s2'],
    })
    expect(diffSpecs(had, { f1: ' 15 ' }).upserts).toEqual([{ field_id: 'f1', value: '15', id: 's1' }])
  })
  it('a blank value for a field with no row does nothing', () => {
    expect(diffSpecs([], { f1: '' })).toEqual({ upserts: [], deletes: [] })
  })
})

describe('the list', () => {
  const items = [
    item({ id: '1', code: 'B-10', name: 'Panel', brand: 'Acme', category: 'Indoor' }),
    item({ id: '2', code: 'B-2', name: 'Flood', brand: 'Zeta', category: 'Outdoor', active: false }),
    item({ id: '3', code: 'C-1', name: 'Strip', brand: null, category: null, model_no: 'ST-9' }),
  ]
  it('filters active or stopped', () => {
    expect(filterItems(items).map(i => i.id)).toEqual(['1', '3'])
    expect(filterItems(items, { status: 'stopped' }).map(i => i.id)).toEqual(['2'])
  })
  it('searches code, name, brand, model and category, every word', () => {
    expect(filterItems(items, { q: 'st-9' }).map(i => i.id)).toEqual(['3'])
    expect(filterItems(items, { q: 'acme indoor' }).map(i => i.id)).toEqual(['1'])
    expect(filterItems(items, { q: 'flood', status: 'stopped' }).map(i => i.id)).toEqual(['2'])
    expect(filterItems(items, { q: 'nothing' })).toEqual([])
  })
  it('groups by category or brand, the empty group last', () => {
    expect(groupItems(items, 'category').map(g => [g.key, g.rows.length])).toEqual([['Indoor', 1], ['Outdoor', 1], ['', 1]])
    expect(groupItems(items, 'brand').map(g => g.key)).toEqual(['Acme', 'Zeta', ''])
    expect(groupItems(items, '')).toEqual([{ key: '', rows: items }])
  })
  it('sorts by code, numbers as numbers', () => {
    expect(sortItems(items).map(i => i.code)).toEqual(['B-2', 'B-10', 'C-1'])
  })
  it('suggests the values already used', () => {
    expect(usedValues(items, 'category')).toEqual(['Indoor', 'Outdoor'])
    expect(usedValues(items, 'unit')).toEqual(['pcs'])
  })
  it('pages of fifty, kept in range', () => {
    const rows = Array.from({ length: 120 }, (_, i) => i)
    expect(PAGE_SIZE).toBe(50)
    expect(paginate(rows, 1)).toMatchObject({ page: 1, pages: 3 })
    expect(paginate(rows, 3).rows).toHaveLength(20)
    expect(paginate(rows, 9).page).toBe(3)
    expect(paginate(rows, 'x').page).toBe(1)
    expect(paginate([], 1)).toEqual({ rows: [], page: 1, pages: 1 })
  })
})

describe('files', () => {
  it('a datasheet is a PDF or an image; a picture only an image; 20 MB at most', () => {
    expect(fileProblem('datasheet', { type: 'application/pdf', size: 1000 })).toBe('')
    expect(fileProblem('image', { type: 'application/pdf', size: 1000 })).toBe('type')
    expect(fileProblem('image', { type: 'image/png', size: 21 * 1024 * 1024 })).toBe('size')
    expect(fileProblem('image', { type: 'image/gif', size: 5 })).toBe('type')
    expect(fileProblem('image', null)).toBe('none')
  })
  it('stored names are safe and unique', () => {
    expect(storedName('My sheet (v2).pdf', 'k1')).toBe('k1-My-sheet-v2-.pdf')
    expect(storedName('../../x.pdf', 'k2')).not.toContain('/')
    expect(storedName('', 'k3')).toBe('k3-file')
  })
})

describe('history', () => {
  it('an update lists only what changed', () => {
    const row = { action: 'update', old_data: { id: 'a', name: 'A', brand: null, updated_at: '1' }, new_data: { id: 'a', name: 'B', brand: null, updated_at: '2' } }
    expect(describeChange(row)).toEqual([{ field: 'name', from: 'A', to: 'B' }])
  })
  it('an insert lists what was filled', () => {
    expect(describeChange({ action: 'insert', old_data: null, new_data: { id: 'a', code: 'X', brand: null, workspace_id: 'w' } })).toEqual([{ field: 'code', from: null, to: 'X' }])
  })
})
