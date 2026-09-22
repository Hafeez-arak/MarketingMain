import { describe, it, expect } from 'vitest'
import {
  GOALS, isCustomGoal, parseCategories, joinCategories, listedCategories, customCategories,
} from './planConstants'

describe('focus categories — parsing a stored value', () => {
  it('reads several', () => {
    expect(parseCategories('Brand awareness, Project showcase'))
      .toEqual(['Brand awareness', 'Project showcase'])
  })

  // The whole point of keeping one text column: a plan or a localStorage draft
  // saved before this change opens as a one-item list, not as nothing.
  it('reads a single legacy value as a list of one', () => {
    expect(parseCategories('Brand awareness')).toEqual(['Brand awareness'])
  })

  it('is empty for nothing at all', () => {
    expect(parseCategories('')).toEqual([])
    expect(parseCategories(null)).toEqual([])
    expect(parseCategories(undefined)).toEqual([])
  })

  it('ignores stray separators and whitespace', () => {
    expect(parseCategories(' , Brand awareness ,, ')).toEqual(['Brand awareness'])
  })

  // "Education & how-to" and "Trust & social proof" are why the separator is a
  // comma and not an ampersand. If this ever fails, the separator is wrong.
  it('keeps an ampersand inside a category intact', () => {
    expect(parseCategories('Education & how-to, Trust & social proof'))
      .toEqual(['Education & how-to', 'Trust & social proof'])
    for (const g of GOALS) expect(g).not.toContain(',')
  })
})

describe('focus categories — joining for storage', () => {
  it('round-trips', () => {
    const picked = ['Brand awareness', 'Education & how-to']
    expect(parseCategories(joinCategories(picked))).toEqual(picked)
  })

  it('de-duplicates but keeps the order they were chosen in', () => {
    expect(joinCategories(['Lead generation', 'Brand awareness', 'Lead generation']))
      .toBe('Lead generation, Brand awareness')
  })

  it('drops blanks rather than storing empty slots', () => {
    expect(joinCategories(['', '  ', 'Brand awareness'])).toBe('Brand awareness')
    expect(joinCategories([])).toBe('')
  })
})

describe('focus categories — listed vs typed-in', () => {
  it('separates the two', () => {
    const stored = 'Brand awareness, Smart poles for municipalities, Project showcase'
    expect(listedCategories(stored)).toEqual(['Brand awareness', 'Project showcase'])
    expect(customCategories(stored)).toBe('Smart poles for municipalities')
  })

  it('has no custom part when everything is on the list', () => {
    expect(customCategories('Brand awareness, Project showcase')).toBe('')
  })

  it('keeps several typed-in categories together in one box', () => {
    expect(customCategories('Smart poles, Retrofit tenders')).toBe('Smart poles, Retrofit tenders')
  })

  it('agrees with isCustomGoal on a single value', () => {
    expect(isCustomGoal('Brand awareness')).toBe(false)
    expect(isCustomGoal('Smart poles for municipalities')).toBe(true)
    expect(customCategories('Brand awareness')).toBe('')
  })
})
