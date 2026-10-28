#!/usr/bin/env node
// ─── Check the v2 shell in the database, signed in as real local logins ────
// 2026-10-28, docs/SHELL.md. supabase/shell.test.js proves the rules on an
// in-process Postgres; this asks the running local stack the same questions
// through the API, as the app does:
//
//   staff.admin@arak-sa.com      the access admin (every section)
//   staff.marketing@arak-sa.com  Marketing and Insights to work in, CRM to read
//   staff.dev@arak-sa.com        Marketing and Insights, CRM to work in
//
// Pins: each person saves and reads only their own row. Search: each module's
// function answers only those who can open the module, in the company asked.
// Cleans up the pins it wrote (and only those). Local database only. Exits 1
// on any failure.
//
//   node dev/v2db/check-shell.mjs

import { asUser } from './check-sections.mjs'

const URL = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const ARAK = '00000000-0000-0000-0000-000000000001'
const GHUSN = 'c688dfbe-9d93-4a88-adbb-605e8b81e8f8'

async function signIn(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'arak-v2-local' }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`sign in ${email}: ${JSON.stringify(j).slice(0, 200)}`)
  return j.access_token
}
const uid = t => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sub

let failed = 0
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed++ }
const find = async (tok, fn, ws, q) => {
  const r = await asUser(tok, `rpc/${fn}`, { method: 'POST', body: { ws, q, lim: 5 } })
  return r.ok ? r.rows : null
}

const admin = await signIn('staff.admin@arak-sa.com')
const sara = await signIn('staff.marketing@arak-sa.com')
const tariq = await signIn('staff.dev@arak-sa.com')
// Pins that existed before the check are put back afterwards.
const before = {}
for (const [name, tok] of Object.entries({ admin, sara, tariq })) {
  before[name] = (await asUser(tok, `shell_pins?workspace_id=eq.${ARAK}&select=sections`)).rows?.[0]?.sections ?? null
}

try {
  // ── Pins ──
  const save = (tok, body) => asUser(tok, 'shell_pins?on_conflict=workspace_id,user_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body })
  check((await save(sara, { workspace_id: ARAK, user_id: uid(sara), sections: ['crm', 'marketing'] })).ok, 'Sara saves her own pins')
  const mine = await asUser(sara, `shell_pins?workspace_id=eq.${ARAK}&select=user_id,sections`)
  check(mine.rows.length === 1 && mine.rows[0].sections.join() === 'crm,marketing', 'and reads them back')
  check((await asUser(admin, `shell_pins?user_id=eq.${uid(sara)}&select=sections`)).rows.length === 0, 'the access admin cannot read hers')
  check(!(await save(tariq, { workspace_id: ARAK, user_id: uid(sara), sections: ['hr'] })).ok, 'Tariq cannot write hers')
  const outside = await asUser(sara, 'shell_pins', { method: 'POST', body: { workspace_id: '57ea6bde-ddb3-4e49-ad45-4402bdac6998', user_id: uid(sara), sections: ['crm'] } })
  check(!outside.ok, 'nobody pins in a company they do not belong to')

  // ── Search ──
  check((await find(admin, 'shell_search_contacts', ARAK, 'ابراج'))?.some(r => r.kind === 'org'), 'the admin finds an organisation by its Arabic name without the hamza')
  check((await find(admin, 'shell_search_hr', ARAK, 'نوره'))?.length > 0, 'and an employee with ه for ة')
  check((await find(admin, 'shell_search_leads', ARAK, 'light'))?.length > 0, 'and leads')
  check((await find(sara, 'shell_search_crm', ARAK, 'light'))?.length > 0, 'Sara finds opportunities (CRM to read)')
  for (const fn of ['shell_search_contacts', 'shell_search_hr', 'shell_search_leads']) {
    check((await find(sara, fn, ARAK, 'a'))?.length === 0, `Sara gets nothing from ${fn} (no grant)`)
  }
  check((await find(sara, 'shell_search_crm', GHUSN, 'test'))?.length === 0, 'and nothing from another company she has no CRM in')
  const anon = await fetch(`${URL}/rest/v1/rpc/shell_search_tasks`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ ws: ARAK, q: 'a' }) })
  check(!anon.ok, 'signed-out callers cannot search')
} finally {
  for (const [name, tok] of Object.entries({ admin, sara, tariq })) {
    if (before[name] === null) await asUser(tok, `shell_pins?workspace_id=eq.${ARAK}&user_id=eq.${uid(tok)}`, { method: 'DELETE' })
    else await asUser(tok, `shell_pins?workspace_id=eq.${ARAK}&user_id=eq.${uid(tok)}`, { method: 'PATCH', body: { sections: before[name] } })
  }
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
