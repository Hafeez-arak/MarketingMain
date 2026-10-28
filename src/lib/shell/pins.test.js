import { describe, it, expect } from 'vitest'
import { defaultPins, railSections, togglePin, isPinned, canPin } from './pins'
import { SECTIONS } from '../modules'

const keys = list => list.map(s => (typeof s === 'string' ? s : s.key))
const ADMIN = { isAccessAdmin: true, sections: null }
// Sara: marketing and insights to work in, CRM only to read.
const SARA = { isAccessAdmin: false, sections: { marketing: 'work', insights: 'work', crm: 'view' } }
// Nasser-like reader: view everywhere he has anything.
const READER = { isAccessAdmin: false, sections: { ceo: 'view', crm: 'view' } }
const FAISAL = { isAccessAdmin: false, sections: { sales: 'manage' } }

describe('default pins', () => {
  it('pins the sections a person works in or manages', () => {
    expect(defaultPins(SARA)).toEqual(['marketing', 'insights'])
  })

  it('falls back to every section when they only read', () => {
    expect(defaultPins(READER)).toEqual(['ceo', 'crm'])
  })

  it('gives the access admin everything, Admin included', () => {
    expect(defaultPins(ADMIN)).toEqual(SECTIONS.map(s => s.key))
  })

  it('follows v1 where the grants table is missing (members work in Marketing and Insights)', () => {
    expect(defaultPins({ isAccessAdmin: false, sections: null })).toEqual(['marketing', 'insights'])
  })

  it('is empty for someone with no sections', () => {
    expect(defaultPins({ isAccessAdmin: false, sections: {} })).toEqual([])
  })
})

describe('the rail', () => {
  it('draws the defaults until the person chooses', () => {
    expect(keys(railSections(SARA, null))).toEqual(['marketing', 'insights'])
  })

  it('draws the saved choice, in the registry order whatever order it was saved in', () => {
    expect(keys(railSections(SARA, ['insights', 'crm']))).toEqual(['crm', 'insights'])
  })

  it('never draws a pinned section the person can no longer open', () => {
    expect(keys(railSections(SARA, ['marketing', 'hr', 'sales']))).toEqual(['marketing'])
  })

  it('an empty choice draws no sections (the grid still opens them all)', () => {
    expect(railSections(SARA, [])).toEqual([])
  })

  it('someone with a single section always has it, whatever is saved', () => {
    expect(keys(railSections(FAISAL, []))).toEqual(['sales'])
    expect(canPin(FAISAL)).toBe(false)
    expect(canPin(SARA)).toBe(true)
  })

  it('keeps the section menus: a drawn section carries only the pages the person may open', () => {
    const sales = railSections({ isAccessAdmin: false, sections: { sales: 'view', crm: 'view' } }, null).find(s => s.key === 'sales')
    expect(sales.pages.map(p => p.to)).not.toContain('/sales/agent-brief')
  })
})

describe('pinning', () => {
  it('the first change starts from the defaults', () => {
    expect(togglePin('crm', SARA, null)).toEqual(['crm', 'marketing', 'insights'])
    expect(togglePin('insights', SARA, null)).toEqual(['marketing'])
  })

  it('toggles on the saved list and keeps it in registry order', () => {
    expect(togglePin('marketing', SARA, ['insights'])).toEqual(['marketing', 'insights'])
    expect(togglePin('insights', SARA, ['marketing', 'insights'])).toEqual(['marketing'])
  })

  it('keeps the pin of a section whose grant is gone, so it comes back with the grant', () => {
    const saved = togglePin('marketing', SARA, ['marketing', 'hr'])
    expect(saved).toEqual(['hr'])
    expect(keys(railSections({ ...SARA, sections: { ...SARA.sections, hr: 'view' } }, saved))).toEqual(['hr'])
  })

  it('drops keys that are not sections', () => {
    expect(togglePin('crm', SARA, ['marketing', 'nonsense', 'finance'])).toEqual(['crm', 'marketing'])
  })

  it('isPinned answers for the rail', () => {
    expect(isPinned('marketing', SARA, null)).toBe(true)
    expect(isPinned('crm', SARA, null)).toBe(false)
  })
})
