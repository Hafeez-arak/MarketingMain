import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode, StubPostgrest, STUB_SUPABASE } from './workflowHarness'

// ─── Publish Post (Zernio) ─────────────────────────────────────────────────
// Covers what the composer's options do once they reach the workflow. The
// workflow is the last thing between a caller and a real post on a real
// account, so the guards here are re-asserted server-side rather than trusted
// from the browser — a webhook is reachable without one.

const ENV = {
  ZERNIO_API_KEY: 'stub-zernio-key',
  SUPABASE_URL: STUB_SUPABASE,
  SUPABASE_KEY: 'stub-service-key',
}

const PUBLISH = loadCodeNode('Arak Lighting – Publish Post (Zernio)', 'Publish to Zernio')

const WS = '11111111-1111-1111-1111-111111111111'

// Captures the body Zernio was actually sent, which is the point of every
// assertion below.
const PROFILE = '6a93f477bd1e9a40e2928cbc'

function zernio({ accounts = [{ _id: 'acc_1', platform: 'instagram', isActive: true }] } = {}) {
  const sent = []
  const accountUrls = []
  const routes = [
    ['/api/v1/accounts', async ({ url }) => {
      accountUrls.push(url)
      return { statusCode: 200, body: { accounts } }
    }],
    ['/api/v1/posts', async ({ body }) => {
      sent.push(body)
      return { statusCode: 200, body: { post: { _id: 'zpost_1' }, _id: 'zpost_1' } }
    }],
  ]
  return { routes, sent, accountUrls }
}

function db({ profileId = PROFILE } = {}) {
  return new StubPostgrest({
    generated_posts: [{
      id: 'p1', workspace_id: WS, publish_status: 'not_published', zernio_post_id: '',
    }],
    workspaces: [{ id: WS, name: 'Arak Lighting', zernio_profile_id: profileId }],
  })
}

const base = {
  post_id: 'p1', post_table: 'generated_posts', workspace_id: WS,
  account_id: 'acc_1', caption: 'Warm light', image_url: 'https://cdn.test/a.jpg',
}

const run = (body, { postgrest, routes }) =>
  runCodeNode(PUBLISH, { env: ENV, input: { body }, postgrest, routes })

describe('composer options reaching Zernio', () => {
  it('nests Instagram options under the platform entry', async () => {
    const { routes, sent } = zernio()
    await run({
      ...base, platform: 'instagram',
      platform_specific_data: { firstComment: 'Specs below', isAiGenerated: true },
    }, { postgrest: db(), routes })

    expect(sent).toHaveLength(1)
    expect(sent[0].platforms[0].platformSpecificData).toMatchObject({
      firstComment: 'Specs below', isAiGenerated: true,
    })
  })

  // A webhook is reachable without the browser, so unknown keys must not ride
  // through into the provider call.
  it('drops keys that are not on the allowlist', async () => {
    const { routes, sent } = zernio()
    await run({
      ...base, platform: 'instagram',
      platform_specific_data: { firstComment: 'ok', evilField: 'nope' },
    }, { postgrest: db(), routes })

    const psd = sent[0].platforms[0].platformSpecificData
    expect(psd.firstComment).toBe('ok')
    expect(psd).not.toHaveProperty('evilField')
  })

  it('omits platformSpecificData entirely when there is nothing to send', async () => {
    const { routes, sent } = zernio()
    await run({ ...base, platform: 'instagram' }, { postgrest: db(), routes })

    expect(sent[0].platforms[0]).not.toHaveProperty('platformSpecificData')
  })
})

describe('Instagram audio', () => {
  const reel = {
    ...base, platform: 'instagram',
    image_url: '', video_url: 'https://cdn.test/v.mp4',
  }

  it('passes a catalog track through on a Reel', async () => {
    const { routes, sent } = zernio()
    await run({
      ...reel,
      platform_specific_data: {
        audioName: 'Arak — Showroom',
        audioConfiguration: { audioId: 'aud_1', audioVolume: 100, videoVolume: 0 },
      },
    }, { postgrest: db(), routes })

    const psd = sent[0].platforms[0].platformSpecificData
    expect(psd.audioConfiguration).toMatchObject({ audioId: 'aud_1', videoVolume: 0 })
    expect(psd.audioName).toBe('Arak — Showroom')
  })

  // Instagram rejects catalog audio on anything but a Reel at container
  // creation. Refusing here means a hand-made request gets a sentence, and the
  // post row is not left claimed by a call that could never succeed.
  it('refuses catalog audio on a non-Reel', async () => {
    const { routes, sent } = zernio()
    const { out } = await run({
      ...base, platform: 'instagram',
      platform_specific_data: { audioConfiguration: { audioId: 'aud_1' } },
    }, { postgrest: db(), routes })

    expect(out.ok).toBe(false)
    expect(String(out.error)).toMatch(/only be attached to a Reel/i)
    expect(sent).toHaveLength(0)
  })

  it('refuses an audio configuration with no audioId', async () => {
    const { routes, sent } = zernio()
    const { out } = await run({
      ...reel,
      platform_specific_data: { audioConfiguration: { audioVolume: 50 } },
    }, { postgrest: db(), routes })

    expect(out.ok).toBe(false)
    expect(String(out.error)).toMatch(/audioId/i)
    expect(sent).toHaveLength(0)
  })
})

describe('TikTok', () => {
  const ttAccounts = [{ _id: 'acc_tt', platform: 'tiktok', isActive: true }]
  const ttBase = {
    ...base, account_id: 'acc_tt', platform: 'tiktok',
    image_url: '', video_url: 'https://cdn.test/v.mp4',
  }
  const consent = { content_preview_confirmed: true, express_consent_given: true }

  // Zernio puts TikTok's settings at the TOP level of the request body. Inside
  // platformSpecificData they are silently ignored and the post publishes with
  // TikTok's defaults instead — which for privacy_level can be more public
  // than was chosen.
  it('sends tiktokSettings at the top level, not under the platform entry', async () => {
    const { routes, sent } = zernio({ accounts: ttAccounts })
    await run({
      ...ttBase,
      tiktok_settings: { privacy_level: 'SELF_ONLY', allow_duet: false, ...consent },
    }, { postgrest: db(), routes })

    expect(sent[0].tiktokSettings).toMatchObject({ privacy_level: 'SELF_ONLY', allow_duet: false })
    expect(sent[0].platforms[0]).not.toHaveProperty('tiktokSettings')
  })

  // TikTok rejects a post with no privacy level. Refusing before the call
  // means the row is not left claimed by a request that could never succeed.
  it('refuses to publish without a privacy level', async () => {
    const { routes, sent } = zernio({ accounts: ttAccounts })
    const { out } = await run({ ...ttBase, tiktok_settings: { ...consent } },
      { postgrest: db(), routes })

    expect(out.ok).toBe(false)
    expect(String(out.error)).toMatch(/privacy level/i)
    expect(sent).toHaveLength(0)
  })

  // Re-asserted rather than trusted: TikTok requires both as a condition of
  // API access, and a request arriving without them did not come from the
  // composer.
  it('refuses to publish without the consent declaration', async () => {
    const { routes, sent } = zernio({ accounts: ttAccounts })
    const { out } = await run({
      ...ttBase, tiktok_settings: { privacy_level: 'PUBLIC_TO_EVERYONE' },
    }, { postgrest: db(), routes })

    expect(out.ok).toBe(false)
    expect(String(out.error)).toMatch(/consent/i)
    expect(sent).toHaveLength(0)
  })
})

// ─── Resolving which account to post as ────────────────────────────────────
// Only reached when the caller does NOT name an account_id, which is the
// path the composer takes for a plain scheduled post. Every other test here
// passes account_id explicitly, so this was the one branch with no coverage —
// and it was the branch that listed EVERY account the Zernio API key can see,
// across every tenant, and posted as the first one matching the platform.
describe('account resolution when the caller names no account', () => {
  const noAccount = { ...base }
  delete noAccount.account_id

  it('scopes the account list to this workspace Zernio profile', async () => {
    const { routes, accountUrls } = zernio()
    const out = await run({ ...noAccount, platform: 'instagram' }, { postgrest: db(), routes })

    expect(out.out.ok).toBe(true)
    // The whole fix in one assertion: an unscoped GET /accounts is what let a
    // post go out on another brand's feed.
    expect(accountUrls[0]).toContain(`profileId=${PROFILE}`)
  })

  // Zernio POPULATES the reference — `{ _id, name }`, not the string the field
  // name promises. Stringifying it is what made the connect flow discard every
  // account it was handed; the same shape reaches this workflow.
  it('keeps an account whose profileId arrives as a populated object', async () => {
    const { routes, sent } = zernio({ accounts: [
      { _id: 'acc_1', platform: 'instagram', isActive: true,
        profileId: { _id: PROFILE, name: 'arak_ws_x' } },
    ] })
    const out = await run({ ...noAccount, platform: 'instagram' }, { postgrest: db(), routes })

    expect(out.out.ok).toBe(true)
    expect(sent).toHaveLength(1)
  })

  it('refuses an account belonging to another workspace profile', async () => {
    const { routes, sent } = zernio({ accounts: [
      { _id: 'acc_other', platform: 'instagram', isActive: true,
        profileId: { _id: 'a-different-profile' } },
    ] })
    const out = await run({ ...noAccount, platform: 'instagram' }, { postgrest: db(), routes })

    expect(out.out.ok).toBe(false)
    expect(out.out.error).toMatch(/No connected instagram account in this workspace/)
    expect(sent).toHaveLength(0)
  })

  // No profile means this workspace has never connected anything. Falling back
  // to the unscoped list here would resolve to somebody else's account and
  // publish as it, which is precisely the failure the profile prevents.
  it('refuses rather than falling back when the workspace has no profile', async () => {
    const { routes, sent } = zernio()
    const out = await run({ ...noAccount, platform: 'instagram' },
      { postgrest: db({ profileId: null }), routes })

    expect(out.out.ok).toBe(false)
    expect(out.out.error).toMatch(/no connected accounts yet/i)
    expect(sent).toHaveLength(0)
  })
})
