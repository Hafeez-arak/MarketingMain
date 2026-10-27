import http from 'node:http'
import fs from 'node:fs'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ─── The whole app as one Node server: what Vercel does, on our own box ─────
//
// 2026-10-27, the owner: move the whole stack onto our own server (Oracle
// Cloud, "arak-hub"), first as a test copy. Vercel does three things for the
// app, and this file does the same three, with no change to the app itself:
//
//   1. serves the built screens (dist/, from `vite build`), with every path
//      that is not a file answered by index.html, as vercel.json's rewrite does;
//   2. runs the same api/ files Vercel runs as functions, giving them the
//      helpers Vercel adds (res.status().json(), res.send(), req.query and,
//      for JSON, req.body);
//   3. runs the two timed jobs in vercel.json's "crons", but only when
//      WEB_CRONS=on. A test copy leaves them off, as it leaves n8n's timed
//      workflows off: the morning email run would otherwise run twice.
//
// The routes are a fixed list, matched exactly. A server that imports
// whatever path a request names is a file-read primitive (see agent.js).

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

// api/<folder>/<name>.js, or api/<folder>/[param].js with the name in req.query.
export const API = {
  agent: { names: ['chat', 'discover', 'lens', 'resolve', 'run', 'search', 'synthesise', 'website'] },
  email: { param: 'action', file: '[action].js', name: /^[a-z_]+$/ },
  leads: { param: 'action', file: '[action].js', name: /^[a-z_]+$/ },
  n8n: { param: 'slot', file: '[slot].js', name: /^[a-zA-Z0-9_-]+$/ },
  zernio: { param: 'action', file: '[action].js', name: /^[a-zA-Z0-9_-]+$/ },
}

// The email handler reads the raw body itself (a webhook signature is checked
// over the exact bytes), so its stream is left untouched. Every other handler
// takes req.body as Vercel gives it.
const RAW_BODY = new Set(['email'])

// vercel.json "crons", in UTC as Vercel reads them.
export const CRONS = [
  { path: '/api/email/cron', due: d => d.getUTCHours() === 6 && d.getUTCMinutes() === 0 },
  { path: '/api/agent/chat?cron=ceo-brief', due: d => d.getUTCDay() === 0 && d.getUTCHours() === 4 && d.getUTCMinutes() === 0 },
]

/** Which handler file a path names, or null. */
export function routeOf(pathname) {
  const m = /^\/api\/([a-z0-9]+)\/([^/]+)$/.exec(pathname)
  if (!m) return null
  const [, folder, name] = m
  const spec = API[folder]
  if (!spec) return null
  if (spec.names) return spec.names.includes(name) ? { folder, file: `${name}.js`, query: {} } : null
  return spec.name.test(name) ? { folder, file: spec.file, query: { [spec.param]: name } } : null
}

/** The Vercel response helpers, over a plain Node response. */
export function vercelShim(res) {
  res.status = code => { res.statusCode = code; return res }
  res.json = body => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
    return res
  }
  res.send = body => {
    if (body != null && typeof body === 'object' && !Buffer.isBuffer(body)) return res.json(body)
    res.end(body)
    return res
  }
  return res
}

async function parseBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return undefined
  if (/json/i.test(req.headers['content-type'] || '')) {
    try { return JSON.parse(raw) } catch { return raw }
  }
  return raw
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4', '.pdf': 'application/pdf',
}

function serveStatic(dist, pathname, res) {
  // Resolve inside dist only; anything else (or a folder) gets index.html.
  let file
  try { file = path.join(dist, decodeURIComponent(pathname)) } catch { file = '' } // a malformed %-escape
  if (!file || !file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(dist, 'index.html')
  }
  const isIndex = file.endsWith(`${path.sep}index.html`)
  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream')
  // Vite's hashed files never change; index.html must always be re-read.
  res.setHeader('Cache-Control', pathname.startsWith('/assets/') && !isIndex ? 'public, max-age=31536000, immutable' : 'no-cache')
  fs.createReadStream(file).pipe(res)
}

function defaultLoad(folder, file) {
  return import(pathToFileURL(path.join(root, 'api', folder, file)).href)
}

export function createWebServer({ dist = path.join(root, 'dist'), load = defaultLoad, log = console } = {}) {
  return http.createServer(async (req, res) => {
    vercelShim(res)
    const url = new URL(req.url || '/', 'http://app')

    if (url.pathname === '/healthz') return res.status(200).json({ ok: true })

    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed.' })
      return serveStatic(dist, url.pathname, res)
    }

    const route = routeOf(url.pathname)
    if (!route) return res.status(404).json({ error: 'No such API route.' })

    req.query = { ...Object.fromEntries(url.searchParams), ...route.query }
    try {
      if (!RAW_BODY.has(route.folder) && req.method !== 'GET' && req.method !== 'HEAD') req.body = await parseBody(req)
      const mod = await load(route.folder, route.file)
      await mod.default(req, res)
    } catch (err) {
      log.error(`[web] ${url.pathname}:`, err?.stack || err)
      if (!res.headersSent) res.status(500).json({ error: String(err?.message || err).slice(0, 400) })
      else if (!res.writableEnded) res.end()
    }
  })
}

/** Calls each due job once a minute, as Vercel Cron does, with the CRON_SECRET bearer. */
export function startCrons({ port, secret = process.env.CRON_SECRET || '', now = () => new Date(), log = console }) {
  if (!secret) { log.error('[web] WEB_CRONS=on but CRON_SECRET is not set: the timed jobs would be refused.'); return null }
  return setInterval(async () => {
    const d = now()
    for (const job of CRONS.filter(j => j.due(d))) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}${job.path}`, { headers: { Authorization: `Bearer ${secret}`, 'User-Agent': 'arak-web-cron' } })
        log.log(`[web] cron ${job.path} → ${r.status}`)
      } catch (err) { log.error(`[web] cron ${job.path} failed: ${err.message}`) }
    }
  }, 60_000)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const port = Number(process.env.WEB_PORT) || 3000
  const server = createWebServer()
  // Long AI calls and the streaming chat must not be cut off by Node's own
  // request timeout; Vercel's 300s ceiling does not exist here.
  server.requestTimeout = 0
  server.listen(port, () => console.log(`[web] listening on :${port}; timed jobs ${process.env.WEB_CRONS === 'on' ? 'ON' : 'off'}`))
  if (process.env.WEB_CRONS === 'on') startCrons({ port })
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)))
}
