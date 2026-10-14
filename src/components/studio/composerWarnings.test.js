import { describe, it, expect } from 'vitest'
import { composerWarnings, WARNINGS } from './composerWarnings'

const ids = (prompt, opts) => composerWarnings(prompt, opts).map(w => w.id)

describe('composerWarnings', () => {
  it('says nothing about an ordinary brief', () => {
    expect(ids('A dusk shot of a modern Riyadh villa facade with warm linear lighting')).toEqual([])
    expect(ids('')).toEqual([])
    // A number that is not a count of posts.
    expect(ids('A 3000K warm glow over 2 floors of a hotel lobby')).toEqual([])
  })

  it('flags a link, which nothing opens', () => {
    expect(ids('Make it like https://www.instagram.com/p/abc123/')).toEqual(['link'])
    expect(ids('style of www.arak-sa.com/projects')).toEqual(['link'])
    expect(composerWarnings('see https://x.com/a')[0].text).toBe(WARNINGS.link)
  })

  it('flags a brief that asks for several posts', () => {
    expect(ids('Create 5 posts for Ramadan')).toEqual(['multiple'])
    expect(ids('three different designs for national day')).toEqual(['multiple'])
    expect(ids('a series of Instagram posts about KNX')).toEqual(['multiple'])
    expect(ids('اعمل 5 منشورات لرمضان')).toEqual(['multiple'])
  })

  it('only says "one design per model" on the image tab', () => {
    expect(ids('Create 5 posts for Ramadan', { intent: 'video' })).toEqual([])
  })

  it('flags Arabic text asked for without the words', () => {
    expect(ids('Ramadan greeting post with Arabic text in gold')).toEqual(['arabic'])
    expect(ids('add a headline in Arabic about our new range')).toEqual(['arabic'])
    expect(ids('تصميم مع نص عربي')).toEqual(['arabic'])
  })

  it('is satisfied once the Arabic wording is in quotes', () => {
    expect(ids('Ramadan post with Arabic text "رمضان كريم" in gold')).toEqual([])
    expect(ids('Arabic headline «إضاءة تليق بمشروعك»')).toEqual([])
  })

  it('does not mistake Arabic-speaking audiences for a text request', () => {
    expect(ids('A lobby shot for our Arabic-speaking clients')).toEqual([])
  })

  it('can raise more than one at once, in a stable order', () => {
    expect(ids('5 posts with Arabic text like https://x.com/p')).toEqual(['link', 'multiple', 'arabic'])
  })
})
