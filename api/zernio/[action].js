import {
  createZernio, normalizeAccount, ownedByProfile, profileIdOf,
  CONNECT_SPECS, CONNECTABLE, explainZernioError, ZernioError, qs, analyticsPlan, followerPlan, retryRateLimited,
  syncAccountPosts,
} from './_zernio.js'
import { mayDisconnect, protectionReason } from '../../src/lib/platformSafety.js'

// ─── Per-workspace OAuth ───────────────────────────────────────────────────
//
// POST /api/zernio/<action>. Replaces the "Arak Lighting – Zernio Connect"
// n8n workflow, which is no longer reachable (its slot is gone from
// WEBHOOK_PATHS, so the n8n proxy 404s it).
//
// Why it moved off n8n:
//   • Deploying a workflow change means git pull + redeploy.sh on the WSL2
//     box. OAuth takes dozens of iterations to get right; that loop is the
//     wrong shape for it.
//   • Zernio's post.published / analytics.synced webhooks want a real HTTPS
//     endpoint. This deployment already is one.
//   • The logic is now plain JS with a stub fetch in front of it, so the class
//     of bug that caused this rebuild — a shape mismatch invisible without a
//     live account — is a unit test.
//
// The Zernio API key stays server-side, exactly as it did in n8n. Nothing here
// is reachable without a signed-in user who is a member of the workspace they
// name.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON_KEY     = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const ZERNIO_KEY   = process.env.ZERNIO_API_KEY || ''

// The actions this route answers. DERIVED from `handlers` rather than listed,
// because the two lists drifted the moment one was added: `followers` was
// written as a handler and not added here, so every call to it 404'd with
// "Unknown action: followers" while the code that answered it sat directly
// below, untouched and unreachable. A hand-kept allowlist beside a dispatch
// table is two statements of the same fact, and one of them is always the
// stale one.
//
// `handlers` is a const declared later in this module; this is only read
// inside the request handler, long after the module has finished evaluating.
export const isAction = name => Object.prototype.hasOwnProperty.call(handlers, name)

// ─── Supabase ──────────────────────────────────────────────────────────────
// Two identities, used deliberately:
//
//   asUser    the caller's own JWT, so RLS answers the question. This is what
//             proves membership — `workspaces` is SELECT-gated on
//             is_workspace_member(id), so a non-member gets zero rows without
//             this code having to know anything about roles.
//   asService the service key, for the two writes RLS would otherwise have to
//             be widened for. Only ever reached AFTER the membership check.
//
// The old n8n workflow took workspace_id straight off the request body and
// never checked it. Any signed-in user could list, and disconnect, any other
// workspace's accounts by editing one field.
async function supa(path, { token, method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON_KEY || SERVICE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`)
  try { return text ? JSON.parse(text) : null } catch { return null }
}

function bearerOf(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

async function authenticate(token) {
  if (!token) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const user = await res.json()
    return user?.id ? { id: user.id, token } : null
  } catch {
    // Supabase unreachable. Fail closed — the alternative is letting an
    // unverified caller reach an OAuth flow that connects real accounts.
    return null
  }
}

// Membership check and workspace read in one request, because RLS makes them
// the same request. Zero rows means "not a member" and "no such workspace"
// alike, and the caller is told the same thing either way: an error that
// distinguishes them is an existence oracle for other tenants' workspace ids.
async function loadWorkspace(workspaceId, token) {
  if (!/^[0-9a-f-]{36}$/i.test(String(workspaceId || ''))) return null
  const rows = await supa(
    `workspaces?id=eq.${workspaceId}&select=id,name,zernio_profile_id`, { token })
  return (Array.isArray(rows) && rows[0]) || null
}

// ─── Get-or-create this workspace's Zernio profile ─────────────────────────
//
// Idempotent and race-safe without a read-then-create, which two tabs would
// both pass before either wrote. Two things make that work:
//
//   1. The profile name is DERIVED from the workspace id, not chosen. Zernio
//      enforces name uniqueness per team, so a second create for the same
//      workspace is refused rather than silently producing a twin.
//   2. That refusal is a 409 carrying details.existingProfileId — the id the
//      winner got. The loser of the race gets the same answer, and nobody is
//      left holding an orphan profile.
async function ensureProfile(z, ws) {
  if (ws.zernio_profile_id) return ws.zernio_profile_id

  const name = `arak_ws_${ws.id}`
  let profileId
  try {
    const created = await z.request('profiles', {
      method: 'POST',
      body: { name, description: String(ws.name || 'Arak workspace').slice(0, 200) },
    })
    profileId = String(created?.profile?._id || created?._id || '')
  } catch (err) {
    const existing = err?.body?.details?.existingProfileId
    if (err.status === 409 && existing) profileId = String(existing)
    else throw err
  }
  if (!profileId) throw new ZernioError('Zernio created a profile but returned no id.')

  await supa(`workspaces?id=eq.${ws.id}`, {
    token: SERVICE_KEY, method: 'PATCH',
    body: { zernio_profile_id: profileId }, prefer: 'return=minimal',
  })
  return profileId
}

// ─── The account list every screen reads ───────────────────────────────────
//
// One place, so the tenancy filter and the shape conversion cannot disagree
// between the six actions that need them. Mirroring into social_accounts on
// the way through is what lets a screen list connected accounts without the
// Zernio key ever reaching a browser.
async function listAccounts(z, { workspaceId, profileId, mirror = true }) {
  const res = await z.request('accounts', { query: { profileId } })
  const owned = ownedByProfile(res.accounts || [], profileId)

  let connectedAt = {}
  if (mirror) {
    // Deliberately runs even when the list is EMPTY. An empty list is the
    // "I just disconnected the last account" case, and skipping the mirror
    // there is what would leave the row behind forever.
    try {
      connectedAt = await mirrorAccounts({ workspaceId, profileId, accounts: owned })
    } catch { /* the mirror is a cache; a failed write must not empty the list */ }
  }

  return owned.map(a => normalizeAccount(a, { connectedAt: connectedAt[String(a._id)] || null }))
}

async function mirrorAccounts({ workspaceId, profileId, accounts }) {
  const rows = accounts.map(a => {
    const n = normalizeAccount(a)
    return {
      workspace_id: workspaceId,
      zernio_account_id: n.zernio_account_id,
      zernio_profile_id: profileId,
      platform: n.platform,
      username: n.username,
      display_name: n.display_name,
      profile_picture: n.profile_picture,
      profile_url: n.profile_url,
      is_active: n.is_active,
      needs_reconnection: n.needs_reconnection,
      followers_count: n.followers_count,
      publish_provider: 'zernio',
      // Both defaulted in normalizeAccount, so the row written here and the
      // object handed to the browser cannot disagree about the same account.
      login_method: n.login_method,
      account_type: n.account_type,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    // Every row carries the SAME keys, deliberately. PostgREST refuses a bulk
    // insert whose objects differ in shape (PGRST102, "All object keys must
    // match"), so spreading a column in only for the platform that has one
    // turns any mixed-platform refresh — an Instagram account and a TikTok
    // account in one workspace, which is the normal case — into a 400 that
    // silently empties the mirror. Null where the column does not apply.
    // connected_at is deliberately ABSENT. This is an upsert with
    // merge-duplicates, so every column named here is rewritten on every
    // refresh — including it would reset the token clock on every page load
    // and hide exactly the accounts about to expire. Omitting it lets the
    // column's `default now()` fire on INSERT only, which is the write-once
    // semantics "how old is this token?" needs.
  }).filter(r => r.zernio_account_id)

  // ── Rows Zernio no longer has ────────────────────────────────────────────
  // Zernio is the authority on what is connected; social_accounts is a cache
  // of it. An account disconnected at zernio.com — or by another workspace
  // member in another tab — vanishes from the list above but would otherwise
  // sit in this table forever, showing up as a phantom account everywhere
  // that reads the table rather than the live list (analytics, mainly).
  //
  // Scoped to THIS profile's rows, which is what keeps it safe. Rows with a
  // different zernio_profile_id, or none at all, belong to another provider —
  // the Meta Graph path writes social_accounts rows too, and `zernio_account_id`
  // there holds an Instagram user id. Those are not ours to delete.
  const keep = rows.map(r => r.zernio_account_id)
  const notMine = keep.length
    ? `&zernio_account_id=not.in.(${keep.map(id => `"${id}"`).join(',')})`
    : ''
  //
  // The prune and the upsert touch disjoint rows — the prune deletes only ids
  // NOT in `keep`, the upsert writes only ids IN it — so they run together.
  // One after the other they were two more Supabase round trips stacked on
  // every account list, which every page asks for when it opens.
  const prune = supa(
    `social_accounts?workspace_id=eq.${workspaceId}`
    + `&zernio_profile_id=eq.${encodeURIComponent(profileId)}${notMine}`,
    { token: SERVICE_KEY, method: 'DELETE', prefer: 'return=minimal' },
  ).catch(() => { /* pruning is housekeeping; never let it block the live list */ })

  if (!rows.length) { await prune; return {} }

  const [written] = await Promise.all([
    supa('social_accounts?on_conflict=workspace_id,zernio_account_id', {
      token: SERVICE_KEY, method: 'POST', body: rows,
      prefer: 'resolution=merge-duplicates,return=representation',
    }),
    prune,
  ])
  const out = {}
  for (const r of written || []) out[String(r.zernio_account_id)] = r.connected_at
  return out
}

// account_id arrives from a browser, and Zernio scopes DELETE /accounts/{id}
// and the per-account reads to the API TEAM, not to a profile. Confirming the
// id appears in THIS profile's list is the whole of what makes them
// tenant-safe.
async function requireOwnedAccount(z, { workspaceId, profileId, accountId }) {
  const accounts = await listAccounts(z, { workspaceId, profileId, mirror: false })
  const found = accounts.find(a => a.zernio_account_id === accountId)
  if (!found) {
    const err = new Error('That account does not belong to this workspace.')
    err.httpStatus = 403
    throw err
  }
  return found
}

/**
 * The stored `is_protected` flag for an account.
 *
 * Read separately because it is OURS, not Zernio's: normalizeAccount builds
 * its object from Zernio's response, which has never heard of this column, so
 * an account arriving through requireOwnedAccount carries only the platform.
 * The platform alone already protects LinkedIn, but the flag is what lets a
 * person protect any other account without a deploy, and it would be quietly
 * inert if nothing ever read it.
 *
 * Fails CLOSED. If the lookup errors we return true — "we could not check"
 * has to mean protected, because the alternative is deleting a real company
 * page because a query timed out.
 */
async function isAccountProtected({ workspaceId, accountId }) {
  try {
    const rows = await supa(
      `social_accounts?workspace_id=eq.${workspaceId}` +
      `&zernio_account_id=eq.${encodeURIComponent(accountId)}&select=is_protected&limit=1`,
      { token: SERVICE_KEY },
    )
    return rows?.[0]?.is_protected === true
  } catch {
    return true
  }
}

// Every read in a plan, each failing on its own: a rate limit on best-time
// must not blank the follower chart. A failed read comes back as { _error }.
async function readPlan(z, plan) {
  const results = await Promise.all(plan.requests.map(r =>
    retryRateLimited(() => z.request(r.path, { query: r.query }))
      .catch(err => ({ _error: explainZernioError(err) }))))
  return { plan, results }
}

// Whether a plan built from the browser's hint makes the same reads as one
// built from the verified account. For LinkedIn the account type decides it:
// a company page gets the page reads, a personal profile does not.
function samePlanShape(hint, actual) {
  if (hint.platform !== actual.platform) return false
  if (actual.platform !== 'linkedin') return true
  return (hint.accountType === 'personal') === (actual.accountType === 'personal')
}

// ─── Actions ───────────────────────────────────────────────────────────────

const handlers = {
  async accounts(z, { ws, profileId }) {
    return { accounts: await listAccounts(z, { workspaceId: ws.id, profileId }) }
  },

  async connect_url(z, { profileId, body }) {
    const platform = String(body.platform || '').toLowerCase()
    const spec = CONNECT_SPECS[platform]
    if (!spec) {
      return fail(`${platform || 'That platform'} cannot be connected yet.`, 400)
    }
    const redirectUrl = String(body.redirect_url || '').trim()
    // Zernio rejects a relative path with 400 INVALID_REDIRECT_URL, and the
    // absolute URL is what makes preview deployments and localhost return to
    // themselves instead of to production.
    if (!/^https?:\/\//i.test(redirectUrl)) {
      return fail('redirect_url must be an absolute http(s) URL.', 400)
    }

    const res = await z.request(`connect/${encodeURIComponent(platform)}`, {
      query: {
        profileId,
        redirect_url: redirectUrl,
        ...(spec.headless ? { headless: 'true' } : {}),
        ...(spec.connectParams || {}),
      },
    })
    const authUrl = String(res.authUrl || res.url || '')
    if (!authUrl) throw new ZernioError('Zernio returned no authorisation URL.')
    return { auth_url: authUrl, state: res.state || '', headless: !!spec.headless }
  },

  async selection_options(z, { profileId, body }) {
    const { spec, args, error } = selectionArgs(profileId, body)
    if (error) return error
    return { options: await spec.selection.options(z, args) }
  },

  async selection_complete(z, { ws, profileId, body }) {
    const { spec, args, error } = selectionArgs(profileId, body)
    if (error) return error

    const choice = body.selection || null
    const choiceId = String(choice?.id || choice?._id || choice || '').trim()
    if (!choiceId) return fail('The chosen option has no id.', 400)

    await spec.selection.complete(z, { ...args, choice, choiceId })

    // Re-list rather than trusting the completion response to describe the new
    // account. This is the moment social_accounts must become correct, and one
    // authoritative read is cheaper to reason about than merging two shapes.
    return { accounts: await listAccounts(z, { workspaceId: ws.id, profileId }) }
  },

  async disconnect(z, { ws, profileId, body }) {
    const accountId = String(body.account_id || '').trim()
    if (!accountId) return fail('account_id is required.', 400)
    const account = await requireOwnedAccount(z, { workspaceId: ws.id, profileId, accountId })

    // ── Protected accounts ──
    // Checked HERE, server-side, because this is the only place the browser
    // cannot route around. The UI hides the button too, but a hidden button is
    // a courtesy and this is the guarantee: disconnecting ARAK's real LinkedIn
    // page deletes it at Zernio, which is not something a stray click on a
    // shared laptop should be able to do. See src/lib/platformSafety.js.
    const protectedRow = await isAccountProtected({ workspaceId: ws.id, accountId })
    if (!mayDisconnect({ ...account, is_protected: protectedRow })) {
      return fail(protectionReason(account), 403)
    }

    await z.request(`accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' })

    // Local row goes only after Zernio confirms. The other order leaves an
    // account live at the provider that the UI swears is gone — and the next
    // refresh would resurrect the row anyway.
    await supa(
      `social_accounts?workspace_id=eq.${ws.id}&zernio_account_id=eq.${encodeURIComponent(accountId)}`,
      { token: SERVICE_KEY, method: 'DELETE', prefer: 'return=minimal' },
    )
    return { disconnected: accountId }
  },

  // TikTok requires privacy_level on every post, drawn from the levels THIS
  // creator is allowed to use — a private account cannot post publicly, and
  // sending a level it does not allow fails the post. So the composer cannot
  // offer the choice until this answers.
  async creator_info(z, { ws, profileId, body }) {
    const accountId = String(body.account_id || '').trim()
    const mediaType = String(body.media_type || 'video').trim()
    if (!accountId) return fail('account_id is required.', 400)
    await requireOwnedAccount(z, { workspaceId: ws.id, profileId, accountId })

    // Zernio's own docs disagree with themselves here: the platform guide
    // documents /tiktok/creator-info and the API reference /tiktok-creator-info.
    // Try one, fall back on 404. Collapse to one call once it is known which
    // is real.
    const paths = [
      `accounts/${encodeURIComponent(accountId)}/tiktok/creator-info`,
      `accounts/${encodeURIComponent(accountId)}/tiktok-creator-info`,
    ]
    let info = null, lastErr = null
    for (const path of paths) {
      try { info = await z.request(path, { query: { mediaType } }); break }
      catch (err) { lastErr = err; if (err.status !== 404) throw err }
    }
    if (!info) throw lastErr || new ZernioError('Could not read TikTok creator info.')

    const data = info.creatorInfo || info.data || info
    const levels = data.privacy_level_options || data.privacyLevelOptions || data.privacyLevels || []
    return {
      privacyLevels: Array.isArray(levels) ? levels : [],
      nickname: data.creator_nickname || data.nickname || '',
      maxVideoSeconds: Number(data.max_video_post_duration_sec || 0) || null,
      commentDisabled: data.comment_disabled === true,
      duetDisabled: data.duet_disabled === true,
      stitchDisabled: data.stitch_disabled === true,
    }
  },

  // One account's analytics, for a platform page's Analytics tab. The same
  // response shape as the Zernio Dashboard n8n workflow, so both screens draw
  // with one component — but served from here, where the account is first
  // proven to be this workspace's. The workflow takes account_id on trust.
  //
  // The reads start alongside the ownership check instead of after it, planned
  // from the platform the browser says the account is on. Nothing is returned
  // until the check passes, so a foreign account's numbers would be fetched
  // and thrown away with a 403, never shown. It is worth it because the check
  // is a full Zernio account list, which used to stand in front of every tab
  // load. The hint only chooses WHICH reads to make; if it is wrong, they are
  // made again from the verified account.
  async analytics(z, { ws, profileId, body }) {
    const accountId = String(body.account_id || '').trim()
    if (!accountId) return fail('account_id is required.', 400)

    const hint = { platform: String(body.platform || '').toLowerCase(), accountType: body.account_type || null }
    // The window travels as it was chosen: `days` for a rolling one, `from`
    // and `to` for a fixed one. Resolving a preset here rather than in the
    // browser keeps it on the server's clock — see src/lib/dateRange.js.
    const window = { days: body.days, from: body.from, to: body.to }
    const early = hint.platform ? readPlan(z, analyticsPlan({ ...hint, accountId, ...window })) : null
    const account = await requireOwnedAccount(z, { workspaceId: ws.id, profileId, accountId })

    const actual = { platform: account.platform, accountType: account.account_type || null }
    const { plan, results } = early && samePlanShape(hint, actual)
      ? await early
      : await readPlan(z, analyticsPlan({ ...actual, accountId, ...window }))

    return {
      account,
      platform: account.platform,
      days: plan.days,
      fromDate: plan.fromDate,
      toDate: plan.toDate,
      insightsFrom: plan.insightsFrom,
      metricsSupported: plan.metricsSupported,
      ...Object.fromEntries(plan.requests.map((r, i) => [r.key, results[i]])),
    }
  },

  // Just the follower series, for the Follower history card's own range
  // picker. Same ownership proof as `analytics`, two Zernio reads instead of
  // nine — see followerPlan for why it is not that route with a different
  // window.
  async followers(z, { ws, profileId, body }) {
    const accountId = String(body.account_id || '').trim()
    if (!accountId) return fail('account_id is required.', 400)

    const account = await requireOwnedAccount(z, { workspaceId: ws.id, profileId, accountId })
    const plan = followerPlan({
      platform: account.platform, accountId,
      days: body.days, from: body.from, to: body.to,
    })
    const { results } = await readPlan(z, plan)

    return {
      platform: account.platform,
      days: plan.days,
      fromDate: plan.fromDate,
      toDate: plan.toDate,
      ...Object.fromEntries(plan.requests.map((r, i) => [r.key, results[i]])),
    }
  },

  // "Refresh from Zernio". The account list is re-read and mirrored (follower
  // counts, dead tokens), then each account's posts are fetched from the
  // platform now rather than on Zernio's ~90-minute cycle — see
  // syncAccountPosts. `account_id` narrows it to one account, for a platform
  // page's Analytics tab; without it every account in the workspace is asked.
  //
  // post_analytics, the stored copy the assistant reads, is still written by
  // the n8n Zernio Sync. The browser fires that alongside this rather than
  // through it: it takes far longer, and a page must not wait on it to show
  // the numbers this already refreshed.
  async sync(z, { ws, profileId, body }) {
    const accounts = await listAccounts(z, { workspaceId: ws.id, profileId })
    const only = String(body.account_id || '').trim()
    if (only && !accounts.some(a => a.zernio_account_id === only)) {
      return fail('That account does not belong to this workspace.', 403)
    }
    const targets = only ? accounts.filter(a => a.zernio_account_id === only) : accounts
    return {
      accounts,
      synced: await syncAccountPosts(z, targets),
      synced_at: new Date().toISOString(),
    }
  },

  // Meta exposes only the audio it has CLEARED for third-party publishing, so
  // this catalog is a subset of what the Instagram app shows. Omitting `q`
  // returns trending, the better default for a picker that opens empty.
  async audio_search(z, { ws, profileId, body }) {
    const accountId = String(body.account_id || '').trim()
    if (!accountId) return fail('account_id is required.', 400)
    await requireOwnedAccount(z, { workspaceId: ws.id, profileId, accountId })

    const query = String(body.q || '').trim()
    let res
    try {
      res = await z.request(`accounts/${encodeURIComponent(accountId)}/instagram/audio`, {
        query: { audioType: String(body.audio_type || 'music').trim(), q: query },
      })
    } catch (err) {
      // The one failure worth naming separately, because it is a CONNECTION
      // problem rather than a search problem: no retry and no rephrasing will
      // help, only reconnecting with Facebook access.
      if (/instagram_audio_requires_facebook_login/i.test(`${err.code} ${err.message}`)) {
        return { ok: false, needsReconnect: true, error: explainZernioError(err) }
      }
      throw err
    }

    const items = res.audio || res.audios || res.items || res.results || res.data || []
    return {
      trending: !query,
      audio: (Array.isArray(items) ? items : []).map(a => ({
        audioId: String(a.audioId || a.id || a._id || ''),
        title: String(a.title || a.name || ''),
        artist: String(a.artist || a.artistName || a.creator || ''),
        // Seconds. Zernio reports milliseconds on some shapes and seconds on
        // others; normalised here so the picker does not have to guess.
        duration: Number(a.durationSeconds || (a.durationMs ? a.durationMs / 1000 : 0) || a.duration || 0) || null,
        // Preview only, and short-lived (roughly a day and a half). Never
        // stored on a post row: a saved draft must re-fetch rather than hold
        // a dead URL.
        previewUrl: String(a.downloadUrl || a.previewUrl || ''),
        coverUrl: String(a.coverUrl || a.thumbnailUrl || ''),
      })).filter(a => a.audioId),
    }
  },

  // ── Auto-replies ─────────────────────────────────────────────────────────
  //
  // Keyword-triggered DMs: someone comments (or messages) a word, they get a
  // reply. Zernio runs the whole thing — it holds the automations, watches the
  // comments, sends the DMs and keeps the logs — so none of this is mirrored
  // into Supabase. A local copy would be a second version of a record we do
  // not own and cannot keep in step: Zernio's webhook fires on a comment we
  // never see, and the row it writes would be invisible here until something
  // re-read it anyway.
  //
  // ── ISOLATION ──
  // `profileId` is per workspace (see ensureProfile), and Zernio's list is
  // filtered by it, so listing cannot cross a workspace. Everything addressed
  // by automation id goes through requireOwnedAutomation instead, because an
  // id is guessable and the id alone says nothing about who owns it.
  //
  // Instagram and Facebook only — Zernio's own limit, not ours. The screen
  // says so rather than offering an account the create call would reject.

  async auto_replies(z, { ws, profileId, body }) {
    const accountId = String(body.account_id || '').trim()
    if (accountId) await requireOwnedAccount(z, { workspaceId: ws.id, profileId, accountId })

    const out = await z.request('comment-automations', { query: { profileId } })
    const all = Array.isArray(out?.automations) ? out.automations : []
    return {
      automations: (accountId ? all.filter(a => String(a.accountId || '') === accountId) : all)
        .map(normalizeAutomation),
    }
  },

  // Create when there is no id, update when there is. One action rather than
  // two because the editor is one form: splitting them would put the same
  // twelve fields through two validations that have to agree.
  async auto_reply_save(z, { ws, profileId, body }) {
    const id = String(body.id || '').trim()
    const fields = automationFields(body)
    if (fields.__fail) return fields

    if (id) {
      await requireOwnedAutomation(z, { workspaceId: ws.id, profileId, automationId: id })
      const out = await z.request(`comment-automations/${encodeURIComponent(id)}`, {
        method: 'PATCH', body: fields,
      })
      return { automation: normalizeAutomation(out?.automation || out) }
    }

    const accountId = String(body.account_id || '').trim()
    if (!accountId) return fail('Pick the account this should run on.', 400)
    const account = await requireOwnedAccount(z, { workspaceId: ws.id, profileId, accountId })
    if (!AUTO_REPLY_PLATFORMS.includes(account.platform)) {
      return fail(
        `Auto-replies only work on Instagram and Facebook — ${account.platform} cannot be automated this way.`,
        400,
      )
    }

    const out = await z.request('comment-automations', {
      method: 'POST',
      body: { profileId, accountId, ...fields },
    })
    return { automation: normalizeAutomation(out?.automation || out) }
  },

  async auto_reply_delete(z, { ws, profileId, body }) {
    const id = String(body.id || '').trim()
    if (!id) return fail('id is required.', 400)
    await requireOwnedAutomation(z, { workspaceId: ws.id, profileId, automationId: id })
    await z.request(`comment-automations/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return { deleted: id }
  },

  // The logs AND the misses. `misses` is the only signal that a keyword is
  // catching nothing — non-matching comments produce no log row — so it is
  // fetched here rather than left for somebody to discover in the API.
  async auto_reply_logs(z, { ws, profileId, body }) {
    const id = String(body.id || '').trim()
    if (!id) return fail('id is required.', 400)
    await requireOwnedAutomation(z, { workspaceId: ws.id, profileId, automationId: id })

    const out = await z.request(`comment-automations/${encodeURIComponent(id)}/logs`, {
      query: { limit: Math.min(Number(body.limit) || 50, 100), skip: Number(body.skip) || 0 },
    })
    return {
      logs: (Array.isArray(out?.logs) ? out.logs : []).map(l => ({
        id: String(l.id || ''),
        commenterName: String(l.commenterName || ''),
        commentText: String(l.commentText || ''),
        source: String(l.source || 'comment'),
        status: String(l.status || ''),
        error: String(l.error || ''),
        commentReplyStatus: String(l.commentReplyStatus || ''),
        nextDueAt: l.nextDueAt || null,
        createdAt: l.createdAt || null,
      })),
      misses: {
        total: Number(out?.misses?.total) || 0,
        retentionDays: Number(out?.misses?.retentionDays) || 0,
        samples: (out?.misses?.samples || []).slice(0, 5).map(s =>
          String(typeof s === 'string' ? s : (s?.commentText || s?.text || ''))).filter(Boolean),
      },
      pagination: out?.pagination || null,
    }
  },
}

// Zernio automates comments on these two and refuses the rest. LinkedIn — this
// brand's best channel — is not among them, which the screen has to say out
// loud rather than let somebody build an automation that never fires.
const AUTO_REPLY_PLATFORMS = ['instagram', 'facebook']

/** One automation, in this app's shape. Zernio omits fields rather than nulling them. */
function normalizeAutomation(a = {}) {
  const stats = a.stats || {}
  return {
    id: String(a.id || a._id || ''),
    name: String(a.name || ''),
    platform: String(a.platform || '').toLowerCase(),
    account_id: String(a.accountId || ''),
    trigger: String(a.trigger || 'comment'),
    // Absent means account-wide — every post — which is the common case and
    // must not be shown as "post (blank)".
    platform_post_id: String(a.platformPostId || ''),
    post_title: String(a.postTitle || ''),
    keywords: Array.isArray(a.keywords) ? a.keywords.map(String) : [],
    match_mode: String(a.matchMode || 'contains'),
    exclude_keywords: Array.isArray(a.excludeKeywords) ? a.excludeKeywords.map(String) : [],
    typo_tolerance: a.typoTolerance === true,
    dm_message: String(a.dmMessage || ''),
    comment_reply: String(a.commentReply || ''),
    also_match_in_dms: a.alsoMatchInDms === true,
    is_active: a.isActive !== false,
    created_at: a.createdAt || null,
    stats: {
      triggered: Number(stats.triggered) || 0,
      dmsSent: Number(stats.dmsSent) || 0,
      dmsFailed: Number(stats.dmsFailed) || 0,
      uniqueContacts: Number(stats.uniqueContacts) || 0,
    },
  }
}

/**
 * The editable fields, validated once for both create and update.
 *
 * Zernio's own limits are enforced here rather than left to a 400 from it: a
 * refusal that arrives after the request has crossed the internet reads as
 * "something went wrong", and the thing that went wrong was a character count
 * the browser could have counted.
 */
function automationFields(body = {}) {
  const name = String(body.name || '').trim()
  const dmMessage = String(body.dm_message || '').trim()
  const keywords = cleanList(body.keywords)
  const excludeKeywords = cleanList(body.exclude_keywords)
  const matchMode = body.match_mode === 'word' ? 'word' : 'contains'

  if (!name) return fail('Give this auto-reply a name, so you can find it later.', 400)
  if (!dmMessage) return fail('Write the message that gets sent.', 400)
  if (dmMessage.length > 1000) {
    return fail(`The message is ${dmMessage.length} characters; Instagram allows about 1,000.`, 400)
  }
  // `alsoMatchInDms` on an empty keyword list would answer EVERY incoming
  // message, which is a different product and not one anybody asked for.
  if (body.also_match_in_dms && !keywords.length) {
    return fail('Add at least one keyword before answering direct messages, or every message gets a reply.', 400)
  }
  // Only meaningful with whole-word matching; sending it otherwise is a silent
  // no-op that looks switched on in the editor next time it opens.
  const typoTolerance = matchMode === 'word' && body.typo_tolerance === true

  return {
    name,
    keywords,
    matchMode,
    excludeKeywords,
    typoTolerance,
    dmMessage,
    commentReply: String(body.comment_reply || '').trim(),
    alsoMatchInDms: body.also_match_in_dms === true,
    ...(body.is_active === undefined ? {} : { isActive: body.is_active !== false }),
  }
}

/** Trimmed, de-duplicated, case-insensitively unique, blanks dropped. */
function cleanList(raw) {
  const seen = new Set()
  const out = []
  for (const item of Array.isArray(raw) ? raw : String(raw || '').split(',')) {
    const v = String(item || '').trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

/**
 * Prove an automation belongs to this workspace before touching it.
 *
 * Zernio scopes an automation to a profile, and a profile to a workspace — but
 * the update, delete and log endpoints are addressed by automation id alone
 * and will answer for any id the API key can see. The API key is the
 * deployment's, not the workspace's, so without this a workspace could read
 * another's logs (which contain commenter names and message text) by guessing
 * an id. The read is one extra round trip and is not optional.
 */
async function requireOwnedAutomation(z, { workspaceId, profileId, automationId }) {
  const out = await z.request(`comment-automations/${encodeURIComponent(automationId)}`)
  const automation = out?.automation || out || {}
  const accountId = String(automation.accountId || '')
  if (!accountId) {
    const err = new Error('That auto-reply could not be found.')
    err.httpStatus = 404
    throw err
  }
  await requireOwnedAccount(z, { workspaceId, profileId, accountId })
  return automation
}

// Both selection actions take the same arguments and make the same four
// mistakes available, so they are validated once. `needs` comes from the
// platform's own spec: Instagram carries its tokens inline on the callback,
// LinkedIn carries a pendingDataToken and nothing else.
function selectionArgs(profileId, body) {
  const platform = String(body.platform || '').toLowerCase()
  const spec = CONNECT_SPECS[platform]
  if (!spec) return { error: fail(`${platform || 'That platform'} cannot be connected yet.`, 400) }
  if (!spec.selection) {
    return { error: fail(`${spec.label} finishes at the callback — there is nothing to select.`, 400) }
  }

  const args = {
    profileId,
    tempToken: String(body.temp_token || '').trim(),
    connectToken: String(body.connect_token || '').trim(),
    pendingDataToken: String(body.pending_data_token || '').trim(),
    // Only the fallback LinkedIn shape and Snapchat need this off the URL;
    // the documented LinkedIn path reads it from the pending payload instead,
    // which is authoritative where a query param is not.
    userProfile: body.user_profile && typeof body.user_profile === 'object' ? body.user_profile : null,
  }

  // `requires` is a list of alternative field sets — the callback satisfies
  // the step if it carries all of any one of them. The message names what was
  // missing from the first (documented) shape rather than saying "invalid",
  // because that is the thing someone debugging a live connect needs to see.
  const groups = spec.selection.requires
  if (!groups.some(group => group.every(key => args[key]))) {
    return { error: fail(
      `This ${spec.label} connection came back without ${groups[0].join(' and ')}. Start again.`, 400) }
  }

  // The profile named by the callback must be THIS workspace's. Zernio issued
  // the flow against a profileId; a mismatch means the browser has crossed a
  // wire, and completing would attach an account to the wrong tenant.
  // (LinkedIn's equivalent check happens against the pending-data payload,
  // which is authoritative where a URL param is not.)
  const fromCallback = String(body.profile_id || '').trim()
  if (fromCallback && fromCallback !== String(profileId)) {
    return { error: fail('This connection was started for a different workspace. Start again from this one.', 403) }
  }
  return { spec, args }
}

function fail(message, status = 400) {
  return { __fail: true, status, error: message }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'POST only' })
  }

  const action = String(req.query?.action || '')
  if (!isAction(action)) {
    return res.status(404).json({ ok: false, error: `Unknown action: ${action || '(none)'}` })
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(503).json({
      ok: false,
      error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set on this deployment.',
    })
  }
  if (!ZERNIO_KEY) {
    return res.status(503).json({
      ok: false,
      error: 'ZERNIO_API_KEY is not set on this deployment, so no account can be connected. ' +
             'Add it to the Vercel project environment and redeploy.',
    })
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const workspaceId = String(body.workspace_id || '').trim()
  const token = bearerOf(req)

  // Sign-in and membership are checked at the same time rather than in turn:
  // both are Supabase round trips, and in sequence they were two of the four
  // stacked in front of every account list. The workspace read uses the
  // caller's own token, so an invalid token reads nothing — and its result is
  // discarded anyway when the sign-in check fails.
  const [user, wsRead] = await Promise.all([
    authenticate(token),
    token
      ? loadWorkspace(workspaceId, token).then(ws => ({ ws }), error => ({ error }))
      : Promise.resolve({ ws: null }),
  ])
  if (!user) {
    return res.status(401).json({
      ok: false,
      error: 'Sign in to do this. If you are signed in, your session expired — reload the page.',
    })
  }

  try {
    if (wsRead.error) throw wsRead.error
    const ws = wsRead.ws
    if (!ws) {
      return res.status(403).json({ ok: false, error: 'You do not have access to that workspace.' })
    }

    const z = createZernio({ apiKey: ZERNIO_KEY })
    const profileId = await ensureProfile(z, ws)
    const out = await handlers[action](z, { ws, profileId, body })

    if (out && out.__fail) return res.status(out.status).json({ ok: false, error: out.error })
    return res.status(200).json({ ok: true, profile_id: profileId, ...out })
  } catch (err) {
    // Everything reaches the browser as ok:false with a reason. The n8n
    // version had to do this because a thrown node error arrived as an empty
    // HTTP 200; here it is a choice, and the reason is the point — "Connect
    // failed" with no explanation is the single most annoying thing this
    // screen can say.
    const status = err.httpStatus || (err instanceof ZernioError ? (err.status >= 400 && err.status < 600 ? err.status : 502) : 500)
    return res.status(status).json({
      ok: false,
      error: err instanceof ZernioError ? explainZernioError(err) : String(err.message || err),
    })
  }
}

export { qs, profileIdOf, CONNECTABLE }
export { automationFields, cleanList, normalizeAutomation, AUTO_REPLY_PLATFORMS }
