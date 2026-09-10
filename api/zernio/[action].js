import {
  createZernio, normalizeAccount, ownedByProfile, profileIdOf,
  CONNECT_SPECS, CONNECTABLE, explainZernioError, ZernioError, qs,
} from './_zernio.js'

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

const ACTIONS = new Set([
  'accounts', 'connect_url', 'selection_options', 'selection_complete',
  'disconnect', 'creator_info', 'audio_search',
])

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

async function authenticate(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
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
  try {
    await supa(
      `social_accounts?workspace_id=eq.${workspaceId}`
      + `&zernio_profile_id=eq.${encodeURIComponent(profileId)}${notMine}`,
      { token: SERVICE_KEY, method: 'DELETE', prefer: 'return=minimal' },
    )
  } catch { /* pruning is housekeeping; never let it block the live list */ }

  if (!rows.length) return {}

  const written = await supa(
    'social_accounts?on_conflict=workspace_id,zernio_account_id',
    {
      token: SERVICE_KEY, method: 'POST', body: rows,
      prefer: 'resolution=merge-duplicates,return=representation',
    },
  )
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
    await requireOwnedAccount(z, { workspaceId: ws.id, profileId, accountId })

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
  if (!ACTIONS.has(action)) {
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

  const user = await authenticate(req)
  if (!user) {
    return res.status(401).json({
      ok: false,
      error: 'Sign in to do this. If you are signed in, your session expired — reload the page.',
    })
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const workspaceId = String(body.workspace_id || '').trim()

  try {
    const ws = await loadWorkspace(workspaceId, user.token)
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
