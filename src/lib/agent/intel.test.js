import { describe, it, expect } from 'vitest'
import {
  nameKey, sameName, cleanDate, canonicalCompetitor, signalFromFinding, opportunityFromFinding,
  eventFromFinding, planStoreWrites, annotateFindings, eventStatus, knownIntelPrompt, signalHistory,
  matchEvent, isOpenOpportunity,
} from './intel'

const NOW = new Date('2026-09-20T09:00:00Z')
const WATCH = ['Technolight', 'Huda Lighting', 'Inara Lighting (شركة إنارة للإضاءة)', 'Alnasser Lighting']

// Real leads from the 14 Sep 2026 Arak brief, reshaped as the lens now reports them.
const tuwaiq = {
  lens: 'openings', ref: 'F13',
  headline: "PIF's Boutique Group retendered the Tuwaiq Palace hotel conversion in Riyadh.",
  suggested_action: 'Contact Dar Al-Omran, supervision consultant.',
  relevance: 'high', for_whom: 'sales', category: 'tender', channel: 'news',
  sources: [{ url: 'https://www.meed.com/tuwaiq-palace', title: 'MEED' }],
  lead: { type: 'tender', name: 'Tuwaiq Palace hotel conversion', client: 'Boutique Group (PIF)', consultant: 'Dar Al-Omran', location: 'Riyadh', timing: 'closed', deadline: '2026-05-31' },
}
const mondrian = {
  lens: 'openings', ref: 'F18',
  headline: 'Mondrian Riyadh has an interior architect but no main contractor.',
  relevance: 'medium', for_whom: 'sales', category: 'project', channel: 'news',
  sources: [{ url: 'https://hotelierme.com/mondrian' }],
  lead: { type: 'project', name: 'Mondrian Riyadh', location: 'Al Malga, Riyadh', stage: 'design', timing: 'unconfirmed' },
}

describe('names are the identity of a lead or an event', () => {
  it('matches the same project written two ways', () => {
    expect(sameName('Tuwaiq Palace', 'Tuwaiq Palace hotel conversion')).toBe(true)
    expect(sameName('The Mondrian Riyadh', 'mondrian riyadh')).toBe(true)
  })

  it('never merges two projects that only share a city', () => {
    expect(sameName('Riyadh', 'Mondrian Riyadh')).toBe(false)
    expect(sameName('Mondrian Riyadh', 'Tuwaiq Palace Riyadh')).toBe(false)
  })

  it('keeps Arabic names instead of erasing them to empty keys', () => {
    expect(nameKey('شركة إنارة للإضاءة')).not.toBe('')
    expect(sameName('مشروع أ', 'مشروع ب')).toBe(false)
  })

  it('maps a short competitor name back to the watchlist spelling', () => {
    expect(canonicalCompetitor('Inara Lighting', WATCH)).toBe('Inara Lighting (شركة إنارة للإضاءة)')
    expect(canonicalCompetitor('Huda', WATCH)).toBe('Huda Lighting')
    expect(canonicalCompetitor('Nouran Lighting', WATCH)).toBe('Nouran Lighting')
  })

  it('rejects impossible dates rather than storing them', () => {
    expect(cleanDate('2026-02-30')).toBeNull()
    expect(cleanDate('2026-11-02T00:00:00Z')).toBe('2026-11-02')
    expect(cleanDate('November')).toBeNull()
  })
})

describe('findings become store rows', () => {
  it('a finding with no source is never a signal — no source, no fact', () => {
    expect(signalFromFinding({ ...tuwaiq, sources: [] })).toBeNull()
  })

  it('computed lenses do not fill the store', () => {
    expect(signalFromFinding({ lens: 'calendar', headline: 'National Day', sources: [{ url: 'https://x.com' }] })).toBeNull()
  })

  it('a lead keeps its people and its timing', () => {
    const o = opportunityFromFinding(tuwaiq)
    expect(o).toMatchObject({ type: 'tender', consultant: 'Dar Al-Omran', timing: 'closed', deadline: '2026-05-31', relevance: 'high' })
  })

  it('event editions of different years get different keys', () => {
    const a = eventFromFinding({ event: { name: 'Saudi Build 2026', start_date: '2026-11-02' }, sources: [] })
    const b = eventFromFinding({ event: { name: 'Saudi Build 2027' }, sources: [] })
    expect(a.fingerprint).not.toBe(b.fingerprint)
    expect(matchEvent(b, [{ ...a, id: 'e1' }])).toBeNull()
    const undated = eventFromFinding({ event: { name: 'Saudi Build' }, sources: [] })
    expect(matchEvent(undated, [{ ...a, id: 'e1' }])?.id).toBe('e1')
  })
})

describe('checking the store before calling anything new', () => {
  it('first sighting inserts, and two lenses reporting one lead insert it once', () => {
    const plan = planStoreWrites([tuwaiq, { ...tuwaiq, lens: 'rivals' }, mondrian], {}, { runId: 'r1', now: NOW })
    expect(plan.opportunities.insert.map(o => o.name)).toEqual(['Tuwaiq Palace hotel conversion', 'Mondrian Riyadh'])
    expect(plan.opportunities.update).toHaveLength(0)
  })

  it('a lead seen again with nothing new is SEEN, not news', () => {
    const stored = [{ id: 'o1', ...opportunityFromFinding(mondrian), status: 'assigned', times_seen: 1, first_seen_at: '2026-09-14T18:00:00Z', last_run_id: 'r0' }]
    const plan = planStoreWrites([mondrian], { opportunities: stored }, { runId: 'r1', now: NOW })
    const [f] = annotateFindings([mondrian], plan)
    expect(f.store.state).toBe('seen')
    expect(f.novelty).toBe('continuing')
    expect(f.store.status).toBe('assigned')
    expect(plan.opportunities.update[0].patch.times_seen).toBe(2)
  })

  it('a contractor being named is a CHANGE, and fills the row without touching status', () => {
    const stored = [{ id: 'o1', ...opportunityFromFinding(mondrian), status: 'pursued', owner_note: 'Called Aedas', last_run_id: 'r0' }]
    const next = { ...mondrian, lead: { ...mondrian.lead, name: 'Mondrian Riyadh hotel', contractor: 'Nesma & Partners' } }
    const plan = planStoreWrites([next], { opportunities: stored }, { runId: 'r1', now: NOW })
    const patch = plan.opportunities.update[0].patch
    expect(patch.contractor).toBe('Nesma & Partners')
    expect(patch.last_change).toContain('contractor now Nesma & Partners')
    expect(patch).not.toHaveProperty('status')
    expect(patch).not.toHaveProperty('owner_note')
    expect(annotateFindings([next], plan)[0].store.state).toBe('changed')
  })

  it('a week that could not reach the deadline never blanks the one we have', () => {
    const stored = [{ id: 'o1', ...opportunityFromFinding(tuwaiq), last_run_id: 'r0' }]
    const vaguer = { ...tuwaiq, lead: { ...tuwaiq.lead, deadline: '', timing: 'unconfirmed' } }
    const plan = planStoreWrites([vaguer], { opportunities: stored }, { runId: 'r1', now: NOW })
    expect(plan.opportunities.update[0].patch).not.toHaveProperty('deadline')
  })

  it('merges newly seen exhibitors onto a tracked event', () => {
    const base = eventFromFinding({ event: { name: 'Saudi Elenex 2026', start_date: '2026-11-02', competitors_exhibiting: ['Technolight'] }, sources: [] }, WATCH)
    const stored = [{ id: 'e1', ...base }]
    const next = { lens: 'rivals', headline: 'Huda exhibiting', sources: [{ url: 'https://saudielenex.com/exhibitors' }], event: { name: 'Saudi Elenex', competitors_exhibiting: ['Huda'] } }
    const plan = planStoreWrites([next], { events: stored }, { runId: 'r1', now: NOW, watchlist: WATCH })
    expect(plan.events.update[0].patch.competitors_exhibiting).toEqual(['Technolight', 'Huda Lighting'])
  })

  it('a reworded competitor signal is matched, a different fact is not', () => {
    const s = signalFromFinding({ lens: 'rivals', competitor: 'Huda', headline: 'Huda Lighting opened a new 737 sqm showroom in Riyadh', sources: [{ url: 'https://a.com' }] }, WATCH)
    const stored = [{ id: 's1', ...s }]
    const reworded = { lens: 'rivals', competitor: 'Huda Lighting', headline: 'New 737 sqm Riyadh showroom opened by Huda Lighting', sources: [{ url: 'https://b.com' }] }
    const different = { lens: 'rivals', competitor: 'Huda Lighting', headline: 'Huda Lighting is hiring a KNX project engineer in Jeddah', sources: [{ url: 'https://c.com' }] }
    const plan = planStoreWrites([reworded, different], { signals: stored }, { runId: 'r1', now: NOW, watchlist: WATCH })
    expect(plan.signals.update.map(u => u.id)).toEqual(['s1'])
    expect(plan.signals.insert.map(i => i.summary)).toEqual([different.headline])
  })
})

describe('reading the store', () => {
  it('an event is concluded only after it ends', () => {
    expect(eventStatus({ start_date: '2026-09-15', end_date: '2026-09-20' }, NOW)).toBe('upcoming')
    expect(eventStatus({ start_date: '2026-09-15', end_date: '2026-09-19' }, NOW)).toBe('concluded')
    expect(eventStatus({}, NOW)).toBe('tbc')
  })

  it('a lead is closed by a person, not by its deadline passing', () => {
    expect(isOpenOpportunity({ status: 'new', deadline: '2026-01-01' })).toBe(true)
    expect(isOpenOpportunity({ status: 'dropped' })).toBe(false)
  })

  it('lenses are shown tracked leads so they report changes, not repeats', () => {
    const text = knownIntelPrompt({
      opportunities: [{ name: 'Mondrian Riyadh', stage: 'design', status: 'new' }, { name: 'Old tender', status: 'lost' }],
      events: [{ name: 'Saudi Build 2026', start_date: '2026-11-02', end_date: '2026-11-05' }, { name: 'Past expo', end_date: '2026-01-01' }],
    }, { now: NOW })
    expect(text).toContain('Mondrian Riyadh (design, no contractor named)')
    expect(text).not.toContain('Old tender')
    expect(text).toContain('Saudi Build 2026')
    expect(text).not.toContain('Past expo')
  })

  it('signal history refs every piece so a combined claim can be traced', () => {
    const { byCompetitor, refs } = signalHistory([
      { id: 'a', competitor: 'Huda Lighting', channel: 'linkedin', summary: 'x', first_seen_at: '2026-09-10T00:00:00Z', relevance: 'high' },
      { id: 'b', competitor: 'Huda Lighting', channel: 'jobs', summary: 'y', first_seen_at: '2026-09-01T00:00:00Z', relevance: 'low' },
      { id: 'c', competitor: 'Technolight', channel: 'website', summary: 'z', first_seen_at: '2025-01-01T00:00:00Z', relevance: 'high' },
    ], { now: NOW })
    expect(refs.map(r => r.ref)).toEqual(['S1'])
    expect(byCompetitor['Huda Lighting'][0].channel).toBe('linkedin')
    expect(byCompetitor.Technolight).toBeUndefined()
  })
})
