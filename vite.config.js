import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { WEBHOOK_PATHS } from './src/lib/n8nWebhookPaths.js'

// ─── Dev-only: save an exported blob to disk ───────────────────────────────
// POST a binary body to /__dev/save?name=foo.png and it lands in
// <tmpdir>/arak-dev-exports/foo.png.
//
// This exists so the editor's real output can be inspected and fed to the
// video compose step without signing in: the studio itself is behind auth, and
// the dev harness (/dev-editor.html) has no access token, so it cannot upload
// to Supabase the way the real app does. Writing to a temp dir keeps the
// service-role key out of the browser entirely, which uploading directly would
// not.
//
// `apply: 'serve'` means this never exists in a production build.
function devExportSink() {
  const dir = path.join(os.tmpdir(), 'arak-dev-exports')
  return {
    name: 'arak-dev-export-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/save', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only') }
        const raw = new URL(req.url, 'http://localhost').searchParams.get('name') || 'export.bin'
        // Filenames come from a browser we do not fully control, and this
        // writes to disk — anything that isn't a plain name is rejected rather
        // than sanitised, so no request can climb out of the directory.
        if (!/^[A-Za-z0-9._-]+$/.test(raw)) { res.statusCode = 400; return res.end('bad name') }
        fs.mkdirSync(dir, { recursive: true })
        const chunks = []
        req.on('data', c => chunks.push(c))
        req.on('end', () => {
          const file = path.join(dir, raw)
          fs.writeFileSync(file, Buffer.concat(chunks))
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, path: file, bytes: fs.statSync(file).size }))
        })
      })
    },
  }
}

// ─── Dev-only: stand in for the Vercel /api/n8n proxy ──────────────────────
// In production api/n8n/[slot].js forwards webhook calls to n8n so the tunnel
// hostname never enters the browser bundle. The Vite dev server does not run
// Vercel functions, so without this every webhook 404s locally and the app
// looks broken in a way that has nothing to do with the code under test.
//
// Here the host comes from VITE_N8N_BASE_URL in .env — a local developer
// already has it, and keeping dev off the Supabase-backed config avoids
// needing a service-role key on anyone's laptop.
//
// The workflows now reject any call missing x-webhook-secret once
// N8N_WEBHOOK_SECRET is set on the n8n side (a "Webhook Secret Guard" node
// runs first in every Creative Studio workflow) — this proxy didn't send it,
// so every local call silently died inside that guard before reaching the
// Respond node. n8n then closes the connection with an empty 200 rather than
// an error body, which is indistinguishable on this end from "worked, nothing
// to report" — res.json() on the client throws on the empty body, every
// caller's catch swallows it, and the symptom is just... nothing rendering.
// No fal balance, no generation, no error message pointing at why.
//
// The secret itself is read from n8n/docker/.env — the same file n8n reads —
// rather than duplicated into the root .env, so there is exactly one place
// this value lives and the two can't drift out of sync with each other.
function readN8nWebhookSecret() {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), 'n8n/docker/.env'), 'utf8')
    const line = text.split('\n').find(l => l.startsWith('N8N_WEBHOOK_SECRET='))
    return line ? line.slice('N8N_WEBHOOK_SECRET='.length).trim() : ''
  } catch {
    return ''
  }
}

function devN8nProxy(baseUrl) {
  const secret = readN8nWebhookSecret()
  return {
    name: 'arak-dev-n8n-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/n8n', async (req, res) => {
        const base = String(baseUrl || '').trim().replace(/\/+$/, '')
        const slot = (req.url || '').split('?')[0].replace(/^\//, '')
        const path = WEBHOOK_PATHS[slot]
        res.setHeader('Content-Type', 'application/json')
        if (!path) { res.statusCode = 404; return res.end(JSON.stringify({ error: `Unknown webhook slot: ${slot}` })) }
        if (!base) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'VITE_N8N_BASE_URL is not set in .env' })) }

        const chunks = []
        req.on('data', c => chunks.push(c))
        req.on('end', async () => {
          try {
            const upstream = await fetch(`${base}/webhook/${path}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(secret ? { 'x-webhook-secret': secret } : {}),
              },
              body: Buffer.concat(chunks),
            })
            const text = await upstream.text()
            // Same empty-200 trap the Vercel proxy names — see the comment in
            // api/n8n/[slot].js. Kept in both so a laptop with a stale
            // n8n/docker/.env fails the same, legible way production does.
            if (upstream.ok && !text.trim()) {
              res.statusCode = 502
              return res.end(JSON.stringify({
                error: 'n8n accepted the request but ran nothing — the workflow ' +
                       'stopped at its Webhook Secret Guard. N8N_WEBHOOK_SECRET in ' +
                       'n8n/docker/.env does not match the running n8n.',
              }))
            }
            res.statusCode = upstream.status
            res.end(text)
          } catch (err) {
            res.statusCode = 502
            res.end(JSON.stringify({ error: `Could not reach n8n: ${err.message}` }))
          }
        })
      })
    },
  }
}

// ─── Dev-only: run the /api/zernio functions in-process ────────────────────
// api/zernio/[action].js is a Vercel function and the Vite dev server does not
// run those, so without this every Connect button 404s locally and the app
// looks broken in a way that has nothing to do with the code under test.
//
// This IMPORTS the real handler rather than proxying to a deployed copy, which
// matters more here than it did for n8n: the whole reason per-workspace OAuth
// moved off n8n was to make it iterable, and iterating against production
// would give that back. What runs locally is the same module that ships.
//
// Secrets come from the two files a developer already has. SUPABASE_KEY in
// n8n/docker/.env is the service-role key (it is what the workflows write
// with), so it stands in for SUPABASE_SERVICE_ROLE_KEY here — same value, one
// place, no third copy to drift.
function readEnvFile(file) {
  try {
    const out = {}
    for (const line of fs.readFileSync(path.join(process.cwd(), file), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m) out[m[1]] = m[2].trim()
    }
    return out
  } catch {
    return {}
  }
}

function devZernioApi(env) {
  return {
    name: 'arak-dev-zernio-api',
    apply: 'serve',
    configureServer(server) {
      const n8nEnv = readEnvFile('n8n/docker/.env')
      process.env.SUPABASE_URL ||= env.SUPABASE_URL || env.VITE_SUPABASE_URL || n8nEnv.SUPABASE_URL || ''
      process.env.SUPABASE_ANON_KEY ||= env.VITE_SUPABASE_ANON_KEY || ''
      process.env.SUPABASE_SERVICE_ROLE_KEY ||= env.SUPABASE_SERVICE_ROLE_KEY || n8nEnv.SUPABASE_KEY || ''
      process.env.ZERNIO_API_KEY ||= env.ZERNIO_API_KEY || n8nEnv.ZERNIO_API_KEY || ''

      server.middlewares.use('/api/zernio', async (req, res) => {
        const action = (req.url || '').split('?')[0].replace(/^\//, '')
        const chunks = []
        req.on('data', c => chunks.push(c))
        req.on('end', async () => {
          let body = {}
          try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { /* handler sees {} */ }
          // The shims Vercel's Node runtime provides. Narrow on purpose: if
          // the handler starts needing more of the response API, that should
          // be a visible failure here rather than a silent difference between
          // dev and production.
          const shim = {
            status(code) { res.statusCode = code; return shim },
            json(payload) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)) },
            setHeader: (k, v) => res.setHeader(k, v),
          }
          try {
            const mod = await server.ssrLoadModule('/api/zernio/[action].js')
            await mod.default({ method: req.method, query: { action }, headers: req.headers, body }, shim)
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: `Dev handler crashed: ${err.message}` }))
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
// A config function, not a plain object, so loadEnv can read .env here in
// Node — the dev proxy needs VITE_N8N_BASE_URL before any client code exists.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), devExportSink(), devN8nProxy(env.VITE_N8N_BASE_URL), devZernioApi(env)],
    server: {
      port: process.env.PORT ? Number(process.env.PORT) : 5173,
    },
  }
})
