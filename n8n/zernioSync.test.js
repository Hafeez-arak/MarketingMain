import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode, StubPostgrest, STUB_SUPABASE } from './workflowHarness'

// ─── Zernio Sync: the account mirror ───────────────────────────────────────
// This workflow's job is to make social_accounts agree with Zernio. It had no
// test, and the thing it did instead was fetch ONE global account list — every
// account the API key can see, across every tenant — and write all of them
// into every workspace that had rows.
//
// With one workspace connected that looks correct, which is why it survived.
// With three it means each brand's Social screen lists the other two brands'
// accounts as its own, and the composer offers them as publish targets.
//
// The analytics half is out of scope here: `hasAnalyticsAccess: false` makes
// the workflow return straight after the accounts pass, which is what keeps
// these tests about one thing.

const ENV = {
  ZERNIO_API_KEY: 'stub-zernio-key',
  SUPABASE_URL: STUB_SUPABASE,
  SUPABASE_KEY: 'stub-service-key',
}

const SYNC = loadCodeNode('Arak Lighting – Zernio Sync', 'Zernio: Sync')

const WS_A = '11111111-1111-1111-1111-111111111111'
const WS_B = '22222222-2222-2222-2222-222222222222'
const PROFILE_A = '6a93f477bd1e9a40e2928cbc'
const PROFILE_B = '6a86cba609f44f3a9a423604'

// Zernio honours ?profileId= server-side, so the stub does too — anything else
// would test a fantasy API rather than the one this talks to.
function zernio({ byProfile = {} } = {}) {
  const asked = []
  const routes = [
    ['/api/v1/accounts', async ({ url }) => {
      const profileId = new URL(url).searchParams.get('profileId') || ''
      asked.push(profileId)
      return {
        statusCode: 200,
        body: { accounts: byProfile[profileId] || [], hasAnalyticsAccess: false },
      }
    }],
  ]
  return { routes, asked }
}

const run = (body, { postgrest, routes }) =>
  runCodeNode(SYNC, { env: ENV, input: { body }, postgrest, routes })

const twoWorkspaces = () => new StubPostgrest({
  workspaces: [
    { id: WS_A, name: 'Arak Lighting', zernio_profile_id: PROFILE_A },
    { id: WS_B, name: 'Aqeeq',         zernio_profile_id: PROFILE_B },
  ],
  social_accounts: [],
})

const ACCOUNTS = {
  [PROFILE_A]: [{ _id: 'acc_a', platform: 'tiktok', username: 'arak',
                  isActive: true, profileId: { _id: PROFILE_A, name: 'arak_ws_a' } }],
  [PROFILE_B]: [{ _id: 'acc_b', platform: 'instagram', username: 'aqeeq',
                  isActive: true, profileId: { _id: PROFILE_B, name: 'arak_ws_b' } }],
}

describe('mirroring accounts into workspaces', () => {
  it('asks Zernio once per workspace, scoped by that workspace profile', async () => {
    const { routes, asked } = zernio({ byProfile: ACCOUNTS })
    await run({}, { postgrest: twoWorkspaces(), routes })
    expect(asked.sort()).toEqual([PROFILE_A, PROFILE_B].sort())
  })

  // THE regression. Two brands, one account each, and neither may see the
  // other's.
  it('never writes one workspace account into another workspace', async () => {
    const pg = twoWorkspaces()
    const { routes } = zernio({ byProfile: ACCOUNTS })
    await run({}, { postgrest: pg, routes })

    const rows = pg.tables.social_accounts
    expect(rows).toHaveLength(2)
    expect(rows.find(r => r.workspace_id === WS_A).zernio_account_id).toBe('acc_a')
    expect(rows.find(r => r.workspace_id === WS_B).zernio_account_id).toBe('acc_b')
  })

  it('syncs only the named workspace when the webhook names one', async () => {
    const pg = twoWorkspaces()
    const { routes, asked } = zernio({ byProfile: ACCOUNTS })
    await run({ workspace_id: WS_A }, { postgrest: pg, routes })

    expect(asked).toEqual([PROFILE_A])
    expect(pg.tables.social_accounts.every(r => r.workspace_id === WS_A)).toBe(true)
  })

  // A workspace with no profile has never connected anything. There is nothing
  // to mirror and — crucially — nothing to guess: the old code would have
  // filled it with whatever the global list happened to contain.
  it('skips a workspace that has never connected anything', async () => {
    const pg = new StubPostgrest({
      workspaces: [{ id: WS_A, name: 'Arak Lighting', zernio_profile_id: null }],
      social_accounts: [],
    })
    const { routes, asked } = zernio({ byProfile: ACCOUNTS })
    const out = await run({}, { postgrest: pg, routes })

    expect(asked).toEqual([])
    expect(pg.tables.social_accounts).toHaveLength(0)
    expect(out.out.ok).toBe(true)
  })

  // Zernio POPULATES the reference: `{ _id, name }`, not the string the field
  // name promises. Stringifying it is what made the connect flow discard every
  // account it was ever handed, and the same shape arrives here.
  it('keeps an account whose profileId arrives as a populated object', async () => {
    const pg = twoWorkspaces()
    const { routes } = zernio({ byProfile: ACCOUNTS })
    await run({ workspace_id: WS_A }, { postgrest: pg, routes })
    expect(pg.tables.social_accounts).toHaveLength(1)
  })

  // The second opinion on top of Zernio's own filter may only ever reject an
  // account that names a DIFFERENT profile.
  it('drops an account Zernio returned under the wrong profile', async () => {
    const pg = twoWorkspaces()
    const { routes } = zernio({ byProfile: {
      [PROFILE_A]: [{ _id: 'acc_x', platform: 'tiktok', isActive: true,
                      profileId: { _id: PROFILE_B } }],
    } })
    await run({ workspace_id: WS_A }, { postgrest: pg, routes })
    expect(pg.tables.social_accounts).toHaveLength(0)
  })
})
