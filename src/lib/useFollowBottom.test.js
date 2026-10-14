import { describe, it, expect } from 'vitest'
import { shouldFollow, NEAR_BOTTOM_PX } from './useFollowBottom'

// A 400px box over 2000px of conversation: the bottom is scrollTop 1600.
const box = { scrollHeight: 2000, clientHeight: 400 }

describe('shouldFollow — when a streaming answer may move the reader', () => {
  it('keeps following at the very bottom', () => {
    expect(shouldFollow({ ...box, prevTop: 1500, top: 1600 })).toBe(true)
  })

  it('keeps following within the threshold, scrolling down', () => {
    expect(shouldFollow({ ...box, prevTop: 1500, top: 1600 - NEAR_BOTTOM_PX })).toBe(true)
  })

  // The bug: the reader scrolled up mid-answer and the next chunk pulled
  // them straight back down.
  it('lets go the moment the reader scrolls up, even a little', () => {
    expect(shouldFollow({ ...box, prevTop: 1600, top: 1590 })).toBe(false)
  })

  it('stays let go while the reader is up in the conversation', () => {
    expect(shouldFollow({ ...box, prevTop: 800, top: 820 })).toBe(false)
  })

  it('picks up again once the reader scrolls back to the bottom', () => {
    expect(shouldFollow({ ...box, prevTop: 1500, top: 1598 })).toBe(true)
  })

  it('ignores sub-pixel jitter rather than reading it as scrolling up', () => {
    expect(shouldFollow({ ...box, prevTop: 1600, top: 1599.5 })).toBe(true)
  })
})
