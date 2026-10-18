import { describe, it, expect } from 'vitest'
import { mentionQuery, matchMentions, insertMention } from './mentions'

describe('mentionQuery', () => {
  it('finds the @word being typed at the caret', () => {
    expect(mentionQuery('ask @sha')).toEqual({ start: 4, query: 'sha' })
    expect(mentionQuery('@')).toEqual({ start: 0, query: '' })
  })
  it('ignores email addresses and finished mentions', () => {
    expect(mentionQuery('mail hafeez@arak')).toBeNull()
    expect(mentionQuery('@Shadia please')).toBeNull()
  })
  it('reads up to the caret, not the end of the text', () => {
    expect(mentionQuery('hi @sh and more', 6)).toEqual({ start: 3, query: 'sh' })
  })
})

describe('matchMentions', () => {
  const people = [{ name: 'shadia' }, { name: 'hafeez' }, { name: 'Mohammed Kader' }]
  it('matches the start of a name or of any word in it', () => {
    expect(matchMentions(people, 'sh').map(p => p.name)).toEqual(['shadia'])
    expect(matchMentions(people, 'kad').map(p => p.name)).toEqual(['Mohammed Kader'])
    expect(matchMentions(people, '')).toHaveLength(3)
  })
})

describe('insertMention', () => {
  it('replaces the query with a capitalised first name and a space', () => {
    expect(insertMention('please @sh', 7, 10, 'shadia')).toEqual({ text: 'please @Shadia ', caret: 15 })
    expect(insertMention('@ha fix it', 0, 3, 'hafeez')).toEqual({ text: '@Hafeez  fix it', caret: 8 })
  })
})
