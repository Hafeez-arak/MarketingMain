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
//
// ── THE UNDERSCORE IS THE ONLY EXEMPTION ──
//
// Vercel turns EVERY .js file under api/ into a function. The single exception
// is a leading underscore on a file or directory name, which is why
// api/agent/_provider.js and api/zernio/_zernio.test.js cost nothing.
//
// A `.test.js` suffix means nothing to Vercel. The first version of this file
// assumed otherwise, excluded test files from its own count, and was itself
// deployed as the thirteenth function — so it reported 12, passed, and broke
// the build it existed to protect. It is `_vercelFunctionBudget.test.js` now,
// and the rule below is Vercel's rule and nothing else.

const HOBBY_FUNCTION_LIMIT = 12

const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)))

/**
 * Every file Vercel turns into a function.
 *
 * Vercel's rule exactly: any .js under api/, unless a file or directory in its
 * path begins with an underscore. Nothing else is exempt — not a `.test.js`
 * suffix, not a name that obviously is not a route. Adding any cleverness here
 * makes this file disagree with the platform, which is the one thing it must
 * never do.
 */
function functionFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { out.push(...functionFiles(full)); continue }
    if (!entry.name.endsWith('.js')) continue
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
    for (const moved of ['indexHealth.js', 'websiteExplain.js', 'critique.js',
      'performance.js', 'reviseIdea.js']) {
      expect(files).not.toContain(path.join('agent', moved))
    }
  })

  // How this file itself broke the build once: a test under api/ without a
  // leading underscore is deployed, and spends a function slot to do nothing.
  it('has no deployable test files, including this one', () => {
    const deployedTests = files.filter(f => f.endsWith('.test.js'))
    expect(deployedTests, `rename with a leading underscore: ${deployedTests.join(', ')}`).toEqual([])
  })

  // Every function costs a slot whether or not anyone calls it, so the list is
  // pinned. A new name here is a deliberate decision to spend the last slot,
  // not something that happens because a file appeared.
  it('is exactly the functions we mean to deploy', () => {
    expect([...files].sort()).toEqual([
      path.join('agent', 'chat.js'),
      path.join('agent', 'discover.js'),
      path.join('agent', 'lens.js'),
      path.join('agent', 'resolve.js'),
      path.join('agent', 'run.js'),
      path.join('agent', 'search.js'),
      path.join('agent', 'synthesise.js'),
      path.join('agent', 'website.js'),
      path.join('n8n', '[slot].js'),
      path.join('zernio', '[action].js'),
    ].sort())
  })
})
