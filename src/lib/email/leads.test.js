import { describe, it, expect } from 'vitest'
import { leadCompanies, leadsForOutreach, searchLinks, contactFromLead } from './leads.js'

const opp = (over = {}) => ({ id: 'o1', name: 'Westin Riyadh', headline: 'New 300-key hotel', client: 'NMDC', contractor: '', consultant: '', location: 'Riyadh, Saudi Arabia', status: 'new', relevance: 'medium', last_seen_at: '2026-09-20', ...over })

describe('leadCompanies', () => {
  it('lists each named company once, with every role it plays', () => {
    expect(leadCompanies(opp({ client: 'Diriyah Company', consultant: 'Dar Al-Handasah; diriyah company' }))).toEqual([
      { name: 'Diriyah Company', roles: ['Client', 'Consultant'] },
      { name: 'Dar Al-Handasah', roles: ['Consultant'] },
    ])
  })
  it('skips blanks and placeholders', () => {
    expect(leadCompanies(opp({ client: 'Unknown', contractor: 'TBC' }))).toEqual([])
  })
  it('keeps a company name that has a comma inside it', () => {
    expect(leadCompanies(opp({ client: 'Nesma & Partners, Riyadh branch' }))[0].name).toBe('Nesma & Partners, Riyadh branch')
  })
})

describe('leadsForOutreach', () => {
  it('keeps open leads not marked "not for outreach", those without people first', () => {
    const out = leadsForOutreach([
      opp({ id: 'a', relevance: 'high' }),
      opp({ id: 'b', status: 'won' }),
      opp({ id: 'c', outreach_dismissed_at: '2026-09-28' }),
      opp({ id: 'd', relevance: 'high' }),
    ], [{ id: 'k', opportunity_id: 'a' }])
    expect(out.map(o => o.id)).toEqual(['d', 'a'])
    expect(out[1].contacts).toHaveLength(1)
  })
})

describe('searchLinks and contactFromLead', () => {
  it('builds searches a person opens', () => {
    const l = searchLinks('NMDC', 'Riyadh, Saudi Arabia')
    expect(decodeURIComponent(l.google)).toContain('"NMDC" Riyadh email')
    expect(l.linkedin).toMatch(/^https:\/\/www\.linkedin\.com\/search\/results\/people\//)
  })
  it('fills a cold, research-sourced contact tied to the lead', () => {
    expect(contactFromLead(opp(), { name: 'NMDC', roles: ['Client'] })).toMatchObject({
      company: 'NMDC', audience: 'cold', consent: 'none', source: 'research', opportunity_id: 'o1', city: 'Riyadh', contact_type: 'Developer',
    })
  })
})
