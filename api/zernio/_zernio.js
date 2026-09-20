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

import { normalizeRange, resolveRange } from '../../src/lib/dateRange.js'

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
/**
 * A follower count, or null when nobody has actually counted.
 *
 * Zero is a legitimate follower count and must survive; null, undefined and ''
 * are absences and must NOT become zero. That rules out `||`, which cannot
 * tell the two apart — see the note at the call site for what that cost.
 */
export function followerCountOf(account, fromProfile = {}) {
  for (const value of [account?.followersCount, fromProfile?.followersCount]) {
    if (value === null || value === undefined || value === '') continue
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

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
    // ── null is "nobody has counted", NOT "they have none" ──
    //
    // This was `Number(a.followersCount || fromProfile.followersCount || 0) || 0`,
    // which turns every falsy value into 0 — and Zernio sends null.
    //
    // Verified live 2026-09-14 against the freshly connected account:
    // `followersCount: null`, and `followersLastUpdated` equal to the moment
    // of connection rather than of any sync. The dedicated endpoint agrees and
    // is more explicit — GET /v1/accounts/follower-stats returns
    // `currentFollowers: 0` with `dataPoints: 0` and an EMPTY series, which is
    // a default computed over no observations, not an observation of zero.
    //
    // So the account's follower count is unknown, and the `|| 0` rendered that
    // unknown as a confident zero all the way to the assistant, which reported
    // "0 followers" about an account that previously recorded 1. That is the
    // exact null-to-zero collapse `num()` in aggregate.js exists to prevent,
    // and it is worse here because this value is STORED — the lie persists
    // after the truth becomes available.
    //
    // The column is nullable (default 0, no NOT NULL), so null round-trips.
    // Readers must treat it as unknown; ownChannels already does, via num().
    followers_count: followerCountOf(a, fromProfile),
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
    //
    // GET /accounts carries it under metadata, not at the top level — checked
    // live 2026-09-14 on the ARAK Lighting page: top-level `accountType: null`,
    // `metadata.accountType: 'organization'`. Reading the top level alone
    // stored null, so the "Company page" badge never showed and the analytics
    // route could not tell a page from a person.
    account_type: a.accountType || a.account_type || meta.accountType || null,
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

// ─── One account's analytics: which Zernio reads, over which window ────────
//
// Every analytics endpoint at Zernio is scoped to the API TEAM, not to a
// profile, so a request without accountId returns every workspace's numbers.
// Each request below names the account; the route checks the account belongs
// to the caller's workspace before any of them is sent.
//
// The windows are not all the same, deliberately:
//   • Instagram account insights come from Meta, which refuses more than 30
//     days between since and until (#100) — a 30-day span is already one too
//     many, so it is capped at 29 whatever window the page asked for.
//   • Instagram follower history allows 89 days; capped at 88 for the same
//     off-by-one reason.
// A tab load is eight reads at once, and switching window or account a couple
// of times in a row trips Zernio's rate limit: measured 2026-09-14, the third
// consecutive load lost two reads to "Rate limit exceeded. Please retry after
// 1 seconds." One retry after the wait Zernio names recovers that; anything
// longer than a few seconds is left to fail rather than hold the page.
export async function retryRateLimited(fn, { sleep = ms => new Promise(r => setTimeout(r, ms)), maxWaitMs = 3000 } = {}) {
  try {
    return await fn()
  } catch (err) {
    if (!(err instanceof ZernioError) || err.status !== 429) throw err
    const seconds = Number((String(err.message).match(/retry after (\d+(?:\.\d+)?) second/i) || [])[1] || 1)
    const waitMs = seconds * 1000
    if (waitMs > maxWaitMs) throw err
    await sleep(waitMs)
    return fn()
  }
}

// The presets the pickers offer. No longer a whitelist — `analyticsPlan`
// takes any window inside MAX_RANGE_DAYS, and these are just the three
// shortcuts worth having in front of the custom picker.
export const ANALYTICS_DAYS = [7, 30, 90]
export const INSTAGRAM_INSIGHT_METRICS = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'profile_links_taps']

// Instagram reports neither impressions (gone since Graph v22) nor per-post
// clicks, so offering those toggles would draw lines that can only be zero.
//
// LinkedIn is the mirror image. Impressions and clicks are its native per-post
// numbers; it has no views on an ordinary post (LinkedIn counts views on video
// only, and Zernio's per-post read does not carry even those) and a company
// page has no saves. Measured live 2026-09-14 on ARAK Lighting's latest post:
// impressions 1,027, reach 516, clicks 186, views 0, saves 0.
const METRICS_SUPPORTED = {
  instagram: ['likes', 'comments', 'shares', 'saves', 'views', 'reach'],
  linkedin: ['impressions', 'reach', 'likes', 'comments', 'shares', 'clicks'],
}

// ─── LinkedIn company page analytics ───────────────────────────────────────
// Page-level numbers from LinkedIn's organisation statistics: every post on
// the page, including the ones made directly on LinkedIn, plus follower gains
// and page views. Only a company page has them — Zernio answers a personal
// profile with 400 personal_account_not_supported.
//
// Page views are totals only; LinkedIn does not split them by day, so they are
// absent from the series. The window is capped at 88 days: measured live,
// since→until of 89 days is refused ("Date range cannot exceed 88 days") and
// 88 answers.
export const LINKEDIN_PAGE_METRICS = [
  'impressions', 'unique_impressions', 'clicks', 'likes', 'comments', 'shares', 'engagement_rate',
  'organic_followers_gained', 'paid_followers_gained',
  'page_views_total', 'page_views_overview', 'page_views_careers', 'page_views_jobs', 'page_views_life',
]
export const LINKEDIN_SERIES_METRICS = [
  'impressions', 'unique_impressions', 'clicks', 'likes', 'comments', 'shares', 'organic_followers_gained',
]
export const LINKEDIN_MAX_DAYS = 88

const DAY_MS = 86400000
const isoDay = ms => new Date(ms).toISOString().slice(0, 10)

/**
 * The earliest day a capped metric may start, given the window's own end.
 *
 * ── WHY THIS IS NOT `now - cap` ──
 *
 * It used to be, and it was right while every window ended today. It is wrong
 * the moment a window can end in the past: ask for January and Instagram's
 * insights would be requested from "30 days ago" — a window that does not
 * overlap the one being shown at all — and the tiles would carry September's
 * reach above a January chart.
 *
 * The cap is a limit on the DISTANCE between since and until, so it has to be
 * measured from `until`. A window shorter than the cap keeps its own start.
 */
function cappedStart(fromDate, toDate, capDays) {
  const earliest = isoDay(Date.parse(`${toDate}T00:00:00Z`) - capDays * DAY_MS)
  return fromDate > earliest ? fromDate : earliest
}

/**
 * Just the follower series, over a window of its own.
 *
 * ── WHY THIS IS NOT analyticsPlan WITH A DIFFERENT WINDOW ──
 *
 * The follower chart has its own range picker, because "how did the audience
 * grow" is a question about a longer span than "how did last week's posts
 * do". Answering it through analyticsPlan would make nine Zernio reads —
 * posts, daily metrics, best time, posting frequency, content decay, account
 * insights, the follow-type breakdown — to redraw one line, every time
 * somebody nudges a date. These are the two reads that line is made of.
 */
export function followerPlan({ platform, accountId, days, from, to, now = Date.now() }) {
  const { range } = normalizeRange(
    from && to ? { from, to } : { days: Number(days) || 30 },
    { now },
  )
  const { fromDate, toDate, days: span } = resolveRange(range || { days: 30 }, { now })

  const requests = [
    { key: 'followers', path: 'accounts/follower-stats', query: { accountIds: accountId, fromDate, toDate } },
  ]
  if (platform === 'instagram') {
    requests.push({
      key: 'followerHistory',
      path: 'analytics/instagram/follower-history',
      // Instagram's own series caps at 88 days, measured from this window's
      // end for the same reason account insights are — see cappedStart.
      query: { accountId, since: cappedStart(fromDate, toDate, 88), until: toDate, metricType: 'time_series' },
    })
  }
  return { days: span, fromDate, toDate, requests }
}

/**
 * @param {object} opts
 * @param {number} [opts.days] A rolling window, resolved against `now`.
 * @param {string} [opts.from] With `to`, a fixed window that never moves.
 * @param {string} [opts.to]
 */
export function analyticsPlan({
  platform, accountId, accountType = null, days, from, to, now = Date.now(),
}) {
  // A fixed window wins when both dates are present and sane; anything else
  // falls back to the rolling one. The whitelist is gone — Zernio takes
  // arbitrary since/until on every endpoint here (verified live), so the three
  // values it allowed were our limit, not a platform's. What survives is the
  // clamp: a request is still refused above MAX_RANGE_DAYS, because an
  // unbounded window is a slow call nobody asked for.
  const { range } = normalizeRange(
    from && to ? { from, to } : { days: Number(days) || 30 },
    { now },
  )
  const { fromDate, toDate, days: span } = resolveRange(range || { days: 30 }, { now })
  const scoped = { platform, accountId }

  const requests = [
    { key: 'overview', path: 'analytics', query: { ...scoped, fromDate, toDate, limit: 100, source: 'all' } },
    { key: 'daily', path: 'analytics/daily-metrics', query: { ...scoped, fromDate, toDate } },
    { key: 'bestTime', path: 'analytics/best-time', query: scoped },
    { key: 'frequency', path: 'analytics/posting-frequency', query: scoped },
    { key: 'decay', path: 'analytics/content-decay', query: scoped },
    { key: 'followers', path: 'accounts/follower-stats', query: { accountIds: accountId, fromDate, toDate } },
  ]

  let insightsFrom = null
  if (platform === 'instagram') {
    insightsFrom = cappedStart(fromDate, toDate, 29)
    requests.push(
      { key: 'insights', path: 'analytics/instagram/account-insights',
        query: { accountId, since: insightsFrom, until: toDate, metrics: INSTAGRAM_INSIGHT_METRICS.join(',') } },
      { key: 'followerHistory', path: 'analytics/instagram/follower-history',
        query: { accountId, since: cappedStart(fromDate, toDate, 88), until: toDate, metricType: 'time_series' } },
      // ── Reach, split by whether the person already follows us ──
      //
      // `follow_type` is the only breakdown Instagram offers that answers
      // "are we talking to the room or to the street", and reach is the ONLY
      // metric that accepts it. Measured live against Zernio: the same call
      // with accounts_engaged, total_interactions, likes or comments is a 400
      // naming the valid breakdowns, so there is no follower/non-follower
      // split of engagement to be had — from Meta, not from us.
      //
      // total_value only; time_series refuses every breakdown, so this is one
      // number per side for the window rather than a line.
      { key: 'reachByFollowType', path: 'analytics/instagram/account-insights',
        query: {
          accountId, since: insightsFrom, until: toDate,
          metrics: 'reach', metricType: 'total_value', breakdown: 'follow_type',
        } },
    )
  }

  // null counts as a page. Rows mirrored before account_type was read
  // correctly carry null, and every LinkedIn account connected so far is a
  // page; a personal profile that slips through gets Zernio's own
  // personal_account_not_supported in the slot rather than a broken tab.
  if (platform === 'linkedin' && accountType !== 'personal') {
    insightsFrom = cappedStart(fromDate, toDate, LINKEDIN_MAX_DAYS)
    const page = { accountId, since: insightsFrom, until: toDate }
    requests.push(
      { key: 'linkedinPage', path: 'analytics/linkedin/org-aggregate-analytics',
        query: { ...page, metricType: 'total_value', metrics: LINKEDIN_PAGE_METRICS.join(',') } },
      { key: 'linkedinSeries', path: 'analytics/linkedin/org-aggregate-analytics',
        query: { ...page, metricType: 'time_series', metrics: LINKEDIN_SERIES_METRICS.join(',') } },
    )
  }

  return {
    days: span, fromDate, toDate, insightsFrom,
    metricsSupported: METRICS_SUPPORTED[platform] || null,
    requests,
  }
}

// ─── Refresh: ask the platform again, now ──────────────────────────────────
//
// Zernio re-reads each account's posts on its own cycle, at most every ~90
// minutes, and every analytics read above is served from that copy. A Refresh
// button that only re-reads the copy shows the same numbers again — which is
// exactly "refresh does nothing". POST /posts/sync-external makes Zernio fetch
// the account's latest posts from the platform immediately. It reads from the
// platform and publishes nothing.
//
// Zernio debounces it per account (~15s): a second press inside that window
// answers `skipped: true` without fetching, and that is reported as such
// rather than as a refresh that happened. Verified live 2026-09-14 on the
// LinkedIn page: first call re-read 3 posts in 2.9s, the next answered skipped.
//
// One account failing does not stop the rest, and an account that needs
// reconnecting is not asked at all — Zernio would answer 409, and the useful
// sentence there is "reconnect", not a status code.
export async function syncAccountPosts(z, accounts, { retry = retryRateLimited } = {}) {
  return Promise.all((accounts || []).map(async a => {
    const base = {
      account_id: a.zernio_account_id,
      platform: a.platform,
      name: a.display_name || a.username || '',
    }
    if (a.is_active === false || a.needs_reconnection === true) {
      return { ...base, ok: false, needs_reconnection: true, error: 'Needs reconnecting before it can refresh.' }
    }
    try {
      const out = await retry(() => z.request('posts/sync-external', {
        method: 'POST', body: { accountId: a.zernio_account_id },
      }))
      const synced = out?.synced || {}
      return {
        ...base,
        ok: true,
        skipped: synced.skipped === true,
        posts_synced: Number(synced.postsSynced) || 0,
        // `postsFound` read 0 on the live call that nonetheless returned three
        // posts, so the list itself is the count worth reporting.
        recent_posts: Array.isArray(out?.posts) ? out.posts.length : null,
      }
    } catch (err) {
      return { ...base, ok: false, error: explainZernioError(err) }
    }
  }))
}

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
