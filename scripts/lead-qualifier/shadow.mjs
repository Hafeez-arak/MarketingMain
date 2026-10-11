#!/usr/bin/env node
// ─── Shadow run: every stored lead, read again under the current rules ─────
// Before new criteria go live, this re-reads the leads already in the
// database with today's qualify.js (the same askModel, website check and
// cap as production) and writes the new readings NEXT TO the old verdicts in
// a private file. Nothing in the leads table changes. The spend is recorded
// in agent_usage like any other call.
//
//   node --env-file=.env scripts/lead-qualifier/shadow.mjs                 (all leads)
//   ... --limit 20                                                         (a sample first)
//   ... --resume                                                           (skip leads already in the output)
//
// Output (never in git, this repo is public):
//   LEAD_PRIVATE_DIR (default ~/Desktop/Arak neww/lead-qualifier-private)/shadow-<date>.json

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { db } from '../../api/agent/_supabase.js'
import { leadDeps } from '../../api/leads/_deps.js'
import { askModel, loadBrand } from '../../api/leads/_intake.js'
import { toEnvelope, verdictColumns } from '../../src/lib/leads/qualify.js'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const WS = arg('workspace', '00000000-0000-0000-0000-000000000001')
const limit = Number(arg('limit', '0')) || Infinity
const resume = process.argv.includes('--resume')
const dir = process.env.LEAD_PRIVATE_DIR || path.join(os.homedir(), 'Desktop/Arak neww/lead-qualifier-private')
const out = path.join(dir, arg('out', `shadow-${new Date().toISOString().slice(0, 10)}.json`))

// OpenRouter lets a new account make 20 calls a minute per model: stay under.
const PER_MINUTE = 18
const CONCURRENCY = 3

const deps = leadDeps()
const brand = await loadBrand(db, WS)
const leads = []
for (let from = 0; ; from += 500) {
  const page = await db(`leads?workspace_id=eq.${WS}&verdict=neq.duplicate&verdict=not.is.null&select=*&order=received_at.asc,id.asc&offset=${from}&limit=500`) || []
  leads.push(...page)
  if (page.length < 500) break
}
const done = resume && fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : []
const seen = new Set(done.map((r) => r.id))
const todo = leads.filter((l) => !seen.has(l.id)).slice(0, limit)
console.log(`${leads.length} leads; ${todo.length} to read; writing ${out}`)

const results = [...done]
const save = () => fs.writeFileSync(out, JSON.stringify(results, null, 1))
let spent = 0
const started = Date.now()
let calls = 0

async function one(l) {
  const env = toEnvelope('email', {
    sourceRef: l.source_ref, receivedAt: l.received_at || '', name: l.name, company: l.company,
    email: l.email, phone: l.phone, subject: l.subject, message: l.message, language: l.language,
  })
  env.source = l.source
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await askModel(deps, { workspaceId: WS, env, brand, surface: 'lead_qualifier_shadow' })
    spent += r.cost || 0
    if (r.error && /rate|429|limit/i.test(r.error)) { await new Promise((s) => setTimeout(s, 20_000)); continue }
    if (r.error) return { id: l.id, error: r.error }
    const cols = verdictColumns(r.verdict, { site: r.site, folder: l.folder || '', email: l.email })
    return {
      id: l.id, source: l.source, mailbox: l.mailbox, received_at: l.received_at,
      company: l.company, email: l.email, subject: l.subject, message: l.message,
      old: { verdict: l.verdict, human_verdict: l.human_verdict, category: l.category, reason: l.reason },
      new: { ...cols, summary: r.verdict.summary, sender_confidence: r.verdict.senderConfidence, site_ok: r.site?.ok ?? null },
    }
  }
  return { id: l.id, error: 'rate limited three times' }
}

for (let i = 0; i < todo.length; i += CONCURRENCY) {
  // Pace: no more than PER_MINUTE calls in any minute since the start.
  const allowed = Math.floor(((Date.now() - started) / 60_000 + 1) * PER_MINUTE)
  if (calls + CONCURRENCY > allowed) await new Promise((s) => setTimeout(s, 60_000 * (calls + CONCURRENCY - allowed) / PER_MINUTE))
  const chunk = todo.slice(i, i + CONCURRENCY)
  calls += chunk.length
  results.push(...await Promise.all(chunk.map(one)))
  save()
  process.stdout.write(`\r${results.length}/${leads.length}  $${spent.toFixed(4)}   `)
}
save()
const errs = results.filter((r) => r.error).length
console.log(`\nDone. ${results.length} read, ${errs} errors, $${spent.toFixed(4)} this run.`)
