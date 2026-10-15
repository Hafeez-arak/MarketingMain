import { describe, it, expect } from 'vitest'
import {
  PROTECTED_PLATFORMS, isProtectedPlatform, mayPublishTo, mayDisconnect, protectionReason,
} from './platformSafety'

// ─── The account that cannot be un-posted to ───────────────────────────────
//
// No platform is protected by default since 2026-10-14 — the owner chose to
// publish to ARAK's LinkedIn page. What remains is the per-account flag:
// any single account can still be marked protected without a deploy.

const linkedin = {
  platform: 'linkedin', username: 'ARAK Lighting', display_name: 'ARAK Lighting',
  is_active: true, is_protected: false,
}
const instagram = {
  platform: 'instagram', username: 'lightingaaa', display_name: 'Lighting Arak',
  is_active: true, is_protected: false,
}

describe('isProtectedPlatform', () => {
  it('protects no platform by default, LinkedIn included', () => {
    expect(isProtectedPlatform('linkedin')).toBe(false)
    expect(isProtectedPlatform('LinkedIn')).toBe(false)
    expect(isProtectedPlatform('instagram')).toBe(false)
    expect(isProtectedPlatform('tiktok')).toBe(false)
  })

  it('says no to nothing rather than throwing', () => {
    expect(isProtectedPlatform(undefined)).toBe(false)
    expect(isProtectedPlatform(null)).toBe(false)
    expect(isProtectedPlatform('')).toBe(false)
  })
})

describe('mayPublishTo', () => {
  it('allows the LinkedIn page', () => {
    expect(mayPublishTo(linkedin)).toBe(true)
  })

  it('allows Instagram', () => {
    expect(mayPublishTo(instagram)).toBe(true)
  })

  it('still refuses a LinkedIn account that is flagged protected', () => {
    expect(mayPublishTo({ ...linkedin, is_protected: true })).toBe(false)
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
  it('refuses to disconnect a protected account', () => {
    // Disconnecting deletes it at Zernio, which is its own harm — the
    // connection to a real company page is not trivially rebuilt.
    expect(mayDisconnect({ ...linkedin, is_protected: true })).toBe(false)
  })

  it('allows disconnecting an ordinary account', () => {
    expect(mayDisconnect(instagram)).toBe(true)
  })
})

describe('protectionReason', () => {
  it('names a flagged account in plain words', () => {
    // The refusal has to distinguish itself from a failure: "publishing
    // failed" sends someone to a status page, this sends them to whoever
    // decided.
    const reason = protectionReason({ ...linkedin, is_protected: true })
    expect(reason).toMatch(/ARAK Lighting/)
    expect(reason).toMatch(/marked protected/)
    expect(reason).not.toMatch(/is_protected/)
  })

  it('says so when there is no account at all', () => {
    expect(protectionReason(null)).toMatch(/could not be identified/i)
  })
})

describe('the list itself', () => {
  it('no longer contains LinkedIn', () => {
    // Emptied on purpose (owner decision, 2026-10-14). If a platform is added
    // back, this test is the reminder that it was a decision, not a cleanup.
    expect(PROTECTED_PLATFORMS).not.toContain('linkedin')
  })
})
