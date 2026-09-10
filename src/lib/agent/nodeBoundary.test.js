import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// ─── The import boundary, asserted ─────────────────────────────────────────
// AGENT.md §6 names this failure and it is the reason the brand*Core.js
// modules exist: `buildContext` is the single entry point for brand context,
// the server must go through it, and it could not be loaded by a Node
// function at all. brandContext.js imports React and supabaseClient, and
// supabaseClient reads `import.meta.env`, which does not exist outside the
// Vite bundle.
//
// WHY THIS TEST SPAWNS A REAL `node` INSTEAD OF JUST IMPORTING:
//
// Vitest runs on Vite's resolver. Vite resolves `./models` without an
// extension, resolves JSX, and shims `import.meta.env`. So an ordinary
// `import` inside a test would pass on every module in this list while the
// deployed function throws on the first request — the test would be measuring
// Vite's tolerance, not Node's.
//
// Both failure modes this catches have already happened here once each:
//   • api/agent/_context.js imported brandContext.js (React + import.meta.env)
//   • src/lib/agent/cost.js imported './models' with no file extension
//
// Neither shows up in a browser build, in a lint pass, or in any other test.
// They show up as a 500 on the agent's first live call.

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')

/**
 * Import a module in a genuinely separate Node process — no Vite, no aliases,
 * no shims. Returns its export names, or throws with Node's own message.
 */
function importUnderNode(relPath) {
  const script =
    `import(${JSON.stringify(path.join(repoRoot, relPath))})` +
    `.then(m => { process.stdout.write(Object.keys(m).sort().join(',')) })` +
    `.catch(e => { process.stderr.write(String(e && e.message || e)); process.exit(1) })`
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe('the agent runs in Node, not in a bundle', () => {
  // Every module a Vercel function under api/agent/ can reach, directly or
  // transitively. Adding a file there means adding it here.
  const serverReachable = [
    'src/lib/brandSchemaCore.js',
    'src/lib/brandBrainCore.js',
    'src/lib/brandContextCore.js',
    'src/lib/agent/models.js',
    'src/lib/agent/cost.js',
    'src/lib/agent/budget.js',
    'src/lib/agent/prompt.js',
    'src/lib/agent/tools.js',
    'src/lib/agent/aggregate.js',
    'src/lib/agent/loop.js',
    'src/lib/agent/gather.js',
    'src/lib/agent/brief.js',
    'api/agent/_supabase.js',
    'api/agent/_context.js',
    'api/agent/_provider.js',
    'api/agent/_tools.js',
    'api/agent/_loop.js',
    'api/agent/_gather.js',
    'api/agent/_investigate.js',
    // The endpoints themselves. Vercel imports these files directly, so if one
    // cannot load under Node the route is a 500 before any of the above
    // matters.
    'api/agent/chat.js',
    'api/agent/run.js',
  ]

  for (const rel of serverReachable) {
    it(`${rel} loads under plain Node`, () => {
      expect(() => importUnderNode(rel)).not.toThrow()
    })
  }

  it('buildContext itself is reachable from the server — the whole point', () => {
    // Named separately from the loop because this is the specific constraint
    // AGENT.md §3 calls the most important one in the document. If the agent
    // cannot call this exact function, it will grow a second assembler, and
    // the brand the server sees will drift from the brand the browser
    // previews with nothing to show which is right.
    const exports = importUnderNode('src/lib/brandContextCore.js').split(',')
    expect(exports).toContain('buildContext')
  })

  it('the core modules pull in no browser-only dependency', () => {
    // A regression guard with teeth: re-importing React or supabaseClient into
    // one of these files would break the server and nothing else, so the
    // browser build would stay green while the agent went down.
    for (const rel of ['src/lib/brandSchemaCore.js', 'src/lib/brandBrainCore.js', 'src/lib/brandContextCore.js']) {
      expect(() => importUnderNode(rel)).not.toThrow()
    }
  })
})

describe('the split kept one implementation, not two', () => {
  // The re-export contract. If someone later "fixes" a bug by editing the copy
  // in brandContext.js instead of the core, these stop being the same function
  // object and the whole reason for the split is gone.
  it('brandContext.js re-exports the identical buildContext', async () => {
    const [browserSide, coreSide] = await Promise.all([
      import('../brandContext.js'),
      import('../brandContextCore.js'),
    ])
    expect(browserSide.buildContext).toBe(coreSide.buildContext)
    expect(browserSide.matchFeaturedRows).toBe(coreSide.matchFeaturedRows)
    expect(browserSide.getBrandIdentity).toBe(coreSide.getBrandIdentity)
  })

  it('brandBrain.js and brandSchema.js re-export their cores identically', async () => {
    const [brain, brainCore, schema, schemaCore] = await Promise.all([
      import('../brandBrain.js'),
      import('../brandBrainCore.js'),
      import('../brandSchema.js'),
      import('../brandSchemaCore.js'),
    ])
    expect(brain.buildInstructionsString).toBe(brainCore.buildInstructionsString)
    expect(brain.buildSectionBlocks).toBe(brainCore.buildSectionBlocks)
    expect(schema.buildDirectoryBlock).toBe(schemaCore.buildDirectoryBlock)
    expect(schema.getFieldValue).toBe(schemaCore.getFieldValue)
  })
})
