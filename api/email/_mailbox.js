import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'

// ─── Talking to a real mailbox ─────────────────────────────────────────────
// SMTP to send, IMAP to read. The only file that opens a socket to a mail
// server; the engine (_cold.js) gets these functions injected, so its tests
// never do.
//
// Google mailboxes connect with an APP PASSWORD (Google Account → Security →
// 2-Step Verification → App passwords), never the account password: it can
// be revoked on its own and works only for mail.

const TIMEOUTS = { connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 30_000 }

function transportFor(mailbox, password) {
  const port = Number(mailbox.smtp_port) || 465
  return nodemailer.createTransport({
    host: mailbox.smtp_host,
    port,
    secure: port === 465,        // 465 is TLS from the start; 587 upgrades with STARTTLS
    requireTLS: port !== 465,
    auth: { user: mailbox.username || mailbox.email, pass: password },
    ...TIMEOUTS,
  })
}

function imapFor(mailbox, password) {
  return new ImapFlow({
    host: mailbox.imap_host,
    port: Number(mailbox.imap_port) || 993,
    secure: true,
    auth: { user: mailbox.username || mailbox.email, pass: password },
    logger: false,
    socketTimeout: 30_000,
  })
}

/**
 * Log in to both servers and log out. Nothing is sent or read.
 * @returns {Promise<{ ok: boolean, error?: string, where?: 'smtp'|'imap' }>}
 */
export async function verifyMailbox(mailbox, password) {
  const smtp = transportFor(mailbox, password)
  try {
    await smtp.verify()
  } catch (err) {
    return { ok: false, where: 'smtp', error: explain(err, 'sending (SMTP)') }
  } finally {
    smtp.close()
  }
  const imap = imapFor(mailbox, password)
  try {
    await imap.connect()
    await imap.logout()
  } catch (err) {
    try { imap.close() } catch { /* already closed */ }
    return { ok: false, where: 'imap', error: explain(err, 'reading (IMAP)') }
  }
  return { ok: true }
}

/**
 * Send one email.
 * @param {object} message { from:{name,address}, to:{name,address}, subject, text, html, messageId, inReplyTo?, references? }
 * @returns {Promise<{ ok: true, messageId: string } | { ok: false, error: Error }>}
 */
export async function sendFromMailbox(mailbox, password, message) {
  const smtp = transportFor(mailbox, password)
  try {
    const info = await smtp.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      messageId: message.messageId,
      ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
      ...(message.references?.length ? { references: message.references } : {}),
    })
    if (info.rejected?.length) {
      const err = new Error(`Rejected: ${info.rejected.join(', ')}`)
      err.command = 'RCPT TO'
      err.responseCode = 550
      return { ok: false, error: err }
    }
    return { ok: true, messageId: info.messageId || message.messageId }
  } catch (err) {
    return { ok: false, error: err }
  } finally {
    smtp.close()
  }
}

function explain(err, what) {
  const text = String(err?.response || err?.message || err || '')
  if (err?.code === 'EAUTH' || /auth|credentials|username and password|535/i.test(text)) {
    return `The ${what} login was refused. Check the address and use an app password, not the account password.`
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(`${err?.code} ${text}`)) return `The ${what} server name was not found. Check it for typos.`
  if (/ETIMEDOUT|ECONNREFUSED|timeout/i.test(`${err?.code} ${text}`)) return `The ${what} server did not answer. Check the server name and port.`
  return `The ${what} server said: ${text.slice(0, 200)}`
}
