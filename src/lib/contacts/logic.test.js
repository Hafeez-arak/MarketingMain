import { describe, it, expect } from 'vitest'
import {
  ROLES, validateOrg, validatePerson, needsAddress, orgRow, personRow, emptyOrg,
  normalizeName, similarNames, findDuplicates, filterOrgs, filterPeople, quickCounts,
  parseCsv, parseRoles, csvToOrgs, displayName, otherName, CSV_TEMPLATE,
  isForeign, paysUs, groupOrgs, describeActivity,
} from './logic'

const org = (over = {}) => ({ ...emptyOrg(), id: over.id || 'x', status: 'active', ...over })
const ADDRESS = { nat_building_no: '2457', nat_street: 'King Fahd Road', nat_district: 'Al Olaya', city: 'Riyadh', nat_postal_code: '12214' }

describe('validation', () => {
  it('needs a name, and nothing else on its own', () => {
    expect(validateOrg(emptyOrg())).toEqual({ name: 'required' })
    expect(validateOrg({ ...emptyOrg(), name: 'Najd (test)' })).toEqual({})
  })

  it('VAT is 15 digits once spaces are out', () => {
    expect(validateOrg(org({ name: 'a', vat_number: '30012345' })).vat_number).toBe('vat_format')
    expect(validateOrg(org({ name: 'a', vat_number: '3001234567890AB' })).vat_number).toBe('vat_format')
    expect(validateOrg(org({ name: 'a', vat_number: '300 123 456 789 003' }))).toEqual({})
    expect(orgRow(org({ name: 'a', vat_number: ' 300 123 456 789 003 ' })).vat_number).toBe('300123456789003')
  })

  it('address numbers are digits; email and country have a shape', () => {
    const e = validateOrg(org({ name: 'a', nat_building_no: '12A', nat_postal_code: '١٢٣', email: 'nope', country: 'SAU' }))
    expect(e).toEqual({ nat_building_no: 'digits', nat_postal_code: 'digits', email: 'email', country: 'country' })
  })

  it('a client company with a VAT number gives its full national address (his rule)', () => {
    const f = org({ name: 'a', roles: ['client'], vat_number: '300123456789003', city: 'Riyadh' })
    expect(needsAddress(f)).toBe(true)
    expect(validateOrg(f)).toEqual({ nat_building_no: 'address_required', nat_street: 'address_required', nat_district: 'address_required', nat_postal_code: 'address_required' })
    expect(validateOrg({ ...f, ...ADDRESS })).toEqual({})
    // Not a client, an individual, or no VAT number: not required.
    expect(needsAddress({ ...f, roles: ['supplier'] })).toBe(false)
    expect(needsAddress({ ...f, kind: 'individual' })).toBe(false)
    expect(needsAddress({ ...f, vat_number: '' })).toBe(false)
  })

  it('an unknown role is refused', () => {
    expect(validateOrg(org({ name: 'a', roles: ['client', 'reseller'] })).roles).toBe('role')
  })

  it('the row to save: trimmed, blanks null, roles in the fixed order', () => {
    const row = orgRow(org({ name: '  Najd  ', roles: ['supplier', 'client'], email: ' A@B.TEST ', cr_number: ' ', country: 'sa' }))
    expect(row).toMatchObject({ name: 'Najd', roles: ['client', 'supplier'], email: 'a@b.test', cr_number: null, country: 'SA', notes: '' })
    expect(Object.keys(row)).not.toContain('id')
  })

  it('people need a name; a person on their own is never primary', () => {
    expect(validatePerson({ name: ' ', email: 'x' })).toEqual({ name: 'required', email: 'email' })
    expect(personRow({ name: 'Omar', org_id: '', is_primary: true }).is_primary).toBe(false)
    expect(personRow({ name: 'Omar', org_id: 'o1', is_primary: true })).toMatchObject({ org_id: 'o1', is_primary: true })
  })
})

describe('the duplicate guard', () => {
  it('folds Arabic letter forms, case, punctuation and firm-type words', () => {
    expect(normalizeName('Najd Towers Development Co. (test)')).toBe('najd tower development')
    expect(normalizeName('شركة أبراج نجد للتطوير (تجربة)')).toBe(normalizeName('شركه ابراج نجد للتطوير'))
  })

  it('finds very similar names, and leaves different firms alone', () => {
    expect(similarNames('Najd Towers Development (test)', 'Najd Tower Development Co (test)')).toBe(true)
    expect(similarNames('Al Bunyan Contracting', 'Al-Bunyan Contracting Company Ltd')).toBe(true)
    expect(similarNames('Al Bunyan Contracting', 'Al Bunyaan Contracting')).toBe(true) // one typo
    expect(similarNames('Najd Towers', 'Najd Towers Riyadh Branch')).toBe(true) // one inside the other
    expect(similarNames('Red Sea Lighting', 'Red Sea Cables')).toBe(false)
    expect(similarNames('ABC', 'ABD')).toBe(false) // too short to guess
    expect(similarNames('', 'Anything')).toBe(false)
  })

  it('same VAT or CR blocks; a similar name warns; the record itself is not its own duplicate', () => {
    const orgs = [
      org({ id: 'a', name: 'Najd Towers Development', vat_number: '300000000000003', cr_number: '1010123456' }),
      org({ id: 'b', name: 'Red Sea Lighting', cr_number: 'ABC-77' }),
      org({ id: 'c', name: 'Something else' }),
    ]
    const found = findDuplicates(org({ name: 'Najd Tower Development Co', vat_number: '300 000 000 000 003', cr_number: 'abc-77' }), orgs)
    expect(found.map(d => [d.org.id, d.reasons, d.blocking])).toEqual([
      ['a', ['vat', 'name'], true],
      ['b', ['cr'], true],
    ])
    expect(findDuplicates(org({ name: 'Najd Towers Development' }), orgs).map(d => [d.org.id, d.blocking])).toEqual([['a', false]])
    expect(findDuplicates(orgs[0], orgs, 'a')).toEqual([])
  })

  it('matches across languages through the Arabic name', () => {
    const orgs = [org({ id: 'a', name: 'Najd Towers', name_ar: 'أبراج نجد' })]
    expect(findDuplicates(org({ name: 'Different English', name_ar: 'ابراج نجد' }), orgs)).toHaveLength(1)
  })
})

describe('the list', () => {
  const orgs = [
    org({ id: '1', name: 'Najd Towers', name_ar: 'أبراج نجد', roles: ['client'], city: 'Riyadh', vat_number: '300000000000003' }),
    org({ id: '2', name: 'Red Sea Supply', roles: ['supplier'], city: 'Jeddah', phone: '+966 12 000 0002' }),
    org({ id: '3', name: 'Al Bunyan', roles: ['client', 'main_contractor'], city: 'Jeddah' }),
    org({ id: '4', name: 'Eastern Works', roles: ['supplier', 'subcontractor'] }),
    org({ id: '5', name: 'Diriyah Design', roles: ['consultant'] }),
    org({ id: '6', name: 'Old Horizon', roles: ['client'], status: 'archived' }),
  ]
  const ids = rows => rows.map(r => r.id)

  it('quick filters: clients, suppliers, contractors (main or sub), consultants', () => {
    expect(ids(filterOrgs(orgs, { quick: 'clients' }))).toEqual(['1', '3'])
    expect(ids(filterOrgs(orgs, { quick: 'suppliers' }))).toEqual(['2', '4'])
    expect(ids(filterOrgs(orgs, { quick: 'contractors' }))).toEqual(['3', '4'])
    expect(ids(filterOrgs(orgs, { quick: 'consultants' }))).toEqual(['5'])
    expect(quickCounts(orgs)).toEqual({ all: 5, clients: 2, suppliers: 2, contractors: 2, consultants: 1 })
  })

  it('a role and a status narrow it; archived ones show only when asked', () => {
    expect(ids(filterOrgs(orgs, { role: 'main_contractor' }))).toEqual(['3'])
    expect(ids(filterOrgs(orgs, { quick: 'clients', status: 'archived' }))).toEqual(['6'])
    expect(ids(filterOrgs(orgs, { quick: 'clients', status: 'all' }))).toEqual(['1', '3', '6'])
  })

  it('search finds names in either language, numbers, city and phone digits', () => {
    expect(ids(filterOrgs(orgs, { q: 'jeddah' }))).toEqual(['2', '3'])
    expect(ids(filterOrgs(orgs, { q: 'ابراج' }))).toEqual(['1'])
    expect(ids(filterOrgs(orgs, { q: '300000000000003' }))).toEqual(['1'])
    expect(ids(filterOrgs(orgs, { q: '0000002' }))).toEqual(['2'])
    expect(ids(filterOrgs(orgs, { q: 'red jeddah' }))).toEqual(['2'])
  })

  it('people: with an organisation, on their own, and found by their organisation', () => {
    const people = [{ id: 'p1', name: 'Omar', org_id: '1' }, { id: 'p2', name: 'Sara', org_id: null }]
    const byId = { 1: orgs[0] }
    expect(ids(filterPeople(people, byId, { scope: 'alone' }))).toEqual(['p2'])
    expect(ids(filterPeople(people, byId, { scope: 'with' }))).toEqual(['p1'])
    expect(ids(filterPeople(people, byId, { q: 'نجد' }))).toEqual(['p1'])
  })

  it('names in the reader\'s language', () => {
    const o = { name: 'Najd Towers', name_ar: 'أبراج نجد' }
    expect([displayName(o, 'ar'), otherName(o, 'ar')]).toEqual(['أبراج نجد', 'Najd Towers'])
    expect([displayName(o, 'en'), otherName(o, 'en')]).toEqual(['Najd Towers', 'أبراج نجد'])
    expect([displayName({ name: 'X' }, 'ar'), otherName({ name: 'X' }, 'ar')]).toEqual(['X', ''])
  })
})

describe('CSV import', () => {
  it('reads quotes, doubled quotes, CRLF, a BOM and semicolon files', () => {
    expect(parseCsv('﻿name,notes\r\n"Najd, Towers","say ""hi"""\r\n\r\nB,\n')).toEqual([['name', 'notes'], ['Najd, Towers', 'say "hi"'], ['B', '']])
    expect(parseCsv('name;city\nA;Riyadh')).toEqual([['name', 'city'], ['A', 'Riyadh']])
  })

  it('reads roles in English, as keys or in Arabic, and reports the rest', () => {
    const names = { client: ['Client', 'عميل'], supplier: ['Supplier', 'مورد'], main_contractor: ['Main contractor', 'مقاول رئيسي'] }
    expect(parseRoles('supplier; Client', names)).toEqual({ roles: ['client', 'supplier'], unknown: [] })
    expect(parseRoles('عميل، مقاول رئيسي', names)).toEqual({ roles: ['client', 'main_contractor'], unknown: [] })
    expect(parseRoles('main_contractor|reseller', names)).toEqual({ roles: ['main_contractor'], unknown: ['reseller'] })
  })

  it('turns a file into checked rows, with duplicates against the company and the file itself', () => {
    const existing = [org({ id: 'a', name: 'Najd Towers', vat_number: '300000000000003' })]
    const file = [
      'Name,Arabic name,Roles,VAT,City,Unknown column',
      'Red Sea Supply (test),مورد البحر (تجربة),supplier,,Jeddah,x',
      'Copy of Najd,,client,300000000000003,Riyadh,',
      ',,client,,,',
      'Red Sea Supply,,supplier,,,',
    ].join('\n')
    const out = csvToOrgs(file, existing)
    expect(out.ignored).toEqual(['Unknown column'])
    expect(out.rows.map(r => r.line)).toEqual([2, 3, 4, 5])
    expect(out.rows[0]).toMatchObject({ errors: {}, duplicates: [], fields: { name: 'Red Sea Supply (test)', name_ar: 'مورد البحر (تجربة)', roles: ['supplier'], city: 'Jeddah' } })
    // VAT already held, and a client with VAT but no address.
    expect(out.rows[1].duplicates[0]).toMatchObject({ reasons: ['vat'], blocking: true })
    expect(out.rows[1].errors).toMatchObject({ nat_building_no: 'address_required' })
    expect(out.rows[2].errors).toEqual({ name: 'required' })
    // Line 5 repeats line 2 of the same file.
    expect(out.rows[3].duplicates[0]).toMatchObject({ reasons: ['name'], blocking: false, org: { line: 2 } })
  })

  it('the template\'s columns are all understood', () => {
    expect(csvToOrgs(`${CSV_TEMPLATE}\n`).ignored).toEqual([])
    expect(CSV_TEMPLATE.split(',')).toContain('roles')
    expect(ROLES).toHaveLength(6)
  })
})

describe('the rest of his suppliers and clients', () => {
  it('IBAN: Saudi shape in the Kingdom, any country\'s outside; SWIFT and terms have a shape', () => {
    expect(validateOrg(org({ name: 'a', iban: 'SA03 8000 0000 6080 1016 7519' }))).toEqual({})
    expect(validateOrg(org({ name: 'a', iban: 'IT60X0542811101000000123456' })).iban).toBe('iban_sa')
    expect(validateOrg(org({ name: 'a', country: 'IT', iban: 'IT60X0542811101000000123456' }))).toEqual({})
    expect(validateOrg(org({ name: 'a', country: 'IT', iban: 'not an iban' })).iban).toBe('iban')
    expect(validateOrg(org({ name: 'a', swift: 'BC1' })).swift).toBe('swift')
    expect(validateOrg(org({ name: 'a', swift: 'bcititmm' }))).toEqual({})
    expect(validateOrg(org({ name: 'a', payment_terms_days: '4000' })).payment_terms_days).toBe('terms')
    expect(validateOrg(org({ name: 'a', payment_terms_days: '-1' })).payment_terms_days).toBe('terms')
    expect(orgRow(org({ name: 'a', iban: ' sa03 8000 ', swift: 'bcit itmm', payment_terms_days: '30', category_id: '' })))
      .toMatchObject({ iban: 'SA038000', swift: 'BCITITMM', payment_terms_days: 30, category_id: null })
  })

  it('foreign and "pays us" as his screens decide them', () => {
    expect([isForeign({ country: 'IT' }), isForeign({ country: 'SA' }), isForeign({})]).toEqual([true, false, false])
    expect([paysUs({ roles: ['supplier'] }), paysUs({ roles: ['subcontractor'] }), paysUs({ roles: ['client'] })]).toEqual([true, true, false])
  })

  const orgs = [
    org({ id: '1', name: 'A', kind: 'company', city: 'Riyadh', vat_number: '300000000000003', category_id: 'c1', contact_no: 'C-2026-000001' }),
    org({ id: '2', name: 'B', kind: 'individual', city: 'Jeddah' }),
    org({ id: '3', name: 'C', kind: 'company', city: '', country: 'IT', category_id: 'c1' }),
    org({ id: '4', name: 'D', kind: 'company', city: 'Riyadh', category_id: 'c2' }),
  ]
  const ids = rows => rows.map(r => r.id)

  it('his list filters: company or individual, VAT-registered, foreign, category, and the number in search', () => {
    expect(ids(filterOrgs(orgs, { kind: 'individual' }))).toEqual(['2'])
    expect(ids(filterOrgs(orgs, { vat: 'yes' }))).toEqual(['1'])
    expect(ids(filterOrgs(orgs, { vat: 'no' }))).toEqual(['2', '3', '4'])
    expect(ids(filterOrgs(orgs, { foreign: true }))).toEqual(['3'])
    expect(ids(filterOrgs(orgs, { category: 'c1' }))).toEqual(['1', '3'])
    expect(ids(filterOrgs(orgs, { q: 'c-2026-000001' }))).toEqual(['1'])
  })

  it('group by kind, city or category, the empty group last', () => {
    expect(groupOrgs(orgs, 'city').map(g => [g.key, ids(g.rows)])).toEqual([['Jeddah', ['2']], ['Riyadh', ['1', '4']], ['', ['3']]])
    expect(groupOrgs(orgs, 'kind').map(g => g.key)).toEqual(['company', 'individual'])
    const names = { c1: 'Lighting', c2: 'Controls' }
    expect(groupOrgs(orgs, 'category', k => names[k] || '').map(g => g.key)).toEqual(['c2', 'c1', ''])
    expect(groupOrgs(orgs, '')).toEqual([{ key: '', rows: orgs }])
  })

  it('a history row reads field by field, old → new, with dashes for empty', () => {
    const row = { action: 'update', label: 'Najd', person_id: null, changes: { city: [null, 'Riyadh'], roles: [['client'], ['client', 'supplier']], workspace_id: ['x', 'y'] } }
    const show = (f, v) => (f === 'roles' ? v.join(' + ') : v)
    expect(describeActivity(row, show)).toEqual({ who: 'org', action: 'update', label: 'Najd', changes: [['city', '—', 'Riyadh'], ['roles', 'client', 'client + supplier']] })
    expect(describeActivity({ action: 'insert', person_id: 'p', label: 'Omar' })).toEqual({ who: 'person', action: 'insert', label: 'Omar', changes: [] })
  })

  it('the CSV reads the supplier columns too', () => {
    const out = csvToOrgs('name,country,iban,swift,payment terms,address\nLuce,IT,IT60X0542811101000000123456,BCITITMM,60,Milano\nBad,SA,IT60X0542811101000000123456,,x,\n')
    expect(out.ignored).toEqual([])
    expect(out.rows[0]).toMatchObject({ errors: {}, fields: { country: 'IT', payment_terms_days: '60', address: 'Milano' } })
    expect(out.rows[1].errors).toEqual({ iban: 'iban_sa', payment_terms_days: 'terms' })
  })
})
