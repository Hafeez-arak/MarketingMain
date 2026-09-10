import { describe, it, expect } from 'vitest'
import {
  profileIdOf, ownedByProfile, normalizeAccount, qs,
  createZernio, ZernioError, CONNECT_SPECS, explainZernioError,
} from './_zernio.js'

// ─── The bug that caused this rebuild, pinned ──────────────────────────────
// Every test in this file exists because the previous implementation lived
// inside an n8n Code node and could only be exercised by connecting a real
// account through a real OAuth screen and watching what came back. The one
// that mattered took two rounds of review and a live TikTok connect to find.

const PROFILE = '6a93f477bd1e9a40e2928cbc'

// The shape Zernio actually returns, trimmed. Captured live 2026-09-10 from
// GET /v1/accounts?profileId=6a93f477bd1e9a40e2928cbc — not invented, because
// an invented fixture would have had profileId as a string and every one of
// these tests would have passed against the broken code.
const LIVE_TIKTOK = {
  _id: '6aa11d8e726ebfe037cbcab4',
  platform: 'tiktok',
  displayName: 'ppp',
  username: 'ppp228874',
  isActive: true,
  needsReconnection: false,
  enabled: true,
  followersCount: 0,
  loginMethod: null,
  createdAt: '2026-09-09T08:49:18.837Z',
  profileId: { _id: PROFILE, name: 'arak_ws_00000000-0000-0000-0000-000000000001' },
  metadata: {
    profileData: {
      username: 'ppp228874',
      displayName: 'ppp',
      profilePicture: 'https://p16.tiktokcdn.com/avatar.jpeg',
      profileUrl: 'https://tiktok.com/@ppp228874',
    },
  },
}

describe('profileIdOf', () => {
  // Zernio POPULATES the reference. `String({_id})` is '[object Object]',
  // which is not equal to any profile id that has ever existed.
  it('reads the id out of a populated profile object', () => {
    expect(profileIdOf({ _id: PROFILE, name: 'arak_ws_x' })).toBe(PROFILE)
  })

  it('passes a plain string through', () => {
    expect(profileIdOf(PROFILE)).toBe(PROFILE)
  })

  it('treats absent as empty rather than "undefined"', () => {
    expect(profileIdOf(undefined)).toBe('')
    expect(profileIdOf(null)).toBe('')
  })
})

describe('ownedByProfile', () => {
  // THE regression. This exact assertion, against this exact fixture, is what
  // the previous filter failed — silently, for every account, in all six
  // actions that gate on the list.
  it('keeps an account whose profileId arrives as a populated object', () => {
    expect(ownedByProfile([LIVE_TIKTOK], PROFILE)).toHaveLength(1)
  })

  it('still rejects an account belonging to another profile', () => {
    const other = { ...LIVE_TIKTOK, profileId: { _id: 'someone-elses-profile' } }
    expect(ownedByProfile([other], PROFILE)).toHaveLength(0)
  })

  // A tenancy check whose failure mode is "show nothing" is indistinguishable
  // from "nothing is connected", which is the most expensive way to be wrong
  // here. An account we cannot classify is kept — Zernio already filtered
  // server-side, and this is only a second opinion.
  it('keeps an account that names no profile at all', () => {
    const noProfile = { ...LIVE_TIKTOK }
    delete noProfile.profileId
    expect(ownedByProfile([noProfile], PROFILE)).toHaveLength(1)
  })

  it('survives a null in the list', () => {
    expect(ownedByProfile([null, LIVE_TIKTOK], PROFILE)).toHaveLength(1)
  })
})

describe('normalizeAccount', () => {
  // Zernio speaks camelCase and `_id`; every screen reads snake_case and
  // `zernio_account_id`. Handing the raw object to the browser left Disconnect
  // posting `account_id: undefined` and the composer's account picker keying
  // every option on undefined — so no account could be chosen to publish as.
  it('gives the browser the field names its screens actually read', () => {
    const a = normalizeAccount(LIVE_TIKTOK)
    expect(a.zernio_account_id).toBe('6aa11d8e726ebfe037cbcab4')
    expect(a.username).toBe('ppp228874')
    expect(a.display_name).toBe('ppp')
    expect(a.is_active).toBe(true)
    expect(a.needs_reconnection).toBe(false)
    expect(a.zernio_profile_id).toBe(PROFILE)
  })

  // TikTok puts the avatar under metadata.profileData, not at the top level.
  it('falls back to metadata.profileData for the avatar and profile URL', () => {
    const a = normalizeAccount(LIVE_TIKTOK)
    expect(a.profile_picture).toBe('https://p16.tiktokcdn.com/avatar.jpeg')
    expect(a.profile_url).toBe('https://tiktok.com/@ppp228874')
  })

  it('reads is_active from either isActive or enabled', () => {
    expect(normalizeAccount({ ...LIVE_TIKTOK, isActive: false }).is_active).toBe(false)
    expect(normalizeAccount({ ...LIVE_TIKTOK, enabled: false }).is_active).toBe(false)
  })

  // Our own connected_at is written once on INSERT and never updated, so it is
  // the honest answer to "how old is this token". Zernio's createdAt is the
  // fallback for rows that predate the column.
  it('prefers our mirrored connected_at over Zernio createdAt', () => {
    const ours = '2026-09-01T00:00:00.000Z'
    expect(normalizeAccount(LIVE_TIKTOK, { connectedAt: ours }).connected_at).toBe(ours)
    expect(normalizeAccount(LIVE_TIKTOK).connected_at).toBe('2026-09-09T08:49:18.837Z')
  })

  // The composer offers the catalog-audio picker only for facebook_login. This
  // app connects Instagram no other way, and GET /accounts does not reliably
  // echo the field, so the default is what keeps every correctly-connected
  // account from permanently asking to be reconnected.
  it('defaults Instagram to facebook_login and leaves other platforms null', () => {
    expect(normalizeAccount({ _id: '1', platform: 'instagram' }).login_method).toBe('facebook_login')
    expect(normalizeAccount(LIVE_TIKTOK).login_method).toBeNull()
  })

  it('carries the LinkedIn account type through', () => {
    expect(normalizeAccount({ _id: '1', platform: 'linkedin', accountType: 'organization' }).account_type)
      .toBe('organization')
  })
})

describe('qs', () => {
  // The audio search returns TRENDING when q is omitted. Sending `q=` asks for
  // a track named nothing, so an empty value has to mean "not supplied".
  it('drops empty, null and undefined values', () => {
    expect(qs({ a: '1', b: '', c: null, d: undefined })).toBe('a=1')
  })

  it('encodes values that would otherwise break the URL', () => {
    expect(qs({ redirect_url: 'https://x.dev/social/linkedin' }))
      .toBe('redirect_url=https%3A%2F%2Fx.dev%2Fsocial%2Flinkedin')
  })
})

// ─── HTTP ──────────────────────────────────────────────────────────────────

function stub(routes) {
  const seen = []
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method || 'GET', headers: init.headers || {},
                body: init.body ? JSON.parse(init.body) : null })
    for (const [match, reply] of routes) {
      if (url.includes(match)) {
        const r = await reply({ url, init })
        return {
          status: r.status || 200,
          text: async () => JSON.stringify(r.body ?? {}),
        }
      }
    }
    return { status: 404, text: async () => JSON.stringify({ error: 'no stub', code: 'not_found' }) }
  }
  return { fetchImpl, seen }
}

describe('createZernio', () => {
  it('keeps the status and machine-readable code off a failure', async () => {
    const { fetchImpl } = stub([['accounts', () => ({
      status: 403, body: { error: 'Snapchat is in beta.', code: 'PLATFORM_BETA_RESTRICTED' },
    })]])
    const z = createZernio({ apiKey: 'k', fetchImpl })
    await expect(z.request('accounts')).rejects.toMatchObject({
      status: 403, code: 'PLATFORM_BETA_RESTRICTED',
    })
  })

  it('sends the connect token as a header alongside the API key, never instead', async () => {
    const { fetchImpl, seen } = stub([['select-account', () => ({ body: { pages: [] } })]])
    const z = createZernio({ apiKey: 'the-key', fetchImpl })
    await z.request('connect/instagram/select-account', { connectToken: 'ct_1' })
    expect(seen[0].headers.Authorization).toBe('Bearer the-key')
    expect(seen[0].headers['X-Connect-Token']).toBe('ct_1')
  })

  it('does not send a connect token header when there is none', async () => {
    const { fetchImpl, seen } = stub([['accounts', () => ({ body: {} })]])
    await createZernio({ apiKey: 'k', fetchImpl }).request('accounts')
    expect(seen[0].headers).not.toHaveProperty('X-Connect-Token')
  })
})

// ─── Instagram ─────────────────────────────────────────────────────────────

describe('instagram selection', () => {
  const spec = CONNECT_SPECS.instagram.selection

  it('asks Instagram for its own connect URL with facebook_login', () => {
    expect(CONNECT_SPECS.instagram.connectParams).toEqual({ loginMethod: 'facebook_login' })
    expect(CONNECT_SPECS.instagram.headless).toBe(true)
  })

  // The wrong endpoint (connect/facebook/select-page) shipped twice. Its GET
  // answers convincingly — it lists every Page the token manages — so the
  // picker fills in and only the final click fails, on a userProfile the
  // Instagram callback never carries. Asserting the neighbour is never called
  // is the only way that mistake stays fixed.
  it('lists pages from instagram/select-account and never touches facebook/select-page', async () => {
    const { fetchImpl, seen } = stub([['connect/instagram/select-account', () => ({
      body: {
        pages: [{
          id: '811889972008357',
          name: 'My Brand Page',
          instagram_business_account: {
            id: '17841400649984407', username: 'mybrand',
            profile_picture_url: 'https://cdn/pic.jpg',
          },
        }],
      },
    })]])
    const z = createZernio({ apiKey: 'k', fetchImpl })
    const options = await spec.options(z, { profileId: PROFILE, tempToken: 'tt', connectToken: 'ct' })

    expect(seen.every(r => !r.url.includes('facebook/select-page'))).toBe(true)
    // The Instagram handle is the title, the Page name the subtitle: the
    // person picking is choosing an Instagram account, not a Facebook Page.
    expect(options).toEqual([{
      id: '811889972008357',
      name: 'mybrand',
      username: 'mybrand',
      subtitle: 'My Brand Page',
      picture: 'https://cdn/pic.jpg',
    }])
  })

  it('posts exactly the three required fields, and no userProfile', async () => {
    const { fetchImpl, seen } = stub([['connect/instagram/select-account', () => ({ body: { message: 'ok' } })]])
    const z = createZernio({ apiKey: 'k', fetchImpl })
    await spec.complete(z, { profileId: PROFILE, tempToken: 'tt', connectToken: 'ct', choiceId: 'page_1' })

    const post = seen.find(r => r.method === 'POST')
    expect(post.body).toEqual({ profileId: PROFILE, pageId: 'page_1', tempToken: 'tt' })
    expect(post.body).not.toHaveProperty('userProfile')
  })
})

// ─── LinkedIn ──────────────────────────────────────────────────────────────

const PENDING = {
  platform: 'linkedin',
  profileId: PROFILE,
  tempToken: 'AQV_linkedin',
  userProfile: { id: 'ABC123', username: 'johndoe', displayName: 'John Doe' },
  selectionType: 'organizations',
  organizations: [
    { id: '12345', urn: 'urn:li:organization:12345', name: 'Acme Corp', vanityName: 'acme-corp' },
  ],
}

describe('linkedin selection', () => {
  const spec = CONNECT_SPECS.linkedin.selection

  // The documented shape comes first, so it is what the "missing" message
  // names. The tempToken alternative is a fallback for a callback that arrives
  // without pending data — it can offer only the personal profile, but it
  // connects rather than dead-ending.
  it('accepts a pending-data token, or falls back to a temp token', () => {
    expect(spec.requires).toEqual([['pendingDataToken'], ['tempToken']])
  })

  it('offers the personal profile alone when no pending data came back', async () => {
    const { fetchImpl, seen } = stub([])
    const z = createZernio({ apiKey: 'k', fetchImpl })
    const options = await spec.options(z, {
      profileId: PROFILE, pendingDataToken: '',
      tempToken: 'AQV', userProfile: { displayName: 'John Doe' },
    })
    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({ kind: 'personal', name: 'John Doe' })
    // No pending token means nothing to fetch — and nothing to 404 on.
    expect(seen.every(r => !r.url.includes('pending-data'))).toBe(true)
  })

  it('offers the personal profile alongside every company page', async () => {
    const { fetchImpl } = stub([
      ['connect/pending-data', () => ({ body: PENDING })],
      ['connect/linkedin/organizations', () => ({
        body: { organizations: [{ id: '12345', logoUrl: 'https://li/logo.png', industry: 'Lighting' }] },
      })],
    ])
    const z = createZernio({ apiKey: 'k', fetchImpl })
    const options = await spec.options(z, { profileId: PROFILE, pendingDataToken: 'pdt' })

    expect(options.map(o => o.kind)).toEqual(['personal', 'organization'])
    expect(options[0].name).toBe('John Doe')
    expect(options[1]).toMatchObject({
      id: '12345', name: 'Acme Corp',
      urn: 'urn:li:organization:12345', picture: 'https://li/logo.png', subtitle: 'Lighting',
    })
  })

  // Logos are decoration. A picker without them still connects an account, so
  // a failure there must not end the flow.
  it('still lists organisations when the logo lookup fails', async () => {
    const { fetchImpl } = stub([
      ['connect/pending-data', () => ({ body: PENDING })],
      ['connect/linkedin/organizations', () => ({ status: 500, body: { error: 'boom' } })],
    ])
    const z = createZernio({ apiKey: 'k', fetchImpl })
    const options = await spec.options(z, { profileId: PROFILE, pendingDataToken: 'pdt' })
    expect(options).toHaveLength(2)
    expect(options[1].name).toBe('Acme Corp')
  })

  // userProfile is REQUIRED here, unlike Instagram's select-account. The old
  // client dropped it for every platform on the grounds that Instagram did not
  // want it, which would have made every LinkedIn completion a 400.
  it('sends userProfile and accountType when connecting a company page', async () => {
    const { fetchImpl, seen } = stub([
      ['connect/pending-data', () => ({ body: PENDING })],
      ['select-organization', () => ({ body: { message: 'ok' } })],
    ])
    const z = createZernio({ apiKey: 'k', fetchImpl })
    await spec.complete(z, {
      profileId: PROFILE, pendingDataToken: 'pdt',
      choice: { id: '12345', kind: 'organization', name: 'Acme Corp', urn: 'urn:li:organization:12345' },
    })

    const post = seen.find(r => r.url.includes('select-organization'))
    expect(post.body).toMatchObject({
      profileId: PROFILE,
      tempToken: 'AQV_linkedin',
      userProfile: { displayName: 'John Doe' },
      accountType: 'organization',
      selectedOrganization: { id: '12345', urn: 'urn:li:organization:12345', name: 'Acme Corp' },
    })
  })

  it('omits selectedOrganization when connecting the personal profile', async () => {
    const { fetchImpl, seen } = stub([
      ['connect/pending-data', () => ({ body: PENDING })],
      ['select-organization', () => ({ body: { message: 'ok' } })],
    ])
    const z = createZernio({ apiKey: 'k', fetchImpl })
    await spec.complete(z, {
      profileId: PROFILE, pendingDataToken: 'pdt', choice: { id: 'personal', kind: 'personal' },
    })

    const post = seen.find(r => r.url.includes('select-organization'))
    expect(post.body.accountType).toBe('personal')
    expect(post.body).not.toHaveProperty('selectedOrganization')
  })

  // The token comes off a URL in somebody's browser. Without this, a token
  // pasted from another tenant's flow would connect their LinkedIn page here.
  it('refuses a pending payload belonging to another workspace', async () => {
    const { fetchImpl } = stub([
      ['connect/pending-data', () => ({ body: { ...PENDING, profileId: 'someone-else' } })],
    ])
    const z = createZernio({ apiKey: 'k', fetchImpl })
    await expect(spec.options(z, { profileId: PROFILE, pendingDataToken: 'pdt' }))
      .rejects.toThrow(/different workspace/i)
  })

  // One hour from the redirect. "404" is not something a person can act on.
  it('explains an expired pending token instead of reporting 404', async () => {
    const { fetchImpl } = stub([
      ['connect/pending-data', () => ({ status: 404, body: { error: 'Token not found' } })],
    ])
    const z = createZernio({ apiKey: 'k', fetchImpl })
    await expect(spec.options(z, { profileId: PROFILE, pendingDataToken: 'pdt' }))
      .rejects.toThrow(/expired/i)
  })
})

// ─── TikTok ────────────────────────────────────────────────────────────────

describe('tiktok', () => {
  // TikTok's OAuth identifies exactly one creator, so Zernio finishes the
  // connection at the callback. Asking for headless would hand us raw OAuth
  // data and a selection step that does not exist.
  it('has no selection step and does not ask for headless', () => {
    expect(CONNECT_SPECS.tiktok.selection).toBeNull()
    expect(CONNECT_SPECS.tiktok.headless).toBe(false)
  })
})

// ─── Snapchat ──────────────────────────────────────────────────────────────

describe('snapchat', () => {
  // Closed beta at Zernio: GET /connect/snapchat answers 403
  // PLATFORM_BETA_RESTRICTED. The app gates it out as status:'beta', and this
  // is the server-side half — a hand-made request cannot open a flow that has
  // no screen to finish it.
  it('is not connectable', () => {
    expect(CONNECT_SPECS.snapchat).toBeUndefined()
  })

  it('reads the beta refusal as a plan state rather than a bug', () => {
    const err = new ZernioError('Snapchat integration is currently in beta.',
      { status: 403, code: 'PLATFORM_BETA_RESTRICTED' })
    expect(explainZernioError(err)).toMatch(/closed beta/i)
  })
})
