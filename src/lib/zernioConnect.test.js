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

  it('reads the temp token and decodes the user profile', () => {
    const profile = encodeURIComponent(JSON.stringify({ name: 'Arak Lighting' }))
    const got = readConnectCallback(`?tempToken=tt_1&step=connect/instagram/pages&userProfile=${profile}`)

    expect(got.tempToken).toBe('tt_1')
    expect(got.step).toBe('connect/instagram/pages')
    expect(got.userProfile).toEqual({ name: 'Arak Lighting' })
  })

  // A malformed userProfile must degrade to "no name shown", never throw: the
  // token is still good and the user can still finish connecting.
  it('survives a malformed userProfile and keeps the token', () => {
    const got = readConnectCallback('?tempToken=tt_2&userProfile=%7Bnot-json')

    expect(got.tempToken).toBe('tt_2')
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
