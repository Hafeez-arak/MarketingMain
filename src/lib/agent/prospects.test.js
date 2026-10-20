import { describe, it, expect } from 'vitest'
import {
  nameKey, sameCompany, segmentSuggestions, cleanProspects, prospectRows, prospectsPrompt,
  prospectsSummary, contactFromProspect, groupNameFor, PROSPECTS_SCHEMA, MAX_PROSPECTS,
} from './prospects.js'

const ICP = {
  summary: 'Companies that run sites whose grounds must look right every day.',
  segments: [{ key: 'hotels', label: 'Hotels and resorts', track: 'core', match: ['hotel'] }],
  offers: [
    { key: 'maintenance', label: 'Yearly care and maintenance contract', kind: 'recurring' },
    { key: 'design_build', label: 'Design and build a new landscape', kind: 'one_off' },
  ],
  hire_stage: 'Late in a project, near handover.',
}

const good = (over = {}) => ({
  name: 'Example Hotels Co.', website: 'https://examplehotels.sa', city: 'Riyadh',
  sites: '6 hotels in Riyadh', fit: 'Guest gardens at every hotel.', source_url: 'https://examplehotels.sa/locations',
  offer: 'maintenance', pitch: 'Offer a yearly care contract.', proof: '', ask_for: 'Facilities manager',
  email: 'facilities@examplehotels.sa', phone: '+966 11 123 4567', linkedin: 'https://www.linkedin.com/company/examplehotels',
  contact_source: 'https://examplehotels.sa/contact', confidence: 0.8, ...over,
})

describe('nameKey', () => {
  it('ignores case, punctuation and company suffixes', () => {
    expect(nameKey('Example Hotels Co.')).toBe(nameKey('EXAMPLE HOTELS'))
    expect(nameKey('The Example Group LLC')).toBe(nameKey('example'))
  })
  it('keeps Arabic names (resolve.js norm would erase them)', () => {
    expect(nameKey('شركة الريم للفنادق')).toBe('الريمللفنادق')
    expect(nameKey('فندق النخيل')).not.toBe(nameKey('فندق الواحة'))
  })
})

describe('sameCompany', () => {
  it('matches on domain, key, or a contained key of five letters or more', () => {
    expect(sameCompany({ name: 'A', website: 'https://www.x.sa/a' }, { name: 'B', domain: 'x.sa' })).toBe(true)
    expect(sameCompany({ name: 'Example Hotels Co.' }, { name: 'example hotels' })).toBe(true)
    expect(sameCompany({ name: 'Example Hotels Riyadh' }, { name: 'Example Hotels' })).toBe(true)
  })
  it('does not let a short name swallow a longer one', () => {
    expect(sameCompany({ name: 'Abc' }, { name: 'Abcon Contracting' })).toBe(false)
    expect(sameCompany({ name: 'Company Number 1' }, { name: 'Company Number 10' })).toBe(false)
  })
  it('never calls two unnamed rows the same', () => {
    expect(sameCompany({ name: '' }, { name: '' })).toBe(false)
  })
})

describe('segmentSuggestions', () => {
  it('offers the ICP segments when there are any, else the audience lines without headings', () => {
    const personas = [
      'Companies and project clients come first:',
      'Hotels, resorts and hospitality operators: arrivals and guest-facing gardens',
      'Facility and property managers looking for regular landscape maintenance',
      'Homes as well:',
    ].join('\n')
    expect(segmentSuggestions({ targetPersonas: personas, icp: ICP })).toEqual(['Hotels and resorts'])
    const out = segmentSuggestions({ targetPersonas: personas })
    expect(out).toContain('Hotels, resorts and hospitality operators')
    expect(out).toContain('Facility and property managers looking for regular landscape maintenance')
    expect(out.some(s => /come first|as well/.test(s))).toBe(false)
  })
})

describe('cleanProspects', () => {
  const allowed = new Set(['https://examplehotels.sa/locations', 'https://examplehotels.sa/contact', 'https://dir.example/list'])

  it('keeps a sourced company with its checked contacts', () => {
    const { keep } = cleanProspects([good()], { allowed, icp: ICP })
    expect(keep).toHaveLength(1)
    expect(keep[0]).toMatchObject({ email: 'facilities@examplehotels.sa', offer: 'maintenance', domain: 'examplehotels.sa' })
  })

  it('drops a company whose page and website the tools never returned', () => {
    const { keep, dropped } = cleanProspects(
      [good({ website: 'https://made-up.sa', source_url: 'https://made-up.sa/about' })], { allowed, icp: ICP })
    expect(keep).toHaveLength(0)
    expect(dropped.unsourced).toBe(1)
  })

  it('blanks an email or phone read from a page nobody fetched', () => {
    const { keep } = cleanProspects([good({ contact_source: 'https://elsewhere.example/contact' })], { allowed, icp: ICP })
    expect(keep[0].email).toBe('')
    expect(keep[0].phone).toBe('')
    expect(keep[0].contact_source).toBe('')
  })

  it('drops a company we already have, in any spelling, and a duplicate in the same answer', () => {
    const { keep, dropped } = cleanProspects(
      [good(), good({ name: 'EXAMPLE HOTELS' }), good({ name: 'Other Mall', website: '', source_url: 'https://dir.example/list' })],
      { allowed, icp: ICP, known: [{ name: 'Other Mall LLC' }] })
    expect(keep.map(k => k.name)).toEqual(['Example Hotels Co.'])
    expect(dropped.known).toBe(2)
  })

  it('keeps only offer keys the ICP has, a company LinkedIn page, and a real phone', () => {
    const { keep } = cleanProspects([good({ offer: 'free_lunch', linkedin: 'https://linkedin.com/in/someone', phone: '123' })], { allowed, icp: ICP })
    expect(keep[0].offer).toBe('')
    expect(keep[0].linkedin).toBe('')
    expect(keep[0].phone).toBe('')
  })

  it('stops at the count asked for', () => {
    const many = Array.from({ length: 20 }, (_, i) => good({ name: `Company Number ${i}`, website: '', source_url: 'https://dir.example/list' }))
    expect(cleanProspects(many, { allowed, icp: ICP, count: 5 }).keep).toHaveLength(5)
    expect(cleanProspects(many, { allowed, icp: ICP, count: 99 }).keep).toHaveLength(MAX_PROSPECTS)
  })
})

describe('rows, summary and outreach', () => {
  it('pins status new and the segment on every row', () => {
    const rows = prospectRows('ws-1', 's-1', ' Hotels ', [{ name: 'A', name_key: 'a' }])
    expect(rows[0]).toMatchObject({ workspace_id: 'ws-1', search_id: 's-1', segment: 'Hotels', status: 'new' })
  })
  it('says what was left out and why', () => {
    const s = prospectsSummary({ keep: [{}, {}], dropped: { known: 1, unsourced: 3 }, cost: 0.4 })
    expect(s.message).toBe('2 new companies found. 1 we already had was left out. 3 without a page we could check were left out.')
  })
  it('makes a cold contact only from a published email', () => {
    expect(contactFromProspect({ name: 'A', phone: '+966' })).toBeNull()
    expect(contactFromProspect({ name: 'A', email: 'Info@A.sa', segment: 'Hotels' }))
      .toMatchObject({ email: 'info@a.sa', company: 'A', audience: 'cold', consent: 'none', source: 'research' })
  })
  it('names the outreach group after the segment', () => {
    expect(groupNameFor('Hotels')).toBe('Prospects — Hotels')
    expect(groupNameFor('x'.repeat(80)).length).toBeLessThanOrEqual(72)
  })
})

describe('prospectsPrompt', () => {
  const p = prospectsPrompt(
    { brandName: 'Ghusn', descriptor: 'a landscape company', geography: 'Riyadh' },
    { segment: 'hotels', count: 10, icp: ICP, known: ['Already There Co'], language: 'Arabic' })

  it('carries the segment, the offers with keys, when we are hired, and who we already have', () => {
    expect(p).toContain('WHICH HOTELS IN RIYADH WOULD BUY FROM US')
    expect(p).toContain('[offer key: maintenance] — recurring, a yearly contract')
    expect(p).toContain('WHEN WE ARE HIRED: Late in a project, near handover.')
    expect(p).toContain('- Already There Co')
    expect(p).toContain('Search in Arabic as well as English')
  })
  it('asks for public contacts only, never a guessed email', () => {
    expect(p).toMatch(/CONTACTS ARE PUBLIC ONLY/)
    expect(p).toMatch(/Never build an email from a pattern/)
  })
  it('works for a brand with no ICP', () => {
    const bare = prospectsPrompt({ brandName: 'X' }, { segment: 'schools' })
    expect(bare).toContain('WHICH SCHOOLS WOULD BUY FROM US')
    expect(bare).not.toContain('WHAT WE SELL')
  })
})

describe('PROSPECTS_SCHEMA', () => {
  it('requires every item field, so structured output has no optional properties to refuse on', () => {
    const item = PROSPECTS_SCHEMA.schema.properties.prospects.items
    expect(item.required.sort()).toEqual(Object.keys(item.properties).sort())
  })
})
