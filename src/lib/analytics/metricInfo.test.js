import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
// fileURLToPath, not `new URL(...).pathname` — this repo lives under a
// directory with a space in its name, and `.pathname` hands back `%20`.
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { metricInfo, METRIC_INFO_KEYS } from './metricInfo'

// ─── The dictionary and its call sites, kept honest ────────────────────────
// Two failure modes, both silent in the browser:
//
//   · A tile asks for `post.rech`. metricInfo() returns null by design, the
//     info dot renders nothing, and the tile quietly loses its explanation —
//     no error, no warning, nothing to notice in review.
//   · An entry is deleted or renamed and the tiles that referenced it go the
//     same way.
//
// So the source is scanned for every `metric="…"` a component passes and each
// one is required to exist. Regex rather than a parser because the prop is
// only ever written as a string literal here, and a test that needs a build
// step to run is a test that stops being run.

const SRC = fileURLToPath(new URL('../../', import.meta.url))

function jsxFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...jsxFiles(path))
    else if (name.endsWith('.jsx')) out.push(path)
  }
  return out
}

const referenced = new Map() // key -> [file, …]
for (const file of jsxFiles(SRC)) {
  const text = readFileSync(file, 'utf8')
  for (const [, key] of text.matchAll(/\bmetric="([^"]+)"/g)) {
    referenced.set(key, [...(referenced.get(key) || []), file.slice(SRC.length)])
  }
}

describe('metricInfo', () => {
  it('answers null for an unknown key rather than throwing', () => {
    expect(metricInfo('nope.nothing')).toBeNull()
    expect(metricInfo(undefined)).toBeNull()
    expect(metricInfo('')).toBeNull()
  })

  it('gives every entry a `what` that reads as a sentence', () => {
    for (const key of METRIC_INFO_KEYS) {
      const info = metricInfo(key)
      expect(info.what, key).toBeTruthy()
      expect(info.what.endsWith('.'), `${key}: "what" should end in a full stop`).toBe(true)
      if (info.note) {
        expect(info.note.endsWith('.'), `${key}: "note" should end in a full stop`).toBe(true)
      }
    }
  })

  it('namespaces every key by scope', () => {
    // The whole point of the file: `reach` alone would have to describe both
    // the account-wide figure and the per-post sum, and could only be right
    // about one of them.
    for (const key of METRIC_INFO_KEYS) {
      expect(key, key).toMatch(/^(ig|li|post|row|home|calc)\.[a-z_]+$/)
    }
  })

  it('defines every metric the components ask for', () => {
    const missing = [...referenced].filter(([key]) => !metricInfo(key))
    expect(missing.map(([key, files]) => `${key} (${files.join(', ')})`)).toEqual([])
  })

  it('found the call sites at all', () => {
    // Guards the guard: if the scan silently matched nothing — moved files, a
    // renamed prop — the test above would pass over an empty set forever.
    expect(referenced.size).toBeGreaterThan(15)
  })

  it('keeps the two engagement rates describing different things', () => {
    // The specific confusion this file was written for: a LinkedIn page read
    // 6.3% directly above a post strip reading 3.2%. Only one of them is ever
    // rendered now, but both entries survive — whichever one is on screen has
    // to say whose arithmetic produced it, because the answer is not the same
    // on Instagram as it is on LinkedIn.
    const page = metricInfo('li.engagement_rate')
    const post = metricInfo('post.engagement_rate')
    expect(page.what).not.toEqual(post.what)
    expect(`${page.what} ${page.note}`).toMatch(/LinkedIn’s (own )?(number|formula|engagement)/i)
    expect(`${post.what} ${post.note}`).toMatch(/worked out here/i)
  })

  it('has no entry for a metric that was deliberately removed', () => {
    // These were dropped from the UI rather than explained — LinkedIn's
    // page-view split by tab, which nobody acts on. A stale entry here is how
    // a deleted tile quietly comes back: the next person adding a strip finds
    // a ready-made definition and assumes it earned its place.
    for (const key of ['li.page_views_careers', 'li.page_views_jobs', 'li.page_views_life', 'li.page_views_overview']) {
      expect(metricInfo(key), key).toBeNull()
    }
  })

  it('warns that per-post reach double-counts', () => {
    // Why "accounts reached 10" can sit above "post reach 16" without either
    // being wrong.
    expect(metricInfo('post.reach').note).toMatch(/counts four times|once per post/i)
    expect(metricInfo('ig.reach').note).toMatch(/once/i)
  })
})
