// ─── Zernio, read only (arak-hub test server, 2026-10-27) ──────────────────
// A self-hosted copy of the app shows real accounts and numbers, but nothing
// it does may reach Instagram or LinkedIn while production also runs. The
// app is given ZERNIO_BASE_URL=http://zernio-readonly:8790/api/v1 and a dummy
// key; this server holds the real key, forwards GETs, and refuses every other
// method before anything leaves the box: publishing, scheduling, deleting,
// connecting and auto-replies are all POST, PUT, PATCH or DELETE.
// Same rules as dev/v2db/zernioReadOnly.mjs on the v2 branch.
//
//   ZERNIO_API_KEY=… node server/readonly/zernio.mjs     (listens on :8790)

import http from 'node:http'
import process from 'node:process'

const PORT = Number(process.env.PORT) || 8790
const UPSTREAM = 'https://zernio.com'
const KEY = process.env.ZERNIO_API_KEY
if (!KEY) throw new Error('ZERNIO_API_KEY is not set')

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

http.createServer(async (req, res) => {
  const stamp = new Date().toISOString().slice(11, 19)
  if (req.method !== 'GET' || !req.url.startsWith('/api/v1/')) {
    req.resume()
    console.log(`${stamp} REFUSED ${req.method} ${req.url}`)
    return send(res, 403, { error: 'Test copy: nothing is sent to Instagram or LinkedIn from this server.', code: 'local_read_only' })
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
}).listen(PORT, () => console.log(`Zernio read-only gatekeeper on :${PORT} (GET passes, everything else is refused)`))
