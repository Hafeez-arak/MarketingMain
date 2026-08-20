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
