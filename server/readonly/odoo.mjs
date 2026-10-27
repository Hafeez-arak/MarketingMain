// ─── Odoo, read only (arak-hub test server, 2026-10-27) ────────────────────
// The copy keeps the Odoo connection row (lead_crm) but points it here with a
// dummy key. This server swaps in the real key and forwards ONLY calls that
// read; create, write, unlink, message_post and the rest get an Odoo-shaped
// error before anything leaves the box, so Approve, battle-card sync and
// to-dos fail visibly instead of changing Odoo.
// Same rules as dev/v2db/odooReadOnly.mjs on the v2 branch.
//
//   ODOO_URL=https://… ODOO_API_KEY=… node server/readonly/odoo.mjs   (:8791)

import http from 'node:http'
import process from 'node:process'

const PORT = Number(process.env.PORT) || 8791
const UPSTREAM = String(process.env.ODOO_URL || '').replace(/\/+$/, '')
const KEY = process.env.ODOO_API_KEY
if (!UPSTREAM || !KEY) throw new Error('ODOO_URL and ODOO_API_KEY must be set')

export const READS = new Set(['search_read', 'read', 'search', 'search_count', 'fields_get', 'check_access_rights', 'name_search', 'read_group'])
const COMMON = new Set(['version', 'authenticate', 'login'])

const refuse = (res, id, what) => {
  console.log(`${new Date().toISOString().slice(11, 19)} REFUSED ${what}`)
  const message = `Test copy: ${what} was not sent to Odoo from this server.`
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
}).listen(PORT, () => console.log(`Odoo read-only gatekeeper on :${PORT} → ${UPSTREAM} (reads pass, writes are refused)`))
