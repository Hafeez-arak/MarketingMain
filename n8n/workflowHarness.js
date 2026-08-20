import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── Running an n8n Code node under test ───────────────────────────────────
// The workflows in this repo are the largest pieces of untested logic in the
// project: several hundred lines of JavaScript each, embedded in JSON, that
// only ever executed inside a container against live providers. A bug in one
// surfaces as a post that silently didn't go out.
//
// This runs a Code node the way n8n does — its source wrapped in an async
// function body, with `this.helpers.httpRequest`, `$input` and `$env` supplied
// — while HTTP is redirected at stubs. Crucially it loads the source from the
// GENERATED workflow JSON, not from a copy: a test that passes against a
// hand-maintained duplicate of the code proves nothing about what deploys.

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const STUB_SUPABASE = 'https://supabase.test'

export function loadCodeNode(workflowName, nodeName) {
  const file = path.join(HERE, 'workflows', `${workflowName}.json`)
  const wf = JSON.parse(fs.readFileSync(file, 'utf8'))
  const node = wf.nodes.find(n => n.name === nodeName)
  if (!node) throw new Error(`No node "${nodeName}" in ${workflowName}`)
  return node.parameters.jsCode
}

// ─── A small, faithful PostgREST ───────────────────────────────────────────
// Faithful in the ways the workflows depend on and no further. `order` and
// `limit` ARE implemented, because callers rely on them — a stub that quietly
// returns insertion order lets a real ordering bug pass every test. (It did:
// this was written without them and an assertion about follower history
// "passed" against the wrong row.)
export class StubPostgrest {
  constructor(tables = {}) { this.tables = tables; this.log = [] }

  _match(row, params) {
    for (const [col, expr] of params) {
      if (['select', 'order', 'limit', 'on_conflict'].includes(col)) continue
      const [op, ...rest] = expr.split('.')
      const val = rest.join('.')
      const cur = row[col]
      switch (op) {
        case 'eq':  if (String(cur ?? '') !== val) return false; break
        case 'neq': if (String(cur ?? '') === val) return false; break
        case 'in':  if (!val.replace(/^\(|\)$/g, '').split(',').includes(String(cur ?? ''))) return false; break
        case 'gte': if (!(String(cur ?? '') >= val)) return false; break
        case 'lte': if (!(String(cur ?? '') <= val)) return false; break
        case 'lt':  if (!(cur != null && String(cur) < val)) return false; break
        case 'is':  if (val === 'null' && cur != null) return false; break
        default: break
      }
    }
    return true
  }

  handle(method, url, body, headers) {
    const u = new URL(url)
    const table = u.pathname.replace('/rest/v1/', '')
    const params = [...u.searchParams.entries()]
    this.tables[table] ??= []
    const rows = this.tables[table]
    this.log.push({ method, table, query: u.search })

    if (method === 'GET') {
      let hit = rows.filter(r => this._match(r, params))
      const order = u.searchParams.get('order')
      if (order) {
        for (const clause of order.split(',').reverse()) {
          const [col, dir] = clause.split('.')
          hit.sort((a, b) => {
            const x = String(a[col] ?? ''), y = String(b[col] ?? '')
            return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1)
          })
        }
      }
      const limit = Number(u.searchParams.get('limit') || 0)
      if (limit > 0) hit = hit.slice(0, limit)
      return { statusCode: 200, body: hit }
    }

    if (method === 'PATCH') {
      // The claim guard's whole correctness argument is that Postgres
      // serialises this and exactly one caller sees a row back, so the
      // filtered-update-returning-rows shape is reproduced exactly.
      const hit = rows.filter(r => this._match(r, params))
      for (const r of hit) Object.assign(r, body)
      const prefer = String(headers?.Prefer || '')
      return { statusCode: 200, body: prefer.includes('return=representation') ? hit.map(r => ({ ...r })) : [] }
    }

    if (method === 'POST') {
      const conflict = (u.searchParams.get('on_conflict') || '').split(',').filter(Boolean)
      // A POST body may be one row or MANY: PostgREST bulk-upserts an array in
      // a single call, which is how the Zernio account sync writes every
      // connected account at once. Treating an array as one row silently
      // stored a single garbage record whose columns were all undefined, and
      // the assertion that caught it looked like a workflow bug rather than a
      // stub one.
      const incoming = Array.isArray(body) ? body : [body]
      const written = []
      for (const one of incoming) {
        if (conflict.length) {
          const existing = rows.find(r => conflict.every(c => String(r[c] ?? '') === String(one[c] ?? '')))
          // Merge, never replace: a merge-duplicates upsert leaves columns the
          // payload omits untouched. social_accounts.connected_at depends on
          // exactly that — it is written by the column default on insert and
          // must survive every later refresh.
          if (existing) { Object.assign(existing, one); written.push(existing); continue }
        }
        rows.push({ ...one })
        written.push(one)
      }
      return { statusCode: written.length === incoming.length ? 201 : 200, body: written }
    }

    if (method === 'DELETE') {
      // Filtered delete, returning what went. Workflows use this to drop a row
      // only AFTER the provider has confirmed the same deletion, so a stub that
      // refused the verb made a correct two-phase disconnect look like a
      // failure.
      const hit = rows.filter(r => this._match(r, params))
      this.tables[table] = rows.filter(r => !hit.includes(r))
      const prefer = String(headers?.Prefer || '')
      return { statusCode: 200, body: prefer.includes('return=representation') ? hit.map(r => ({ ...r })) : [] }
    }

    return { statusCode: 405, body: { error: 'method not allowed' } }
  }
}

// Execute one Code node. Anything under STUB_SUPABASE goes to `postgrest`;
// everything else is matched against `routes`, an ordered list of
// [urlSubstring, handler] pairs returning { statusCode, body }. An unmatched
// URL throws rather than reaching the network — a test must never depend on a
// live provider by accident.
export async function runCodeNode(source, { env, input, postgrest, routes = [] }) {
  const calls = []

  const httpRequest = async (opts) => {
    const url = String(opts.url)
    const method = (opts.method || 'GET').toUpperCase()
    calls.push({ method, url, body: opts.body })

    // Supabase is matched FIRST, deliberately. Route needles are substrings,
    // and an Instagram account id is also a column VALUE in these queries
    // (`account_id=eq.1784...`) — so a natural-looking provider route silently
    // swallows the database reads and the derived sections come back empty for
    // a reason nothing in the failure points at. Checking the database prefix
    // first makes that impossible rather than merely documented.
    if (url.startsWith(STUB_SUPABASE)) {
      const res = postgrest.handle(method, url, opts.body, opts.headers)
      if (opts.returnFullResponse) return res
      if (res.statusCode >= 300) throw new Error(`HTTP ${res.statusCode}`)
      return res.body
    }
    for (const [needle, handler] of routes) {
      if (url.includes(needle)) {
        const res = await handler({ ...opts, method, url })
        return opts.returnFullResponse ? res : res.body
      }
    }
    throw new Error(`Unstubbed request escaped the harness: ${method} ${url}`)
  }

  const items = (Array.isArray(input) ? input : [input]).map(json => ({ json }))
  const $input = {
    first: () => items[0],
    last:  () => items[items.length - 1],
    all:   () => items,
  }

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const fn = new AsyncFunction('$input', '$env', source)
  const out = await fn.call({ helpers: { httpRequest } }, $input, env)
  return { out: out?.[0]?.json ?? null, items: out, calls }
}

// Form-encoded bodies are what the Graph API takes, so assertions about what
// was actually sent have to decode them.
export function formBody(body) {
  return Object.fromEntries(new URLSearchParams(String(body || '')))
}
