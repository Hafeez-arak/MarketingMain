#!/usr/bin/env node
// ─── Auto-reply test run: what each recent lead WOULD have been sent ──────
// The owner's step before any reply goes out (2026-10-29): take last week's
// qualified and needs-review leads, write the reply each would get with
// autoReply.js (the same model and rules production will use), and lay them
// out for review. NOTHING IS SENT and the leads table does not change. The
// spend is recorded in agent_usage like any other call.
//
//   node --env-file=.env scripts/lead-qualifier/reply-test.mjs               (last 7 days)
//   ... --days 14                                                            (a longer window)
//
// Output (never in git, this repo is public), in LEAD_PRIVATE_DIR
// (default ~/Desktop/Arak neww/lead-qualifier-private):
//   reply-test-<date>.json   every lead, the format chosen, why, and the text
//   reply-test-<date>.html   the same as a page to read or print to PDF

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
const DAYS = Number(arg('days', '7')) || 7
const REPEAT_DAYS = 14
const dir = process.env.LEAD_PRIVATE_DIR || path.join(os.homedir(), 'Desktop/Arak neww/lead-qualifier-private')
const stamp = new Date().toISOString().slice(0, 10)
const outJson = path.join(dir, `reply-test-${stamp}.json`)
const outHtml = path.join(dir, `reply-test-${stamp}.html`)

const deps = leadDeps()
const brand = await loadBrand(db, WS)
const [profile] = await db(`brand_profile?workspace_id=eq.${WS}&select=contact_info`) || []
const company = {
  name: brand.companyName,
  phone: String(profile?.contact_info || '').match(/phone:\s*([+\d][\d\s]+\d)/i)?.[1] || '',
}

const since = new Date(Date.now() - DAYS * 86_400_000)
const lookback = new Date(since.getTime() - REPEAT_DAYS * 86_400_000).toISOString()
const rows = await db(`leads?workspace_id=eq.${WS}&received_at=gte.${lookback}&duplicate_of=is.null&verdict=in.(qualified,needs_review)&select=*&order=received_at.asc`) || []
const live = (l) => (l.human_verdict || l.verdict) !== 'unqualified'

// "Same request again": the same sender (or the same RFQ reference) already
// had a qualifying lead in the 14 days before, which would have got the reply.
const subjectKey = (s) => String(s || '').toLowerCase().replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim()
function repeatOf(l) {
  const t = Date.parse(l.received_at)
  const key = requestKey(l.email, l.subject)
  return rows.find((o) => o.id !== l.id && live(o) && Date.parse(o.received_at) < t && t - Date.parse(o.received_at) <= REPEAT_DAYS * 86_400_000
    && ((key && requestKey(o.email, o.subject) === key)
      || (o.email && o.email === l.email && subjectKey(o.subject) === subjectKey(l.subject))))
}

const todo = rows.filter((l) => Date.parse(l.received_at) >= since.getTime() && live(l))
console.log(`${todo.length} leads since ${since.toISOString().slice(0, 10)}; writing ${outJson}`)

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
  results.push({ ...base, why: pick.why, dropped: pick.dropped, ...buildReply(pick, l, { company }) })
  process.stdout.write(`\r${results.length}/${todo.length}  $${spent.toFixed(4)}   `)
}

fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(outJson, JSON.stringify(results, null, 1))

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const day = (s) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Riyadh' })
const card = (r, i) => `<section>
  <h2>${i + 1}. ${esc(r.company || r.name || r.email)}</h2>
  <p class="meta">${esc(day(r.received_at))} · ${esc(r.source === 'website_form' ? 'Website form' : r.mailbox)}${r.verdict === 'needs_review' ? ' · <b>Needs review: sent only if the sales admin approves</b>' : ''}</p>
  <p class="meta">They asked: ${esc(r.summary || r.subject)}</p>
  ${r.skipped ? `<p class="skip">No reply. ${esc(r.skipped)}</p>`
    : r.error ? `<p class="skip">Not written: ${esc(r.error)}</p>`
      : `<p class="meta">Reply type: <b>${esc(r.label)}</b>. ${esc(r.why)}${r.dropped?.length ? ` (Blanks removed by the safety check: ${esc(r.dropped.join(', '))}.)` : ''}</p>
  <div class="mail"><p class="subj">${esc(r.subject)}</p>${esc(r.text).split('\n\n').map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}</div>`}
</section>`
const sent = results.filter((r) => !r.skipped && !r.error).length
fs.writeFileSync(outHtml, `<!doctype html><html><head><meta charset="utf-8"><title>Auto-reply test</title><style>
@page { size: A4; margin: 16mm; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1d1d1d; margin: 0; }
h1 { font-size: 18pt; margin: 0 0 4pt; } h2 { font-size: 12pt; margin: 0 0 2pt; }
.note { color: #666; margin: 0 0 16pt; } section { break-inside: avoid; margin: 0 0 16pt; }
.meta { color: #555; font-size: 9.5pt; margin: 0 0 3pt; } .skip { color: #8a4b00; margin: 4pt 0 0; }
.mail { border: 0.75pt solid #d6d3ce; border-radius: 4pt; padding: 10pt 12pt; margin-top: 6pt; }
.mail p { margin: 0 0 7pt; } .mail p:last-child { margin: 0; } .subj { font-weight: 700; border-bottom: 0.75pt solid #e8e8e8; padding-bottom: 6pt; }
</style></head><body>
<h1>Auto-reply test: last ${DAYS} days</h1>
<p class="note">Written for review only. Nothing was sent. ${results.length} leads, ${sent} replies written. The signature goes under each reply.</p>
${results.map(card).join('\n')}
</body></html>`)
console.log(`\nDone. ${sent} replies, ${results.filter((r) => r.skipped).length} skipped, ${results.filter((r) => r.error).length} errors, $${spent.toFixed(4)}.\n${outHtml}`)
