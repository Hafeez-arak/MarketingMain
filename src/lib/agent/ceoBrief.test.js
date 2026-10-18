import { describe, it, expect } from 'vitest'
import {
  briefWindow, money, ceoKpis, normaliseBrief, socialFacts, postsByWeek,
  CEO_BRIEF_SCHEMA, CEO_BRIEF_IDENTITY, ceoBriefPrompt, AREAS,
} from './ceoBrief'
import { COMPANY_PROMPT } from './companyTools'
import { volatileFragment } from './prompt'
import { JOBS } from './models'

const NOW = new Date('2026-10-18T12:00:00Z')

describe('money', () => {
  it('writes SAR compactly in both languages with Western digits', () => {
    expect(money(30_355_000)).toEqual({ en: 'SAR 30.4M', ar: '30.4 مليون ريال' })
    expect(money(9_245_950_000)).toEqual({ en: 'SAR 9.2B', ar: '9.2 مليار ريال' })
    expect(money(41_000)).toEqual({ en: 'SAR 41K', ar: '41 ألف ريال' })
    expect(money(950)).toEqual({ en: 'SAR 950', ar: '950 ريال' })
  })
})

describe('briefWindow', () => {
  it('is the seven days up to now, and the seven before', () => {
    const w = briefWindow(NOW)
    expect(w.days).toBe(7)
    expect(w.to).toBe(NOW.toISOString())
    expect(w.from).toBe('2026-10-11T12:00:00.000Z')
    expect(w.prevFrom).toBe('2026-10-04T12:00:00.000Z')
  })
})

describe('ceoKpis', () => {
  const facts = {
    leads: { this_week: { qualified: 13, qualified_unassigned: 13 }, last_week: { qualified: 5 } },
    money: { targets: { open_value_sar: 30_355_000, next_step_overdue: 0 }, opportunities_this_week: [{}, {}] },
    social: { available: true, instagram: { followers: 852, growth: 0 }, linkedin: { followers: 4866, growth: 86 }, posts_this_week: 1 },
    requests: { open: [{}], done_this_week: [] },
  }

  it('computes the four tiles in code, in both languages', () => {
    const k = ceoKpis(facts)
    expect(k.map(t => t.key)).toEqual(['leads', 'money', 'social', 'requests'])
    expect(k[0].value.en).toBe('13')
    expect(k[0].sub.en).toBe('5 last week · 13 with no owner')
    expect(k[0].tone).toBe('bad')
    expect(k[1].value).toEqual({ en: 'SAR 30.4M', ar: '30.4 مليون ريال' })
    expect(k[1].sub.en).toBe('2 new projects found this week')
    expect(k[2].value.en).toBe('5,718')
    expect(k[2].sub.en).toBe('+86 recently · 1 post this week')
    for (const t of k) { expect(t.label.ar).toBeTruthy(); expect(t.sub.ar).toBeTruthy() }
  })

  it('says a source is missing rather than showing a zero', () => {
    const k = ceoKpis({ social: { available: false }, money: {}, leads: {} })
    expect(k[0].value.en).toBe('—')
    expect(k[1].value.en).toBe('—')
    expect(k[2].value.en).toBe('—')
    expect(k[2].sub.en).toMatch(/unavailable/)
  })
})

describe('normaliseBrief', () => {
  it('clamps counts, folds unknown areas and tones, and drops empty points', () => {
    const b = normaliseBrief({
      headline: { ar: 'أسبوع جيد', en: 'A good week' },
      needs_you: Array.from({ length: 5 }, (_, i) => ({ area: 'leads', title: { ar: `${i}`, en: `${i}` }, action: { ar: 'x', en: 'x' } })),
      found: [
        { area: 'nonsense', tone: 'great', text: { ar: 'نص', en: 'text' } },
        { area: 'money', tone: 'good', text: { ar: '', en: '' } },
      ],
      watch: [{ ar: 'a', en: 'a' }, { ar: '', en: '' }],
    })
    expect(b.needs_you).toHaveLength(3)
    expect(b.found).toEqual([{ area: 'team', tone: 'watch', text: { ar: 'نص', en: 'text' } }])
    expect(b.watch).toHaveLength(1)
  })
  it('survives a missing or broken shape', () => {
    expect(normaliseBrief(undefined)).toEqual({ headline: { ar: '', en: '' }, needs_you: [], found: [], watch: [] })
  })
})

describe('social', () => {
  const window = briefWindow(NOW)
  it('counts posts per week from the live reader and keeps the latest few', () => {
    const p = postsByWeek([
      { status: 'published', published_at: '2026-10-12T17:24:10Z', platform: 'instagram', content: 'Fifty years', reach: 164 },
      { status: 'published', published_at: '2026-10-06T10:00:00Z', platform: 'linkedin', content: 'MoU' },
      { status: 'published', published_at: '2026-09-03T13:39:55Z', platform: 'linkedin', content: 'Old' },
    ], window)
    expect(p.this_week).toBe(1)
    expect(p.last_week).toBe(1)
    expect(p.top[0].about).toBe('Fifty years')
  })
  it('reads followers and insights from the live shape, or says unavailable', () => {
    expect(socialFacts({ available: false })).toEqual({ available: false })
    const s = socialFacts({
      available: true,
      followers: { accounts: [{ platform: 'instagram', followers: 852, growth: 0 }, { platform: 'linkedin', followers: 4866, growth: 86 }] },
      account_insights: { ok: true, window: { days: 14 }, reach: 218, views: 541, total_interactions: 6 },
      linkedin_page_insights: [{ ok: true, impressions: 401, members_reached: 61, clicks: 28, engagement_rate_pct: 9.39 }],
    }, { this_week: 1, last_week: 0, top: [] })
    expect(s.instagram).toEqual({ followers: 852, growth: 0, reach: 218, views: 541, interactions: 6 })
    expect(s.linkedin.impressions).toBe(401)
    expect(s.posts_this_week).toBe(1)
  })
})

describe('the model contract', () => {
  it('every point is bilingual and every field required, so the switch never shows a blank', () => {
    const s = CEO_BRIEF_SCHEMA.schema
    expect(s.required).toEqual(['headline', 'needs_you', 'found', 'watch'])
    expect(s.properties.headline.required).toEqual(['ar', 'en'])
    expect(s.properties.found.items.properties.text.required).toEqual(['ar', 'en'])
    expect(s.properties.found.items.properties.area.enum).toEqual(AREAS)
  })
  it('the identity is stable text for the cached prefix, and the facts go in the user turn', () => {
    expect(volatileFragment(CEO_BRIEF_IDENTITY)).toBeNull()
    expect(CEO_BRIEF_IDENTITY).toMatch(/only numbers that appear in the facts/)
    expect(ceoBriefPrompt({ window: { from: '2026-10-11T00:00:00Z', to: '2026-10-18T00:00:00Z' }, x: 1 })).toMatch(/2026-10-11 to 2026-10-18[\s\S]*"x":1/)
  })
  it('the brief is written by Opus, and the chat answers in the language it is asked in', () => {
    expect(JOBS.ceo_brief).toBe('claude-opus-5-5')
    expect(COMPANY_PROMPT).toMatch(/Answer in the language the person writes in/)
    expect(volatileFragment(COMPANY_PROMPT)).toBeNull()
  })
})
