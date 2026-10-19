#!/usr/bin/env node
// ─── Check the Email API's section gate, signed in as the test logins ──────
// 2026-10-19. The Email routes act with the service key after their own
// checks, so RLS alone would not stop someone without Marketing. Asks the
// running dev server (npx vite --mode v2 --port 5180) as each person for
// Email's read-only `status` (Marketing at view or more gets past the gate)
// and for `mailbox_pause` with no mailbox, which changes things (Marketing at
// work gets past the gate and is then told the mailbox is missing; everyone
// else is refused with 403 first). Nothing is changed. Local only.

import { tokens } from './check-sections.mjs'

const APP = process.env.V2_APP || 'http://localhost:5180'
const WS = '00000000-0000-0000-0000-000000000001'
const tok = await tokens()
const canRead = new Set(['owner@arak.test', 'marketing@arak.test', 'ceo@arak.test'])
const canWork = new Set(['owner@arak.test', 'marketing@arak.test'])
let bad = 0
for (const [action, allowed] of [['status', canRead], ['mailbox_pause', canWork]]) {
  console.log(`\n${action}`)
  for (const [email, t] of Object.entries(tok)) {
    if (!t) continue
    const r = await fetch(`${APP}/api/email/${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: WS }),
    })
    const body = await r.json().catch(() => ({}))
    const passed = r.status !== 403
    const ok = passed === allowed.has(email)
    if (!ok) bad++
    console.log(`${ok ? '✓' : '✗'} ${email.padEnd(26)} ${r.status} ${passed ? `(past the gate${body.error ? `: ${body.error}` : ''})` : body.error || ''}`)
  }
}
console.log(bad ? `\n${bad} wrong.` : '\nEmail: Marketing view reads, Marketing work changes, nobody else gets in.')
process.exitCode = bad ? 1 : 0
