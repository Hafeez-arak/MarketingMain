import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { createWebServer, routeOf, CRONS, API } from './web.js'

// The web server stands in for Vercel, so what it must guarantee is what
// Vercel guarantees the app: the right handler with the helpers it calls, the
// body as each handler expects it, the screens for every other path, and no
// path that reaches a file it should not.

let server, dist
afterEach(() => new Promise(resolve => (server ? server.close(resolve) : resolve())))
beforeAll(() => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'web-dist-'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>')
  fs.mkdirSync(path.join(dist, 'assets'))
  fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)')
})

async function start(load = async () => ({ default: async (req, res) => res.json({}) })) {
  server = createWebServer({ dist, load, log: { error: () => {} } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

describe('routeOf', () => {
  it('maps every api file Vercel serves', () => {
    expect(routeOf('/api/agent/run')).toEqual({ folder: 'agent', file: 'run.js', query: {} })
    expect(routeOf('/api/email/cron')).toEqual({ folder: 'email', file: '[action].js', query: { action: 'cron' } })
    expect(routeOf('/api/leads/approve')).toEqual({ folder: 'leads', file: '[action].js', query: { action: 'approve' } })
    expect(routeOf('/api/n8n/draftCopy')).toEqual({ folder: 'n8n', file: '[slot].js', query: { slot: 'draftCopy' } })
    expect(routeOf('/api/zernio/accounts')).toEqual({ folder: 'zernio', file: '[action].js', query: { action: 'accounts' } })
  })

  it('names exactly the api files on disk', () => {
    const onDisk = fs.readdirSync(path.join(import.meta.dirname, '..', 'api'), { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('_'))
      .flatMap(d => fs.readdirSync(path.join(d.parentPath ?? d.path, d.name))
        .filter(f => f.endsWith('.js') && !f.startsWith('_') && !f.endsWith('.test.js'))
        .map(f => `${d.name}/${f}`))
      .sort()
    const served = Object.entries(API)
      .flatMap(([folder, s]) => (s.names ? s.names.map(n => `${folder}/${n}.js`) : [`${folder}/${s.file}`]))
      .sort()
    expect(served).toEqual(onDisk)
  })

  it('refuses anything else, including paths that climb out', () => {
    for (const p of ['/api/agent/nope', '/api/agent/_supabase', '/api/other/x', '/api/email/../agent/run', '/api/email/a.b', '/api/n8n/a/b']) {
      expect(routeOf(p)).toBeNull()
    }
  })
})

describe('web server', () => {
  it('answers a health check', async () => {
    const base = await start()
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ok: true })
  })

  it('serves the screens: a file when it exists, index.html for every other path', async () => {
    const base = await start()
    const asset = await fetch(`${base}/assets/app-abc123.js`)
    expect(await asset.text()).toBe('console.log(1)')
    expect(asset.headers.get('cache-control')).toContain('immutable')
    for (const p of ['/', '/settings/team', '/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/%E0', '/assets/missing.js']) {
      const r = await fetch(`${base}${p}`)
      expect(await r.text()).toContain('<title>app</title>')
      expect(r.headers.get('cache-control')).toBe('no-cache')
    }
  })

  it('gives JSON handlers req.body, req.query and res.status().json()/send()', async () => {
    const base = await start(async (folder, file) => ({
      default: async (req, res) => res.status(201).send({ folder, file, body: req.body, query: req.query }),
    }))
    const r = await fetch(`${base}/api/leads/approve?id=7`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 1 }) })
    expect(r.status).toBe(201)
    expect(await r.json()).toEqual({ folder: 'leads', file: '[action].js', body: { a: 1 }, query: { id: '7', action: 'approve' } })
  })

  it('leaves the email body as a stream, so a webhook signature sees the exact bytes', async () => {
    const base = await start(async () => ({
      default: async (req, res) => {
        const chunks = []
        for await (const c of req) chunks.push(c)
        res.json({ hadBody: req.body !== undefined, raw: Buffer.concat(chunks).toString('utf8') })
      },
    }))
    const raw = '{"b":  2}'
    const r = await fetch(`${base}/api/email/resend_webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw })
    expect(await r.json()).toEqual({ hadBody: false, raw })
  })

  it('names a crashed handler instead of hanging', async () => {
    const base = await start(async () => ({ default: async () => { throw new Error('no key') } }))
    const r = await fetch(`${base}/api/agent/run`, { method: 'POST' })
    expect(r.status).toBe(500)
    expect(await r.json()).toEqual({ error: 'no key' })
  })

  it('404s an unknown api route without loading anything', async () => {
    let loaded = false
    const base = await start(async () => { loaded = true })
    expect((await fetch(`${base}/api/agent/nope`)).status).toBe(404)
    expect(loaded).toBe(false)
  })
})

describe('timed jobs', () => {
  it('fire when vercel.json says (UTC)', () => {
    const due = d => CRONS.filter(j => j.due(new Date(d))).map(j => j.path)
    expect(due('2026-10-27T06:00:00Z')).toEqual(['/api/email/cron'])
    expect(due('2026-11-01T04:00:00Z')).toEqual(['/api/agent/chat?cron=ceo-brief']) // a Sunday
    expect(due('2026-10-27T04:00:00Z')).toEqual([])
    expect(due('2026-10-27T06:01:00Z')).toEqual([])
  })

  it('match vercel.json', () => {
    const crons = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'vercel.json'), 'utf8')).crons
    expect(crons.map(c => c.path).sort()).toEqual(CRONS.map(c => c.path).sort())
    expect(crons.map(c => c.schedule).sort()).toEqual(['0 4 * * 0', '0 6 * * *'])
  })
})
