#!/usr/bin/env node
// ─── Turn a short-lived Meta token into a 60-day one, in place ─────────────
//
// A token straight out of Graph API Explorer lives 1–2 hours. This exchanges
// it for the long-lived version and writes the result back into .env, so the
// thing you edit and the thing the agent reads cannot drift apart.
//
// Nothing secret is ever printed. The old .env is backed up beside itself
// first, because a botched write here would take Supabase down with it.
//
//   node scripts/meta-token-extend.mjs
//
// Needs META_APP_ID and META_APP_SECRET in .env alongside META_IG_TOKEN.
// The app secret is at developers.facebook.com → your app → Settings → Basic.

import fs from 'node:fs'
import path from 'node:path'

const ENV = path.resolve(process.cwd(), '.env')
if (!fs.existsSync(ENV)) {
  console.error(`No .env at ${ENV}. Run this from the repo root.`)
  process.exit(1)
}

const raw = fs.readFileSync(ENV, 'utf8')
const read = k => (raw.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '')

const token = read('META_IG_TOKEN')
const appId = read('META_APP_ID')
const secret = read('META_APP_SECRET')

const missing = [
  !token && 'META_IG_TOKEN',
  !appId && 'META_APP_ID',
  !secret && 'META_APP_SECRET',
].filter(Boolean)

if (missing.length) {
  console.error(`Missing from .env: ${missing.join(', ')}`)
  console.error('META_APP_SECRET is at developers.facebook.com → your app → Settings → Basic.')
  process.exit(1)
}

const G = 'https://graph.facebook.com/v23.0'
const q = new URLSearchParams({
  grant_type: 'fb_exchange_token',
  client_id: appId,
  client_secret: secret,
  fb_exchange_token: token,
})

const res = await fetch(`${G}/oauth/access_token?${q}`)
const body = await res.json().catch(() => ({}))

if (!res.ok || !body.access_token) {
  // Printed in full because a failure here is always a config problem the
  // message names precisely — and the response carries no secret.
  console.error(`Exchange failed (HTTP ${res.status}):`)
  console.error(JSON.stringify(body, null, 2))
  process.exit(1)
}

// Confirm what we were actually given before overwriting anything. An exchange
// that silently hands back a short-lived token would otherwise look like
// success and fail again in an hour.
const dbg = await fetch(
  `${G}/debug_token?input_token=${encodeURIComponent(body.access_token)}` +
  `&access_token=${encodeURIComponent(body.access_token)}`,
).then(r => r.json()).catch(() => ({}))

const expiresAt = dbg?.data?.expires_at
const days = expiresAt ? Math.round((expiresAt - Date.now() / 1000) / 86400) : null

fs.copyFileSync(ENV, `${ENV}.bak-${new Date().toISOString().slice(0, 10)}`)
const next = raw.replace(/^META_IG_TOKEN=.*$/m, `META_IG_TOKEN=${body.access_token}`)
if (next === raw) {
  console.error('Could not find a META_IG_TOKEN= line to replace. Nothing written.')
  process.exit(1)
}
fs.writeFileSync(ENV, next)

console.log('New long-lived token written to .env (backup saved alongside).')
console.log(`  valid    : ${dbg?.data?.is_valid ?? 'unknown'}`)
console.log(`  expires  : ${expiresAt ? new Date(expiresAt * 1000).toISOString() : 'never reported'}` +
            `${days !== null ? `  (~${days} days)` : ''}`)
if (expiresAt === 0) {
  console.log('  expires  : never — this is a non-expiring token.')
}
if (days !== null && days < 7 && expiresAt !== 0) {
  console.log('\n  WARNING: that is still short-lived. The exchange returned a token that')
  console.log('  expires almost immediately, which usually means the app id or secret')
  console.log('  does not match the app the original token came from.')
}
console.log('\nA 60-day token is a reprieve, not a fix. For something permanent use a')
console.log('Business Manager System User token — Business Settings → Users → System')
console.log('Users → Generate New Token, with Token Expiration set to Never.')
