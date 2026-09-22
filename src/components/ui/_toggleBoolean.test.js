import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── Toggle hands its caller a boolean ─────────────────────────────────────
//
// It used to hand out the <input>'s SyntheticEvent. Seven of thirteen call
// sites wrote the obvious `v => set(field, v)` and stored that event — always
// truthy, so a toggle read as permanently on or permanently off depending on
// how its `checked` prop asked the question:
//
//   checked={opts.x !== false}   never switchable OFF
//   checked={opts.x === true}    never switchable ON
//
// Instagram's and TikTok's "Made with AI" were both the second kind. Those are
// the disclosure flags the platforms require and neither could be ticked.
//
// Nothing threw and nothing logged — the switch simply animated back. No unit
// test could see it either, because this repo renders no components. So the
// guard is static: it reads the call sites.
//
// ── WHY THIS IS NOT AN ESLINT RULE ──
//
// The mistake is not a syntax error; both spellings are valid JSX and one of
// them silently means the wrong thing. What makes it catchable is knowing that
// THIS component's handler takes a boolean, which is a fact about this
// codebase rather than about React.

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.resolve(here, '../..')

function jsxFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { out.push(...jsxFiles(full)); continue }
    if (entry.name.endsWith('.jsx')) out.push(full)
  }
  return out
}

/** Every `<Toggle …>` element in the app, as its raw source text. */
function toggleUsages() {
  const found = []
  for (const file of jsxFiles(srcRoot)) {
    const source = fs.readFileSync(file, 'utf8')
    // The opening tag only — up to the first `/>` or `>` that ends it. Good
    // enough because Toggle is always self-closing here, and a false positive
    // is a failing test somebody reads rather than a bug somebody ships.
    for (const match of source.matchAll(/<Toggle\b[\s\S]*?\/>/g)) {
      found.push({ file: path.relative(srcRoot, file), text: match[0] })
    }
  }
  return found
}

const USAGES = toggleUsages()

describe('Toggle onChange takes a boolean', () => {
  it('finds the call sites (guards the scan itself)', () => {
    // Without this the assertions below pass on an empty list, which is the
    // failure mode every static guard in this repo has had to be written
    // against at least once.
    expect(USAGES.length).toBeGreaterThanOrEqual(10)
    expect(USAGES.some(u => u.file.includes('TikTokFields'))).toBe(true)
  })

  it('no call site reads e.target — that is the old event API', () => {
    const offenders = USAGES
      .filter(u => /\be\.target\b/.test(u.text))
      .map(u => u.file)
    expect(
      offenders,
      `Toggle passes a boolean now; use onChange={v => …} in: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  // The component itself, so the contract cannot be reverted without this
  // failing alongside every call site it would break.
  it('the component converts the event before calling out', () => {
    const source = fs.readFileSync(path.join(here, 'index.jsx'), 'utf8')
    const toggle = /export function Toggle\([\s\S]*?\n}/.exec(source)?.[0] || ''
    expect(toggle).toMatch(/onChange=\{e => onChange\?\.\(e\.target\.checked\)\}/)
    // The shape that caused this: the handler forwarded straight through.
    expect(toggle).not.toMatch(/onChange=\{onChange\}/)
  })
})
