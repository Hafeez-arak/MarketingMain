import crypto from 'node:crypto'

// ─── Mailbox passwords at rest ─────────────────────────────────────────────
// An app password is a key to a real mailbox, so it is never stored as
// written. AES-256-GCM, with the key derived (HKDF) from the Supabase service
// key the server already holds — no new environment variable to forget, and
// a copy of the database alone (a backup, a leaked read) decrypts nothing.
//
// Consequence, on purpose: rotating SUPABASE_SERVICE_ROLE_KEY makes every
// stored password unreadable. The mailbox then shows "reconnect" and someone
// pastes its app password again (docs/EMAIL-SETUP.md, section 12).

const VERSION = 'v1'

function keyFrom(serviceKey) {
  if (!serviceKey) throw new Error('No server key to encrypt with.')
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(serviceKey), Buffer.from('arak-email'), Buffer.from('mailbox-password-v1'), 32))
}

export function sealSecret(plain, serviceKey) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(serviceKey), iv)
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

/** The plain secret, or null if it cannot be opened (wrong key, tampered). */
export function openSecret(sealed, serviceKey) {
  const [version, iv, tag, ct] = String(sealed || '').split(':')
  if (version !== VERSION || !iv || !tag || !ct) return null
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(serviceKey), Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
