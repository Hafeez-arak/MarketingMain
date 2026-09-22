import http from 'node:http'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ─── The agent, as a plain Node server ─────────────────────────────────────
//
// The same handlers Vercel runs from api/agent/*.js, served by a long-lived
// process in its own container next to n8n (see n8n/docker/docker-compose.yml).
// Nothing is rewritten: each request imports the real handler and calls it with
// the two things Vercel adds that plain Node does not — `res.status().json()`
// and `req.query`. The handlers already read the body stream themselves.
//
// Why a container at all, rather than Vercel: a research run on Vercel lives
// inside a 300s-per-request ceiling, and the first attempt to drive one from
// the server hit Vercel's 508 INFINITE_LOOP_DETECTED. On a machine we run,
// neither limit exists, and n8n — which already drives the Monday run — calls
// this over the Docker network instead of across the internet.
//
// Not published to the internet. n8n reaches it as http://agent:3000; the only
// host port is bound to 127.0.0.1 for health checks on the box itself.

// The two on-demand Website checks, and the composer's post critique, used to
// be individual Vercel functions. They live beside n8n now: the browser
// reaches one authenticated n8n webhook, and n8n calls this private service
// over the Docker network. Keeping them in this route allowlist means the
// public n8n gateway cannot become an arbitrary internal HTTP proxy.
//
// Vercel Hobby allows 12 Serverless Functions per deployment and the repo was
// already at 12. `critique` was the thirteenth, so adding it did not degrade
// the deployment — it failed the BUILD outright, taking production down with
// it. Anything new belongs here from now on, not in api/agent/.
//
// `performance` and `reviseIdea` followed for headroom rather than because
// they were broken: at exactly 12 of 12 the next route to appear anywhere
// under api/ fails the build again, and both of these are single-purpose,
// neither streams, and neither is on a path a page waits on to first paint.
// api/ now sits at 10.
export const ROUTES = ['run', 'lens', 'synthesise', 'resolve', 'discover', 'chat', 'indexHealth', 'websiteExplain', 'critique', 'performance', 'reviseIdea']

const N8N_HANDLERS = new Set(['indexHealth', 'websiteExplain', 'critique', 'performance', 'reviseIdea'])

const here = path.dirname(fileURLToPath(import.meta.url))

function defaultLoad(route) {
  const root = N8N_HANDLERS.has(route)
    ? path.join(here, 'agentHandlers')
    : path.join(here, '..', 'api', 'agent')
  return import(pathToFileURL(path.join(root, `${route}.js`)).href)
}

/** The Vercel response helpers, over a plain Node response. */
export function vercelShim(res) {
  res.status = code => { res.statusCode = code; return res }
  res.json = body => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
    return res
  }
  return res
}

export function createAgentServer({ load = defaultLoad, log = console } = {}) {
  return http.createServer(async (req, res) => {
    vercelShim(res)
    const url = new URL(req.url || '/', 'http://agent')

    if (url.pathname === '/healthz') {
      res.status(200).json({ ok: true })
      return
    }

    // Only the routes that exist, matched exactly. A server that imports
    // whatever path a request names is a file-read primitive.
    const route = /^\/api\/agent\/([a-zA-Z]+)$/.exec(url.pathname)?.[1]
    if (!route || !ROUTES.includes(route)) {
      res.status(404).json({ error: 'No such agent route.' })
      return
    }

    req.query = Object.fromEntries(url.searchParams)
    try {
      const mod = await load(route)
      await mod.default(req, res)
    } catch (err) {
      // Named loudly: a missing key or a bad import otherwise looks exactly
      // like "the agent silently does nothing".
      log.error(`[agent] /api/agent/${route}:`, err?.stack || err)
      if (!res.headersSent) {
        res.status(500).json({ error: String(err?.message || err).slice(0, 400) })
      } else if (!res.writableEnded) {
        res.end()
      }
    }
  })
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const port = Number(process.env.AGENT_PORT) || 3000
  const server = createAgentServer()
  // A lens can run for minutes and the chat streams; neither may be cut off
  // by Node's own request timeout.
  server.requestTimeout = 0
  server.listen(port, () => console.log(`[agent] listening on :${port}`))
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => server.close(() => process.exit(0)))
  }
}
