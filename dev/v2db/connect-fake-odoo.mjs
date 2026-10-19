#!/usr/bin/env node
// ─── Connect the LOCAL v2 company to the fake Odoo ─────────────────────────
// 2026-10-19. With the fake Odoo running (node dev/v2db/fakeOdoo.js), this
// stores its connection for "Arak Lighting (test)" exactly as the admin's
// Connect would: the API key sealed with the (local) service key. Then the
// CEO page's "Update now", or the hourly round, reads it into the mirror.
//
//   node dev/v2db/fakeOdoo.js &          (port 8069)
//   node dev/v2db/connect-fake-odoo.mjs
//
// Local database only: refuses any other address.

import { sealSecret } from '../../api/email/_secrets.js'
import { FAKE } from './fakeOdoo.js'

const URL = 'http://127.0.0.1:54321'
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const WS = '00000000-0000-0000-0000-000000000001'
const ODOO = process.argv[2] || 'http://127.0.0.1:8069'

const r = await fetch(`${URL}/rest/v1/lead_crm?on_conflict=workspace_id`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify({
    workspace_id: WS, kind: 'odoo', url: ODOO, db: FAKE.db, login: FAKE.login,
    api_key: sealSecret(FAKE.apiKey, KEY), odoo_uid: FAKE.uid, server_version: FAKE.version,
    last_checked_at: new Date().toISOString(), last_error: '',
  }),
})
console.log(r.ok ? `Connected the local test company to the fake Odoo at ${ODOO}.` : `Failed: ${r.status} ${await r.text()}`)
