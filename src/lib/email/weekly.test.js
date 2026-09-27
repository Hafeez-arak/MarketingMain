import { describe, it, expect } from 'vitest'
import {
  weekOf, marketingFindings, audienceSummary, weeklyPrompt, inputsSummary, parseWeekly, optionBody, wantsArabic,
  websiteOf, sitePages, explainModelError, storyPosts, projectTypes,
} from './weekly.js'

function inputs(over = {}) {
  return {
    today: '2026-09-28',
    weekOf: '2026-09-27',
    website: 'https://arak-sa.com',
    pages: ['https://arak-sa.com/services/facade-lighting'],
    audience: audienceSummary({
      contacts: [{ language: 'en', contact_type: 'Customer' }, { language: 'ar', contact_type: 'Consultant' }, { language: 'en', contact_type: 'Customer' }],
      groups: [{ id: 'g1', name: 'Customers', description: 'Bought in 3 years' }],
      members: [{ group_id: 'g1' }, { group_id: 'g1' }],
    }),
    campaigns: [{ sent_on: '2026-09-20', subject: 'Three new projects', recipients: 40, sent: 40, opened: 20, clicked: 4 }],
    lastWeek: ['Showroom invitation: Come and see the range'],
    posts: [{ date: '2026-09-25', platform: 'instagram', topic: 'Hotel lobby lighting', caption: '', text: 'Hotel lobby lighting' }],
    research: {
      id: 'r1', finished_on: '2026-09-17', age_days: 11, headline: 'Riyadh hospitality is busy',
      findings: [{ headline: 'Lighting show LIGHTSPACE is coming', detail: 'First dedicated show', lens: 'events', novelty: 'new' }],
    },
    calendar: [{ name: 'Founding Day', date: '2027-02-22', days_until: 147, note: '' }],
    events: [{ name: 'LIGHTSPACE', start_date: '2026-11-10', city: 'Riyadh', recommendation: 'Visit', decision: 'visiting' }],
    leads: [{ name: 'Mondrian Riyadh', client: 'Ennismore', headline: 'Mondrian Riyadh hotel fit-out for Ennismore, no lighting contractor named', location: 'Riyadh', stage: 'design' }],
    ...over,
  }
}

describe('the week', () => {
  it('starts on Sunday, the first Saudi working day, in Riyadh time', () => {
    expect(weekOf(new Date('2026-09-30T10:00:00Z'))).toBe('2026-09-27')   // Wednesday
    expect(weekOf(new Date('2026-09-27T08:00:00Z'))).toBe('2026-09-27')   // Sunday itself
    // 21:30 UTC Saturday is already Sunday 00:30 in Riyadh.
    expect(weekOf(new Date('2026-09-26T21:30:00Z'))).toBe('2026-09-27')
    expect(weekOf(new Date('2026-09-26T20:00:00Z'))).toBe('2026-09-20')
  })
})

describe('the website and its pages', () => {
  const profile = {
    customFields: {
      website: 'arak-sa.com',
      business_lines: 'lighting | Lighting | /services/indoor-lighting, /services/facade-lighting, lighting design, إضاءة\ncontrols | Controls | /services/lighting-controls, knx',
    },
  }
  it('reads the Brand Brain custom field and gives it a scheme', () => {
    expect(websiteOf(profile)).toBe('https://arak-sa.com')
    expect(websiteOf({ contactInfo: 'Call us. Web: https://www.example.com/ today' })).toBe('https://www.example.com')
    expect(websiteOf({})).toBe('')
  })
  it('lists the service pages from the business lines, and nothing else', () => {
    expect(sitePages(profile)).toEqual([
      'https://arak-sa.com/services/indoor-lighting',
      'https://arak-sa.com/services/facade-lighting',
      'https://arak-sa.com/services/lighting-controls',
    ])
    expect(sitePages({ customFields: { business_lines: '/services/x' } })).toEqual([])
  })
  it('keeps a CTA to a service page, since it starts with the website', () => {
    const r = parseWeekly(JSON.stringify({ options: [{ subject: 'S', body: 'B', cta_label: 'Facades', cta_url: 'https://arak-sa.com/services/facade-lighting' }] }), { website: 'https://arak-sa.com' })
    expect(r.options[0].cta_url).toBe('https://arak-sa.com/services/facade-lighting')
  })
  it('reduces a lead to a project type, whatever its name is spelled like', () => {
    expect(projectTypes("Qiddiya's National Athletics Stadium (~$1.8bn) is moving to tender")).toEqual(['stadium or sports venue', 'giga-project'])
    expect(projectTypes('Ten active hotel developments')).toEqual(['hotel'])
    expect(projectTypes('Something unusual')).toEqual(['construction project'])
  })
  it('explains an empty AI account in words, not JSON', () => {
    expect(explainModelError('400 {"message":"Your credit balance is too low to access the Anthropic API."}')).toMatch(/run out of credit/)
  })
})

describe('what research reaches the model', () => {
  // Shapes taken from the real 2026-09-17 brief.
  const brief = [
    { lens: 'calendar', for_whom: 'marketing', headline: 'Saudi National Day is 6 days away', evidence: { date: '2026-09-23' } },
    { lens: 'calendar', for_whom: 'marketing', headline: 'Founding Day prep opens', evidence: { date: '2027-02-22' } },
    { lens: 'ourselves', for_whom: 'marketing', headline: 'Our Instagram averaged 0.4 interactions per post.' },
    { lens: 'search', for_whom: 'marketing', headline: '1140 search impressions and 44 clicks' },
    { lens: 'rivals', for_whom: 'marketing', headline: 'A rival has a new facade reference' },
    { lens: 'openings', for_whom: 'sales', headline: 'Enar Riyadh is in design' },
    { lens: 'events', for_whom: 'marketing', headline: 'This run could not confirm which competitors exhibit' },
    { lens: 'events', for_whom: 'marketing', headline: 'Saudi Light & Sound Expo 2026 ended 1 September' },
    { lens: 'category', for_whom: 'marketing', headline: 'SASO 2870 is being cited in tenders', detail: 'Standard for LED' },
    { lens: 'category', for_whom: 'both', headline: 'LED-driver certification takes 4-6 months' },
    { lens: 'category', for_whom: 'sales', headline: 'Parsons awarded a design contract' },
  ]
  it('keeps industry and future dates, drops our own numbers, rivals, leads, self-talk and past events', () => {
    const f = marketingFindings(brief, { today: '2026-09-27' })
    expect(f.map(x => x.headline)).toEqual([
      'Founding Day prep opens',
      'SASO 2870 is being cited in tenders',
      'LED-driver certification takes 4-6 months',
    ])
  })
  it('skips test posts and keeps real stories', () => {
    const posts = storyPosts([
      { topic: '' }, { topic: 'fsklfmlsek' }, { topic: 'this is a good video' },
      { topic: 'TEST (delete me): showcase of a luxury project we lit' },
      { topic: 'How a photometric calculation is read: lux levels, uniformity and glare' },
    ])
    expect(posts.map(p => p.text)).toEqual(['How a photometric calculation is read: lux levels, uniformity and glare'])
  })
})

describe('the prompt', () => {
  it('states every section, the research age, and the rules on leads', () => {
    const p = weeklyPrompt(inputs())
    expect(p).toContain('Today is 2026-09-28')
    expect(p).toContain('Website (links must start with this): https://arak-sa.com')
    expect(p).toContain('Pages you may link to (prefer the one that fits the angle): https://arak-sa.com/services/facade-lighting')
    expect(p).toContain('Group "Customers" (2)')
    expect(p).toContain('opened 50%, clicked 10%')
    expect(p).toContain('Showroom invitation')
    expect(p).toContain('Hotel lobby lighting')
    expect(p).toContain('11 day(s) ago (STALE')
    expect(p).toContain('we are visiting')
    expect(p).toContain('never name them, never imply we are involved')
    expect(p).toContain('- A hotel in Riyadh, at design stage')
    expect(p).not.toMatch(/Mondrian|Ennismore|contractor named/)
    expect(p).not.toContain('Riyadh hospitality is busy')   // the run's headline stays out
    expect(p).not.toContain('— Visit')                       // so does the sales recommendation
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
