import { describe, it, expect } from 'vitest'
import { tokenHealth, worthSurfacing, WARN_WITHIN_DAYS } from './tokenHealth'

const NOW = Date.parse('2026-09-10T10:00:00Z')
const inDays = n => Math.floor(NOW / 1000) + n * 86_400

describe('the two clocks fail differently', () => {
  it('expires_at 0 means never, not 1970', () => {
    // The numeric path would read 0 as "expired 56 years ago", which is the
    // kind of off-by-a-sentinel that turns a healthy token into a false alarm
    // on every single run.
    const h = tokenHealth({ is_valid: true, expires_at: 0, data_access_expires_at: inDays(90) }, NOW)
    expect(h.status).toBe('healthy')
    expect(h.tokenDays).toBeNull()
    expect(h.headline).toMatch(/does not expire/i)
  })

  it('warns about DATA ACCESS before the token itself', () => {
    // The dangerous clock, and the reason this module exists. When data access
    // lapses the token keeps reporting is_valid: true and calls simply stop
    // returning anything — an integration that "went quiet after three months"
    // is almost always this, and there is no error to diagnose from.
    const h = tokenHealth({ is_valid: true, expires_at: 0, data_access_expires_at: inDays(5) }, NOW)
    expect(h.status).toBe('data_access_expiring')
    expect(h.headline).toMatch(/still report itself valid/i)
    expect(h.headline).toMatch(/stop arriving/i)
  })

  it('explains the already-lapsed case in terms of the symptom', () => {
    // A person seeing empty results needs to be told WHY they are empty, not
    // merely that a date passed.
    const h = tokenHealth({ is_valid: true, expires_at: 0, data_access_expires_at: inDays(-1) }, NOW)
    expect(h.status).toBe('data_access_expired')
    expect(h.ok).toBe(false)
    expect(h.headline).toMatch(/return nothing rather than an error/i)
  })

  it('data access is checked ahead of the token when both are live', () => {
    // Both clocks ticking: the one that arrives WITHOUT an error to explain it
    // is the one worth naming first.
    const h = tokenHealth(
      { is_valid: true, expires_at: inDays(10), data_access_expires_at: inDays(3) },
      NOW,
    )
    expect(h.status).toBe('data_access_expiring')
  })

  it('still warns about a genuinely expiring token', () => {
    const h = tokenHealth(
      { is_valid: true, expires_at: inDays(4), data_access_expires_at: inDays(400) },
      NOW,
    )
    expect(h.status).toBe('expiring')
    expect(h.headline).toMatch(/expires in 4 days/i)
  })

  it('an expired token is reported as expired, not merely expiring', () => {
    const h = tokenHealth({ is_valid: true, expires_at: inDays(-1) }, NOW)
    expect(h.status).toBe('expired')
    expect(h.ok).toBe(false)
  })
})

describe('the states that need no arithmetic', () => {
  it('no token at all', () => {
    const h = tokenHealth(null, NOW)
    expect(h.status).toBe('missing')
    expect(h.ok).toBe(false)
  })

  it('Meta saying the token is invalid beats every other signal', () => {
    const h = tokenHealth({ is_valid: false, expires_at: 0, data_access_expires_at: inDays(400) }, NOW)
    expect(h.status).toBe('invalid')
  })
})

describe('a healthy token says nothing', () => {
  it('is not surfaced', () => {
    // A banner that is always up is a banner nobody reads, and the one week it
    // says something new is the week it gets ignored.
    const healthy = tokenHealth(
      { is_valid: true, expires_at: 0, data_access_expires_at: inDays(90) }, NOW,
    )
    expect(worthSurfacing(healthy)).toBe(false)
  })

  it('every unhealthy state is surfaced', () => {
    for (const data of [
      null,
      { is_valid: false },
      { is_valid: true, expires_at: inDays(-1) },
      { is_valid: true, expires_at: 0, data_access_expires_at: inDays(-1) },
      { is_valid: true, expires_at: 0, data_access_expires_at: inDays(2) },
      { is_valid: true, expires_at: inDays(2), data_access_expires_at: inDays(400) },
    ]) {
      expect(worthSurfacing(tokenHealth(data, NOW)), JSON.stringify(data)).toBe(true)
    }
  })

  it('the warning window leaves time to act', () => {
    // Short enough not to nag, long enough that a person can generate a new
    // token and redeploy without it being an emergency.
    expect(WARN_WITHIN_DAYS).toBeGreaterThanOrEqual(14)
    expect(WARN_WITHIN_DAYS).toBeLessThanOrEqual(30)
  })
})

describe('the live token, as it stands today', () => {
  it('reads as healthy with data access as the real deadline', () => {
    // The actual values from debug_token on 2026-09-10: never-expiring token,
    // data access running to 2026-12-09.
    const h = tokenHealth({
      is_valid: true,
      expires_at: 0,
      data_access_expires_at: Math.floor(Date.parse('2026-12-09T10:17:13Z') / 1000),
    }, NOW)
    expect(h.status).toBe('healthy')
    expect(h.dataDays).toBe(90)
    // The point: the number a person should have in mind is 90, not "never".
    expect(h.headline).toMatch(/data access runs for another 90 days/i)
  })
})
