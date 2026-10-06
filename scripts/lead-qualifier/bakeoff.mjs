#!/usr/bin/env node
// ─── Lead qualifier bake-off ───────────────────────────────────────────────
// Runs every test enquiry through each candidate model on OpenRouter and
// prints which model gets them right, and for how much. The cheapest model
// with zero "real buyer marked unqualified" wins.
//
//   OPENROUTER_API_KEY=sk-or-... node --env-file=.env scripts/lead-qualifier/bakeoff.mjs
//   ... --models google/gemini-3.1-flash-lite,openai/gpt-4.1-mini   (pick models)
//   ... --only real                                                (one case set)
//
// Cases: cases.synthetic.json here (made up, safe in this public repo) plus
// the REAL enquiries, masked, from a private file that never enters git:
//   LEAD_CASES_PRIVATE (default ~/Desktop/Arak neww/lead-qualifier-private/real-cases.json)
// Results, which quote the model's reading of real enquiries, go next to that
// private file, never into the repo.
//
// What the model sees is exactly what production sends: buildMessages() from
// src/lib/leads/qualify.js, so names, emails and phones are masked here too.
// OpenRouter is told to skip providers that keep or train on prompts.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMessages, parseVerdict, VERDICT_SCHEMA } from '../../src/lib/leads/qualify.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}

// The newest cheap model from each provider on 6 Oct 2026, plus the winner
// of the first run (Mistral Small 3.2) as the baseline to beat.
const DEFAULT_MODELS = [
  'openai/gpt-6-luna',
  'google/gemini-3.5-flash-lite',
  'google/gemini-3.8-flash',
  'mistralai/mistral-small-2603',
  'deepseek/deepseek-v4.1-flash',
  'qwen/qwen3.8-flash',
  'z-ai/glm-5.3-flash',
  'xiaomi/mimo-v2.6-flash',
  'cohere/command-a-plus',
  'nvidia/nemotron-3.5-lightning',
  'mistralai/mistral-small-3.2-24b-instruct',
]
const models = arg('models', DEFAULT_MODELS.join(',')).split(',').map((s) => s.trim()).filter(Boolean)
const only = arg('only', 'all')
// Run every case this many times: a model that flips its answer between
// identical runs is not one to trust with a mailbox.
const repeat = Math.max(1, Number(arg('repeat', '1')) || 1)
const key = process.env.OPENROUTER_API_KEY
if (!key) { console.error('Set OPENROUTER_API_KEY first.'); process.exit(1) }

const privatePath = process.env.LEAD_CASES_PRIVATE || path.join(os.homedir(), 'Desktop/Arak neww/lead-qualifier-private/real-cases.json')
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
let cases = []
if (only !== 'real') cases.push(...load(path.join(here, 'cases.synthetic.json')))
if (only !== 'synthetic') {
  if (fs.existsSync(privatePath)) cases.push(...load(privatePath))
  else console.warn(`No real cases at ${privatePath}; running made-up cases only.`)
}
cases = cases.map((c) => ({ ...c, env: { source: 'website_form', name: '', ...c.env } }))

// What the company sells, from the Brand Brain, the same field production reads.
async function offering() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !sk) throw new Error('Supabase URL/key missing: run with --env-file=.env')
  const r = await fetch(`${url}/rest/v1/brand_profile?workspace_id=eq.00000000-0000-0000-0000-000000000001&select=product_index`, { headers: { apikey: sk, Authorization: `Bearer ${sk}` } })
  const [row] = await r.json()
  if (!row?.product_index) throw new Error('Arak Brand Brain has no product_index')
  return row.product_index
}

// Price and abilities per model: whether it enforces a JSON schema or only
// "some JSON", and whether it thinks before answering.
async function catalogue() {
  const r = await fetch('https://openrouter.ai/api/v1/models')
  const { data } = await r.json()
  return new Map(data.map((m) => {
    const sp = m.supported_parameters || []
    return [m.id, {
      in: Number(m.pricing?.prompt || 0),
      out: Number(m.pricing?.completion || 0),
      schema: sp.includes('structured_outputs'),
      json: sp.includes('response_format'),
      reasons: sp.includes('reasoning'),
      // OpenAI's thinking models refuse temperature, and with
      // require_parameters an unsupported one rules out every provider.
      temperature: sp.includes('temperature'),
    }]
  }))
}

async function ask(model, messages, info = {}) {
  const started = Date.now()
  // Strict schema where the model supports it, plain JSON where it only
  // supports that (the prompt spells out the fields either way).
  const response_format = info.schema || !info.json ? { type: 'json_schema', json_schema: VERDICT_SCHEMA } : { type: 'json_object' }
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Arak lead qualifier bake-off' },
    body: JSON.stringify({
      model,
      messages,
      ...(info.temperature === false ? {} : { temperature: 0 }),
      // Thinking tokens count against this on some providers, so leave room.
      max_tokens: 4000,
      response_format,
      // Sorting an enquiry needs little thought; thinking is billed as output.
      ...(info.reasons ? { reasoning: { effort: 'low', exclude: true } } : {}),
      provider: { data_collection: 'deny', require_parameters: true },
      usage: { include: true },
    }),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok || body.error) return { error: body.error?.message || `HTTP ${r.status}`, ms: Date.now() - started }
  return { text: body.choices?.[0]?.message?.content || '', usage: body.usage || {}, ms: Date.now() - started }
}

async function pool(items, size, fn) {
  const out = new Array(items.length); let next = 0
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }))
  return out
}

const brand = { companyName: 'ARAK Lighting', offering: await offering() }
const models$ = await catalogue()
const isBuyer = (c) => c.accept.length === 1 && c.accept[0] === 'qualified'
const summary = []; const detail = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// New OpenRouter accounts are rate-limited per model; wait and retry that
// ONE request (never a batch) a few times before calling it an error.
async function askPatiently(model, messages, info) {
  for (let attempt = 0; ; attempt++) {
    const res = await ask(model, messages, info)
    if (!res.error || !/rate limit/i.test(res.error) || attempt >= 4) return res
    await sleep(15000)
  }
}

for (const model of models) {
  const info = models$.get(model)
  if (!info) { console.log(`${model} … not on OpenRouter, skipped`); continue }
  process.stdout.write(`${model} … `)
  const jobs = []
  for (let run = 0; run < repeat; run++) for (const c of cases) jobs.push({ c, run })
  const results = await pool(jobs, 4, async ({ c, run }) => {
    const res = await askPatiently(model, buildMessages(c.env, brand), info)
    if (res.error) return { id: c.id, run, error: res.error, ms: res.ms }
    const v = parseVerdict(res.text)
    const cost = typeof res.usage.cost === 'number' ? res.usage.cost : (res.usage.prompt_tokens || 0) * info.in + (res.usage.completion_tokens || 0) * info.out
    return { id: c.id, run, accept: c.accept, verdict: v.verdict, category: v.category, confidence: v.confidence, reason: v.reason, valid: v.valid, ok: c.accept.includes(v.verdict), buyerLost: isBuyer(c) && v.verdict === 'unqualified', cost, ms: res.ms, tokensIn: res.usage.prompt_tokens, tokensOut: res.usage.completion_tokens, thinking: res.usage.completion_tokens_details?.reasoning_tokens || 0 }
  })
  const done = results.filter((r) => !r.error)
  const errors = results.filter((r) => r.error)
  // Cases whose verdict differed between runs.
  const byCase = new Map()
  for (const r of done) { if (!byCase.has(r.id)) byCase.set(r.id, new Set()); byCase.get(r.id).add(r.verdict) }
  const flips = [...byCase.entries()].filter(([, s]) => s.size > 1).map(([id]) => id)
  const row = {
    model,
    right: `${done.filter((r) => r.ok).length}/${jobs.length}`,
    rightPct: jobs.length ? done.filter((r) => r.ok).length / jobs.length : 0,
    buyersLost: done.filter((r) => r.buyerLost).length,
    flips: flips.length,
    badJson: done.filter((r) => !r.valid).length,
    errors: errors.length,
    perLead: done.length ? done.reduce((s, r) => s + r.cost, 0) / done.length : 0,
    total: done.reduce((s, r) => s + r.cost, 0),
    avgMs: done.length ? Math.round(done.reduce((s, r) => s + r.ms, 0) / done.length) : 0,
    avgOut: done.length ? Math.round(done.reduce((s, r) => s + (r.tokensOut || 0), 0) / done.length) : 0,
  }
  summary.push(row); detail.push({ model, results })
  console.log(`${row.right} right, ${row.buyersLost} buyers lost, ${row.flips} flips, ${row.errors} errors, $${row.total.toFixed(4)}`)
  if (errors.length) console.log(`   first error: ${errors[0].error}`)
  const seen = new Set()
  for (const r of done.filter((x) => !x.ok)) {
    const k = `${r.id}|${r.verdict}`
    if (seen.has(k)) continue
    seen.add(k)
    console.log(`   ✗ ${r.id}: said ${r.verdict} (${r.category}, ${r.confidence}), wanted ${r.accept.join('/')} — ${r.reason}`)
  }
  if (flips.length) console.log(`   ↺ changed its answer between runs on: ${flips.join(', ')}`)
}

console.log('\nModel'.padEnd(46) + 'Right     Lost  Flips  BadJSON  Err   $/lead     $ total   avg ms  out tok')
for (const r of summary.sort((a, b) => b.rightPct - a.rightPct || a.buyersLost - b.buyersLost || a.perLead - b.perLead)) {
  console.log(r.model.padEnd(45), r.right.padEnd(9), String(r.buyersLost).padEnd(5), String(r.flips).padEnd(6), String(r.badJson).padEnd(8), String(r.errors).padEnd(5), r.perLead.toFixed(6).padEnd(10), r.total.toFixed(4).padEnd(9), String(r.avgMs).padEnd(7), r.avgOut)
}
const spent = summary.reduce((s, r) => s + r.total, 0)
console.log(`\nSpent on this run: $${spent.toFixed(4)}`)

const outFile = path.join(path.dirname(privatePath), `bakeoff-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify({ summary, detail }, null, 2))
console.log(`Full results: ${outFile}`)
