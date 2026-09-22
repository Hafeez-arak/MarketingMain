import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTES } from './agent.js'

// ─── Does the agent image actually contain the agent? ──────────────────────
//
// The Dockerfile copies named paths, one line each. Nothing checks those lines
// against what the code imports, so a file that is reachable at runtime and
// absent from the image fails only in the container — as a 404 or a 500 on the
// first live call, long after every local test, the lint pass and the Vercel
// build have gone green.
//
// That has now happened twice for the same reason. `server/agentHandlers/` was
// never copied, so indexHealth and websiteExplain 404'd from the day they were
// moved off Vercel (#111) and were "patched in by hand on each redeploy"; the
// post critique (#122) moved into the same directory and inherited it. The
// one-line fix is 9a2c52f. This is the test that would have failed instead.
//
// It resolves the real import graph from the server's entry points and asserts
// every local file in it is covered by a COPY line.

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const dockerfile = fs.readFileSync(path.join(here, 'Dockerfile'), 'utf8')

/**
 * The repo-relative paths the Dockerfile copies in.
 *
 * A COPY of a directory covers everything beneath it, which is why `api/agent`
 * covers `api/agent/_provider.js` without naming it.
 */
function copiedPaths() {
  return [...dockerfile.matchAll(/^\s*COPY\s+(\S+)\s+\S+\s*$/gm)]
    .map(m => m[1])
    .filter(p => !p.startsWith('--'))
}

const COPIED = copiedPaths()

const isCovered = rel =>
  COPIED.some(c => rel === c || rel.startsWith(c.endsWith('/') ? c : `${c}/`))

/** Every local import in one file, resolved to a repo-relative path. */
function localImports(absFile) {
  const source = fs.readFileSync(absFile, 'utf8')
  const specs = [
    ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map(m => m[1])

  const out = []
  for (const spec of specs) {
    // Bare specifiers are npm or Node built-ins; the image installs the one
    // runtime dependency itself and Node brings the rest.
    if (!spec.startsWith('.')) continue
    let abs = path.resolve(path.dirname(absFile), spec)
    if (!fs.existsSync(abs)) {
      if (fs.existsSync(`${abs}.js`)) abs = `${abs}.js`
      else if (fs.existsSync(path.join(abs, 'index.js'))) abs = path.join(abs, 'index.js')
      else continue   // nodeBoundary.test.js is what catches an unresolvable import
    }
    out.push(path.relative(repoRoot, abs).split(path.sep).join('/'))
  }
  return out
}

/** Everything reachable from the entry points, transitively. */
function reachableFrom(entries) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length) {
    const rel = queue.shift()
    if (seen.has(rel)) continue
    seen.add(rel)
    const abs = path.join(repoRoot, rel)
    if (!fs.existsSync(abs) || !abs.endsWith('.js')) continue
    for (const next of localImports(abs)) if (!seen.has(next)) queue.push(next)
  }
  return [...seen]
}

// agent.js loads each route by PATH at request time, so no static import
// reaches the handlers — they have to be named the way the loader names them.
const handlerEntries = ROUTES.map(route => {
  const inHandlers = `server/agentHandlers/${route}.js`
  return fs.existsSync(path.join(repoRoot, inHandlers)) ? inHandlers : `api/agent/${route}.js`
})

const ENTRIES = ['server/agent.js', ...handlerEntries]

describe('the agent image contains everything the agent imports', () => {
  it('reads the Dockerfile (guards the parse itself)', () => {
    // If the COPY regex ever stops matching, every assertion below passes
    // vacuously — an empty allowlist covers nothing, but an empty GRAPH also
    // finds nothing missing.
    expect(COPIED.length).toBeGreaterThanOrEqual(4)
    expect(COPIED).toContain('api/agent')
  })

  it('finds every route handler on disk', () => {
    for (const entry of ENTRIES) {
      expect(fs.existsSync(path.join(repoRoot, entry)), `${entry} does not exist`).toBe(true)
    }
  })

  it('copies every file the entry points reach', () => {
    const missing = reachableFrom(ENTRIES).filter(rel => !isCovered(rel))
    // Named in the failure, so the fix is reading the message rather than
    // rebuilding the image to find out which file it was.
    expect(missing, `add a COPY line to server/Dockerfile for: ${missing.join(', ')}`).toEqual([])
  })

  // The directory whose absence caused this twice. Asserted by name as well as
  // by the graph, so it stays covered even if every handler in it is
  // temporarily removed.
  it('copies the n8n-only handlers directory by name', () => {
    expect(COPIED).toContain('server/agentHandlers')
  })
})
