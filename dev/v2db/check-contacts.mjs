#!/usr/bin/env node
// ─── Check Contacts in the database, signed in as real local logins ────────
// 2026-10-28, dev/erp-pilot/CONTACTS.md. supabase/contacts.test.js proves
// the rules on an in-process Postgres; this asks the running local stack
// the same questions through the API, as the app does, after
// dev/v2db/seed-contacts.sql:
//
//   hafeez@arak-sa.com      the access admin (every section, every company)
//   junaid@arak-sa.com      a member of every company, no Contacts grant:
//                           the admin gives one in Arak Lighting for the
//                           check (view → work → manage) and takes it away
//   junaidatif40@gmail.com  not a member of Arak Lighting at all
//
// Cleans up what it made (the grant and the check's organisation). Local
// database only. Exits 1 on any failure.
//
//   node dev/v2db/check-contacts.mjs

import { asUser } from './check-sections.mjs'

const URL = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const ARAK = '00000000-0000-0000-0000-000000000001'
const GHUSN = 'c688dfbe-9d93-4a88-adbb-605e8b81e8f8'
const GHUSN_ORG = 'c0000000-0000-4000-8000-000000000021'

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
const count = async (tok, ws) => ((await asUser(tok, `contacts_orgs?workspace_id=eq.${ws}&select=id`)).rows || []).length

const admin = await signIn('hafeez@arak-sa.com')
const member = await signIn('junaid@arak-sa.com')
const stranger = await signIn('junaidatif40@gmail.com')
const grant = level => asUser(admin, 'section_access?on_conflict=workspace_id,user_id,section', {
  method: 'POST', prefer: 'resolution=merge-duplicates',
  body: { workspace_id: ARAK, user_id: uid(member), section: 'contacts', level, granted_by: uid(admin) },
})
const name = `Check org (test) ${Date.now()}`

try {
  // ── Company separation ──
  const arak = await count(admin, ARAK), ghusn = await count(admin, GHUSN)
  check(arak >= 11 && ghusn >= 2, `the admin reads each company's own (Arak ${arak}, Ghusn ${ghusn})`)
  const leak = await asUser(admin, `contacts_orgs?workspace_id=eq.${ARAK}&id=eq.${GHUSN_ORG}&select=id`)
  check(leak.rows.length === 0, 'a Ghusn organisation never answers a query for Arak')
  const crossed = await asUser(admin, 'contacts_people', { method: 'POST', body: { workspace_id: ARAK, org_id: GHUSN_ORG, name: 'Crossed (test)' } })
  check(!crossed.ok, 'a person in Arak cannot be put under a Ghusn organisation')
  check(await count(stranger, ARAK) === 0, 'someone outside Arak reads none of its contacts')
  check(!(await asUser(stranger, 'contacts_orgs', { method: 'POST', body: { workspace_id: ARAK, name } })).ok, 'and cannot add one')

  // ── No grant ──
  check(await count(member, ARAK) === 0, 'a member without a Contacts grant reads nothing')
  check(!(await asUser(member, 'contacts_orgs', { method: 'POST', body: { workspace_id: ARAK, name } })).ok, 'and adds nothing')

  // ── View ──
  check((await grant('view')).ok, 'the admin grants View')
  check(await count(member, ARAK) === arak, 'View reads every organisation')
  check(await count(member, GHUSN) === 0, 'but only in the company it was granted in')
  check(!(await asUser(member, 'contacts_orgs', { method: 'POST', body: { workspace_id: ARAK, name } })).ok, 'View cannot add')

  // ── Work ──
  check((await grant('work')).ok, 'the admin grants Work')
  const made = await asUser(member, 'contacts_orgs', { method: 'POST', prefer: 'return=representation', body: { workspace_id: ARAK, name, roles: ['supplier', 'client'] } })
  const id = made.rows?.[0]?.id
  check(made.ok && JSON.stringify(made.rows[0].roles) === '["client","supplier"]', 'Work adds an organisation (roles kept in order)')
  const dup = await asUser(member, 'contacts_orgs', { method: 'POST', body: { workspace_id: ARAK, name: 'Copy (test)', vat_number: '399999999900013' } })
  check(!dup.ok && dup.rows?.message === 'CONTACTS_DUPLICATE_VAT', `the same VAT number is refused, naming the holder ("${dup.rows?.details}")`)
  const arch = await asUser(member, `contacts_orgs?id=eq.${id}`, { method: 'PATCH', body: { status: 'archived' } })
  check(!arch.ok && arch.rows?.message === 'CONTACTS_NEEDS_MANAGE', 'Work cannot archive')
  const del = await asUser(member, `contacts_orgs?id=eq.${id}`, { method: 'DELETE', prefer: 'return=representation' })
  check(del.ok && del.rows.length === 0, 'Work cannot delete')
  const imp = await asUser(member, 'rpc/contacts_import_orgs', { method: 'POST', body: { ws: ARAK, items: [] } })
  check(!imp.ok && imp.rows?.message === 'CONTACTS_NEEDS_MANAGE', 'Work cannot import')

  // ── Manage ──
  check((await grant('manage')).ok, 'the admin grants Manage')
  const a = await asUser(member, `contacts_orgs?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: { status: 'archived' } })
  check(a.ok && a.rows[0].archived_by === uid(member), 'Manage archives, and the database records who')
  const locked = await asUser(member, `contacts_orgs?id=eq.${id}`, { method: 'PATCH', body: { notes: 'x' } })
  check(!locked.ok && locked.rows?.message === 'CONTACTS_ARCHIVED', 'an archived organisation is locked')
  const late = await asUser(member, 'contacts_people', { method: 'POST', body: { workspace_id: ARAK, org_id: id, name: 'Late (test)' } })
  check(!late.ok && late.rows?.message === 'CONTACTS_ARCHIVED', 'and nobody is added to it')
  check((await asUser(member, `contacts_orgs?id=eq.${id}`, { method: 'PATCH', body: { status: 'active' } })).ok, 'Manage restores it')
  const imp2 = await asUser(member, 'rpc/contacts_import_orgs', { method: 'POST', body: { ws: ARAK, items: [] } })
  check(imp2.ok && Array.isArray(imp2.rows), 'Manage may import')
  const gone = await asUser(member, `contacts_orgs?id=eq.${id}`, { method: 'DELETE', prefer: 'return=representation' })
  check(gone.ok && gone.rows.length === 1, 'Manage deletes an organisation nobody uses (cleanup)')
} finally {
  const back = await asUser(admin, `section_access?workspace_id=eq.${ARAK}&user_id=eq.${uid(member)}&section=eq.contacts`, { method: 'DELETE', prefer: 'return=representation' })
  check(back.ok && back.rows.length === 1, 'cleanup: the check\'s grant is taken away again')
  const left = await asUser(admin, `contacts_orgs?name=like.${encodeURIComponent('Check org (test)*')}&select=id`)
  check(left.rows.length === 0, 'cleanup: nothing of the check is left')
}
console.log(failed ? `\n${failed} failed.` : '\nAll as intended.')
process.exitCode = failed ? 1 : 0
