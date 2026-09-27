// ─── Resend, the only part of this app that talks to it ────────────────────
// Sending only. The key in use is a "sending access" key: it can send and it
// can do nothing else — not list domains, not read what was sent, not change
// webhooks. That is deliberate. Domain setup and webhook setup happen in the
// Resend dashboard, and a leaked key can send email but cannot reconfigure the
// account.

const API = 'https://api.resend.com'

/** Turn a Resend error into a sentence a person can act on. */
export function explainResendError(status, body) {
  const msg = String(body?.message || body?.error || '').trim()
  const name = String(body?.name || '')
  if (status === 401 || name === 'missing_api_key' || name === 'invalid_api_key') {
    return 'The email service rejected the sending key.'
  }
  if (status === 403 && /domain/i.test(msg)) {
    return `The sending domain is not verified yet, so this address cannot send. (${msg})`
  }
  if (status === 403 && /testing emails|own email/i.test(msg)) {
    return `${msg} Until your domain is verified, Resend only lets you send test emails to the address you signed up with.`
  }
  if (status === 429) return 'Resend rate limit reached. The emails stay queued and go out on the next run.'
  if (status === 422 || status === 400) return `Resend refused the email: ${msg || name || status}`
  return msg || `Resend error ${status}`
}

export function createResend({ apiKey, fetchImpl = fetch }) {
  async function call(path, body, { idempotencyKey } = {}) {
    let res
    try {
      res = await fetchImpl(`${API}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      // Never reached Resend: nothing was sent, safe to try again later.
      return { ok: false, status: 0, retryable: true, error: `Could not reach Resend: ${err.message}` }
    }
    const text = await res.text().catch(() => '')
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { /* keep text */ }
    if (res.ok) return { ok: true, status: res.status, json }
    return {
      ok: false,
      status: res.status,
      retryable: res.status === 429 || res.status >= 500,
      error: explainResendError(res.status, json || { message: text.slice(0, 300) }),
    }
  }

  return {
    async send(email, opts) {
      const r = await call('/emails', email, opts)
      return r.ok ? { ...r, id: r.json?.id || null } : r
    },
    /** Up to 100 emails; ids come back in the same order. */
    async batch(emails, opts) {
      const r = await call('/emails/batch', emails, opts)
      if (!r.ok) return r
      const list = Array.isArray(r.json?.data) ? r.json.data : Array.isArray(r.json) ? r.json : []
      return { ...r, ids: list.map(x => x?.id || null) }
    },
  }
}
