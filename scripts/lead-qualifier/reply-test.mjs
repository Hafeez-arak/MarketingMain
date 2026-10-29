#!/usr/bin/env node
// ─── Auto-reply test run: what each recent lead WOULD have been sent ──────
// The owner's step before any reply goes out (2026-10-29): take the last 15
// qualified leads, write the reply each would get with
// autoReply.js (the same model and rules production will use), and put them
// in lead_replies as status 'test', where the Sales page's Test tab shows
// them. NOTHING IS SENT and the leads table does not change. Each run
// replaces the company's earlier test rows. The spend is recorded in
// agent_usage like any other call.
//
//   node --env-file=.env scripts/lead-qualifier/reply-test.mjs               (last 15 qualified leads)
//   ... --count 10                                                           (another number)
//   ... --dry                                                                (file only, no rows)
//
// A copy also goes to LEAD_PRIVATE_DIR (default ~/Desktop/Arak neww/
// lead-qualifier-private)/reply-test-<date>.json, never to git (public repo).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { db } from '../../api/agent/_supabase.js'
import { leadDeps } from '../../api/leads/_deps.js'
import { loadBrand } from '../../api/leads/_intake.js'
import { requestKey } from '../../api/leads/_mail.js'
import { toEnvelope } from '../../src/lib/leads/qualify.js'
import { replyRequest, parseReply, buildReply } from '../../src/lib/leads/autoReply.js'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const WS = arg('workspace', '00000000-0000-0000-0000-000000000001')
const COUNT = Number(arg('count', '15')) || 15
const REPEAT_DAYS = 14
const dir = process.env.LEAD_PRIVATE_DIR || path.join(os.homedir(), 'Desktop/Arak neww/lead-qualifier-private')
const stamp = new Date().toISOString().slice(0, 10)
const outJson = path.join(dir, `reply-test-${stamp}.json`)
const dry = process.argv.includes('--dry')

const deps = leadDeps()
const brand = await loadBrand(db, WS)
const company = { name: brand.companyName }

// Qualified by the agent or by a person. Needs-review leads get a reply only
// once approved, so they are not in the test. 90 days back is plenty for the
// last 15 plus the 14 days before them that the repeat check looks at.
const lookback = new Date(Date.now() - 90 * 86_400_000).toISOString()
const fetched = await db(`leads?workspace_id=eq.${WS}&received_at=gte.${lookback}&duplicate_of=is.null&verdict=in.(qualified,needs_review)&select=*&order=received_at.asc`) || []
const live = (l) => (l.human_verdict || l.verdict) === 'qualified'
const rows = fetched.filter(live)

// "Same request again": the same sender (or the same RFQ reference) already
// had a qualifying lead in the 14 days before, which would have got the reply.
const subjectKey = (s) => String(s || '').toLowerCase().replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim()
function repeatOf(l) {
  const t = Date.parse(l.received_at)
  const key = requestKey(l.email, l.subject)
  return rows.find((o) => o.id !== l.id && Date.parse(o.received_at) < t && t - Date.parse(o.received_at) <= REPEAT_DAYS * 86_400_000
    && ((key && requestKey(o.email, o.subject) === key)
      || (o.email && o.email === l.email && subjectKey(o.subject) === subjectKey(l.subject))))
}

const todo = rows.slice(-COUNT)
console.log(`The last ${todo.length} qualified leads, from ${todo[0]?.received_at?.slice(0, 10)}; writing ${outJson}`)

let spent = 0
const results = []
for (const l of todo) {
  const base = {
    id: l.id, received_at: l.received_at, source: l.source, mailbox: l.mailbox || 'info@arak-sa.com (website)',
    verdict: l.human_verdict || l.verdict, name: l.name, company: l.company, email: l.email, subject: l.subject, summary: l.summary,
  }
  const rep = repeatOf(l)
  if (rep) { results.push({ ...base, skipped: `Same request again: ${rep.subject || rep.summary} (${rep.received_at.slice(0, 10)}) already got the reply.` }); continue }
  const env = toEnvelope('email', {
    sourceRef: l.source_ref, receivedAt: l.received_at || '', name: l.name, company: l.company,
    email: l.email, phone: l.phone, subject: l.subject, message: l.message, language: l.language,
  })
  env.source = l.source
  const body = replyRequest(env, l, { companyName: company.name })
  const res = await deps.model(body, WS)
  const usage = res.usage || {}
  spent += Number(usage.cost) || 0
  await db('agent_usage', {
    method: 'POST', prefer: 'return=minimal',
    body: {
      workspace_id: WS, surface: 'lead_auto_reply_test', model: body.model,
      tokens_in: usage.prompt_tokens || 0, tokens_out: usage.completion_tokens || 0,
      cost_usd: Number(usage.cost) || 0, error: res.error ? String(res.error).slice(0, 300) : '',
    },
  }).catch(() => {})
  if (res.error) { results.push({ ...base, error: String(res.error).slice(0, 300) }); continue }
  const pick = parseReply(res.text)
  results.push({ ...base, topic: pick.topic, dropped: pick.dropped, model: body.model, cost: Number(usage.cost) || 0, ...buildReply(pick, l, { company }) })
  process.stdout.write(`\r${results.length}/${todo.length}  $${spent.toFixed(4)}   `)
}

fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(outJson, JSON.stringify(results, null, 1))

if (!dry) {
  await db(`lead_replies?workspace_id=eq.${WS}&status=eq.test`, { method: 'DELETE', prefer: 'return=minimal' })
  const rowsOut = results.filter((r) => !r.error).map((r) => ({
    workspace_id: WS, lead_id: r.id, status: 'test',
    format: r.skipped ? '' : 'acknowledge', subject: r.subject || '', body: r.text || '',
    skip_reason: r.skipped || '', model: r.model || '', cost_usd: r.cost || 0,
  }))
  if (rowsOut.length) await db('lead_replies', { method: 'POST', prefer: 'return=minimal', body: rowsOut })
}
const sent = results.filter((r) => !r.skipped && !r.error).length
console.log(`\nDone. ${sent} replies, ${results.filter((r) => r.skipped).length} skipped, ${results.filter((r) => r.error).length} errors, $${spent.toFixed(4)}.${dry ? ' (dry: nothing stored)' : ' Stored as Test on the Sales page.'}`)
