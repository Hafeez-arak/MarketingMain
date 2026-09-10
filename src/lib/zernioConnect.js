import { isLivePlatform, PLATFORM_META } from './utils'

// ─── Per-workspace account connection ──────────────────────────────────────
// Everything here talks to /api/zernio/<action>, this app's own serverless
// routes. The browser never sees the Zernio API key, same as every other
// provider in this project.
//
// It used to talk to an n8n workflow. That moved for two reasons: deploying a
// workflow change means a git pull and a redeploy script on the WSL2 box,
// which is the wrong loop for something as fiddly as OAuth; and the workflow's
// logic could only be exercised against a real connected account, which is how
// a filter that discarded EVERY account survived two rounds of review. See
// api/zernio/_zernio.js.
//
// The tenancy model, briefly, because it is the whole point: Zernio puts a
// `profile` between the API team and the connected accounts. Each workspace
// gets one (created on first connect, id kept in workspaces.zernio_profile_id)
// and every call below is scoped by it — so a workspace can only see, post as,
// and disconnect its own accounts, and nobody has to touch zernio.com.

async function call(action, payload) {
  try {
    const res = await fetch(`/api/zernio/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => null)
    if (!data) {
      return { error: `The server returned ${res.status} with nothing in it.` }
    }
    // Every route answers with a reason rather than a bare status, so the
    // status itself is never what gets shown.
    if (data.ok === false || !res.ok) return { error: data.error || `Request failed (${res.status}).` }
    return data
  } catch (err) {
    return { error: `Could not reach the server: ${err.message}` }
  }
}

// List this workspace's connected accounts. Returns [] rather than an error
// when nothing is connected yet — "no accounts" is a normal state for a new
// workspace, not a failure.
export async function fetchConnectedAccounts(workspaceId) {
  const res = await call('accounts', { workspace_id: workspaceId })
  if (res.error) return { error: res.error, accounts: [] }
  return { accounts: res.accounts || [], profileId: res.profile_id || '' }
}

// Where the OAuth round trip comes back to. Built from the CURRENT origin
// rather than an env var so that preview deployments, localhost and production
// each return to themselves — an env var would send every preview's callback
// to production, where the tokens mean nothing.
//
// No query string of our own. Zernio appends its result params with the URL
// API, which preserves an existing query — but its success param is literally
// `connected=<platform>`, and the old callback URL ended in `?connected=1`.
// The two collided into `?connected=1&connected=instagram`, so the one param
// that says which platform just connected was shadowed by a constant.
export function connectCallbackUrl(platform) {
  return `${window.location.origin}/social/${platform}`
}

// Step 1: ask Zernio for an authorisation URL and hand it to the browser.
//
// The caller navigates; this deliberately does NOT navigate itself, so the
// screen can show a "redirecting…" state and so tests can assert the URL
// without a jsdom navigation.
export async function startConnect(workspaceId, platform) {
  if (!isLivePlatform(platform)) {
    const label = PLATFORM_META[platform]?.label || platform
    return { error: `${label} is not available yet.` }
  }
  const res = await call('connect_url', {
    workspace_id: workspaceId,
    platform,
    redirect_url: connectCallbackUrl(platform),
  })
  if (res.error) return { error: res.error }
  return { authUrl: res.auth_url, headless: res.headless === true, state: res.state || '' }
}

// ─── Reading the hop back ──────────────────────────────────────────────────
//
// Zernio returns the browser to redirect_url in one of three states, and the
// previous version recognised only one of them:
//
//   error      OAuth was denied, or the account was ineligible. `error` and
//              `platform` are always present; error_message, is_user_fixable,
//              reason and dashboard_url are conditional. NOTHING read these,
//              so a refused connection came back to a page that looked exactly
//              as it had before the user left it. That is the "it opens the
//              OAuth screen and then it just stays as it is" symptom, and it
//              was indistinguishable from the account-list bug behind it.
//
//   selection  headless mode, second choice still to make. Instagram carries
//              its tokens inline (tempToken + connect_token); LinkedIn's org
//              list is too big for a URL, so it carries a pendingDataToken and
//              the payload is fetched server-side — which is strictly better,
//              since the LinkedIn access token never enters the browser.
//
//   connected  standard mode, already done. TikTok lands here. Nothing to
//              finish, but the list must be refreshed and the user told which
//              account arrived, rather than left to infer it from a row
//              appearing.
//
// Anything else is not a callback and returns null — a plain visit to
// /social/instagram must not open a picker.
export function readConnectCallback(search = window.location.search) {
  const q = new URLSearchParams(search)
  const platform = (q.get('platform') || '').toLowerCase()

  const error = q.get('error') || ''
  if (error) {
    return {
      kind: 'error',
      platform,
      error,
      errorMessage: q.get('error_message') || '',
      // Zernio documents these as conditional, so they are read as optional
      // rather than relied on. `is_user_fixable` decides whether the screen
      // offers "try again" or tells someone to go fix something first.
      isUserFixable: q.get('is_user_fixable') === 'true',
      reason: q.get('reason') || '',
      dashboardUrl: q.get('dashboard_url') || '',
    }
  }

  const tempToken = q.get('tempToken') || ''
  const connectToken = q.get('connect_token') || ''
  const pendingDataToken = q.get('pendingDataToken') || ''

  // Either token makes this a selection callback. Which fields a given
  // platform actually needs is the server's question — Instagram wants both
  // tokens, LinkedIn wants the pending-data pointer — and answering it here
  // would put the same knowledge in two places for them to drift apart in.
  //
  // Note what changed: an earlier version required tempToken AND connect_token
  // and returned null otherwise, so a callback missing one of them rendered as
  // nothing at all. Recognising it and letting the server say exactly which
  // field is absent is worse-looking and far more useful — silence is the
  // failure mode this whole rebuild is about.
  if (pendingDataToken || tempToken) {
    return {
      kind: 'selection',
      platform,
      tempToken,
      connectToken,
      pendingDataToken,
      profileId: q.get('profileId') || '',
      step: q.get('step') || '',
      userProfile: parseUserProfile(q.get('userProfile')),
    }
  }

  const connected = q.get('connected') || ''
  if (connected) {
    return {
      kind: 'connected',
      platform: platform || connected.toLowerCase(),
      accountId: q.get('accountId') || '',
      username: q.get('username') || '',
      profileId: q.get('profileId') || '',
    }
  }

  return null
}

// A malformed value must degrade to null rather than throw and strand someone
// holding tokens they cannot use. Only Snapchat's completion endpoint still
// needs this off the URL; LinkedIn's arrives with the pending data instead.
function parseUserProfile(raw) {
  if (!raw) return null
  try { return JSON.parse(decodeURIComponent(raw)) } catch { return null }
}

// ─── What a failed round trip means ────────────────────────────────────────
// Zernio's list is documented as non-exhaustive and may grow at any time, so
// an unrecognised code falls through to a generic sentence carrying whatever
// error_message came with it — never matched exhaustively, never swallowed.
const OAUTH_ERRORS = {
  oauth_denied: 'You cancelled the authorisation, or the platform refused it.',
  personal_account_not_supported:
    'That is a personal account. Instagram only publishes from a professional (Business or Creator) account linked to a Facebook Page — convert it in the Instagram app, then try again.',
  no_facebook_pages:
    'That Facebook login manages no Page with a linked Instagram professional account, so there was nothing to connect.',
  facebook_pages_error: 'Facebook would not list your Pages. Try again in a moment.',
  no_snapchat_public_profiles:
    'That Snapchat login has no Public Profile, and Snapchat requires one to publish.',
  invalid_state: 'The connection took too long and expired. Start it again.',
  invalid_callback: 'The platform sent back something we could not read. Start again.',
  token_exchange_failed: 'The platform accepted the login but refused to issue a token. Start again.',
  connection_failed: 'The platform refused the connection. Start again.',
  reconnect_account_mismatch:
    'That is a different account from the one being reconnected. Sign in as the same account, or disconnect the old one first.',
  account_limit_exceeded: 'The Zernio plan has no room for another connected account.',
  profile_limit_exceeded: 'The Zernio plan has no room for another workspace profile.',
  payment_required: 'Zernio refused this because the plan does not cover it — check billing at zernio.com.',
  access_denied: 'This Zernio API key has no access to that profile.',
  platform_requires_destination:
    'That platform needs a page or profile chosen after login, and this app has no screen for it yet.',
  connection_cancelled: 'The window was closed before the connection finished. Start again.',
  unsupported_platform: 'Zernio does not support connecting that platform this way.',
  internal_error: 'Zernio hit an internal error. Try again in a moment.',
}

export function explainOAuthError(cb) {
  const label = PLATFORM_META[cb?.platform]?.label || cb?.platform || 'That platform'
  const known = OAUTH_ERRORS[String(cb?.error || '').toLowerCase()]
  if (known) return known
  const detail = cb?.errorMessage ? ` (${cb.errorMessage})` : ''
  return `${label} did not finish connecting: ${cb?.error || 'unknown error'}${detail}.`
}

// ─── The second step, where a platform has one ─────────────────────────────

export async function fetchSelectionOptions(workspaceId, platform, cb) {
  const res = await call('selection_options', {
    workspace_id: workspaceId,
    platform: platform || cb.platform,
    ...selectionPayload(cb),
  })
  if (res.error) return { error: res.error, options: [] }
  return { options: res.options || [] }
}

export async function completeSelection(workspaceId, platform, { cb, selection }) {
  const res = await call('selection_complete', {
    workspace_id: workspaceId,
    platform: platform || cb.platform,
    ...selectionPayload(cb),
    selection,
  })
  if (res.error) return { error: res.error }
  return { accounts: res.accounts || [] }
}

// Whatever the callback happened to carry, forwarded verbatim. The server
// decides which of these a given platform actually needs — the browser knowing
// that Instagram wants tokens and LinkedIn wants a pending-data token would be
// the same knowledge in two places, and the two would drift.
function selectionPayload(cb) {
  return {
    temp_token: cb.tempToken || '',
    connect_token: cb.connectToken || '',
    pending_data_token: cb.pendingDataToken || '',
    profile_id: cb.profileId || '',
    step: cb.step || '',
    user_profile: cb.userProfile || null,
  }
}

// ── Instagram catalog audio ───────────────────────────────────────────────
// Searches the audio Meta has CLEARED for third-party publishing. That is a
// subset of what the Instagram app shows — the trending sound of a given week
// usually is not in it — and saying so in the UI is kinder than letting
// someone search for a track that was never reachable.
//
// Omitting `query` returns trending, which is the better default for a picker
// that opens with nothing typed.
//
// `needsReconnect` is a distinct outcome rather than a generic error because
// the fix is different: the account was connected without Facebook access,
// which Instagram requires for catalog audio, and no amount of retrying or
// rephrasing the search will change that.
export async function searchInstagramAudio(workspaceId, accountId, { query = '', audioType = 'music' } = {}) {
  const res = await call('audio_search', {
    workspace_id: workspaceId, account_id: accountId, q: query, audio_type: audioType,
  })
  if (res.error) return { error: res.error, needsReconnect: res.needsReconnect === true, audio: [] }
  if (res.ok === false) return { error: res.error, needsReconnect: res.needsReconnect === true, audio: [] }
  return { audio: res.audio || [], trending: res.trending === true }
}

// Can this account attach catalog audio at all? Answered from the connection
// method we recorded, before the composer offers the picker — the alternative
// is offering it to every account and letting Instagram refuse half of them
// after the Reel is already composed.
//
// A null login_method means the row predates our recording it, which is read
// as "no". That is the safe direction: a missing button is a question someone
// asks, an unusable button is a Reel that fails at publish.
export function supportsCatalogAudio(account) {
  return account?.platform === 'instagram' && account?.login_method === 'facebook_login'
}

// ── TikTok creator info ───────────────────────────────────────────────────
// Called before a TikTok post can be composed, not as an enhancement. TikTok
// requires `privacy_level` on every post and it must be one of the levels THIS
// creator is allowed to use — so until this returns, the composer genuinely
// does not know what to offer. A private account cannot post publicly, and
// defaulting to the most public value is how you learn that expensively.
//
// An empty privacyLevels list is information, not a failure — it means TikTok
// is currently refusing this account, which the panel renders as "needs
// reconnecting" rather than as an error.
export async function fetchCreatorInfo(workspaceId, accountId, mediaType = 'video') {
  const res = await call('creator_info', {
    workspace_id: workspaceId, account_id: accountId, media_type: mediaType,
  })
  if (res.error) return { error: res.error, privacyLevels: [] }
  return {
    privacyLevels: res.privacyLevels || [],
    nickname: res.nickname || '',
    maxVideoSeconds: res.maxVideoSeconds || null,
    commentDisabled: res.commentDisabled === true,
    duetDisabled: res.duetDisabled === true,
    stitchDisabled: res.stitchDisabled === true,
  }
}

// Disconnecting is destructive at the provider — the account has to authorise
// again to come back — so callers should confirm first. The server checks that
// the account really belongs to this workspace before deleting anything; that
// check is server-side on purpose, since account_id comes from a browser.
export async function disconnectAccount(workspaceId, accountId) {
  const res = await call('disconnect', { workspace_id: workspaceId, account_id: accountId })
  if (res.error) return { error: res.error }
  return { ok: true }
}

// ── Token age ─────────────────────────────────────────────────────────────
// Instagram's long-lived tokens expire 60 days after they are granted, and a
// token that dies is indistinguishable, from the UI, from an account that was
// never connected — publishing simply starts failing. social_accounts.
// connected_at is written once, on insert, precisely so this stays answerable.
//
// null connected_at means "connected before we started recording it" and is
// reported as unknown rather than as fresh: guessing fresh would hide exactly
// the accounts most likely to be about to break.
export const TOKEN_LIFETIME_DAYS = 60

export function tokenAge(account, now = Date.now()) {
  const at = account?.connected_at
  if (!at) return { known: false, days: null, expiringSoon: false, expired: false }
  const days = Math.floor((now - new Date(at).getTime()) / 86400000)
  return {
    known: true,
    days,
    expiringSoon: days >= TOKEN_LIFETIME_DAYS - 7 && days < TOKEN_LIFETIME_DAYS,
    expired: days >= TOKEN_LIFETIME_DAYS,
  }
}
