import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode, StubPostgrest, STUB_SUPABASE } from './workflowHarness'

// ─── Zernio Connect ────────────────────────────────────────────────────────
// The workflow that makes accounts per-workspace instead of per-API-key. Two
// of the behaviours below are the reason it exists at all and neither is
// observable without a test: the 409 race on profile creation, and the
// ownership check standing between a browser-supplied account id and a DELETE
// that Zernio scopes to the whole team rather than to one profile.

const ENV = {
  ZERNIO_API_KEY: 'stub-zernio-key',
  SUPABASE_URL: STUB_SUPABASE,
  SUPABASE_KEY: 'stub-service-key',
}

const CONNECT = loadCodeNode('Arak Lighting – Zernio Connect', 'Zernio: Connect')

const WS = '11111111-1111-1111-1111-111111111111'
const PROFILE = '64f0a1b2c3d4e5f6a7b8c9d0'

function zernio({
  accounts = [],
  createProfile = { statusCode: 201, body: { profile: { _id: PROFILE } } },
  connectBody = { authUrl: 'https://instagram.com/oauth/authorize?x=1', state: 'st_1' },
  onDelete = () => ({ statusCode: 200, body: { ok: true } }),
} = {}) {
  const seen = { profileCreates: [], connectUrls: [], deletes: [] }
  const routes = [
    ['/api/v1/profiles', async ({ body }) => {
      seen.profileCreates.push(body)
      return createProfile
    }],
    ['/api/v1/connect/', async ({ url }) => {
      seen.connectUrls.push(url)
      return { statusCode: 200, body: connectBody }
    }],
    ['/api/v1/accounts', async ({ method, url }) => {
      if (method === 'DELETE') {
        seen.deletes.push(url)
        return onDelete()
      }
      return { statusCode: 200, body: { accounts } }
    }],
  ]
  return { routes, seen }
}

function db({ workspace = { id: WS, name: 'Arak Lighting', zernio_profile_id: null }, social = [] } = {}) {
  return new StubPostgrest({ workspaces: [workspace], social_accounts: social })
}

const run = (body, { postgrest, routes }) =>
  runCodeNode(CONNECT, { env: ENV, input: { body }, postgrest, routes })

// ── Profile get-or-create ────────────────────────────────────────────────
describe('profile provisioning', () => {
  it('creates a profile on first use and stores it on the workspace', async () => {
    const pg = db()
    const { routes, seen } = zernio()
    const { out } = await run({ action: 'accounts', workspace_id: WS }, { postgrest: pg, routes })

    expect(out.ok).toBe(true)
    expect(out.profile_id).toBe(PROFILE)
    // Name is DERIVED from the workspace id, which is what makes a concurrent
    // second create collide rather than quietly produce a twin profile.
    expect(seen.profileCreates[0].name).toBe(`arak_ws_${WS}`)
    expect(pg.tables.workspaces[0].zernio_profile_id).toBe(PROFILE)
  })

  it('reuses an existing profile without calling Zernio again', async () => {
    const pg = db({ workspace: { id: WS, name: 'Arak', zernio_profile_id: PROFILE } })
    const { routes, seen } = zernio()
    const { out } = await run({ action: 'accounts', workspace_id: WS }, { postgrest: pg, routes })

    expect(out.profile_id).toBe(PROFILE)
    expect(seen.profileCreates).toHaveLength(0)
  })

  // The race. Two tabs both press Connect; Zernio refuses the second create
  // because the derived name is taken, and hands back the id the winner got.
  // Losing that race has to be indistinguishable from winning it — otherwise
  // one tab ends up with no profile and an error it cannot act on.
  it('adopts the winner\'s profile when a concurrent create returns 409', async () => {
    const pg = db()
    const { routes } = zernio({
      createProfile: {
        statusCode: 409,
        body: { error: 'Profile name already exists', details: { existingProfileId: PROFILE } },
      },
    })
    const { out } = await run({ action: 'accounts', workspace_id: WS }, { postgrest: pg, routes })

    expect(out.ok).toBe(true)
    expect(out.profile_id).toBe(PROFILE)
    expect(pg.tables.workspaces[0].zernio_profile_id).toBe(PROFILE)
  })

  it('reports a 409 with no id rather than inventing one', async () => {
    const pg = db()
    const { routes } = zernio({ createProfile: { statusCode: 409, body: { error: 'taken' } } })
    const { out } = await run({ action: 'accounts', workspace_id: WS }, { postgrest: pg, routes })

    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/409/)
  })
})

// ── Account mirroring ────────────────────────────────────────────────────
describe('accounts', () => {
  const IG = {
    _id: 'acc_ig_1', platform: 'instagram', username: 'lightingaaa',
    profileId: PROFILE, isActive: true, followersCount: 42,
  }

  it('mirrors Zernio accounts into social_accounts scoped to the workspace', async () => {
    const pg = db({ workspace: { id: WS, name: 'Arak', zernio_profile_id: PROFILE } })
    const { routes } = zernio({ accounts: [IG] })
    const { out } = await run({ action: 'accounts', workspace_id: WS }, { postgrest: pg, routes })

    expect(out.accounts).toHaveLength(1)
    const row = pg.tables.social_accounts[0]
    expect(row.workspace_id).toBe(WS)
    expect(row.zernio_account_id).toBe('acc_ig_1')
    expect(row.zernio_profile_id).toBe(PROFILE)
    expect(row.publish_provider).toBe('zernio')
  })

  // connected_at must never appear in the upsert payload: the sync merges on
  // conflict, so naming the column would rewrite it on every page load and
  // reset the token-age clock it exists to keep. The column default fills it
  // on INSERT instead.
  it('never writes connected_at, so a refresh cannot reset the token clock', async () => {
    const pg = db({ workspace: { id: WS, name: 'Arak', zernio_profile_id: PROFILE } })
    const { routes } = zernio({ accounts: [IG] })
    const { calls } = await run({ action: 'accounts', workspace_id: WS }, { postgrest: pg, routes })

    const upsert = calls.find(c => c.method === 'POST' && c.url.includes('social_accounts'))
    expect(upsert).toBeTruthy()
    for (const row of upsert.body) expect(row).not.toHaveProperty('connected_at')
  })

  // profileId is a server-side filter and Zernio honours it. This re-checks it
  // anyway, because this list decides which accounts a workspace may post as —
  // an upstream filter regression would otherwise become a cross-tenant post.
  it('drops any account carrying a different profileId', async () => {
    const pg = db({ workspace: { id: WS, name: 'Arak', zernio_profile_id: PROFILE } })
    const { routes } = zernio({
      accounts: [IG, { _id: 'acc_other', platform: 'tiktok', profileId: 'someone_else' }],
    })
    const { out } = await run({ action: 'accounts', workspace_id: WS }, { postgrest: pg, routes })

    expect(out.accounts.map(a => a._id)).toEqual(['acc_ig_1'])
  })
})

// ── Starting OAuth ───────────────────────────────────────────────────────
describe('connect_url', () => {
  const base = { action: 'connect_url', workspace_id: WS, redirect_url: 'https://app.test/cb' }

  it('returns an auth URL scoped to this workspace\'s profile', async () => {
    const pg = db({ workspace: { id: WS, name: 'Arak', zernio_profile_id: PROFILE } })
    const { routes, seen } = zernio()
    const { out } = await run({ ...base, platform: 'tiktok' }, { postgrest: pg, routes })

    expect(out.ok).toBe(true)
    expect(out.auth_url).toMatch(/oauth/)
    expect(seen.connectUrls[0]).toContain(`profileId=${PROFILE}`)
  })

  // Instagram needs a second choice after OAuth (which page backs the
  // account). headless keeps that picker in our UI instead of bouncing the
  // user to a Zernio-branded screen mid-flow. TikTok finishes at the callback
  // and must NOT ask for it.
  it('asks for headless on Instagram but not on TikTok', async () => {
    const pg = db({ workspace: { id: WS, name: 'Arak', zernio_profile_id: PROFILE } })
    const { routes, seen } = zernio()

    const ig = await run({ ...base, platform: 'instagram' }, { postgrest: pg, routes })
    expect(ig.out.headless).toBe(true)
    expect(seen.connectUrls[0]).toContain('headless=true')

    const tt = await run({ ...base, platform: 'tiktok' }, { postgrest: pg, routes })
    expect(tt.out.headless).toBe(false)
    expect(seen.connectUrls[1]).not.toContain('headless')
  })

  // Snapchat is status:'beta' in PLATFORM_META — visible, labelled, and not
  // connectable. The UI hides the button; this is the half that means a
  // hand-made request cannot open a flow the app has no screen to finish.
  it('refuses a platform the app cannot finish connecting', async () => {
    const pg = db({ workspace: { id: WS, name: 'Arak', zernio_profile_id: PROFILE } })
    const { routes, seen } = zernio()
    const { out } = await run({ ...base, platform: 'snapchat' }, { postgrest: pg, routes })

    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/cannot be connected/i)
    expect(seen.connectUrls).toHaveLength(0)
  })

  it('refuses without a redirect_url rather than starting an unfinishable flow', async () => {
    const pg = db({ workspace: { id: WS, name: 'Arak', zernio_profile_id: PROFILE } })
    const { routes } = zernio()
    const { out } = await run(
      { action: 'connect_url', workspace_id: WS, platform: 'tiktok' }, { postgrest: pg, routes })

    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/redirect_url/)
  })
})

// ── Headless page selection (the flow that hung on the first live connect) ──
describe('selection', () => {
  // The shape Zernio's spec documents for connect/instagram/select-account:
  // a Facebook Page carrying the Instagram account linked to it.
  const PAGE = {
    id: 'pg_1',
    name: 'Lighting Arak',
    access_token: 'page_tok',
    instagram_business_account: {
      id: 'ig_1', username: 'arak', profile_picture_url: 'https://cdn/ig.jpg',
    },
  }
  const pgWith = () => db({ workspace: { id: WS, name: 'Arak', zernio_profile_id: PROFILE } })

  // Captures the exact request Zernio received, because both bugs here were
  // entirely in the request: wrong endpoint, wrong place for the token.
  //
  // The Facebook route is stubbed too, and every test asserts it stayed
  // untouched. facebook/select-page is not a 404 — its GET answers with the
  // same-looking page list, which is exactly why the wrong endpoint survived
  // to the final click. A test that only checked the Instagram route would
  // have passed against the broken code.
  function withSelect({ pages = [PAGE], onPost = () => ({ statusCode: 200, body: { account: { accountId: 'acc_1' } } }) } = {}) {
    const seen = { get: null, post: null, facebook: [] }
    const routes = [
      ['/connect/instagram/select-account', async ({ method, url, headers, body }) => {
        if (method === 'POST') { seen.post = { url, headers, body }; return onPost() }
        seen.get = { url, headers }
        return { statusCode: 200, body: { pages } }
      }],
      ['/connect/facebook/select-page', async ({ method, url }) => {
        seen.facebook.push({ method, url })
        // What the live API actually did to us: 400 on the POST because its
        // schema requires a userProfile object the Instagram callback never
        // carries.
        if (method === 'POST') {
          return { statusCode: 400, body: { error: 'Invalid input: expected object, received undefined' } }
        }
        return { statusCode: 200, body: { pages: [{ id: 'pg_1', name: 'Lighting Arak', category: 'Lighting shop' }] } }
      }],
      ['/api/v1/accounts', async () => ({ statusCode: 200, body: { accounts: [] } })],
    ]
    return { routes, seen }
  }

  const cb = {
    action: 'selection_options', workspace_id: WS, platform: 'instagram',
    temp_token: 'tt_1', connect_token: 'ct_1', profile_id: PROFILE,
  }

  // Instagram authorises THROUGH Facebook, but the endpoint is Instagram's own
  // — connect/instagram/select-account. facebook/select-page connects a
  // FACEBOOK account and requires a userProfile object our callback never
  // carries, which is what produced "Zernio 400: Invalid input: expected
  // object, received undefined" on the first live completion.
  it('lists pages from the instagram/select-account endpoint, never the facebook one', async () => {
    const { routes, seen } = withSelect()
    const { out } = await run(cb, { postgrest: pgWith(), routes })

    expect(out.ok).toBe(true)
    expect(out.options).toHaveLength(1)
    expect(seen.get.url).toContain('/connect/instagram/select-account')
    expect(seen.facebook).toEqual([])
  })

  // The row names the Instagram account, because that is what the person is
  // choosing; the Page is the subtitle. The id stays the PAGE's — that is what
  // the completion POST takes.
  it('shows the linked Instagram handle and keeps the page id for completion', async () => {
    const { routes } = withSelect()
    const { out } = await run(cb, { postgrest: pgWith(), routes })

    expect(out.options[0]).toMatchObject({
      id: 'pg_1', name: 'arak', username: 'arak',
      category: 'Lighting Arak', picture: 'https://cdn/ig.jpg',
      instagram_account_id: 'ig_1',
    })
  })

  // The short-lived connect token authenticates as a HEADER, not a query
  // param. Sent as a query param (the old assumption) it authorised nothing.
  it('sends the connect token as the X-Connect-Token header', async () => {
    const { routes, seen } = withSelect()
    await run(cb, { postgrest: pgWith(), routes })

    expect(seen.get.headers['X-Connect-Token']).toBe('ct_1')
    expect(seen.get.url).not.toContain('ct_1')
  })

  it('refuses without the connect token rather than calling a route that will reject it', async () => {
    const { routes, seen } = withSelect()
    const { out } = await run({ ...cb, connect_token: '' }, { postgrest: pgWith(), routes })

    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/connect_token/)
    expect(seen.get).toBeNull()
  })

  // The profile in the callback must match the one this workspace holds, or a
  // crossed browser wire would attach an account to the wrong tenant.
  it('refuses a callback whose profile is not this workspace\'s', async () => {
    const { routes, seen } = withSelect()
    const { out } = await run({ ...cb, profile_id: 'someone_elses_profile' },
      { postgrest: pgWith(), routes })

    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/different workspace/i)
    expect(seen.get).toBeNull()
  })

  it('completes by POSTing the chosen pageId, then re-lists accounts', async () => {
    const { routes, seen } = withSelect()
    const { out } = await run(
      { ...cb, action: 'selection_complete', selection: { id: 'pg_1', name: 'arak' } },
      { postgrest: pgWith(), routes })

    expect(out.ok).toBe(true)
    expect(seen.post.url).toContain('/connect/instagram/select-account')
    expect(seen.post.body.pageId).toBe('pg_1')
    expect(seen.post.body.profileId).toBe(PROFILE)
    expect(seen.post.headers['X-Connect-Token']).toBe('ct_1')
    expect(seen.facebook).toEqual([])
  })

  // Exactly the three fields the spec marks required, and nothing else. A
  // userProfile here is the signature of the Facebook endpoint's schema, which
  // is the wrong flow — sending one would mean we had drifted back to it.
  it('sends only profileId, pageId and tempToken — no userProfile', async () => {
    const { routes, seen } = withSelect()
    await run({ ...cb, action: 'selection_complete', selection: { id: 'pg_1' },
                user_profile: { id: 'u_1', name: 'Someone' } },
      { postgrest: pgWith(), routes })

    expect(Object.keys(seen.post.body).sort()).toEqual(['pageId', 'profileId', 'tempToken'])
  })

  // Zernio refusing the completion has to reach the person as a reason. The
  // picker stays open on this path, so a silent failure is a button that does
  // nothing at all.
  it('surfaces a refused completion with Zernio\'s own reason', async () => {
    const { routes } = withSelect({
      onPost: () => ({ statusCode: 400, body: { error: 'Selected page has no linked Instagram professional account' } }),
    })
    const { out } = await run(
      { ...cb, action: 'selection_complete', selection: { id: 'pg_1' } },
      { postgrest: pgWith(), routes })

    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/no linked Instagram professional account/)
  })
})

// ── Disconnect ───────────────────────────────────────────────────────────
describe('disconnect', () => {
  const MINE = { _id: 'acc_mine', platform: 'instagram', profileId: PROFILE }

  it('disconnects an account this workspace owns, Zernio first then locally', async () => {
    const pg = db({
      workspace: { id: WS, name: 'Arak', zernio_profile_id: PROFILE },
      social: [{ workspace_id: WS, zernio_account_id: 'acc_mine', platform: 'instagram' }],
    })
    const { routes, seen } = zernio({ accounts: [MINE] })
    const { out } = await run(
      { action: 'disconnect', workspace_id: WS, account_id: 'acc_mine' }, { postgrest: pg, routes })

    expect(out.ok).toBe(true)
    expect(seen.deletes).toHaveLength(1)
  })

  // The tenancy guard. account_id arrives from a browser and Zernio scopes
  // DELETE /accounts/{id} to the API TEAM, not to a profile — so without the
  // ownership check, knowing another workspace's account id would be enough to
  // disconnect it. The DELETE must not be attempted at all.
  it('refuses an account belonging to another workspace, without calling Zernio', async () => {
    const pg = db({ workspace: { id: WS, name: 'Arak', zernio_profile_id: PROFILE } })
    const { routes, seen } = zernio({ accounts: [MINE] })
    const { out } = await run(
      { action: 'disconnect', workspace_id: WS, account_id: 'acc_someone_else' },
      { postgrest: pg, routes })

    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/does not belong/i)
    expect(seen.deletes).toHaveLength(0)
  })
})

// ── TikTok creator info ──────────────────────────────────────────────────
describe('creator_info', () => {
  const TT = { _id: 'acc_tt', platform: 'tiktok', profileId: PROFILE }

  function withCreatorInfo({ firstPathStatus = 200, levels = ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] } = {}) {
    const seen = { urls: [] }
    const routes = [
      ['tiktok/creator-info', async ({ url }) => {
        seen.urls.push(url)
        if (firstPathStatus !== 200) return { statusCode: firstPathStatus, body: { error: 'not here' } }
        return { statusCode: 200, body: { creatorInfo: { privacy_level_options: levels, creator_nickname: 'Arak' } } }
      }],
      ['tiktok-creator-info', async ({ url }) => {
        seen.urls.push(url)
        return { statusCode: 200, body: { data: { privacy_level_options: levels } } }
      }],
      ['/api/v1/accounts', async () => ({ statusCode: 200, body: { accounts: [TT] } })],
    ]
    return { routes, seen }
  }

  const pgWith = () => db({ workspace: { id: WS, name: 'Arak', zernio_profile_id: PROFILE } })

  it('returns the creator\'s allowed privacy levels', async () => {
    const { routes } = withCreatorInfo()
    const { out } = await run(
      { action: 'creator_info', workspace_id: WS, account_id: 'acc_tt' },
      { postgrest: pgWith(), routes })

    expect(out.ok).toBe(true)
    expect(out.privacyLevels).toEqual(['PUBLIC_TO_EVERYONE', 'SELF_ONLY'])
  })

  // Zernio's platform guide and API reference document DIFFERENT paths for
  // this endpoint. Rather than guess and ship a feature that 404s, the
  // workflow tries one and falls back — this proves the fallback works.
  it('falls back to the second documented path when the first 404s', async () => {
    const { routes, seen } = withCreatorInfo({ firstPathStatus: 404 })
    const { out } = await run(
      { action: 'creator_info', workspace_id: WS, account_id: 'acc_tt' },
      { postgrest: pgWith(), routes })

    expect(out.ok).toBe(true)
    expect(out.privacyLevels).toHaveLength(2)
    expect(seen.urls).toHaveLength(2)
  })

  // Same tenancy guard as disconnect: without it, knowing another workspace's
  // account id would read that account's posting configuration.
  it('refuses an account belonging to another workspace', async () => {
    const { routes } = withCreatorInfo()
    const { out } = await run(
      { action: 'creator_info', workspace_id: WS, account_id: 'acc_not_mine' },
      { postgrest: pgWith(), routes })

    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/does not belong/i)
  })

  // An account TikTok is refusing returns an empty list, which the composer
  // renders as "needs reconnecting". That is information, not a failure.
  it('reports an empty level list rather than an error', async () => {
    const { routes } = withCreatorInfo({ levels: [] })
    const { out } = await run(
      { action: 'creator_info', workspace_id: WS, account_id: 'acc_tt' },
      { postgrest: pgWith(), routes })

    expect(out.ok).toBe(true)
    expect(out.privacyLevels).toEqual([])
  })
})

// ── Instagram catalog audio ──────────────────────────────────────────────
describe('audio_search', () => {
  const IG = { _id: 'acc_ig', platform: 'instagram', profileId: PROFILE }
  const pgWith = () => db({ workspace: { id: WS, name: 'Arak', zernio_profile_id: PROFILE } })

  function withAudio({ status = 200, body = null } = {}) {
    const seen = { urls: [] }
    const routes = [
      ['/instagram/audio', async ({ url }) => {
        seen.urls.push(url)
        if (status !== 200) return { statusCode: status, body }
        return {
          statusCode: 200,
          body: { audio: [
            { audioId: 'aud_1', title: 'Slow Dust', artist: 'Nadir', durationMs: 31000, downloadUrl: 'https://cdn.test/p.mp3' },
            { title: 'No id — dropped' },
          ] },
        }
      }],
      ['/api/v1/accounts', async () => ({ statusCode: 200, body: { accounts: [IG] } })],
    ]
    return { routes, seen }
  }

  it('returns normalised tracks and drops entries with no audioId', async () => {
    const { routes } = withAudio()
    const { out } = await run(
      { action: 'audio_search', workspace_id: WS, account_id: 'acc_ig', q: 'dust' },
      { postgrest: pgWith(), routes })

    expect(out.ok).toBe(true)
    expect(out.audio).toHaveLength(1)
    // durationMs normalised to seconds, so the picker does not have to guess
    // which unit a given Zernio response used.
    expect(out.audio[0]).toMatchObject({ audioId: 'aud_1', title: 'Slow Dust', duration: 31 })
  })

  // Omitting the query is how the picker opens: trending is a better default
  // than an empty list.
  it('treats a blank query as a trending request', async () => {
    const { routes, seen } = withAudio()
    const { out } = await run(
      { action: 'audio_search', workspace_id: WS, account_id: 'acc_ig' },
      { postgrest: pgWith(), routes })

    expect(out.trending).toBe(true)
    expect(seen.urls[0]).not.toContain('q=')
  })

  // The failure that is a CONNECTION problem rather than a search problem. It
  // gets its own flag because the fix is a reconnect, and no amount of
  // retrying or rephrasing changes it.
  it('reports an Instagram-Login account as needing a reconnect, not as an error', async () => {
    const { routes } = withAudio({
      status: 400,
      body: { error: 'bad request', code: 'instagram_audio_requires_facebook_login' },
    })
    const { out } = await run(
      { action: 'audio_search', workspace_id: WS, account_id: 'acc_ig' },
      { postgrest: pgWith(), routes })

    expect(out.ok).toBe(false)
    expect(out.needsReconnect).toBe(true)
    expect(out.error).toMatch(/reconnect/i)
  })

  it('refuses an account belonging to another workspace', async () => {
    const { routes, seen } = withAudio()
    const { out } = await run(
      { action: 'audio_search', workspace_id: WS, account_id: 'acc_elsewhere' },
      { postgrest: pgWith(), routes })

    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/does not belong/i)
    expect(seen.urls).toHaveLength(0)
  })
})

// ── Failure shape ────────────────────────────────────────────────────────
describe('errors', () => {
  // responseMode=lastNode turns a thrown node error into HTTP 200 with an
  // EMPTY body (see the Webhook Secret Guard note in gen_workflows.py), so
  // every failure here has to come back as ok:false carrying a reason. A
  // Connect button that says nothing is the worst version of this screen.
  it('returns ok:false with a reason instead of throwing', async () => {
    const pg = db()
    const { routes } = zernio()
    const { out } = await run({ action: 'nonsense', workspace_id: WS }, { postgrest: pg, routes })

    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/Unknown action/)
  })

  it('names a missing workspace_id rather than failing obscurely downstream', async () => {
    const pg = db()
    const { routes } = zernio()
    const { out } = await run({ action: 'accounts' }, { postgrest: pg, routes })

    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/workspace_id/)
  })
})
