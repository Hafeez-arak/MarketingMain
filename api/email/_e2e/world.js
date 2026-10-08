import crypto from 'node:crypto'
import { simpleParser } from 'mailparser'
import { postgrest } from './postgrest.js'

// ─── The outside world, faked, for the email end-to-end tests ──────────────
// One fetch replaces the global one and answers every URL the email server
// calls:
//
//   ${SUPABASE}/rest/v1/…        PostgREST over PGlite (postgrest.js)
//   ${SUPABASE}/auth/v1/user     who a person's token belongs to
//   login.microsoftonline.com    Microsoft sign-in: codes and refresh tokens
//   graph.microsoft.com          a Microsoft 365 tenant: every mailbox has
//                                Drafts, Sent Items and an Inbox, and email
//                                sent to another address in the world is
//                                delivered to its inbox, in the same thread
//   api.resend.com               the marketing sender
//   dns.google                   DNS over HTTPS: every domain is set up for
//                                Microsoft 365 (MX, SPF, DKIM, DMARC) unless
//                                dnsBroken has it, which has none of them
//
// Knobs on each account make Microsoft misbehave the ways it does in real
// life (refused permission, throttling, no licence, a send that dies after
// Microsoft took it, a revoked sign-in), so each failure path runs for real.

export const SUPABASE = 'http://supabase.test'

const jsonRes = (status, body, headers = {}) => new Response(body == null ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
})

export function createWorld(pg) {
  const users = new Map()        // token → { id, email }
  const accounts = new Map()     // email → Microsoft account
  const codes = new Map()        // sign-in code → email
  const resendSent = []
  const log = []                 // every outside call, for assertions
  const logins = []              // { tenant, grant } per token request
  const dnsBroken = new Set()    // domains with no mail DNS at all
  let seq = 0
  const nextId = p => `${p}-${++seq}`
  const nowIso = () => new Date().toISOString()

  function account(email, opts = {}) {
    const a = {
      email, displayName: opts.displayName || email.split('@')[0],
      licensed: opts.licensed ?? true,
      // Another organisation's Microsoft 365: its tenant id, and only the
      // shared "organizations" endpoint (sign-in) or its own (renewal) know it.
      tenant: opts.tenant || 'tenant-e2e',
      // Knobs, each read at the moment it matters:
      denyDrafts: false,        // 403 ErrorAccessDenied on creating a draft (missing Mail.ReadWrite)
      throttle: false,          // 429 on send
      blocked: false,           // Microsoft blocked it for spam
      revoked: false,           // refresh token refused (invalid_grant)
      dieAfterSend: false,      // Microsoft takes the email, then the connection drops
      dieBeforeSend: false,     // the draft is made, then the connection drops
      rejectRecipient: null,    // address Microsoft refuses outright
      drafts: [], sent: [], inbox: [],
      tokens: new Set(), refresh: `rt-${email}-${crypto.randomUUID()}`,
    }
    accounts.set(email, a)
    return a
  }

  /** A person who can sign in. Also a row in auth.users (foreign keys point there). */
  async function user(email, id = crypto.randomUUID()) {
    const token = `user-token-${id}`
    users.set(token, { id, email })
    await pg.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
    return { id, email, token }
  }

  /** A sign-in code, as Microsoft would hand back to the callback. */
  function signInCode(email) {
    const code = nextId('code')
    codes.set(code, email)
    return code
  }

  function issueTokens(a) {
    const at = `at-${a.email}-${++seq}`
    a.tokens.add(at)
    const idToken = `h.${Buffer.from(JSON.stringify({ tid: a.tenant })).toString('base64url')}.s`
    return { access_token: at, refresh_token: a.refresh, expires_in: 3600, token_type: 'Bearer', id_token: idToken }
  }

  // Threads: a conversation per first Message-ID; a reply joins the thread of
  // whatever it references.
  const threads = new Map()      // message-id → conversationId
  function threadFor(messageId, refs = []) {
    for (const r of refs) if (threads.has(r)) { threads.set(messageId, threads.get(r)); return threads.get(r) }
    const conv = nextId('conv')
    threads.set(messageId, conv)
    return conv
  }

  function deliver(fromA, msg) {
    for (const to of msg.to) {
      const target = accounts.get(to)
      const rec = {
        id: nextId('in'), conversationId: msg.conversationId, internetMessageId: msg.internetMessageId,
        from: { emailAddress: { address: fromA.email, name: fromA.displayName } },
        subject: msg.subject, receivedDateTime: nowIso(), bodyPreview: msg.text.slice(0, 255),
        toRecipients: [{ emailAddress: { address: to } }],
      }
      if (target) target.inbox.push(rec)
    }
  }

  /**
   * Someone outside answers one of our emails: it lands in the mailbox's
   * inbox, in the thread of the email it answers.
   */
  function reply({ to, from, fromName = '', inReplyTo, subject = 'RE: your email', text = 'Yes, please send details.' }) {
    const a = accounts.get(to)
    const conv = threads.get(inReplyTo) || a.sent.find(m => m.internetMessageId === inReplyTo)?.conversationId
    if (!conv) throw new Error(`no thread for ${inReplyTo}`)
    const id = `<${crypto.randomUUID()}@outside.test>`
    threads.set(id, conv)
    a.inbox.push({
      id: nextId('in'), conversationId: conv, internetMessageId: id,
      from: { emailAddress: { address: from, name: fromName } },
      subject, receivedDateTime: nowIso(), bodyPreview: text.slice(0, 255),
    })
    return id
  }

  function graphMailbox(authz) {
    const token = String(authz || '').replace(/^Bearer /, '')
    for (const a of accounts.values()) if (a.tokens.has(token)) return a
    return null
  }

  function graphError(status, code, message = code) {
    return jsonRes(status, { error: { code, message } })
  }

  async function graph(method, url, init) {
    const a = graphMailbox(init.headers?.Authorization || init.headers?.authorization)
    if (!a) return graphError(401, 'InvalidAuthenticationToken')
    const p = url.pathname.replace(/^\/v1\.0/, '')
    const q = url.searchParams

    if (!a.licensed && p.startsWith('/me/mail')) return graphError(404, 'MailboxNotEnabledForRESTAPI')
    if (method === 'GET' && p === '/me') return jsonRes(200, { displayName: a.displayName, mail: a.email, userPrincipalName: a.email })
    if (method === 'GET' && p === '/me/mailFolders/inbox' && !q.has('$filter')) return jsonRes(200, { id: 'inbox' })

    if (method === 'POST' && p === '/me/messages') {
      if (a.denyDrafts) return graphError(403, 'ErrorAccessDenied', 'Access is denied. Check credentials and try again.')
      const mime = Buffer.from(String(init.body), 'base64')
      const parsed = await simpleParser(mime)
      const to = (parsed.to?.value || []).map(v => String(v.address).toLowerCase())
      if (a.rejectRecipient && to.includes(a.rejectRecipient)) return graphError(400, 'ErrorInvalidRecipients', 'At least one recipient is not valid.')
      const refs = [].concat(parsed.references || [], parsed.inReplyTo || []).filter(Boolean)
      const internetMessageId = parsed.messageId
      const conversationId = threadFor(internetMessageId, refs)
      const d = {
        id: nextId('msg'), internetMessageId, conversationId, subject: parsed.subject || '',
        to, toRecipients: to.map(address => ({ emailAddress: { address } })),
        text: parsed.text || '', html: parsed.html || '', inReplyTo: parsed.inReplyTo || null, references: refs,
        createdDateTime: nowIso(), sentDateTime: null,
      }
      a.drafts.push(d)
      log.push({ kind: 'draft', mailbox: a.email, to, subject: d.subject })
      if (a.dieBeforeSend) { a.dieBeforeSend = false; throw new TypeError('fetch failed (connection reset)') }
      return jsonRes(201, { id: d.id, internetMessageId, conversationId })
    }

    const sendM = p.match(/^\/me\/messages\/([^/]+)\/send$/)
    if (method === 'POST' && sendM) {
      const id = decodeURIComponent(sendM[1])
      const i = a.drafts.findIndex(d => d.id === id)
      if (i < 0) return graphError(404, 'ErrorItemNotFound')
      if (a.blocked) return graphError(403, 'ErrorMessageSubmissionBlocked')
      if (a.throttle) return graphError(429, 'ApplicationThrottled')
      const [d] = a.drafts.splice(i, 1)
      d.sentDateTime = nowIso()
      a.sent.push(d)
      log.push({ kind: 'sent', mailbox: a.email, to: d.to, subject: d.subject, messageId: d.internetMessageId, inReplyTo: d.inReplyTo })
      deliver(a, d)
      if (a.dieAfterSend) { a.dieAfterSend = false; throw new TypeError('fetch failed (socket hang up)') }
      return new Response(null, { status: 202 })
    }

    const delM = p.match(/^\/me\/messages\/([^/]+)$/)
    if (method === 'DELETE' && delM) {
      const id = decodeURIComponent(delM[1])
      const i = a.drafts.findIndex(d => d.id === id)
      if (i < 0) return graphError(404, 'ErrorItemNotFound')
      a.drafts.splice(i, 1)
      return new Response(null, { status: 204 })
    }

    const listM = p.match(/^\/me\/mailFolders\/(inbox|sentitems|drafts)\/messages$/)
    if (method === 'GET' && listM) {
      const box = { inbox: a.inbox, sentitems: a.sent, drafts: a.drafts }[listM[1]]
      let items = [...box]
      // "receivedDateTime ge X" / "sentDateTime ge A and sentDateTime le B"
      for (const clause of String(q.get('$filter') || '').split(' and ').filter(Boolean)) {
        const [field, op, val] = clause.split(' ')
        items = items.filter(m => {
          const v = m[field]
          if (!v) return false
          return op === 'ge' ? v >= val : op === 'le' ? v <= val : true
        })
      }
      if (/asc/.test(q.get('$orderby') || '')) items.sort((x, y) => String(x.receivedDateTime).localeCompare(String(y.receivedDateTime)))
      items = items.slice(0, Number(q.get('$top') || 50))
      return jsonRes(200, { value: items })
    }
    return graphError(400, 'NotModelled', `${method} ${p}`)
  }

  async function login(url, init) {
    const form = new URLSearchParams(String(init.body))
    const tenant = url.pathname.split('/')[1]
    logins.push({ tenant, grant: form.get('grant_type') })
    if (form.get('grant_type') === 'authorization_code') {
      const email = codes.get(form.get('code'))
      if (!email) return jsonRes(400, { error: 'invalid_grant', error_description: 'AADSTS70000: code expired' })
      codes.delete(form.get('code'))
      const a = accounts.get(email)
      // AADSTS50020: our own tenant does not know another organisation's user.
      if (tenant !== a.tenant && tenant !== 'organizations') return jsonRes(400, { error: 'invalid_grant', error_description: 'AADSTS50020: user account does not exist in tenant' })
      return jsonRes(200, issueTokens(a))
    }
    if (form.get('grant_type') === 'refresh_token') {
      const a = [...accounts.values()].find(x => x.refresh === form.get('refresh_token'))
      if (!a || a.revoked) return jsonRes(400, { error: 'invalid_grant', error_description: 'AADSTS50173: the grant has expired.' })
      if (tenant !== a.tenant) return jsonRes(400, { error: 'invalid_grant', error_description: 'AADSTS50020: user account does not exist in tenant' })
      return jsonRes(200, issueTokens(a))
    }
    return jsonRes(400, { error: 'unsupported_grant_type' })
  }

  function dns(url) {
    const name = String(url.searchParams.get('name') || '').toLowerCase()
    const type = url.searchParams.get('type')
    const domain = name.replace(/^(_dmarc|[a-z0-9-]+\._domainkey)\./, '')
    const answer = (t, data) => jsonRes(200, { Status: 0, Answer: [{ name, type: t, data }] })
    if (dnsBroken.has(domain)) return jsonRes(200, { Status: 3 })
    if (type === 'MX') return answer(15, `0 ${domain.replace(/\./g, '-')}.mail.protection.outlook.com.`)
    if (type !== 'TXT') return jsonRes(200, { Status: 0 })
    if (name.startsWith('_dmarc.')) return answer(16, '"v=DMARC1; p=none"')
    if (/^selector[12]\._domainkey\./.test(name)) return answer(16, '"v=DKIM1; k=rsa; p=MIIBIjANBgkq"')
    if (name === 'spf.protection.outlook.com') return answer(16, '"v=spf1 ip4:40.92.0.0/15 -all"')
    if (name.includes('_domainkey')) return jsonRes(200, { Status: 0 })
    return answer(16, '"v=spf1 include:spf.protection.outlook.com -all"')
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = (init.method || 'GET').toUpperCase()
    if (url.origin === SUPABASE) {
      const authz = String(init.headers?.Authorization || init.headers?.authorization || '').replace(/^Bearer /, '')
      if (url.pathname === '/auth/v1/user') {
        const u = users.get(authz)
        return u ? jsonRes(200, u) : jsonRes(401, { message: 'invalid token' })
      }
      const table = url.pathname.replace('/rest/v1/', '')
      const prefer = init.headers?.Prefer || init.headers?.prefer || ''
      const out = await postgrest(pg, {
        method, table, search: url.search, prefer, user: users.get(authz) || null,
        body: init.body ? JSON.parse(init.body) : undefined,
      })
      if (out.status >= 400) log.push({ kind: 'db-error', method, path: `${table}${url.search}`, error: out.body })
      return jsonRes(out.status, out.body, out.headers)
    }
    if (url.hostname === 'login.microsoftonline.com') return login(url, init)
    if (url.hostname === 'graph.microsoft.com') return graph(method, url, init)
    if (url.hostname === 'dns.google' || url.hostname === 'cloudflare-dns.com') return dns(url)
    if (url.hostname === 'api.resend.com') {
      const body = JSON.parse(init.body)
      if (url.pathname === '/emails/batch') {
        const data = body.map(e => { const id = nextId('re'); resendSent.push({ ...e, id }); return { id } })
        return jsonRes(200, { data })
      }
      const id = nextId('re')
      resendSent.push({ ...body, id })
      return jsonRes(200, { id })
    }
    throw new Error(`The e2e world has no answer for ${method} ${url}`)
  }

  return { pg, fetch: fetchImpl, account, accounts, user, signInCode, reply, resendSent, log, dnsBroken, logins }
}
