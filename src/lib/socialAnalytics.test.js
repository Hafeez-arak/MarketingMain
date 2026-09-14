import { describe, it, expect } from 'vitest'
import { profileUrlOf } from './socialAnalytics'

// Zernio returns `profileUrl: null` for an Instagram account connected through
// facebook_login, and the Zernio Sync workflow writes that into
// social_accounts as ''. The Analytics account row hid its only link behind
// that field, so clicking the account did nothing a person could see.

describe('profileUrlOf', () => {
  it('keeps a stored profile URL', () => {
    expect(profileUrlOf({ platform: 'instagram', username: 'x', profile_url: 'https://instagram.com/real' }))
      .toBe('https://instagram.com/real')
  })

  it('derives Instagram from the handle when the stored URL is empty', () => {
    expect(profileUrlOf({ platform: 'instagram', username: 'lightingaaa', profile_url: '' }))
      .toBe('https://www.instagram.com/lightingaaa/')
  })

  it('derives TikTok from the handle, with or without a leading @', () => {
    expect(profileUrlOf({ platform: 'tiktok', username: '@arak', profile_url: null }))
      .toBe('https://www.tiktok.com/@arak')
  })

  // A LinkedIn handle does not say whether it is a person or a company page,
  // and the two live under different paths. A wrong guess is a link to a
  // stranger, so nothing is guessed.
  it('does not guess a LinkedIn URL', () => {
    expect(profileUrlOf({ platform: 'linkedin', username: 'arak', profile_url: '' })).toBe('')
  })

  it('returns empty with no handle to build from', () => {
    expect(profileUrlOf({ platform: 'instagram', username: '', profile_url: '' })).toBe('')
    expect(profileUrlOf(null)).toBe('')
  })
})
