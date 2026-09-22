import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── Vercel Hobby allows 12 Serverless Functions per deployment ────────────
//
// Not a soft limit and not a performance note. The thirteenth function makes
// Vercel refuse to BUILD:
//
//   No more than 12 Serverless Functions can be added to a Deployment on the
//   Hobby plan. Create a team (Pro plan) to deploy more.
//
// So adding one does not slow production down — it takes production down, and
// every unrelated fix queued behind it with it. That is what happened on
// 2026-09-22: api/agent/critique.js was the thirteenth, and the deployment
// carrying the auto-replies URL fix failed with it.
//
// Nothing local could see it. Tests, lint and `vite build` all pass on a repo
// that Vercel will reject, because none of them counts files in api/. This
// does.
//
// ── WHEN THIS FAILS ──
//
// Do not raise the number. Move the new handler to server/agentHandlers/ and
// reach it through an n8n gateway, the way indexHealth, websiteExplain and
// critique already are — see server/agent.js. Raise it only when the account
// actually moves to a Pro plan, and say so in the commit that does.

const HOBBY_FUNCTION_LIMIT = 12

const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)))

/**
 * Every file Vercel turns into a function.
 *
 * A leading underscore marks a shared module, not a route, and Vercel ignores
 * it — that convention is the only reason api/agent/_provider.js and friends
 * do not each cost a function. Test files are excluded here but would not be
 * deployed either.
 */
function functionFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { out.push(...functionFiles(full)); continue }
    if (!entry.name.endsWith('.js')) continue
    if (entry.name.endsWith('.test.js')) continue
    out.push(path.relative(apiDir, full))
  }
  return out
}

describe('Vercel function budget', () => {
  const files = functionFiles(apiDir)

  it('finds the functions (guards the walk itself)', () => {
    // If this stops finding files the limit check below passes vacuously.
    expect(files.length).toBeGreaterThanOrEqual(8)
    expect(files).toContain(path.join('agent', 'chat.js'))
  })

  it(`stays within the ${HOBBY_FUNCTION_LIMIT} the Hobby plan will build`, () => {
    expect(files.length).toBeLessThanOrEqual(HOBBY_FUNCTION_LIMIT)
  })

  // The handlers that moved off Vercel must not drift back by being recreated
  // under api/ — each one would retake a slot and the build would fail again.
  it('keeps the n8n-hosted handlers out of api/', () => {
    for (const moved of ['indexHealth.js', 'websiteExplain.js', 'critique.js']) {
      expect(files).not.toContain(path.join('agent', moved))
    }
  })
})
