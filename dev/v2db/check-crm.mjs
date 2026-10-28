#!/usr/bin/env node
// ─── Check the CRM in the database, signed in as real local logins ─────────
// 2026-10-28, dev/erp-pilot/CRM.md. supabase/crm.test.js proves every rule
// on an in-process Postgres; this asks the running local stack the main
// questions through the API, as the app does, after seed-contacts.sql and
// seed-crm.sql:
//
//   staff.admin@arak-sa.com      the access admin (every section, every company)
//   staff.dev@arak-sa.com        the CRM at Work in Arak Lighting (seed-crm.sql)
//   staff.marketing@arak-sa.com  the CRM at View in Arak Lighting
//   outside.two@example.com      not a member of Arak Lighting at all
//
// It makes one opportunity and deletes it again (an open one with no done
// activity can be deleted; won/lost and done activities are proved in the
// PGlite tests, since they cannot be undone). Local database only. Exits 1
// on any failure.
//
//   node dev/v2db/check-crm.mjs

import { asUser } from './check-sections.mjs'

const URL = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const ARAK = '00000000-0000-0000-0000-000000000001'
const GHUSN = 'c688dfbe-9d93-4a88-adbb-605e8b81e8f8'
const GHUSN_LEAD = 'e0000000-0000-4000-8000-000000000021'
const ARCHIVED_ORG = 'c0000000-0000-4000-8000-000000000010'

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
const leads = async (tok, ws) => ((await asUser(tok, `crm_leads?workspace_id=eq.${ws}&select=id`)).rows || []).length

const admin = await signIn('staff.admin@arak-sa.com')
const worker = await signIn('staff.dev@arak-sa.com')
const viewer = await signIn('staff.marketing@arak-sa.com')
const stranger = await signIn('outside.two@example.com')
const stage = async name => (await asUser(admin, `crm_stages?workspace_id=eq.${ARAK}&name_en=eq.${encodeURIComponent(name)}&select=id`)).rows[0].id
const reason = (await asUser(admin, `crm_lost_reasons?workspace_id=eq.${ARAK}&name_en=eq.Price&select=id`)).rows[0].id
const tag = (await asUser(admin, `crm_tags?workspace_id=eq.${ARAK}&name=eq.GRMS&select=id`)).rows[0].id
let id = null

try {
  // ── Company separation ──
  const arak = await leads(admin, ARAK), ghusn = await leads(admin, GHUSN)
  check(arak >= 8 && ghusn >= 1, `the admin reads each company's own (Arak ${arak}, Ghusn ${ghusn})`)
  check((await asUser(admin, `crm_leads?workspace_id=eq.${ARAK}&id=eq.${GHUSN_LEAD}&select=id`)).rows.length === 0, 'a Ghusn opportunity never answers a query for Arak')
  check(await leads(worker, GHUSN) === 0, 'the Arak worker reads none of Ghusn\'s')
  check(await leads(stranger, ARAK) === 0, 'someone outside Arak reads none of its opportunities')
  const intruder = await asUser(stranger, 'crm_leads', { method: 'POST', body: { workspace_id: ARAK, title: 'Intruder (test)', organization: 'x', stage_id: await stage('New') } })
  check(!intruder.ok, 'and cannot add one')

  // ── View ──
  check(await leads(viewer, ARAK) === arak, 'View reads every opportunity of its company')
  check(!(await asUser(viewer, 'crm_leads', { method: 'POST', body: { workspace_id: ARAK, title: 'Viewer (test)', organization: 'x', stage_id: await stage('New') } })).ok, 'View cannot add')
  const people = (await asUser(viewer, 'rpc/crm_people', { method: 'POST', body: { ws: ARAK } })).rows
  check(Array.isArray(people) && people.some(p => p.user_id === uid(worker)) && people.some(p => p.user_id === uid(admin)), `View reads the people picker (${people.length})`)
  check(!people.some(p => p.user_id === uid(stranger)), 'which lists only people with the CRM in this company')

  // ── Work ──
  const made = await asUser(worker, 'crm_leads', {
    method: 'POST', prefer: 'return=representation',
    body: { workspace_id: ARAK, title: ' Check opportunity (test) ', contact_name: 'Check (test)', stage_id: await stage('New'), assigned_to: uid(worker) },
  })
  id = made.rows?.[0]?.id
  check(made.ok && /^L-\d{4}-\d{6}$/.test(made.rows[0].lead_no) && made.rows[0].title === 'Check opportunity (test)' && made.rows[0].created_by === uid(worker),
    `Work adds one: numbered ${made.rows?.[0]?.lead_no}, trimmed, the creator recorded`)
  const bad = await asUser(worker, 'crm_leads', { method: 'POST', body: { workspace_id: ARAK, title: 'x', organization: 'o', stage_id: await stage('New'), assigned_to: uid(stranger) } })
  check(!bad.ok && bad.rows?.message === 'CRM_ASSIGNEE', 'it cannot be given to someone without the CRM here')
  check((await asUser(worker, `crm_leads?id=eq.${id}`, { method: 'PATCH', body: { stage_id: await stage('Negotiation') } })).ok, 'Work moves it to another stage')
  check((await asUser(worker, 'rpc/crm_set_tags', { method: 'POST', body: { ws: ARAK, lead: id, tag_ids: [tag] } })).ok, 'and tags it')
  const act = await asUser(worker, 'crm_activities', {
    method: 'POST', prefer: 'return=representation',
    body: { workspace_id: ARAK, lead_id: id, activity_type: 'call', summary: 'Check call (test)', due_date: new Date().toISOString().slice(0, 10), assigned_to: uid(worker) },
  })
  check(act.ok, 'and plans an activity on it')
  check((await asUser(worker, `crm_activities?id=eq.${act.rows?.[0]?.id}`, { method: 'DELETE', prefer: 'return=representation' })).rows?.length === 1, 'and deletes the planned activity')
  const won = await asUser(worker, `crm_leads?id=eq.${id}`, { method: 'PATCH', body: { status: 'won' } })
  check(!won.ok && won.rows?.message === 'CRM_WON_NEEDS_CLIENT', 'won is refused without a client')
  const arch = await asUser(worker, `crm_leads?id=eq.${id}`, { method: 'PATCH', body: { client_org_id: ARCHIVED_ORG } })
  check(!arch.ok && arch.rows?.message === 'CRM_CLIENT_ARCHIVED', 'an archived organisation cannot be its client')
  const lost = await asUser(worker, `crm_leads?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: { status: 'lost', lost_reason_id: reason, lost_note: 'Check (test)' } })
  check(lost.ok && lost.rows[0].closed_by === uid(worker) && lost.rows[0].closed_at, 'Work marks it lost; the database stamps who and when')
  const frozen = await asUser(worker, `crm_leads?id=eq.${id}`, { method: 'PATCH', body: { title: 'changed' } })
  check(!frozen.ok && frozen.rows?.message === 'CRM_LEAD_LOST', 'a lost one is frozen')
  const reopened = await asUser(worker, `crm_leads?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: { status: 'open' } })
  check(reopened.ok && reopened.rows[0].lost_reason_id === null && reopened.rows[0].closed_at === null, 'reopening clears the loss')
  check(!(await asUser(worker, 'crm_sources', { method: 'POST', body: { workspace_id: ARAK, name: 'Check source (test)' } })).ok, 'Work cannot change the settings')
  check((await asUser(worker, `crm_history?lead_id=eq.${id}&select=id`)).rows.length === 0, 'Work does not read the history')
  const hist = (await asUser(admin, `crm_history?lead_id=eq.${id}&activity_id=is.null&select=action,actor&order=id`)).rows
  check(hist.map(r => r.action).join() === "insert,update,update,update" && hist.every(r => r.actor === uid(worker)), `Manage reads the history (${hist.map(r => r.action).join(', ')}: refused changes leave none), all by the worker`)
} finally {
  if (id) {
    const gone = await asUser(worker, `crm_leads?id=eq.${id}`, { method: 'DELETE', prefer: 'return=representation' })
    check(gone.ok && gone.rows.length === 1, 'cleanup: Work deletes the open check opportunity (its tags go with it)')
  }
  const left = await asUser(admin, `crm_leads?title=like.${encodeURIComponent('Check opportunity (test)*')}&select=id`)
  check(left.rows.length === 0, 'cleanup: nothing of the check is left (its history stays, as his audit log)')
}
console.log(failed ? `\n${failed} failed.` : '\nAll as intended.')
process.exitCode = failed ? 1 : 0
