// ─── Zernio, read only, for v2's local runs (2026-10-25) ───────────────────
// The local copy of production (dev/v2db/prod-copy) should look like
// production: real accounts, real numbers, and so the same buttons (a Post
// Queue card shows Schedule and Post now only when an account is connected).
// But nothing done on this Mac may reach Instagram or LinkedIn.
//
// So the app talks to this server instead of zernio.com (vite --mode v2 sets
// ZERNIO_BASE_URL to it and gives the app a dummy key). It forwards GET
// requests to Zernio with the real key, which only this process holds, and
// refuses every other method before anything leaves the machine: publishing,
// scheduling, deleting, connecting and auto-replies are all POST, PUT, PATCH
// or DELETE.
//
//   node dev/v2db/zernioReadOnly.mjs [path to the main checkout's .env]
//
// Listens on 127.0.0.1:8790 and prints one line per request.

import http from 'node:http'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const PORT = 8790
const UPSTREAM = 'https://zernio.com'
const envPath = process.argv[2] || `${execSync('git worktree list --porcelain', { encoding: 'utf8' }).match(/^worktree (.*)$/m)[1]}/.env`
const line = fs.readFileSync(envPath, 'utf8').split('\n').find((l) => l.startsWith('ZERNIO_API_KEY='))
const KEY = line && line.slice('ZERNIO_API_KEY='.length).trim().replace(/^["']|["']$/g, '')
if (!KEY) throw new Error(`No ZERNIO_API_KEY in ${envPath}`)

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

http.createServer(async (req, res) => {
  const stamp = new Date().toISOString().slice(11, 19)
  if (req.method !== 'GET' || !req.url.startsWith('/api/v1/')) {
    req.resume()
    console.log(`${stamp} REFUSED ${req.method} ${req.url}`)
    return send(res, 403, { error: 'Local copy: nothing is sent to Instagram or LinkedIn from this machine.', code: 'local_read_only' })
  }
  try {
    const r = await fetch(UPSTREAM + req.url, { method: 'GET', headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' } })
    const text = await r.text()
    console.log(`${stamp} GET ${req.url.split('?')[0]} → ${r.status}`)
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' })
    res.end(text)
  } catch (err) {
    console.log(`${stamp} GET ${req.url} failed: ${err.message}`)
    send(res, 502, { error: `Could not reach Zernio: ${err.message}` })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Zernio read-only gatekeeper on http://127.0.0.1:${PORT} (GET passes, everything else is refused)`))
