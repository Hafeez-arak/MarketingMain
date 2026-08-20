import { defaultWebhookUrl, describeWebhookFailure } from './n8nWebhooks'
import { isLivePlatform, PLATFORM_META } from './utils'

// ─── Per-workspace account connection ──────────────────────────────────────
// Everything here talks to ONE n8n workflow (Arak Lighting – Zernio Connect)
// which does the real Zernio calls server-side. The browser never sees the
// Zernio API key, same as every other provider in this project.
//
// What this replaces: `dispatch(actions.connectAccount(platform))`, which set
// a boolean in local React state. The overview page said "Connected", nothing
// had been connected, and the first publish attempt was where you found out.
// These calls either really connect an account or return a reason.
//
// The tenancy model, briefly, because it is the whole point: Zernio puts a
// `profile` between the API team and the connected accounts. Each workspace
// gets one (created on first connect, id kept in workspaces.zernio_profile_id)
// and every call below is scoped by it — so a workspace can only see, post as,
// and disconnect its own accounts, and nobody has to touch zernio.com.

async function call(payload) {
  const url = defaultWebhookUrl('zernioConnect')
  if (!url) return { error: 'Zernio Connect webhook is not configured.' }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return { error: await describeWebhookFailure(res) }
    const data = await res.json().catch(() => ({}))
    // The workflow answers ok:false rather than throwing, because
    // responseMode=lastNode turns a thrown node error into HTTP 200 with an
    // empty body — so a failure has to arrive as data or not at all.
    if (data.ok === false) return { error: data.error || 'That did not work.' }
    return data
  } catch (err) {
    return { error: err.message }
  }
}

// List this workspace's connected accounts, refreshing our local mirror on the
// way through. Returns [] rather than an error when nothing is connected yet —
// "no accounts" is a normal state for a new workspace, not a failure.
export async function fetchConnectedAccounts(workspaceId) {
  const res = await call({ action: 'accounts', workspace_id: workspaceId })
  if (res.error) return { error: res.error, accounts: [] }
  return { accounts: res.accounts || [], profileId: res.profile_id || '' }
}

// Where the OAuth round trip comes back to. Built from the CURRENT origin
// rather than an env var so that preview deployments, localhost and
// production each return to themselves — an env var would send every
// preview's callback to production, where the tempToken means nothing.
export function connectCallbackUrl(platform) {
  return `${window.location.origin}/social/${platform}?connected=1`
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
  const res = await call({
    action: 'connect_url',
    workspace_id: workspaceId,
    platform,
    redirect_url: connectCallbackUrl(platform),
  })
  if (res.error) return { error: res.error }
  return { authUrl: res.auth_url, headless: res.headless === true, state: res.state || '' }
}

// Step 2 (Instagram only, for now): after OAuth, Zernio sends the browser back
// with a tempToken and the user still has to choose WHICH page/account. Read
// those off the callback URL.
//
// `userProfile` arrives URL-encoded JSON. It is decoded defensively: a
// malformed value should degrade to "no profile shown", not throw and strand
// the user on a blank callback screen with a valid token they can't use.
export function readConnectCallback(search = window.location.search) {
  const q = new URLSearchParams(search)
  const tempToken = q.get('tempToken') || ''
  if (!tempToken) return null
  let userProfile = null
  try {
    const raw = q.get('userProfile')
    if (raw) userProfile = JSON.parse(decodeURIComponent(raw))
  } catch { /* a missing name is survivable; a thrown callback is not */ }
  return { tempToken, step: q.get('step') || '', userProfile }
}

export async function fetchSelectionOptions(workspaceId, platform, { tempToken, step }) {
  const res = await call({
    action: 'selection_options',
    workspace_id: workspaceId, platform, temp_token: tempToken, step,
  })
  if (res.error) return { error: res.error, options: [] }
  return { options: res.options || [] }
}

export async function completeSelection(workspaceId, platform, { tempToken, step, selection }) {
  const res = await call({
    action: 'selection_complete',
    workspace_id: workspaceId, platform, temp_token: tempToken, step, selection,
  })
  if (res.error) return { error: res.error }
  return { accounts: res.accounts || [], account: res.account || null }
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
  const res = await call({
    action: 'audio_search', workspace_id: workspaceId,
    account_id: accountId, q: query, audio_type: audioType,
  })
  if (res.error) return { error: res.error, needsReconnect: res.needsReconnect === true, audio: [] }
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
// workspaceId is passed because the workflow re-checks that the account
// belongs to this workspace before reading its configuration, the same guard
// disconnect uses and for the same reason: account_id comes from a browser.
//
// An empty privacyLevels list is information, not a failure — it means TikTok
// is currently refusing this account, which the panel renders as "needs
// reconnecting" rather than as an error.
export async function fetchCreatorInfo(workspaceId, accountId, mediaType = 'video') {
  const res = await call({
    action: 'creator_info', workspace_id: workspaceId,
    account_id: accountId, media_type: mediaType,
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
// again to come back — so callers should confirm first. The workflow checks
// that the account really belongs to this workspace before deleting anything;
// that check is server-side on purpose, since account_id comes from a browser.
export async function disconnectAccount(workspaceId, accountId) {
  const res = await call({
    action: 'disconnect', workspace_id: workspaceId, account_id: accountId,
  })
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
