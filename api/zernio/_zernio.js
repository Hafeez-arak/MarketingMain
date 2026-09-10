// ─── Zernio: the API client and the per-platform connect specs ─────────────
//
// Deliberately free of Vercel, Supabase, and process.env: everything arrives
// as an argument, so the whole file runs under vitest with a stub fetch. The
// bug this replaces was invisible for exactly that reason — it lived in a
// filter inside an n8n Code node, and the only way to see it was to connect a
// real account and watch it not appear.
//
// The `_` prefix keeps Vercel from turning this into a route. It is an
// import, not an endpoint.

export const ZERNIO_BASE = 'https://zernio.com/api/v1'

export class ZernioError extends Error {
  constructor(message, { status = 0, code = '', body = null } = {}) {
    super(message)
    this.name = 'ZernioError'
    this.status = status
    this.code = code
    this.body = body
  }
}

// ─── The bug this whole rebuild exists for ─────────────────────────────────
//
// Zernio POPULATES the `profileId` reference on an account. It arrives as
// `{ _id: '6a93…', name: 'arak_ws_…' }`, not as the string the field name
// promises. The previous implementation compared it with
// `String(a.profileId) === String(profileId)` — which is
// `'[object Object]' === '6a93…'`, false for every account ever returned.
//
// That comparison was a tenancy re-check sitting on top of a server-side
// filter Zernio already honours, so it could only ever remove accounts, never
// add them. It removed all of them. The visible symptom was an OAuth round
// trip that completed at the provider, created the account at Zernio, and
// came back to a screen that said nothing was connected — and, because six
// other actions gate on the same list, a Disconnect button that answered
// "that account does not belong to this workspace" about the workspace's own
// account.
//
// Verified live 2026-09-10: GET /v1/accounts?profileId=6a93f477… returns the
// workspace's TikTok account with profileId as an object.
export function profileIdOf(value) {
  if (!value) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'object') return String(value._id || value.id || '').trim()
  return String(value).trim()
}

// ─── HTTP ──────────────────────────────────────────────────────────────────
// Non-2xx is read as data rather than thrown by fetch, so the status and
// Zernio's own machine-readable `code` survive to the caller. Several
// decisions below turn on the code — PLATFORM_BETA_RESTRICTED and
// instagram_audio_requires_facebook_login mean "this will never work as
// asked" rather than "try again".
export function createZernio({ apiKey, fetchImpl = fetch, base = ZERNIO_BASE }) {
  if (!apiKey) throw new Error('ZERNIO_API_KEY is not set on this deployment.')

  async function request(path, { method = 'GET', query, body, connectToken } = {}) {
    const url = `${base}/${path.replace(/^\/+/, '')}${query ? `?${qs(query)}` : ''}`
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      // Short-lived (15 min) and only issued for the flows that need it.
      // Sent alongside the API key, never instead of it.
      ...(connectToken ? { 'X-Connect-Token': connectToken } : {}),
    }

    let res
    try {
      res = await fetchImpl(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
    } catch (err) {
      throw new ZernioError(`Could not reach Zernio: ${err.message}`, { status: 0 })
    }

    const text = await res.text().catch(() => '')
    let parsed = null
    try { parsed = text ? JSON.parse(text) : null } catch { /* not JSON; `text` is the message */ }

    if (res.status >= 200 && res.status < 300) return parsed ?? {}

    const message = (parsed && (parsed.error || parsed.message)) || text.slice(0, 400) || `HTTP ${res.status}`
    throw new ZernioError(message, {
      status: res.status,
      code: (parsed && parsed.code) || '',
      body: parsed,
    })
  }

  return { request }
}

// Zernio's params are all primitives (ids, a redirect URL, a search term), so
// none of URLSearchParams' array handling is wanted — and an empty string here
// is "not supplied", not "supplied as blank". Sending `q=` to the audio search
// asks for a track named nothing instead of returning trending.
export function qs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

// ─── Account shape ─────────────────────────────────────────────────────────
//
// Zernio speaks camelCase and identifies an account by `_id`. Every screen in
// this app reads snake_case and `zernio_account_id`, because that is the shape
// of the social_accounts table they were written against. The previous version
// handed the browser Zernio's raw objects, so `account.zernio_account_id`,
// `display_name`, `profile_picture`, `is_active`, `needs_reconnection` and
// `login_method` were all undefined on every row.
//
// Most of that degraded quietly — `is_active !== false` is true for undefined,
// so accounts still read as "connected". Two did not: Disconnect posted
// account_id undefined, and the composer's account picker keyed every option
// on undefined, so choosing which account to publish as selected nothing.
//
// Normalising here, once, is what makes those screens correct without
// touching them.
export function normalizeAccount(raw, { connectedAt = null } = {}) {
  const a = raw || {}
  const meta = a.metadata || {}
  const fromProfile = meta.profileData || {}
  return {
    zernio_account_id: String(a._id || a.accountId || a.id || ''),
    platform: String(a.platform || ''),
    username: String(a.username || fromProfile.username || ''),
    display_name: String(a.displayName || fromProfile.displayName || a.name || ''),
    profile_picture: String(a.profilePicture || fromProfile.profilePicture || a.avatarUrl || ''),
    profile_url: String(a.profileUrl || fromProfile.profileUrl || ''),
    is_active: a.isActive !== false && a.enabled !== false,
    needs_reconnection: a.needsReconnection === true,
    followers_count: Number(a.followersCount || fromProfile.followersCount || 0) || 0,
    zernio_profile_id: profileIdOf(a.profileId),
    // Instagram only, and defaulted rather than left null. `connect_url`
    // always asks for loginMethod=facebook_login and Zernio's Instagram
    // completion endpoint accepts no other value, so any Instagram account
    // connected through this app IS facebook_login — but GET /accounts does
    // not reliably echo the field back (its own schema does not list it).
    //
    // The trade-off, stated plainly: an Instagram account added by hand at
    // zernio.com with Instagram Login would be mislabelled, and the cost is
    // one Reel refused with Instagram's own
    // `instagram_audio_requires_facebook_login`. The cost of the other
    // direction is every correctly-connected account permanently showing
    // "reconnect to enable catalog audio" — advice to redo something that was
    // already done right.
    login_method: a.loginMethod || a.login_method
      || (String(a.platform || '') === 'instagram' ? 'facebook_login' : null),
    // LinkedIn only: 'personal' | 'organization'. Publishing differs between
    // them (an organisation post is authored by the page, not the person), so
    // it is carried rather than flattened away.
    account_type: a.accountType || a.account_type || null,
    // When OAuth was granted, which is what makes "this token is 58 days old,
    // reconnect" answerable. Our own mirror wins when we have it: it is
    // written once on INSERT and never updated, whereas Zernio's createdAt
    // belongs to the account document and is the only thing left when a row
    // predates the column.
    connected_at: connectedAt || a.createdAt || null,
  }
}

// Belt and braces on top of Zernio's own `profileId` filter — but written so
// that it can only ever reject an account that names a DIFFERENT profile. An
// account with no profile, or one whose shape we failed to read, is kept.
//
// The version this replaces did the opposite: it dropped anything it could not
// parse, and it could not parse the real shape. A tenancy check whose failure
// mode is "show nothing" looks identical to "nothing is connected", which is
// the most expensive possible way to be wrong here.
export function ownedByProfile(accounts, profileId) {
  const want = String(profileId || '')
  return (accounts || []).filter(a => {
    // A non-object is not a lenient case, it is a broken one: it has no id, so
    // it would reach the browser as a row with no account behind it and no way
    // to select or disconnect it.
    if (!a || typeof a !== 'object') return false
    const got = profileIdOf(a.profileId)
    return !got || got === want
  })
}

// ─── Per-platform connect behaviour ────────────────────────────────────────
//
// Everything that differs between platforms lives here, so the handler is one
// flow rather than a switch repeated six times.
//
//   headless     ask Zernio for the raw OAuth result instead of its own hosted
//                picker, so the second choice happens in our UI. Only worth
//                doing where a second choice exists.
//   connectParams extra query params on GET /connect/{platform}.
//   selection    null when OAuth alone finishes the connection.
//   oneAccountPerProfile  Zernio replaces rather than adds. Changes what the
//                button is allowed to promise.
//
// Snapchat is absent on purpose. It is a closed beta at Zernio
// (403 PLATFORM_BETA_RESTRICTED on GET /connect/snapchat) and the app gates it
// out as status:'beta'; adding it here would open a flow with no screen to
// finish it. Its endpoints are /v1/connect/snapchat/select-profile and its
// shape is LinkedIn's — pending-data token, a userProfile that must be
// forwarded — so it slots in as one more entry when approval lands.
export const CONNECT_SPECS = {
  instagram: {
    label: 'Instagram',
    headless: true,
    // Publishing, analytics, comments and the inbox are identical either way,
    // but catalog audio is not: attaching a track on an Instagram-Login
    // account fails with instagram_audio_requires_facebook_login, and the Meta
    // Ads add-on rides on this same connection. Omitting the param silently
    // takes both away, because Zernio's default is instagram_login.
    //
    // It is also what makes the Page-selection step real: Instagram Login
    // connects directly with no picker, Facebook Login authorises through the
    // linked Page and needs one.
    connectParams: { loginMethod: 'facebook_login' },
    oneAccountPerProfile: true,
    selection: {
      // `requires` is a list of ALTERNATIVE sets: the callback satisfies the
      // step if it carries every field of any one of them. Instagram has
      // exactly one shape — tokens inline: profileId, tempToken,
      // platform=instagram, step=select_account, connect_token.
      requires: [['tempToken', 'connectToken']],
      async options(z, { profileId, tempToken, connectToken }) {
        // connect/instagram/select-account, NOT connect/facebook/select-page.
        // The Facebook endpoint connects a platform:facebook account and its
        // POST requires a userProfile the Instagram callback never carries —
        // but its GET answers anyway, listing every Page the token manages, so
        // the wrong endpoint fills the picker convincingly and only the final
        // click fails. That shipped twice.
        const res = await z.request('connect/instagram/select-account', {
          query: { profileId, tempToken }, connectToken,
        })
        const pages = Array.isArray(res.pages) ? res.pages : []
        return pages.map(p => {
          const ig = p.instagram_business_account || p.instagramBusinessAccount || {}
          return {
            id: String(p.id || p.pageId || ''),
            // The Instagram handle is the title and the Page name the
            // subtitle: someone picking here is choosing an Instagram account,
            // and @handle is what they know it by. The Page is the thing they
            // will have forgotten they linked.
            name: String(ig.username || p.name || ''),
            username: String(ig.username || ''),
            subtitle: String(p.name || ''),
            picture: String(ig.profile_picture_url || ig.profilePictureUrl || ''),
          }
        }).filter(o => o.id)
        // Deliberately not filtered to pages carrying an instagram_business_
        // account. Zernio documents that it returns only eligible ones; if
        // that stops being true, a filter here would empty the picker and tell
        // the user they have no professional account — a lie that ends the
        // flow. Showing the row means the worst case is a refusal with a
        // reason.
      },
      async complete(z, { profileId, tempToken, connectToken, choiceId }) {
        // Exactly the three fields the spec marks required. userProfile is NOT
        // sent: select-account does not accept it.
        await z.request('connect/instagram/select-account', {
          method: 'POST', connectToken,
          body: { profileId, pageId: choiceId, tempToken },
        })
      },
    },
  },

  tiktok: {
    label: 'TikTok',
    // No second choice: TikTok's OAuth identifies exactly one creator, so
    // Zernio creates the account at the callback and the redirect already
    // carries accountId. Asking for headless here would hand us raw OAuth data
    // and a selection step that does not exist.
    headless: false,
    selection: null,
  },

  linkedin: {
    label: 'LinkedIn',
    headless: true,
    selection: {
      // LinkedIn's org list is too large for URL params, so the redirect
      // carries a `pendingDataToken` instead and the payload is fetched
      // server-side. That is strictly better than Instagram's inline tokens:
      // the browser never holds the LinkedIn access token at all.
      //
      // Reading the token does not consume it (it lives an hour, and the
      // selection POST is what deletes it), so `complete` re-reads rather than
      // making the browser carry tempToken and userProfile back to us.
      // Two accepted shapes, and the second is a deliberate fallback rather
      // than a guess at the API. The documented path is pendingDataToken:
      // LinkedIn's org list is too large for URL params, so the redirect
      // carries a pointer and the payload is fetched server-side — strictly
      // better, since the LinkedIn access token never enters the browser.
      //
      // But the connect URL's `state` shows Zernio also mints a connect token
      // for this flow, so a callback carrying tempToken instead is possible.
      // Without pending data there is no way to enumerate organisations at
      // all — GET /connect/linkedin/organizations requires the ids up front —
      // so that path offers the personal profile only, and says so, instead
      // of dead-ending on a token that never arrived.
      requires: [['pendingDataToken'], ['tempToken']],
      async options(z, { profileId, pendingDataToken, tempToken, userProfile }) {
        const pending = pendingDataToken
          ? await readPendingData(z, { profileId, pendingDataToken })
          : { tempToken, userProfile: userProfile || {}, organizations: [] }
        const orgs = Array.isArray(pending.organizations) ? pending.organizations : []

        // Best-effort enrichment: logos and vanity names make a list of
        // company pages legible. It is a separate endpoint that can fail on
        // its own, and a picker with no logos still works, so a failure here
        // is swallowed rather than ending the connection.
        let details = {}
        if (orgs.length) {
          try {
            const res = await z.request('connect/linkedin/organizations', {
              query: {
                tempToken: pending.tempToken,
                orgIds: orgs.slice(0, 100).map(o => o.id).join(','),
              },
            })
            for (const d of res.organizations || []) details[String(d.id)] = d
          } catch { /* logos are decoration; the ids and names are already in hand */ }
        }

        const person = pending.userProfile || {}
        // The personal profile is a real, first-class choice — LinkedIn's
        // select-organization takes accountType:'personal' with no
        // organisation at all — so it is offered as an option rather than
        // hidden behind a mode switch the user has to find.
        const options = [{
          id: 'personal',
          kind: 'personal',
          name: String(person.displayName || person.username || 'My LinkedIn profile'),
          subtitle: 'Your personal profile',
          picture: String(person.profilePicture || ''),
        }]

        for (const o of orgs) {
          const d = details[String(o.id)] || {}
          options.push({
            id: String(o.id),
            kind: 'organization',
            name: String(o.name || d.vanityName || o.vanityName || ''),
            subtitle: String(d.industry || 'Company page'),
            picture: String(d.logoUrl || ''),
            // Carried through the picker because select-organization requires
            // the full object back, urn included, and the urn is not
            // derivable from the id with any confidence.
            urn: String(o.urn || `urn:li:organization:${o.id}`),
            vanityName: String(o.vanityName || d.vanityName || ''),
            logoUrl: String(d.logoUrl || ''),
          })
        }
        return options.filter(o => o.id && o.name)
      },
      async complete(z, { profileId, pendingDataToken, tempToken, userProfile, choice }) {
        // Re-read rather than making the browser carry tempToken and
        // userProfile back to us: reading a pending token does not consume it
        // (the selection POST is what deletes it), so this costs one call and
        // keeps LinkedIn's access token out of the browser entirely.
        const pending = pendingDataToken
          ? await readPendingData(z, { profileId, pendingDataToken })
          : { tempToken, userProfile: userProfile || {} }
        const isOrg = choice && choice.kind === 'organization'

        // userProfile is REQUIRED here, unlike Instagram's select-account.
        // The old client dropped it on the floor for every platform on the
        // grounds that Instagram did not want it; LinkedIn and Snapchat both
        // reject the call without it.
        const body = {
          profileId,
          tempToken: pending.tempToken,
          userProfile: pending.userProfile || {},
          accountType: isOrg ? 'organization' : 'personal',
        }
        if (isOrg) {
          body.selectedOrganization = {
            id: String(choice.id),
            urn: String(choice.urn || `urn:li:organization:${choice.id}`),
            name: String(choice.name || ''),
            ...(choice.logoUrl ? { logoUrl: String(choice.logoUrl) } : {}),
            ...(choice.vanityName ? { vanityName: String(choice.vanityName) } : {}),
          }
        }
        await z.request('connect/linkedin/select-organization', { method: 'POST', body })
      },
    },
  },
}

// GET /v1/connect/pending-data, with the tenancy check that makes it safe to
// act on. The token comes off a URL in somebody's browser; without comparing
// the profile it names against the one this workspace holds, a token pasted
// from another tenant's flow would connect their LinkedIn page here.
async function readPendingData(z, { profileId, pendingDataToken }) {
  let pending
  try {
    pending = await z.request('connect/pending-data', { query: { token: pendingDataToken } })
  } catch (err) {
    // One hour, and the clock starts at the redirect. Someone who leaves the
    // picker open over lunch lands here, and "404" is not an answer they can
    // act on.
    if (err.status === 404) {
      throw new ZernioError(
        'This connection has expired — it stays valid for an hour after you authorise. Start again.',
        { status: 404, code: 'pending_data_expired' },
      )
    }
    throw err
  }
  const got = profileIdOf(pending.profileId)
  if (got && got !== String(profileId)) {
    throw new ZernioError(
      'This connection was started for a different workspace. Start again from this one.',
      { status: 403, code: 'profile_mismatch' },
    )
  }
  return pending
}

export const CONNECTABLE = Object.keys(CONNECT_SPECS)

// ─── Turning a Zernio failure into something a person can act on ───────────
//
// Zernio's `code` is machine-readable and stable; its `error` is prose aimed
// at a developer. Only the cases where the user's next step genuinely differs
// are named — everything else keeps Zernio's own message, which is more
// specific than any generic sentence we could substitute for it.
export function explainZernioError(err) {
  const code = String((err && err.code) || '').toLowerCase()
  const raw = `${code} ${String((err && err.message) || '')}`.toLowerCase()

  if (code === 'platform_beta_restricted' || raw.includes('platform_beta_restricted')) {
    return 'Zernio has not approved this account for that platform yet — it is still a closed beta.'
  }
  if (raw.includes('instagram_audio_requires_facebook_login')) {
    return 'This account was connected without Facebook access, which Instagram requires for catalog audio. Reconnect it to enable audio.'
  }
  if (code === 'profile_limit_exceeded' || code === 'account_limit_exceeded') {
    return `${err.message} (This is a plan limit at Zernio, not something this app can raise.)`
  }
  if (err && err.status === 402) {
    return 'Zernio refused this because the plan does not cover it — check billing at zernio.com.'
  }
  return (err && err.message) || 'That did not work.'
}
