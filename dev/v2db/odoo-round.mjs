#!/usr/bin/env node
// ─── One Odoo mirror round (and Technical's monitor), on the LOCAL database ──
// 2026-10-19. What the hourly round does, run now and forced, through the
// same server code (api/leads/_deps.js → _odooSync.js → _technical.js):
//
//   node dev/v2db/fakeOdoo.js &          (the fake Odoo, port 8069)
//   node dev/v2db/connect-fake-odoo.mjs  (once)
//   node dev/v2db/odoo-round.mjs
//
// Reads the local keys from .env.v2 and refuses any address that is not this
// machine, so it can never reach production.

import { readFileSync } from 'node:fs'

for (const line of readFileSync(new URL('../../.env.v2', import.meta.url), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
for (const k of ['SUPABASE_URL', 'VITE_SUPABASE_URL']) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(process.env[k] || '')) {
    console.error(`Refusing: ${k} is not this machine (${process.env[k] || 'unset'}).`)
    process.exit(1)
  }
}

const WS = '00000000-0000-0000-0000-000000000001'
const { leadDeps } = await import('../../api/leads/_deps.js')
const out = await leadDeps().odoo({ workspaceId: WS, force: true })
console.log(JSON.stringify(out, null, 2))
