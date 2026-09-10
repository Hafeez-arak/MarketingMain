import { describe, it, expect } from 'vitest'
import {
  readConnectCallback, explainOAuthError, tokenAge, TOKEN_LIFETIME_DAYS,
} from './zernioConnect'

// The pieces of zernioConnect.js that are pure logic rather than a fetch
// wrapper. All three decide what the user is told, and all three have a
// failure mode that is silent: a callback read wrong strands someone on a page
// that looks untouched, an unread error says nothing happened when something
// did, and a token age that guesses "fresh" hides the accounts that are about
// to stop publishing.

describe('readConnectCallback', () => {
  it('returns null on a plain visit to the platform page', () => {
    expect(readConnectCallback('')).toBeNull()
    expect(readConnectCallback('?tab=posts')).toBeNull()
  })

  // ── The kind that was never read at all ─────────────────────────────────
  // Zernio sends the browser back to the SAME redirect_url on failure, with
  // `error` and `platform` appended. Nothing read them, so a denied or
  // ineligible connection returned to a screen that rendered exactly as it had
  // before the user left — which is indistinguishable from a dead button, and
  // is what "it opens the OAuth screen and then it just stays as it is" was.
  describe('a failed round trip', () => {
    it('is recognised as an error rather than as nothing', () => {
      const got = readConnectCallback('?error=oauth_denied&platform=instagram')
      expect(got.kind).toBe('error')
      expect(got.error).toBe('oauth_denied')
      expect(got.platform).toBe('instagram')
    })

    // error_message, is_user_fixable, reason and dashboard_url are documented
    // as conditional, so they are read as optional rather than relied on.
    it('reads the conditional extras when they are there', () => {
      const got = readConnectCallback(
        '?error=payment_required&platform=linkedin&reason=plan_limit' +
        '&is_user_fixable=true&dashboard_url=https%3A%2F%2Fzernio.com%2Fbilling')
      expect(got.isUserFixable).toBe(true)
      expect(got.reason).toBe('plan_limit')
      expect(got.dashboardUrl).toBe('https://zernio.com/billing')
    })

    it('does not invent them when they are absent', () => {
      const got = readConnectCallback('?error=oauth_denied&platform=tiktok')
      expect(got.isUserFixable).toBe(false)
      expect(got.errorMessage).toBe('')
    })
  })

  // ── Instagram: tokens inline ────────────────────────────────────────────
  describe('an Instagram selection callback', () => {
    it('reads both tokens plus the profile id and step', () => {
      const got = readConnectCallback(
        '?tempToken=tt_1&connect_token=ct_1&profileId=prof_9&step=select_account&platform=instagram')
      expect(got.kind).toBe('selection')
      expect(got.tempToken).toBe('tt_1')
      expect(got.connectToken).toBe('ct_1')
      expect(got.profileId).toBe('prof_9')
      expect(got.step).toBe('select_account')
    })

    // tempToken alone cannot finish an Instagram selection — select-account
    // authenticates with the connect token. It is still recognised as a
    // callback, because the alternative is what an earlier version did:
    // return null and render nothing, leaving someone staring at a page that
    // gives no hint a round trip even happened. The server names the missing
    // field instead.
    it('is still a callback without the connect token, so the gap can be named', () => {
      const got = readConnectCallback('?tempToken=tt_1&step=select_account&platform=instagram')
      expect(got.kind).toBe('selection')
      expect(got.connectToken).toBe('')
    })
  })

  // ── LinkedIn: a pointer instead of tokens ───────────────────────────────
  // The org list is too large for URL params, so the redirect carries a
  // pendingDataToken and the payload is fetched server-side. Strictly better
  // than Instagram's inline tokens: the LinkedIn access token never enters the
  // browser at all.
  describe('a LinkedIn selection callback', () => {
    it('is a selection callback on the pending-data token alone', () => {
      const got = readConnectCallback('?pendingDataToken=pdt_1&platform=linkedin')
      expect(got.kind).toBe('selection')
      expect(got.pendingDataToken).toBe('pdt_1')
      expect(got.platform).toBe('linkedin')
      expect(got.tempToken).toBe('')
    })
  })

  // ── Standard mode: already done ─────────────────────────────────────────
  // TikTok lands here. There is nothing to finish, but the account list has to
  // be refreshed and the user told which account arrived — otherwise a
  // successful connection and a dead button look identical.
  describe('a completed standard-mode callback', () => {
    it('is recognised as connected, with the account it connected', () => {
      const got = readConnectCallback(
        '?connected=tiktok&profileId=prof_9&accountId=acc_1&username=ppp228874')
      expect(got.kind).toBe('connected')
      expect(got.platform).toBe('tiktok')
      expect(got.accountId).toBe('acc_1')
      expect(got.username).toBe('ppp228874')
    })

    // The old callback URL ended in `?connected=1`, and Zernio's own success
    // param is `connected=<platform>`. Appended together they became
    // `?connected=1&connected=instagram`, so the param naming the platform was
    // shadowed by a constant. The callback URL no longer carries a query of
    // its own; this asserts nothing reintroduces one.
    it('never reports the platform as "1"', () => {
      const got = readConnectCallback('?connected=instagram&accountId=acc_1')
      expect(got.platform).toBe('instagram')
    })
  })

  it('decodes userProfile when present and survives a malformed one', () => {
    const profile = encodeURIComponent(JSON.stringify({ displayName: 'Arak Lighting' }))
    expect(readConnectCallback(`?tempToken=tt&connect_token=ct&userProfile=${profile}`).userProfile)
      .toEqual({ displayName: 'Arak Lighting' })
    // A malformed value must degrade to null, never throw: the tokens are
    // still good and the user can still finish connecting.
    const broken = readConnectCallback('?tempToken=tt&connect_token=ct&userProfile=%7Bnot-json')
    expect(broken.tempToken).toBe('tt')
    expect(broken.userProfile).toBeNull()
  })
})

describe('explainOAuthError', () => {
  it('turns a known code into the thing the user has to go do', () => {
    expect(explainOAuthError({ error: 'personal_account_not_supported', platform: 'instagram' }))
      .toMatch(/professional \(Business or Creator\)/)
  })

  // Zernio documents the list as non-exhaustive and says new values may be
  // added at any time, so an unrecognised code must degrade to something
  // readable rather than be swallowed by an exhaustive match.
  it('keeps an unknown code visible instead of hiding it', () => {
    const said = explainOAuthError({
      error: 'some_new_zernio_code', platform: 'linkedin', errorMessage: 'upstream said no',
    })
    expect(said).toContain('some_new_zernio_code')
    expect(said).toContain('upstream said no')
    expect(said).toContain('LinkedIn')
  })
})

describe('tokenAge', () => {
  const at = days => ({ connected_at: new Date(Date.now() - days * 86400000).toISOString() })

  it('reports a fresh token as neither expiring nor expired', () => {
    expect(tokenAge(at(3))).toMatchObject({ known: true, days: 3, expiringSoon: false, expired: false })
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
    expect(tokenAge({ connected_at: null }))
      .toMatchObject({ known: false, days: null, expiringSoon: false, expired: false })
  })
})
