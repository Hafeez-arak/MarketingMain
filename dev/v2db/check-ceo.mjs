#!/usr/bin/env node
// ─── Check the CEO panel's project decisions, through the running app ──────
// 2026-10-19. With the dev server on :5180 and a mirror round done
// (odoo-round.mjs), signed in as ceo@arak.test:
//
//   1. the panel's decisions include the red projects, each with its
//      project manager and a Remind button;
//   2. Remind on Crescent tower phase 1 gives Khalid one task; a second
//      Remind the same day gives none more;
//   3. a project manager (no CEO section) is refused.
//
// Removes the task it made. Local only. Exits 1 on any failure.

import { tokens, asUser } from './check-sections.mjs'

const APP = process.env.V2_APP || 'http://localhost:5180'
const WS = '00000000-0000-0000-0000-000000000001'
const tok = await tokens()
let failed = 0
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed++ }
const call = async (who, action, body = {}) => {
  const r = await fetch(`${APP}/api/leads/${action}`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok[who]}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: WS, ...body }),
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

const panel = await call('ceo@arak.test', 'control')
const red = (panel.body.decisions || []).filter(d => d.kind === 'project_red')
// At most three decisions in all (the CEO's rule), shared round-robin with
// late quotes, unowned leads and the rest, so not every red project fits.
check(panel.status === 200 && red.length >= 1 && (panel.body.decisions || []).length <= 3, `the panel lists ${red.length} red project(s) among its ${(panel.body.decisions || []).length} decisions`)
const crescent = red.find(d => d.action.projectId === 402)
check(crescent?.owner === 'Khalid PM' && Boolean(crescent?.action.userId), `Crescent: owner "${crescent?.owner}", Remind button live`)
const atRisk = (panel.body.kpis || []).find(k => k.key === 'projects')
check(!atRisk || /2/.test(JSON.stringify(atRisk.value)), `"projects at risk" counts Technical's red projects (${JSON.stringify(atRisk?.value?.en ?? atRisk?.value)})`)

const first = await call('ceo@arak.test', 'remind_project', { project_id: 402 })
check(first.status === 200 && first.body.task && !first.body.already, 'Remind gives Khalid a task')
const again = await call('ceo@arak.test', 'remind_project', { project_id: 402 })
check(again.status === 200 && again.body.already, 'a second Remind the same day makes no second task')

const khalidTasks = await asUser(tok['pm.khalid@arak.test'], `tasks?id=eq.${first.body.task}&select=title,priority,assigned_to`)
check(khalidTasks.rows?.[0]?.priority === 'high', `Khalid sees it: "${khalidTasks.rows?.[0]?.title}"`)

const pm = await call('pm.sara@arak.test', 'remind_project', { project_id: 402 })
check(pm.status === 403, `a project manager is refused (${pm.status})`)

if (first.body.task) await asUser(tok['owner@arak.test'], `tasks?id=eq.${first.body.task}`, { method: 'DELETE' })
console.log(failed ? `\n${failed} failed.` : '\nAll as intended.')
process.exitCode = failed ? 1 : 0
