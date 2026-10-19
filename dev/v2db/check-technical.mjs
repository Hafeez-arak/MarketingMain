#!/usr/bin/env node
// ─── Check Technical's follow-ups in the database, signed in as the PMs ────
// 2026-10-19. After seed.mjs and a mirror round (odoo-round.mjs), signed in
// as pm.sara@arak.test, as the app would be:
//
//   1. she records a submittal round on her project 403, and the client
//      returns it with code C → a "Resubmit … (round 2)" task is hers at once;
//   2. she records round 2 → that task is done;
//   3. she writes the weekly update → the "Weekly update" reminder is done;
//   4. Khalid cannot record anything on her project.
//
// Cleans up what it made. Local database only. Exits 1 on any failure.

import { tokens, asUser } from './check-sections.mjs'

const WS = '00000000-0000-0000-0000-000000000001'
const tok = await tokens()
const sara = tok['pm.sara@arak.test'], khalid = tok['pm.khalid@arak.test'], owner = tok['owner@arak.test']
const uid = t => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sub
let failed = 0
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed++ }
const title = `Lighting fixtures (check ${Date.now()})`

const r1 = await asUser(sara, 'project_submittals', { method: 'POST', prefer: 'return=representation', body: { workspace_id: WS, odoo_project_id: 403, title, round: 1, submitted_at: '2026-10-01', created_by: uid(sara) } })
check(r1.ok, 'Sara records round 1 on her project')
const id1 = r1.rows?.[0]?.id

const coded = await asUser(sara, `project_submittals?id=eq.${id1}`, { method: 'PATCH', prefer: 'return=representation', body: { code: 'C', notes: 'Add photometric files.' } })
check(coded.ok && coded.rows?.[0]?.returned_at, 'the client\'s code C is saved, dated today')

const findTask = async key => (await asUser(owner, `tasks?auto_key=eq.${encodeURIComponent(key)}&select=id,title,status,assigned_to,priority,due_at`)).rows?.[0]
let t = await findTask(`resubmit:403:${id1}`)
check(t && t.assigned_to === uid(sara) && t.status === 'todo' && t.priority === 'high', `a follow-up is hers at once: "${t?.title}"`)
const mine = await asUser(sara, `tasks?id=eq.${t?.id}&select=id`)
check(mine.rows?.length === 1, 'she sees it in her tasks')

const k = await asUser(khalid, 'project_submittals', { method: 'POST', body: { workspace_id: WS, odoo_project_id: 403, title, round: 2, created_by: uid(khalid) } })
check(!k.ok, 'Khalid cannot record a round on Sara\'s project')
const kRead = await asUser(khalid, `project_submittals?id=eq.${id1}&select=id`)
check(kRead.rows?.length === 0, 'and cannot read it')

const r2 = await asUser(sara, 'project_submittals', { method: 'POST', prefer: 'return=representation', body: { workspace_id: WS, odoo_project_id: 403, title, round: 2, submitted_at: '2026-10-19', created_by: uid(sara) } })
check(r2.ok, 'Sara records round 2')
t = await findTask(`resubmit:403:${id1}`)
check(t?.status === 'done', 'the resubmit follow-up is done')

// An open "weekly update" reminder, as the monitor round makes one.
const reminderKey = `update_due:403:check-${Date.now()}`
await asUser(owner, 'tasks', { method: 'POST', body: { workspace_id: WS, title: 'Weekly update for Palm Tower parking (check)', assigned_to: uid(sara), created_by: uid(owner), section: 'technical', odoo_project_id: 403, auto_key: reminderKey } })
const before = (await asUser(owner, `tasks?auto_key=like.update_due:403:*&status=eq.todo&select=id`)).rows || []
const up = await asUser(sara, 'project_updates', { method: 'POST', prefer: 'return=representation', body: { workspace_id: WS, odoo_project_id: 403, status: 'at_risk', done: 'Round 2 submitted.', next: 'Chase the consultant.', blockers: '', written_by: uid(sara) } })
check(up.ok, 'Sara writes the weekly update')
const after = (await asUser(owner, `tasks?auto_key=like.update_due:403:*&status=eq.todo&select=id`)).rows || []
check(before.length >= 1 && after.length === 0, `the "Weekly update" reminder is done (${before.length} open before, ${after.length} after)`)
const ku = await asUser(khalid, 'project_updates', { method: 'POST', body: { workspace_id: WS, odoo_project_id: 403, status: 'on_track', written_by: uid(khalid) } })
check(!ku.ok, 'Khalid cannot write Sara\'s update')

// Clean up (the reminder's own task stays done, as it would in use).
// Each removal must take its row, or the next run starts from a dirty database.
const gone = async path => ((await asUser(owner, path, { method: 'DELETE', prefer: 'return=representation' })).rows || []).length
check(await gone(`project_updates?id=eq.${up.rows?.[0]?.id}`) === 1, 'cleanup: the update is removed (Technical manage)')
check(await gone(`project_submittals?title=eq.${encodeURIComponent(title)}`) === 2, 'cleanup: both rounds are removed')
check(await gone(`tasks?auto_key=eq.${encodeURIComponent(`resubmit:403:${id1}`)}`) === 1, 'cleanup: the follow-up is removed')
check(await gone(`tasks?auto_key=eq.${encodeURIComponent(reminderKey)}`) === 1, 'cleanup: the check\'s reminder is removed')
console.log(failed ? `\n${failed} failed.` : '\nAll as intended.')
process.exitCode = failed ? 1 : 0
