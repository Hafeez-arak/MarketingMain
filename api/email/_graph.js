import crypto from 'node:crypto'
import MailComposerModule from 'nodemailer/lib/mail-composer'

const MailComposer = MailComposerModule.default || MailComposerModule

// ─── Microsoft 365 mailboxes, through Microsoft Graph ──────────────────────
// The company's own Microsoft 365 accounts (arak-sa.com) as outreach senders.
// Someone signs in AS the mailbox once ("Connect Microsoft 365"); from then on
// the server holds its refresh token, sealed like an app password, and sends
// and reads with it. No password is ever typed into the app or stored.
//
// Why a server-side (confidential) sign-in and not the Lighting app's
// browser (SPA/PKCE) one, although both use the same app registration: a
// refresh token issued to a single-page app lives 24 hours and may only be
// redeemed from a browser. A sender that runs every 10 minutes from a server
// needs the web flow's, which lives 90 days and renews itself with every use.
//
// Why Graph and not SMTP with a password: Exchange Online turns basic-auth
// SMTP off by default at the end of 2026 and IMAP with a password is already
// gone, so the Google path (_mailbox.js) cannot read these inboxes at all.
//
// Every call takes `fetch` injected, so the tests never touch Microsoft.

// Mail.ReadWrite, not just Mail.Send: an email is created as a draft (so our
// Message-ID and threading headers survive) and then sent, and Microsoft
// counts creating a draft as writing to the mailbox. Without it the draft is
// refused with ErrorAccessDenied (found on the first real send, 2026-09-28).
export const SCOPES = 'openid profile email offline_access User.Read Mail.Send Mail.Read Mail.ReadWrite'

// The lead agent only READS a mailbox (info@): it asks for no send and no
// write, at sign-in and at every renewal, so the token it holds cannot send,
// move or delete anything even if it leaked. See api/leads/_mail.js.
export const READ_SCOPES = 'openid profile email offline_access User.Read Mail.Read'
const GRAPH = 'https://graph.microsoft.com/v1.0'

export function msConfig(env = process.env) {
  const clientId = String(env.MICROSOFT_CLIENT_ID || '').trim()
  const tenant = String(env.MICROSOFT_TENANT_ID || '').trim()
  const secret = String(env.MICROSOFT_CLIENT_SECRET || '').trim()
  return { clientId, tenant, secret, configured: Boolean(clientId && tenant && secret) }
}

const loginBase = config => `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0`

/**
 * The sign-in settings for one mailbox. A mailbox on another organisation's
 * Microsoft 365 (clb-sa.com, ghusnsa.com) signed in at the shared
 * "organizations" endpoint; its own tenant id is kept and its renewals go
 * there, since our own tenant does not know its account.
 */
export const configForMailbox = (config, mb) => (mb?.tenant ? { ...config, tenant: mb.tenant } : config)

/** The tenant id inside Microsoft's id_token, or ''. */
export function tenantOf(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken || '').split('.')[1], 'base64url').toString('utf8')).tid || '' } catch { return '' }
}

// ─── The sign-in's state ───────────────────────────────────────────────────
// Microsoft hands `state` back untouched. It carries who started the sign-in
// and for which workspace, signed, so the callback (which has no session of
// its own) cannot be pointed at someone else's workspace. The nonce inside it
// is also set as a cookie on the browser that started, so a link someone else
// started cannot be finished in your browser.

const STATE_TTL_MS = 15 * 60_000

function stateKey(serviceKey) {
  if (!serviceKey) throw new Error('No server key to sign with.')
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(serviceKey), Buffer.from('arak-email'), Buffer.from('ms-oauth-state-v1'), 32))
}

const b64url = buf => Buffer.from(buf).toString('base64url')

/** @param {object} claims { ws, uid, mb?, n } */
export function signState(claims, serviceKey, now = Date.now()) {
  const payload = b64url(JSON.stringify({ ...claims, exp: now + STATE_TTL_MS }))
  const mac = crypto.createHmac('sha256', stateKey(serviceKey)).update(payload).digest('base64url')
  return `${payload}.${mac}`
}

/** The claims, or null if the state was altered or is too old. */
export function openState(state, serviceKey, now = Date.now()) {
  const [payload, mac] = String(state || '').split('.')
  if (!payload || !mac) return null
  const want = crypto.createHmac('sha256', stateKey(serviceKey)).update(payload).digest()
  const got = Buffer.from(mac, 'base64url')
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null
  let claims
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch { return null }
  if (!claims || typeof claims.exp !== 'number' || claims.exp < now) return null
  return claims
}

export function authorizeUrl({ config, redirectUri, state, loginHint = '', scopes = SCOPES }) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: scopes,
    state,
    // Always ask which account: the person connecting is usually signed in
    // to Microsoft as themselves, not as the outreach mailbox.
    prompt: 'select_account',
  })
  if (loginHint) params.set('login_hint', loginHint)
  return `${loginBase(config)}/authorize?${params}`
}

// ─── Tokens ────────────────────────────────────────────────────────────────
// Stored as one sealed JSON blob: { rt, at, exp }. The access token is reused
// until five minutes before it expires; the refresh token Microsoft returns
// with each renewal replaces the old one.

export function packTokens(t, now = Date.now()) {
  return JSON.stringify({ rt: t.refresh_token || t.rt || '', at: t.access_token || t.at || '', exp: t.expires_in ? now + Number(t.expires_in) * 1000 : (t.exp || 0) })
}

export function unpackTokens(plain) {
  try {
    const t = JSON.parse(String(plain || ''))
    return t && t.rt ? t : null
  } catch { return null }
}

async function tokenCall(fetchImpl, config, form, scopes = SCOPES) {
  const res = await fetchImpl(`${loginBase(config)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.secret, scope: scopes, ...form }).toString(),
  })
  let body = {}
  try { body = await res.json() } catch { /* not JSON */ }
  if (!res.ok || body.error) {
    const err = new Error(body.error_description?.split('\r\n')[0] || body.error || `Microsoft sign-in answered ${res.status}`)
    err.oauth = body.error || 'http_' + res.status
    // invalid_grant: the refresh token was revoked, expired (90 days unused),
    // or the password changed. Only signing in again fixes it.
    err.kind = body.error === 'invalid_grant' || body.error === 'interaction_required' ? 'auth' : 'transient'
    if (err.kind === 'auth') err.reason = 'Microsoft no longer accepts this mailbox\'s sign-in (password changed, access removed, or unused for 90 days). Reconnect it.'
    throw err
  }
  return body
}

export function exchangeCode({ config, code, redirectUri, fetch: f = fetch, scopes = SCOPES }) {
  return tokenCall(f, config, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, scopes)
}

export function refreshTokens({ config, refreshToken, fetch: f = fetch, scopes = SCOPES }) {
  return tokenCall(f, config, { grant_type: 'refresh_token', refresh_token: refreshToken }, scopes)
}

// ─── Graph calls ───────────────────────────────────────────────────────────

/**
 * What a Graph failure means for the row and the mailbox, the same kinds
 * classifySmtpError uses, so the engine treats both providers alike.
 */
export function classifyGraphError(status, code = '', message = '') {
  const text = `${code} ${message}`
  if (/MailboxNotEnabledForRESTAPI|MailboxNotHostedInExchangeOnline|ResourceNotFound.*mailbox/i.test(text)) {
    return { kind: 'auth', reason: 'This account has no Exchange mailbox. Give it an Exchange Online (Plan 1) or Business Basic licence, then reconnect.' }
  }
  if (/ErrorMessageSubmissionBlocked|SubmissionBlocked|SendAsDenied|OutboundSpam/i.test(text)) {
    return { kind: 'auth', reason: 'Microsoft has blocked this mailbox from sending, usually after spam reports. A Microsoft 365 admin must release it (Defender portal → Restricted entities) before it sends again.' }
  }
  if (/ErrorAccessDenied|AccessDenied/i.test(text)) {
    return { kind: 'auth', reason: 'Microsoft refused access to this mailbox: the app is missing a permission (Mail.ReadWrite) or its sign-in was withdrawn. Once the permission is granted, connect the mailbox again.' }
  }
  if (status === 401 || /InvalidAuthenticationToken/i.test(text)) {
    return { kind: 'auth', reason: 'Microsoft refused this mailbox\'s sign-in. Reconnect it.' }
  }
  // The day's sending quota is spent: nothing more goes today.
  if (/ErrorExceededMessageLimit|QuotaExceeded/i.test(text)) return { kind: 'limit', reason: '' }
  // Throttling (429, busy) clears within minutes, not by tomorrow: the
  // mailbox waits one short pause, like any other passing failure.
  if (status === 429 || /ApplicationThrottled|ErrorServerBusy|MailboxConcurrency/i.test(text)) return { kind: 'transient', reason: '' }
  if (/ErrorInvalidRecipients|InvalidRecipients|ErrorInvalidEmailAddress/i.test(text)) return { kind: 'recipient', reason: '' }
  return { kind: 'transient', reason: '' }
}

async function graphCall(fetchImpl, token, path, { method = 'GET', body, contentType = 'application/json' } = {}) {
  const res = await fetchImpl(path.startsWith('http') ? path : `${GRAPH}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': contentType } : {}) },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
  if (res.status === 202 || res.status === 204) return { ok: true, status: res.status, data: null }
  let data = null
  try { data = await res.json() } catch { /* empty */ }
  if (!res.ok) {
    const code = data?.error?.code || ''
    const message = data?.error?.message || `Microsoft Graph answered ${res.status}`
    const err = new Error(`${code ? code + ': ' : ''}${message}`.slice(0, 300))
    const { kind, reason } = classifyGraphError(res.status, code, message)
    Object.assign(err, { status: res.status, code, kind, reason })
    return { ok: false, status: res.status, error: err }
  }
  return { ok: true, status: res.status, data }
}

/** Who signed in, and does the account have a mailbox. */
export async function whoAmI({ accessToken, fetch: f = fetch }) {
  const me = await graphCall(f, accessToken, '/me?$select=displayName,mail,userPrincipalName')
  if (!me.ok) return { ok: false, error: me.error }
  const email = String(me.data?.mail || me.data?.userPrincipalName || '').trim().toLowerCase()
  const inbox = await graphCall(f, accessToken, '/me/mailFolders/inbox?$select=id')
  if (!inbox.ok) return { ok: false, error: inbox.error }
  return { ok: true, email, displayName: String(me.data?.displayName || '').trim() }
}

/** Build the RFC 5322 message, so Message-ID / In-Reply-To / References are ours. */
export function buildMime(message) {
  return new Promise((resolve, reject) => {
    new MailComposer({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      messageId: message.messageId,
      ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
      ...(message.references?.length ? { references: message.references } : {}),
    }).compile().build((err, buf) => (err ? reject(err) : resolve(buf)))
  })
}

/**
 * The provider for one kind of mailbox: send, and read the inbox.
 *
 * @param {object} args
 * @param {object} args.config    msConfig()
 * @param {Function} args.save    async (mailbox, plainTokenJson) → stores renewed tokens
 * @param {Function} [args.fetch]
 * @param {Function} [args.now]   () → ms
 */
export function createGraphMail({ config, save, fetch: f = fetch, now = () => Date.now() }) {
  /** A usable access token, renewing (and saving) it when it is near expiry. */
  async function tokenFor(mb, plain, { force = false } = {}) {
    const t = unpackTokens(plain)
    if (!t) {
      const err = new Error('The stored Microsoft sign-in cannot be read.')
      return { error: Object.assign(err, { kind: 'auth', reason: 'The stored Microsoft sign-in cannot be read. Reconnect this mailbox.' }) }
    }
    if (!force && t.at && t.exp > now() + 5 * 60_000) return { token: t.at, fresh: false }
    if (!config.configured) {
      return { error: Object.assign(new Error('Microsoft sign-in is not configured on the server.'), { kind: 'transient' }) }
    }
    try {
      const got = await refreshTokens({ config: configForMailbox(config, mb), refreshToken: t.rt, fetch: f })
      const packed = packTokens({ ...got, refresh_token: got.refresh_token || t.rt }, now())
      await save(mb, packed)
      return { token: got.access_token, fresh: true }
    } catch (err) {
      return { error: err }
    }
  }

  /**
   * One Graph call with a token. A cached token that is refused (401 expired,
   * or 403 ErrorAccessDenied) is renewed once and the call retried: the
   * renewal asks for every scope in SCOPES, so a permission an admin granted
   * after the mailbox connected is picked up without signing in again. That
   * was the Mail.ReadWrite case of 2026-09-28: tokens from before the scope
   * existed kept being refused for their remaining hour.
   */
  async function withToken(mb, plain, call) {
    let tok = await tokenFor(mb, plain)
    if (tok.error) return { ok: false, error: tok.error }
    let res = await call(tok.token)
    const refused = res.status === 401 || /AccessDenied/i.test(res.error?.code || '')
    if (!res.ok && refused && !tok.fresh) {
      tok = await tokenFor(mb, plain, { force: true })
      if (tok.error) return { ok: false, error: tok.error }
      res = await call(tok.token)
    }
    return res.ok ? { ok: true, data: res.data, token: tok.token } : { ok: false, error: res.error }
  }

  return {
    /**
     * Send one email. Created as a draft from our own MIME (so threading
     * headers survive), then sent; it lands in the mailbox's Sent Items like
     * any email a person wrote.
     * @returns {Promise<{ ok: true, messageId: string, threadId: string } | { ok: false, error: Error }>}
     */
    async send(mb, plain, message) {
      let mime
      try { mime = (await buildMime(message)).toString('base64') } catch (err) { return { ok: false, error: err } }
      const draft = await withToken(mb, plain, token => graphCall(f, token, '/me/messages', { method: 'POST', body: mime, contentType: 'text/plain' }))
      if (!draft.ok) return { ok: false, error: draft.error }
      const id = draft.data?.id
      const ids = { messageId: draft.data?.internetMessageId || message.messageId, threadId: draft.data?.conversationId || '' }
      const sent = await graphCall(f, draft.token, `/me/messages/${encodeURIComponent(id)}/send`, { method: 'POST' })
      if (sent.ok) return { ok: true, ...ids }
      // Did it go? A draft that can still be deleted was not sent, so the row
      // may safely wait for the next run. One that is gone from Drafts was.
      const del = await graphCall(f, draft.token, `/me/messages/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!del.ok && del.status === 404) return { ok: true, ...ids }
      return { ok: false, error: sent.error }
    },

    /**
     * Did an email this mailbox was handing over actually leave? For a row
     * stuck in 'sending' (see resolveStuck in _cold.js). Looks in Sent Items,
     * then Drafts, in the hour after the row was claimed, and matches by our
     * Message-ID or, when Microsoft replaced it, by the recipient.
     *   { ok, state: 'sent', messageId, threadId, subject, sentAt }
     *   { ok, state: 'draft' }   it was never sent; the draft is deleted
     *   { ok, state: 'none' }    in neither folder
     */
    async findSent(mb, plain, { messageId = '', to = '', since }) {
      const from = new Date(Date.parse(since) - 2 * 60_000).toISOString()
      const until = new Date(Date.parse(since) + 60 * 60_000).toISOString()
      const want = String(to || '').toLowerCase()
      const matches = m => (messageId && m.internetMessageId === messageId)
        || (want && (m.toRecipients || []).some(r => String(r?.emailAddress?.address || '').toLowerCase() === want))
      const list = (folder, field) => {
        const q = new URLSearchParams({
          $filter: `${field} ge ${from} and ${field} le ${until}`,
          $top: '50',
          $select: 'id,internetMessageId,conversationId,subject,sentDateTime,toRecipients',
        })
        return withToken(mb, plain, token => graphCall(f, token, `/me/mailFolders/${folder}/messages?${q}`))
      }

      const sent = await list('sentitems', 'sentDateTime')
      if (!sent.ok) return { ok: false, error: sent.error }
      const hit = (sent.data?.value || []).find(matches)
      if (hit) {
        return { ok: true, state: 'sent', messageId: hit.internetMessageId || messageId, threadId: hit.conversationId || '', subject: hit.subject || '', sentAt: hit.sentDateTime || null }
      }

      const drafts = await list('drafts', 'createdDateTime')
      if (!drafts.ok) return { ok: false, error: drafts.error }
      const draft = (drafts.data?.value || []).find(matches)
      if (!draft) return { ok: true, state: 'none' }
      // Deleted, so nobody opening Drafts can send it by accident later.
      const del = await graphCall(f, drafts.token, `/me/messages/${encodeURIComponent(draft.id)}`, { method: 'DELETE' })
      if (!del.ok && del.status !== 404) return { ok: false, error: del.error }
      return { ok: true, state: 'draft' }
    },

    /**
     * Inbox messages received at or after `sinceIso`, oldest first, at most 50.
     * @returns {Promise<{ ok: true, messages: Array } | { ok: false, error: Error }>}
     */
    async inbox(mb, plain, sinceIso) {
      const q = new URLSearchParams({
        $filter: `receivedDateTime ge ${sinceIso}`,
        $orderby: 'receivedDateTime asc',
        $top: '50',
        // bodyPreview: the first ~255 characters, enough to tell "stop" from
        // "yes, send it". Sorted in _cold.js and never stored.
        $select: 'id,conversationId,internetMessageId,from,subject,receivedDateTime,bodyPreview',
      })
      const res = await withToken(mb, plain, token => graphCall(f, token, `/me/mailFolders/inbox/messages?${q}`))
      if (!res.ok) return { ok: false, error: res.error }
      const messages = (res.data?.value || []).map(m => ({
        id: m.id,
        threadId: m.conversationId || '',
        from: String(m.from?.emailAddress?.address || '').toLowerCase(),
        fromName: String(m.from?.emailAddress?.name || ''),
        subject: String(m.subject || ''),
        preview: String(m.bodyPreview || ''),
        receivedAt: m.receivedDateTime,
      }))
      return { ok: true, messages }
    },
  }
}
