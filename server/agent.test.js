import { describe, it, expect, afterEach } from 'vitest'
import { Buffer } from 'node:buffer'
import { createAgentServer, ROUTES } from './agent.js'

// The server is the only thing between n8n and the handlers, so what it must
// guarantee is small and checkable: the right handler, the Vercel helpers the
// handlers call, the body intact, and nothing reachable that is not an agent
// route.

let server
afterEach(() => new Promise(resolve => (server ? server.close(resolve) : resolve())))

async function start(load) {
  server = createAgentServer({ load, log: { error: () => {} } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

const readBody = async req => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

describe('agent server', () => {
  it('answers a health check without loading any handler', async () => {
    let loaded = false
    const base = await start(async () => { loaded = true })
    const res = await fetch(`${base}/healthz`)
    expect(await res.json()).toEqual({ ok: true })
    expect(loaded).toBe(false)
  })

  it('serves every agent route, and only those', () => {
    expect(ROUTES).toEqual(['run', 'lens', 'synthesise', 'resolve', 'discover', 'chat', 'indexHealth', 'websiteExplain', 'critique'])
  })

  it('calls the named handler with the body, the query and res.status().json()', async () => {
    const seen = []
    const base = await start(async route => ({
      default: async (req, res) => {
        seen.push(route)
        const body = await readBody(req)
        res.status(201).json({ route, body, query: req.query, auth: req.headers.authorization })
      },
    }))
    // Camel-cased endpoint names are intentional: the private n8n Website
    // gateway forwards the two handlers that were removed from Vercel, and
    // route matching must not silently reject them before their membership
    // check runs.
    const res = await fetch(`${base}/api/agent/indexHealth?x=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: JSON.stringify({ workspace_id: 'workspace' }),
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ route: 'indexHealth', body: { workspace_id: 'workspace' }, query: { x: '1' }, auth: 'Bearer t' })
    expect(seen).toEqual(['indexHealth'])
  })

  it('refuses anything that is not an agent route, including path tricks', async () => {
    let loaded = false
    const base = await start(async () => { loaded = true })
    for (const p of ['/api/agent/_supabase', '/api/agent/../zernio/_zernio', '/api/agent/unknown', '/api/n8n/run', '/']) {
      const res = await fetch(`${base}${p}`, { method: 'POST' })
      expect(res.status, p).toBe(404)
    }
    expect(loaded).toBe(false)
  })

  it('turns a crashed handler into a named 500 instead of a hung request', async () => {
    const base = await start(async () => ({ default: async () => { throw new Error('boom') } }))
    const res = await fetch(`${base}/api/agent/run`, { method: 'POST' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})
