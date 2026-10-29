import { describe, it, expect } from 'vitest'
import {
  riyadhToday, daysBetween, addDays, docState, warnDays, typeName, canManageDoc, canCreateKind, isRestricted,
  sortDocuments, filterDocuments, figures, missingFields, sourcesFor, reviewProblems, parseAlertDays, typeProblems,
  gregorianToHijri, hijriToGregorian, parseHijri, dateFromInputs, alertSchedule, fileProblem, filePath, sha256Hex, defaultTitle,
  papersToRenew, errorKey,
} from './logic'

const TODAY = '2026-10-29'
const type = (id, extra = {}) => ({ id, name: `نوع ${id}`, name_en: `Type ${id}`, alert_days: [90, 30, 7], task_days_before: 30, is_required: false, is_active: true, number_required: false, ...extra })
const doc = (id, extra = {}) => ({ id: String(id), document_no: `DOC-2026-00000${id}`, title: `Doc ${id} (test)`, type_id: 't1', link_kind: 'company', confirmed_at: '2026-01-01', archived_at: null, expiry_date: null, confidential: false, responsible_id: null, ...extra })
const types = [type('t1'), type('t2', { alert_days: null }), type('t3', { is_required: true })]
const typesById = Object.fromEntries(types.map(t => [t.id, t]))

describe('dates', () => {
  it('today is Riyadh\'s, not UTC\'s', () => {
    expect(riyadhToday(new Date('2026-10-28T22:30:00Z'))).toBe('2026-10-29')
    expect(riyadhToday(new Date('2026-10-28T20:59:00Z'))).toBe('2026-10-28')
  })
  it('counts days', () => {
    expect(daysBetween('2026-10-29', '2026-11-28')).toBe(30)
    expect(daysBetween('2026-10-29', '2026-10-01')).toBe(-28)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('the state of a document', () => {
  it('draft, archived, no expiry, expired, expiring (within the largest alert day), valid', () => {
    expect(docState(doc(1, { confirmed_at: null }), types[0], TODAY)).toBe('draft')
    expect(docState(doc(1, { archived_at: '2026-02-01' }), types[0], TODAY)).toBe('archived')
    expect(docState(doc(1), types[0], TODAY)).toBe('no_expiry')
    expect(docState(doc(1, { expiry_date: '2026-10-28' }), types[0], TODAY)).toBe('expired')
    expect(docState(doc(1, { expiry_date: '2026-10-29' }), types[0], TODAY)).toBe('expiring')
    expect(docState(doc(1, { expiry_date: '2027-01-27' }), types[0], TODAY)).toBe('expiring')   // exactly 90 days
    expect(docState(doc(1, { expiry_date: '2027-01-28' }), types[0], TODAY)).toBe('valid')
  })
  it('a type with no alert days never says expiring', () => {
    expect(warnDays(types[1])).toBeNull()
    expect(docState(doc(1, { type_id: 't2', expiry_date: '2026-11-01' }), types[1], TODAY)).toBe('valid')
  })
  it('names a type in the reader\'s language, falling back to the Arabic one', () => {
    expect(typeName(types[0], 'en')).toBe('Type t1')
    expect(typeName(types[0], 'ar')).toBe('نوع t1')
    expect(typeName({ name: 'س' }, 'en')).toBe('س')
  })
})

describe('who may do what (the buttons; the database refuses the rest)', () => {
  it('confidential and employees\' papers are for manage; the rest for work', () => {
    expect(isRestricted(doc(1, { link_kind: 'employee' }))).toBe(true)
    expect(isRestricted(doc(1, { confidential: true }))).toBe(true)
    expect(canManageDoc(doc(1), 'view')).toBe(false)
    expect(canManageDoc(doc(1), 'work')).toBe(true)
    expect(canManageDoc(doc(1, { link_kind: 'employee' }), 'work')).toBe(false)
    expect(canManageDoc(doc(1, { confidential: true }), 'manage')).toBe(true)
    expect(canCreateKind('employee', 'work')).toBe(false)
    expect(canCreateKind('supplier', 'work')).toBe(true)
    expect(canCreateKind('company', 'view')).toBe(false)
  })
})

describe('the list', () => {
  const docs = [
    doc(1, { expiry_date: '2026-11-15', title: 'Municipal licence (test)', number: 'ML-55' }),
    doc(2, { expiry_date: '2026-09-01', type_id: 't3' }),
    doc(3, { confirmed_at: null }),
    doc(4, { archived_at: '2026-03-01', expiry_date: '2026-12-01' }),
    doc(5, { expiry_date: '2030-01-01', responsible_id: 'u1', link_kind: 'supplier' }),
    doc(6, { expiry_date: '2026-12-10', type_id: 't3' }),
  ]
  const ctx = { typesById, pendingIds: new Set(['5']), today: TODAY, linkNames: { 5: 'Supplier One (test)' } }
  const ids = f => filterDocuments(docs, f, ctx).map(d => d.id)
  it('hides archived ones except under archived', () => {
    expect(ids({})).toEqual(['1', '2', '3', '5', '6'])
    expect(ids({ state: 'archived' })).toEqual(['4'])
  })
  it('filters by state, type, link, responsible', () => {
    expect(ids({ state: 'expired' })).toEqual(['2'])
    expect(ids({ state: 'expiring' })).toEqual(['1', '6'])
    expect(ids({ state: 'valid' })).toEqual(['5'])
    expect(ids({ state: 'awaiting' })).toEqual(['3', '5'])       // a draft, and a confirmed one with a renewal waiting
    expect(ids({ type_id: 't3' })).toEqual(['2', '6'])
    expect(ids({ link_kind: 'supplier' })).toEqual(['5'])
    expect(ids({ responsible_id: 'u1' })).toEqual(['5'])
  })
  it('"ends within N days" counts confirmed, unexpired ones only', () => {
    expect(ids({ within: 30 })).toEqual(['1'])
    expect(ids({ within: 90 })).toEqual(['1', '6'])
  })
  it('searches the title, number, DOC- number and the linked name, Arabic letter forms folded', () => {
    expect(ids({ q: 'municipal' })).toEqual(['1'])
    expect(ids({ q: 'ml-55' })).toEqual(['1'])
    expect(ids({ q: 'DOC-2026-000006' })).toEqual(['6'])
    expect(ids({ q: 'supplier one' })).toEqual(['5'])
    expect(ids({ q: 'nothing like this' })).toEqual([])
  })
  it('sorts drafts first, then the soonest expiry, none last, archived last', () => {
    expect(sortDocuments(docs).map(d => d.id)).toEqual(['3', '2', '1', '6', '5', '4'])
  })
  it('the five figures', () => {
    const f = figures(docs, types, { ...ctx, openTasks: new Set(['1']) })
    expect(f.expired).toEqual({ count: 1, names: ['Doc 2 (test)'] })
    expect(f.soon).toEqual({ count: 1, tasks: 1 })
    expect(f.later.count).toBe(2)
    expect(f.required).toEqual({ total: 1, held: 1, missing: [] })   // t3 has doc 6 in force
    expect(f.awaiting.count).toBe(2)
    const none = figures([doc(2, { expiry_date: '2026-09-01', type_id: 't3' })], types, ctx)
    expect(none.required).toEqual({ total: 1, held: 0, missing: ['t3'] })
    expect(figures([], [type('x')], ctx).required.total).toBe(0)
  })
  it('papers to renew: employees\' only, expired or expiring, soonest first', () => {
    const e = [doc(1, { link_kind: 'employee', expiry_date: '2026-11-20' }), doc(2, { link_kind: 'employee', expiry_date: '2026-09-01' }), doc(3, { link_kind: 'employee', expiry_date: '2031-01-01' }), doc(4, { expiry_date: '2026-09-01' })]
    expect(papersToRenew(e, typesById, TODAY).map(d => d.id)).toEqual(['2', '1'])
  })
})

describe('review and confirm', () => {
  const cr = type('cr', { number_required: true, expiry_required: true })
  it('names the fields the type still needs', () => {
    expect(missingFields(cr, { number: ' ', expiry_date: '' })).toEqual(['number', 'expiry_date'])
    expect(missingFields(cr, { number: '1010', expiry_date: '2030-01-01' })).toEqual([])
    expect(missingFields(null, {})).toEqual([])
  })
  it('records where each filled field came from', () => {
    const sug = { file: { number: { value: '1010101010' } }, ai: { expiry_date: { value: '2030-01-01' }, number: { value: '9999999999' } } }
    expect(sourcesFor({ number: '1010101010', issuer: 'MoC', expiry_date: '2030-01-01', issue_date: '' }, sug))
      .toEqual({ number: 'file', issuer: 'manual', expiry_date: 'ai' })
    expect(sourcesFor({ number: '9999999999' }, sug)).toEqual({ number: 'ai' })
    expect(sourcesFor({ number: 'typed' }, sug)).toEqual({ number: 'manual' })
  })
  it('a draft save needs a title; confirming also needs the required fields and a responsible', () => {
    expect(reviewProblems(cr, { title: '', number: '' }, { confirm: false })).toEqual({ title: 'required' })
    expect(reviewProblems(cr, { title: 'x', number: '', expiry_date: '' }, { confirm: true })).toEqual({ number: 'needed', expiry_date: 'needed', responsible_id: 'needed' })
    expect(reviewProblems(cr, { title: 'x', number: '1', expiry_date: '2020-01-01', issue_date: '2021-01-01', responsible_id: 'u' }, { confirm: true })).toEqual({ expiry_date: 'order' })
  })
})

describe('the type form', () => {
  it('reads alert days as a list, largest first', () => {
    expect(parseAlertDays('7, 90 ،30,30')).toEqual([90, 30, 7])
    expect(parseAlertDays('')).toEqual([])
    expect(parseAlertDays('soon')).toBeNull()
    expect(parseAlertDays('1,2,3,4,5,6,7')).toBeNull()
    expect(parseAlertDays('0')).toEqual([])
  })
  it('checks name, links, days and the pattern', () => {
    const ok = { name: 'New', link_kinds: ['company'], alert_days_text: '90, 30', task_days_before: '30', number_pattern: '[0-9]{10}' }
    expect(typeProblems(ok)).toEqual({})
    expect(typeProblems({ ...ok, name: ' ' })).toEqual({ name: 'required' })
    expect(typeProblems({ ...ok, name: 'Taken' }, { names: [{ id: 'a', name: 'Taken' }] })).toEqual({ name: 'taken' })
    expect(typeProblems({ ...ok, name: 'Taken' }, { names: [{ id: 'a', name: 'Taken' }], ownId: 'a' })).toEqual({})
    expect(typeProblems({ ...ok, link_kinds: [] })).toEqual({ link_kinds: 'required' })
    expect(typeProblems({ ...ok, alert_days_text: 'x' })).toEqual({ alert_days: 'format' })
    expect(typeProblems({ ...ok, task_days_before: '-1' })).toEqual({ task_days: 'range' })
    expect(typeProblems({ ...ok, task_days_before: '' })).toEqual({})
    expect(typeProblems({ ...ok, number_pattern: '([' })).toEqual({ number_pattern: 'regex' })
  })
})

describe('Hijri dates (Umm al-Qura)', () => {
  it('converts both ways and back', () => {
    expect(gregorianToHijri('2026-10-29')).toEqual({ y: 1448, m: 5, d: 18 })
    expect(hijriToGregorian(1448, 5, 18)).toBe('2026-10-29')
    expect(hijriToGregorian(1447, 1, 1)).toBe('2025-06-26')
    for (const iso of ['2024-02-29', '2026-01-01', '2030-12-31', '2035-06-15']) {
      const h = gregorianToHijri(iso)
      expect(hijriToGregorian(h.y, h.m, h.d)).toBe(iso)
    }
  })
  it('refuses a day that does not exist', () => {
    expect(hijriToGregorian(1448, 13, 1)).toBeNull()
    expect(hijriToGregorian(1448, 5, 0)).toBeNull()
    expect(hijriToGregorian(1000, 1, 1)).toBeNull()
  })
  it('reads the ways people write it, including Arabic digits and هـ', () => {
    expect(parseHijri('1448/05/18')).toEqual({ y: 1448, m: 5, d: 18 })
    expect(parseHijri('١٤٤٨-٥-١٨ هـ')).toEqual({ y: 1448, m: 5, d: 18 })
    expect(parseHijri('18/05/1448')).toBeNull()
    expect(parseHijri('')).toBeNull()
  })
  it('the Gregorian field wins when alone, the Hijri one fills an empty one, and both must agree', () => {
    expect(dateFromInputs('2026-10-29', '')).toEqual({ value: '2026-10-29' })
    expect(dateFromInputs('', '1448/05/18')).toEqual({ value: '2026-10-29' })
    expect(dateFromInputs('2026-10-29', '1448/05/18')).toEqual({ value: '2026-10-29' })
    expect(dateFromInputs('2026-10-30', '1448/05/18')).toEqual({ error: 'hijriMismatch' })
    expect(dateFromInputs('', '1448/15/17')).toEqual({ error: 'hijriFormat' })
    expect(dateFromInputs('', '')).toEqual({ value: null })
  })
})

describe('the alert schedule', () => {
  const t = type('t1')
  const d = doc(1, { expiry_date: '2026-11-20' })
  it('one row per alert day, then the task, with what happened', () => {
    const rows = alertSchedule(d, t, [
      { expiry_date: '2026-11-20', kind: 'notice', days_before: 30, status: 'sent' },
      { expiry_date: '2026-11-20', kind: 'notice', days_before: 90, status: 'covered' },
      { expiry_date: '2026-11-20', kind: 'task', days_before: 30, status: 'sent', task_id: 'tk' },
      { expiry_date: '2025-01-01', kind: 'notice', days_before: 7, status: 'sent' },   // an earlier expiry: not this one
    ], TODAY)
    expect(rows.map(r => [r.kind, r.days, r.status])).toEqual([['notice', 90, 'covered'], ['notice', 30, 'sent'], ['notice', 7, 'later'], ['task', 30, 'sent']])
    expect(rows[3].taskId).toBe('tk')
    expect(rows[2].at).toBe('2026-11-13')
  })
  it('a threshold passed with nothing sent is due; none without an expiry', () => {
    expect(alertSchedule(d, t, [], TODAY).map(r => r.status)).toEqual(['due', 'due', 'later', 'due'])
    expect(alertSchedule(doc(1), t, [], TODAY)).toEqual([])
    expect(alertSchedule(d, { ...t, alert_days: null, task_days_before: null }, [], TODAY)).toEqual([])
  })
})

describe('files', () => {
  it('accepts a PDF or a picture up to 20 MB', () => {
    expect(fileProblem(null)).toBeNull()
    expect(fileProblem({ type: 'application/pdf', size: 1000 })).toBeNull()
    expect(fileProblem({ type: 'image/png', size: 20 * 1024 * 1024 })).toBeNull()
    expect(fileProblem({ type: 'application/zip', size: 10 })).toBe('FILE_TYPE')
    expect(fileProblem({ type: 'application/pdf', size: 20 * 1024 * 1024 + 1 })).toBe('FILE_SIZE')
    expect(fileProblem({ type: 'application/pdf', size: 0 })).toBe('FILE_SIZE')
  })
  it('keeps a file in its document\'s folder under a fresh name', () => {
    expect(filePath('ws1', 'doc1', { type: 'application/pdf' }, 'abc')).toBe('ws1/doc1/abc.pdf')
    expect(filePath('ws1', 'doc1', { type: 'image/jpeg' }, 'abc')).toBe('ws1/doc1/abc.jpg')
  })
  it('the same bytes give the same checksum', async () => {
    const a = await sha256Hex(new TextEncoder().encode('hello').buffer)
    expect(a).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })
  it('titles a document by its type and who it is for', () => {
    expect(defaultTitle(types[0], 'Laila', 'en')).toBe('Type t1 — Laila')
    expect(defaultTitle(types[0], '', 'ar')).toBe('نوع t1')
  })
})

describe('refusals', () => {
  it('reads the code or the constraint', () => {
    expect(errorKey({ message: 'DOCUMENT_LOCKED' })).toBe('DOCUMENT_LOCKED')
    expect(errorKey({ message: 'new row violates check constraint "company_documents_link"' })).toBe('DOCUMENT_LINK')
    expect(errorKey({ message: 'duplicate key value violates unique constraint "company_document_versions_file_uq"' })).toBe('DOCUMENT_FILE_REPEATED')
    expect(errorKey({ code: '42501', message: 'x' })).toBe('notAllowed')
    expect(errorKey({ message: 'weird' })).toBe('')
  })
})
