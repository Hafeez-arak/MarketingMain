// ─── Odoo, read only, for v2's local runs (2026-10-25) ─────────────────────
// The local copy of production keeps the Odoo connection row (lead_crm) but
// points it here, with a dummy key. This server swaps in the real key and
// forwards to arak-co.odoo.com ONLY calls that read. The real key is the
// export's sealed one (dev/v2db/prod-copy/data/lead_crm.json, never leaves
// this Mac), opened with production's service key from the main .env:
//
//   common: version, authenticate, login     object.execute_kw: search_read,
//   read, search, search_count, fields_get, check_access_rights, name_search,
//   read_group                                  /web/database/list
//
// Everything else (create, write, unlink, message_post, action_feedback…) is
// answered with an Odoo-shaped error before anything leaves the machine, so
// Approve, battle-card sync and to-dos fail visibly instead of changing Odoo.
//
//   node dev/v2db/odooReadOnly.mjs [main .env]   listens on 127.0.0.1:8791

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { openSecret } from '../../api/email/_secrets.js'

const PORT = 8791
const here = path.dirname(fileURLToPath(import.meta.url))
const [row] = JSON.parse(fs.readFileSync(path.join(here, 'prod-copy/data/lead_crm.json'), 'utf8'))
if (!row?.url || !row?.api_key) throw new Error('No Odoo connection in the export: run prod-copy/copy-production.sh first.')
const envPath = process.argv[2] || `${execSync('git worktree list --porcelain', { encoding: 'utf8' }).match(/^worktree (.*)$/m)[1]}/.env`
const prodKey = fs.readFileSync(envPath, 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='))?.slice(26).trim().replace(/^["']|["']$/g, '')
const UPSTREAM = row.url.replace(/\/+$/, '')
const KEY = openSecret(row.api_key, prodKey)

const READS = new Set(['search_read', 'read', 'search', 'search_count', 'fields_get', 'check_access_rights', 'name_search', 'read_group'])
const COMMON = new Set(['version', 'authenticate', 'login'])

const refuse = (res, id, what) => {
  console.log(`${new Date().toISOString().slice(11, 19)} REFUSED ${what}`)
  const message = `Local copy: ${what} was not sent to Odoo from this machine.`
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 403, message, data: { name: 'local_read_only', message } } }))
}

http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', async () => {
    let msg = {}
    try { msg = body ? JSON.parse(body) : {} } catch { /* not JSON */ }
    const id = msg.id ?? null
    let label = `${req.method} ${req.url}`
    if (req.url === '/jsonrpc') {
      const { service, method, args = [] } = msg.params || {}
      if (service === 'common' && COMMON.has(method)) {
        if (method !== 'version') args[2] = KEY
        label = `common.${method}`
      } else if (service === 'object' && method === 'execute_kw' && READS.has(args[4])) {
        args[2] = KEY
        label = `${args[3]}.${args[4]}`
      } else {
        return refuse(res, id, service === 'object' ? `${args[3]}.${args[4]}` : `${service}.${method}`)
      }
      msg.params.args = args
    } else if (req.url !== '/web/database/list') {
      return refuse(res, id, label)
    }
    try {
      const r = await fetch(UPSTREAM + req.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) })
      const text = await r.text()
      console.log(`${new Date().toISOString().slice(11, 19)} ${label} → ${r.status}`)
      res.writeHead(r.status, { 'Content-Type': 'application/json' })
      res.end(text)
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { message: `Could not reach Odoo: ${err.message}` } }))
    }
  })
}).listen(PORT, '127.0.0.1', () => console.log(`Odoo read-only gatekeeper on http://127.0.0.1:${PORT} → ${UPSTREAM} (reads pass, writes are refused)`))
