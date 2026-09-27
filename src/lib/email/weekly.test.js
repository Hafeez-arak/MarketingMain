import { describe, it, expect } from 'vitest'
import {
  weekOf, marketingFindings, audienceSummary, weeklyPrompt, inputsSummary, parseWeekly, optionBody, wantsArabic,
} from './weekly.js'

function inputs(over = {}) {
  return {
    today: '2026-09-28',
    weekOf: '2026-09-28',
    website: 'https://arak-sa.com',
    audience: audienceSummary({
      contacts: [{ language: 'en', contact_type: 'Customer' }, { language: 'ar', contact_type: 'Consultant' }, { language: 'en', contact_type: 'Customer' }],
      groups: [{ id: 'g1', name: 'Customers', description: 'Bought in 3 years' }],
      members: [{ group_id: 'g1' }, { group_id: 'g1' }],
    }),
    campaigns: [{ sent_on: '2026-09-20', subject: 'Three new projects', recipients: 40, sent: 40, opened: 20, clicked: 4 }],
    lastWeek: ['Showroom invitation: Come and see the range'],
    posts: [{ date: '2026-09-25', platform: 'instagram', topic: 'Hotel lobby lighting', caption: '' }],
    research: {
      id: 'r1', finished_on: '2026-09-17', age_days: 11, headline: 'Riyadh hospitality is busy',
      findings: [{ headline: 'Lighting show LIGHTSPACE is coming', detail: 'First dedicated show', lens: 'events', novelty: 'new' }],
    },
    calendar: [{ name: 'Founding Day', date: '2027-02-22', days_until: 147, note: '' }],
    events: [{ name: 'LIGHTSPACE', start_date: '2026-11-10', city: 'Riyadh', recommendation: 'Visit', decision: 'visiting' }],
    leads: [{ name: 'Mondrian Riyadh', headline: 'Hotel fit-out, no lighting contractor named', location: 'Riyadh', stage: 'design' }],
    ...over,
  }
}

describe('the week', () => {
  it('is the Monday of the Riyadh week, even late Sunday UTC', () => {
    expect(weekOf(new Date('2026-09-30T10:00:00Z'))).toBe('2026-09-28')
    // 22:30 UTC Sunday is already Monday 01:30 in Riyadh.
    expect(weekOf(new Date('2026-09-27T22:30:00Z'))).toBe('2026-09-28')
    expect(weekOf(new Date('2026-09-27T20:00:00Z'))).toBe('2026-09-21')
  })
})

describe('what research reaches the model', () => {
  it('takes marketing findings first, then market lenses, and leaves sales and technical out', () => {
    const f = marketingFindings([
      { headline: 'Tender closes Thursday', for_whom: 'sales', lens: 'openings' },
      { headline: 'Spec change for DALI', for_whom: 'technical', lens: 'category' },
      { headline: 'Demand for warm white rising', lens: 'demand' },
      { headline: 'Post a Founding Day reel', for_whom: 'marketing', lens: 'calendar' },
      { headline: 'Post a Founding Day reel', for_whom: 'marketing', lens: 'calendar' },
    ])
    expect(f.map(x => x.headline)).toEqual(['Post a Founding Day reel', 'Demand for warm white rising'])
  })
})

describe('the prompt', () => {
  it('states every section, the research age, and the rules on leads', () => {
    const p = weeklyPrompt(inputs())
    expect(p).toContain('Today is 2026-09-28')
    expect(p).toContain('Website (the only link you may use): https://arak-sa.com')
    expect(p).toContain('Group "Customers" (2)')
    expect(p).toContain('opened 50%, clicked 10%')
    expect(p).toContain('Showroom invitation')
    expect(p).toContain('Hotel lobby lighting')
    expect(p).toContain('11 day(s) ago (STALE')
    expect(p).toContain('we are visiting')
    expect(p).toContain('never name them, never imply we are involved')
    expect(p).toContain('Hotel fit-out, no lighting contractor named')
  })
  it('never sends a person\'s name or address to the model', () => {
    const p = weeklyPrompt(inputs())
    expect(p).not.toMatch(/@/)
  })
  it('asks for Arabic only when a fifth of the list reads it', () => {
    expect(wantsArabic({ arabic_share: 0.33 })).toBe(true)
    expect(wantsArabic({ arabic_share: 0.1 })).toBe(false)
    expect(weeklyPrompt(inputs())).toContain('Arabic: YES')
    const en = inputs({ audience: audienceSummary({ contacts: [{ language: 'en' }], groups: [], members: [] }) })
    expect(weeklyPrompt(en)).toContain('Arabic: NO')
  })
  it('copes with a brand-new workspace: no list, no research, nothing sent', () => {
    const p = weeklyPrompt(inputs({
      audience: audienceSummary({}), campaigns: [], lastWeek: [], posts: [], research: null, calendar: [], events: [], leads: [], website: '',
    }))
    expect(p).toContain('The list is empty so far')
    expect(p).toContain('No completed research run yet.')
    expect(p).toContain('every CTA is a reply')
  })
  it('summarises inputs as counts, not text', () => {
    const s = inputsSummary(inputs())
    expect(s).toMatchObject({ contacts: 3, groups: 1, campaigns: 1, research_age_days: 11, arabic_requested: true, leads: 1 })
  })
})

describe('parsing the answer', () => {
  const option = (over = {}) => ({
    angle: 'Hotel season', why_now: 'Research', audience: 'Customers', subject: 'S', preheader: 'P', body: 'B',
    cta_label: 'See it', cta_url: 'https://arak-sa.com/projects', ar_subject: 'ع', ar_preheader: '', ar_body: 'نص', ar_cta_label: 'شاهد', ...over,
  })
  it('keeps a CTA only when it points at the website', () => {
    const r = parseWeekly(JSON.stringify({ note: '', options: [option(), option({ cta_url: 'https://evil.example' })] }), { website: 'https://arak-sa.com', arabic: true })
    expect(r.options[0].cta_url).toBe('https://arak-sa.com/projects')
    expect(r.options[1]).toMatchObject({ cta_url: '', cta_label: '', ar_cta_label: '' })
  })
  it('blanks Arabic that was not asked for, and drops options with no body', () => {
    const r = parseWeekly(JSON.stringify({ options: [option(), option({ body: '' })] }), { website: 'https://arak-sa.com', arabic: false })
    expect(r.options).toHaveLength(1)
    expect(r.options[0].ar_body).toBe('')
  })
  it('fails cleanly on junk', () => {
    expect(parseWeekly('not json').ok).toBe(false)
    expect(parseWeekly(JSON.stringify({ options: [] })).ok).toBe(false)
  })
  it('turns an option into a body whose CTA line the designer makes a button', () => {
    expect(optionBody(option())).toBe('B\n\n[See it](https://arak-sa.com/projects)')
    expect(optionBody(option(), 'ar')).toBe('نص\n\n[شاهد](https://arak-sa.com/projects)')
    expect(optionBody(option({ cta_url: '' }))).toBe('B')
  })
})
