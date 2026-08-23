import { describe, it, expect } from 'vitest'
import { readConnectCallback, tokenAge, TOKEN_LIFETIME_DAYS } from './zernioConnect'

// The two pieces of zernioConnect.js that are pure logic rather than a fetch
// wrapper. Both decide what the user is told, and both have a failure mode
// that is silent: a callback that throws strands someone on a blank screen
// holding a valid token, and a token age that guesses "fresh" hides the
// accounts that are about to stop publishing.

describe('readConnectCallback', () => {
  it('returns null when this is not a connect callback', () => {
    expect(readConnectCallback('?connected=1')).toBeNull()
  })

  // The tokens are BOTH required. A callback carrying only tempToken (the old
  // assumption) cannot finish the selection — the select-page endpoints
  // authenticate with connect_token — so treating it as a callback is what
  // left the picker spinning. Without both, it is not a callback.
  it('returns null without the connect token', () => {
    expect(readConnectCallback('?tempToken=tt_1&step=select_account')).toBeNull()
  })

  it('reads both tokens plus the profile id, step and platform', () => {
    const got = readConnectCallback(
      '?tempToken=tt_1&connect_token=ct_1&profileId=prof_9&step=select_account&platform=instagram')

    expect(got.tempToken).toBe('tt_1')
    expect(got.connectToken).toBe('ct_1')
    expect(got.profileId).toBe('prof_9')
    expect(got.step).toBe('select_account')
    expect(got.platform).toBe('instagram')
  })

  it('decodes userProfile when present', () => {
    const profile = encodeURIComponent(JSON.stringify({ name: 'Arak Lighting' }))
    const got = readConnectCallback(`?tempToken=tt_1&connect_token=ct_1&userProfile=${profile}`)
    expect(got.userProfile).toEqual({ name: 'Arak Lighting' })
  })

  // The real Instagram callback carried no userProfile at all, so its absence
  // is normal, not an error.
  it('treats a missing userProfile as null, not a failure', () => {
    const got = readConnectCallback('?tempToken=tt_1&connect_token=ct_1')
    expect(got.tempToken).toBe('tt_1')
    expect(got.userProfile).toBeNull()
  })

  // A malformed userProfile must degrade to null, never throw: the tokens are
  // still good and the user can still finish connecting.
  it('survives a malformed userProfile and keeps the tokens', () => {
    const got = readConnectCallback('?tempToken=tt_2&connect_token=ct_2&userProfile=%7Bnot-json')

    expect(got.tempToken).toBe('tt_2')
    expect(got.connectToken).toBe('ct_2')
    expect(got.userProfile).toBeNull()
  })
})

describe('tokenAge', () => {
  const at = days => ({ connected_at: new Date(Date.now() - days * 86400000).toISOString() })

  it('reports a fresh token as neither expiring nor expired', () => {
    const age = tokenAge(at(3))
    expect(age).toMatchObject({ known: true, days: 3, expiringSoon: false, expired: false })
  })

  it('warns inside the last week of the token lifetime', () => {
    expect(tokenAge(at(TOKEN_LIFETIME_DAYS - 2)).expiringSoon).toBe(true)
  })

  it('reports an expired token as expired, not merely expiring', () => {
    const age = tokenAge(at(TOKEN_LIFETIME_DAYS + 1))
    expect(age.expired).toBe(true)
    expect(age.expiringSoon).toBe(false)
  })

  // Rows that predate connected_at carry null. Reporting those as fresh would
  // hide precisely the oldest accounts — the ones most likely to be days from
  // failing — so unknown stays unknown.
  it('treats a missing connected_at as unknown rather than fresh', () => {
    const age = tokenAge({ connected_at: null })
    expect(age).toMatchObject({ known: false, days: null, expiringSoon: false, expired: false })
  })
})
