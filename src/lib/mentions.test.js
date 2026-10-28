import { describe, it, expect } from 'vitest'
import { mentionQuery, matchMentions, insertMention } from './mentions'

describe('mentionQuery', () => {
  it('finds the @word being typed at the caret', () => {
    expect(mentionQuery('ask @sha')).toEqual({ start: 4, query: 'sha' })
    expect(mentionQuery('@')).toEqual({ start: 0, query: '' })
  })
  it('ignores email addresses and finished mentions', () => {
    expect(mentionQuery('mail omar@arak')).toBeNull()
    expect(mentionQuery('@Sara please')).toBeNull()
  })
  it('reads up to the caret, not the end of the text', () => {
    expect(mentionQuery('hi @sh and more', 6)).toEqual({ start: 3, query: 'sh' })
  })
})

describe('matchMentions', () => {
  const people = [{ name: 'sara' }, { name: 'omar' }, { name: 'Mohammed Nasser' }]
  it('matches the start of a name or of any word in it', () => {
    expect(matchMentions(people, 'sa').map(p => p.name)).toEqual(['sara'])
    expect(matchMentions(people, 'nas').map(p => p.name)).toEqual(['Mohammed Nasser'])
    expect(matchMentions(people, '')).toHaveLength(3)
  })
})

describe('insertMention', () => {
  it('replaces the query with a capitalised first name and a space', () => {
    expect(insertMention('please @sa', 7, 10, 'sara')).toEqual({ text: 'please @Sara ', caret: 13 })
    expect(insertMention('@om fix it', 0, 3, 'omar')).toEqual({ text: '@Omar  fix it', caret: 6 })
  })
})
