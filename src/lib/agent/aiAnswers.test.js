import { describe, it, expect } from 'vitest'
import {
  aiQuestions, answerPrompt, firstMention, hostOf, scoreAnswer, checkSummary, groupChecks,
  questionMoves, answerSources, MAX_QUESTIONS,
} from './aiAnswers.js'

const BRAND = ['arak', 'أراك', 'اراك']
const RIVALS = ['Signify', 'ICS Arabia', 'Alrouf']

describe('aiQuestions', () => {
  it('reads the textarea one question per line, dropping blanks and repeats', () => {
    expect(aiQuestions('Who designs lighting in Riyadh?\n\n  who designs lighting in riyadh? \nمن أفضل شركات الإنارة في السعودية؟\r\n'))
      .toEqual(['Who designs lighting in Riyadh?', 'من أفضل شركات الإنارة في السعودية؟'])
  })

  it(`keeps at most ${MAX_QUESTIONS}, because each is a paid call`, () => {
    expect(aiQuestions(Array.from({ length: 30 }, (_, i) => `q${i}`))).toHaveLength(MAX_QUESTIONS)
  })
})

describe('answerPrompt', () => {
  // The whole measure depends on this: a prompt that names the company
  // measures nothing.
  it('never mentions the company it is measuring', () => {
    const p = answerPrompt('Who installs KNX lighting control in Riyadh?')
    expect(p).toContain('Who installs KNX lighting control in Riyadh?')
    expect(p.toLowerCase()).not.toContain('arak')
  })
})

describe('firstMention', () => {
  it('matches whole words only, in any case', () => {
    expect(firstMention('Try ARAK Lighting in Hittin.', 'arak')).toBe(4)
    expect(firstMention('Araki Lighting, Barakah Electric', 'arak')).toBe(-1)
  })

  // \b does not work for Arabic; the edges are any-script letters instead.
  it('works in Arabic, and not inside a longer Arabic word', () => {
    expect(firstMention('ننصح بشركة أراك للإضاءة', 'أراك')).toBeGreaterThan(0)
    expect(firstMention('الأراكي', 'أراك')).toBe(-1)
  })
})

describe('hostOf', () => {
  it('drops www and reads nothing out of a non-URL', () => {
    expect(hostOf('https://www.arak-sa.com/services/lighting-design')).toBe('arak-sa.com')
    expect(hostOf('not a url')).toBe('')
  })
})

describe('scoreAnswer', () => {
  const text = 'For lighting design in Riyadh, consider ICS Arabia, ARAK Lighting (since 1976) and Signify.'

  it('records named, our place among the tracked names, cited, and who else was named', () => {
    const s = scoreAnswer({
      text, brandTerms: BRAND, competitors: RIVALS, site: 'sc-domain:arak-sa.com',
      sources: ['https://icsarabia.com/services/lighting-design/', 'https://arak-sa.com/services/lighting-design', 'https://clutch.co/sa'],
    })
    expect(s).toMatchObject({ named: true, rank: 2, cited: true, competitors: ['ICS Arabia', 'Signify'] })
    expect(s.sources).toEqual(['icsarabia.com', 'arak-sa.com', 'clutch.co'])
  })

  // Named without a link is visibility, not a click. The two are kept apart.
  it('separates being named from being cited', () => {
    const s = scoreAnswer({ text, brandTerms: BRAND, competitors: RIVALS, site: 'arak-sa.com', sources: ['https://clutch.co/sa'] })
    expect(s.named).toBe(true)
    expect(s.cited).toBe(false)
  })

  it('gives no rank when we are not named', () => {
    const s = scoreAnswer({ text: 'Signify and Alrouf both do this.', brandTerms: BRAND, competitors: RIVALS, site: 'arak-sa.com' })
    expect(s).toMatchObject({ named: false, rank: null, competitors: ['Signify', 'Alrouf'] })
  })
})

describe('checkSummary', () => {
  const rows = [
    { question: 'a', named: true, cited: true, competitors: ['Signify'], sources: ['arak-sa.com', 'clutch.co'], cost_usd: 0.05 },
    { question: 'b', named: false, cited: false, competitors: ['Signify', 'Alrouf'], sources: ['clutch.co'], cost_usd: 0.04 },
    { question: 'c', error: 'overloaded', competitors: [], sources: [], cost_usd: 0 },
  ]

  // A question the model never answered is not one we were left out of.
  it('keeps failed answers out of every share', () => {
    const s = checkSummary(rows)
    expect(s).toMatchObject({ asked: 3, answered: 2, failed: 1, named: 1, cited: 1, namedShare: 50, citedShare: 50 })
    expect(s.rivals[0]).toEqual({ name: 'Signify', count: 2 })
    expect(s.sources[0]).toEqual({ name: 'clutch.co', count: 2 })
    expect(s.cost).toBeCloseTo(0.09)
  })
})

describe('groupChecks and questionMoves', () => {
  const rows = [
    { run_id: 'r2', checked_at: '2026-12-01T09:00:00Z', question: 'Who designs lighting?', named: true },
    { run_id: 'r2', checked_at: '2026-12-01T09:00:00Z', question: 'Who installs KNX?', named: false },
    { run_id: 'r1', checked_at: '2026-11-01T09:00:00Z', question: 'who designs lighting?', named: false },
    { run_id: 'r1', checked_at: '2026-11-01T09:00:00Z', question: 'Who installs KNX?', named: true },
  ]

  it('groups rows into checks, newest first', () => {
    const checks = groupChecks(rows)
    expect(checks.map(c => c.runId)).toEqual(['r2', 'r1'])
    expect(checks[0].summary.named).toBe(1)
  })

  it('says per question whether we were newly named or dropped', () => {
    const [now, before] = groupChecks(rows)
    expect(questionMoves(now.rows, before.rows).map(r => r.move)).toEqual(['gained', 'lost'])
    expect(questionMoves(now.rows, []).map(r => r.move)).toEqual(['new', 'new'])
  })
})

describe('answerSources', () => {
  const searched = { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://a.example' }, { type: 'web_search_result', url: 'https://arak-sa.com/' }] }

  it('reads the citations the reader sees, in order, once each', () => {
    const r = { content: [searched, { type: 'text', text: 'x', citations: [{ url: 'https://b.example' }, { url: 'https://b.example' }] }, { type: 'text', text: 'y', citations: [{ url: 'https://c.example' }] }] }
    expect(answerSources(r)).toEqual({ urls: ['https://b.example', 'https://c.example'], fromSearch: false })
  })

  it('falls back to what was searched, and says so, when nothing is cited', () => {
    expect(answerSources({ content: [searched, { type: 'text', text: 'x' }] }))
      .toEqual({ urls: ['https://a.example', 'https://arak-sa.com/'], fromSearch: true })
  })
})
