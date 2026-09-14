import { describe, it, expect } from 'vitest'
import {
  PROTECTED_PLATFORMS, isProtectedPlatform, mayPublishTo, mayDisconnect, protectionReason,
} from './platformSafety'

// ─── The account that cannot be un-posted to ───────────────────────────────
//
// ARAK Lighting's LinkedIn is the company's real page. @lightingaaa is a
// one-follower test account. Every publish path in this app was written for
// the second kind, and these tests are what keep the first kind out of them.

const linkedin = {
  platform: 'linkedin', username: 'ARAK Lighting', display_name: 'ARAK Lighting',
  is_active: true, is_protected: true,
}
const instagram = {
  platform: 'instagram', username: 'lightingaaa', display_name: 'Lighting Arak',
  is_active: true, is_protected: false,
}

describe('isProtectedPlatform', () => {
  it('protects LinkedIn', () => {
    expect(isProtectedPlatform('linkedin')).toBe(true)
  })

  it('does not protect the platforms this product publishes to', () => {
    expect(isProtectedPlatform('instagram')).toBe(false)
    expect(isProtectedPlatform('tiktok')).toBe(false)
  })

  it('is not fooled by case or whitespace', () => {
    // The platform reaches this from a webhook body, a DB column and a React
    // prop. Exactly one of those is guaranteed to be normalised.
    expect(isProtectedPlatform('LinkedIn')).toBe(true)
    expect(isProtectedPlatform('  LINKEDIN  ')).toBe(true)
  })

  it('says no to nothing rather than throwing', () => {
    expect(isProtectedPlatform(undefined)).toBe(false)
    expect(isProtectedPlatform(null)).toBe(false)
    expect(isProtectedPlatform('')).toBe(false)
  })
})

describe('mayPublishTo', () => {
  it('refuses LinkedIn', () => {
    expect(mayPublishTo(linkedin)).toBe(false)
  })

  it('allows Instagram', () => {
    expect(mayPublishTo(instagram)).toBe(true)
  })

  it('refuses LinkedIn even when the stored flag says otherwise', () => {
    // The reconnection hole: a NEW row defaults is_protected to false, and
    // this workspace's Instagram already proved that reconnecting is how rows
    // get replaced. The platform rule is what survives that.
    expect(mayPublishTo({ ...linkedin, is_protected: false })).toBe(false)
    expect(mayPublishTo({ platform: 'linkedin' })).toBe(false)
  })

  it('honours the flag on a platform that is not protected by default', () => {
    // What the column is FOR: protecting an account without a deploy.
    expect(mayPublishTo({ ...instagram, is_protected: true })).toBe(false)
  })

  it('fails closed when the account is unknown', () => {
    // "We could not tell what this is" must mean no. A publish path that
    // proceeds on a missing account is one that publishes somewhere nobody
    // chose.
    expect(mayPublishTo(null)).toBe(false)
    expect(mayPublishTo(undefined)).toBe(false)
  })
})

describe('mayDisconnect', () => {
  it('refuses to disconnect the protected account', () => {
    // Disconnecting deletes it at Zernio, which is its own harm — the
    // connection to a real company page is not trivially rebuilt.
    expect(mayDisconnect(linkedin)).toBe(false)
  })

  it('allows disconnecting an ordinary account', () => {
    expect(mayDisconnect(instagram)).toBe(true)
  })
})

describe('protectionReason', () => {
  it('names the account and says reporting still works', () => {
    // The refusal has to distinguish itself from a failure. "Publishing
    // failed" sends someone to a status page; this should send them to
    // whoever owns the page.
    const reason = protectionReason(linkedin)
    expect(reason).toMatch(/ARAK Lighting/)
    expect(reason).toMatch(/linkedin/i)
    expect(reason).toMatch(/Analytics and reporting are unaffected/i)
  })

  it('explains a flagged account differently from a protected platform', () => {
    expect(protectionReason({ ...instagram, is_protected: true })).toMatch(/is_protected/)
  })

  it('says so when there is no account at all', () => {
    expect(protectionReason(null)).toMatch(/could not be identified/i)
  })
})

describe('the list itself', () => {
  it('contains LinkedIn and is not empty', () => {
    // A guard whose list silently emptied would pass every other test in this
    // file, because every one of them asks a question about LinkedIn.
    expect(PROTECTED_PLATFORMS).toContain('linkedin')
    expect(PROTECTED_PLATFORMS.length).toBeGreaterThan(0)
  })
})
