import { describe, it, expect } from 'vitest'
import { questionKey, freshQuestions } from './agendaDedup.js'

const q = subject => ({ action: 'add', subject, why: 'because' })

describe('questionKey', () => {
  it('ignores case and punctuation', () => {
    expect(questionKey('Are tenders moving?')).toBe(questionKey('are tenders moving'))
    expect(questionKey("ARAK's board")).toBe(questionKey('arak s board'))
  })

  it('does NOT collapse two questions that differ by one decisive word', () => {
    // The measured failure of fuzzy matching, pinned as a test. These are two
    // completely different commercial moments in a project pipeline, and a
    // similarity score treats them as one question.
    expect(questionKey('giga-projects entering DESIGN stage'))
      .not.toBe(questionKey('giga-projects entering CONSTRUCTION stage'))
  })

  it('is empty for nothing', () => {
    expect(questionKey('')).toBe('')
    expect(questionKey(null)).toBe('')
  })
})

describe('freshQuestions', () => {
  it('writes a question that has never been proposed', () => {
    const { fresh } = freshQuestions([q('Are tenders moving?')], [])
    expect(fresh).toHaveLength(1)
  })

  it('drops a re-proposal of wording already on the agenda', () => {
    const { fresh, duplicates } = freshQuestions(
      [q('Are tenders moving?')],
      [{ subject: 'Are tenders moving' }],
    )
    expect(fresh).toEqual([])
    expect(duplicates).toEqual(['Are tenders moving?'])
  })

  it('will not re-propose something a person RETIRED', () => {
    // Dismissal keeps the row precisely so this can be checked. Re-proposing
    // what someone explicitly turned down is the most irritating thing a
    // weekly agent can do.
    const { fresh } = freshQuestions(
      [q('Watch Lumina')],
      [{ subject: 'Watch Lumina', status: 'retired' }],
    )
    expect(fresh).toEqual([])
  })

  it('deduplicates within a single run', () => {
    const { fresh, duplicates } = freshQuestions([q('Same thing'), q('same thing!')], [])
    expect(fresh).toHaveLength(1)
    expect(duplicates).toHaveLength(1)
  })

  it('keeps two questions that differ by one decisive word', () => {
    // The whole reason this is an exact match. Losing one of these would mean
    // the agent could ask about a pipeline stage but not both stages.
    const { fresh } = freshQuestions(
      [q('Which giga-projects are entering CONSTRUCTION stage right now?')],
      [{ subject: 'Which giga-projects are entering DESIGN stage right now?' }],
    )
    expect(fresh).toHaveLength(1)
  })

  it('accepts plain strings as the existing list', () => {
    const { fresh } = freshQuestions([q('Are tenders moving?')], ['are tenders moving'])
    expect(fresh).toEqual([])
  })

  it('skips a blank subject rather than writing an empty row', () => {
    expect(freshQuestions([q('  '), { action: 'add' }], []).fresh).toEqual([])
  })

  it('survives nonsense', () => {
    expect(() => freshQuestions(null, null)).not.toThrow()
    expect(freshQuestions(null, null).fresh).toEqual([])
  })
})
