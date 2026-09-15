import { describe, it, expect } from 'vitest'
import { BRIEF_SCHEMA } from './brief'

// ─── The structured-output schemas stay inside the API's limits ────────────
// On 2026-09-15 the first run after the three-reader report shipped did no
// research at all. Every searching lens was refused before it started:
//
//   "Schemas contains too many optional parameters (32) ... (limit: 24)"
//
// and synthesis was refused with "The compiled grammar is too large". The
// free count_tokens check had accepted both schemas, because it does not
// compile the grammar — so nothing short of a real run would have caught it.
// This does, for free: it counts optional parameters the way the API does,
// across every nested object, and holds each schema well under the limit so
// the next added field fails here rather than in production.

const API_LIMIT = 24
// Headroom, deliberately. The lens schema is at 5 after the fix; a budget of
// 12 leaves room to add a field without a second outage.
const BUDGET = 12
const BRIEF_BUDGET = 0

/** Optional properties anywhere in a JSON schema: properties not in `required`. */
export function countOptional(schema) {
  let n = 0
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.type === 'object' && node.properties) {
      const required = new Set(node.required || [])
      for (const [key, child] of Object.entries(node.properties)) {
        if (!required.has(key)) n += 1
        walk(child)
      }
    }
    if (node.items) walk(node.items)
    for (const k of ['anyOf', 'allOf', 'oneOf']) if (node[k]) walk(node[k])
  }
  walk(schema)
  return n
}

/** Every property in a schema, required or not, across nested objects. */
export function countProperties(schema) {
  let n = 0
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.type === 'object' && node.properties) {
      for (const child of Object.values(node.properties)) { n += 1; walk(child) }
    }
    if (node.items) walk(node.items)
  }
  walk(schema)
  return n
}

// The compiled-grammar limit is NOT documented as a number. It was measured
// on 2026-09-15 with real claude-opus-5 calls (a refused schema is not billed):
//
//   brief as merged in #63 .................. 56 properties  REFUSED
//   same, every field required .............. 56             REFUSED
//   same, minus competitor_reads ............ 53             REFUSED
//   #63 minus competitor_moves .............. 48             COMPILED
//   this fix (no market, no competitor_reads) 44             COMPILED
//
// So 48 is the largest size known to compile. Past it, verify against the API
// before merging — this test cannot tell you where between 48 and 53 it breaks.
const BRIEF_PROPERTY_CEILING = 48

describe('structured-output schemas stay under the API limits', () => {
  it('counts the way the API does — the 2026-09-15 lens schema really had 32', () => {
    const leaf = { type: 'string' }
    const obj = (props, required = []) => ({ type: 'object', properties: props, required })
    const legacy = obj({
      findings: {
        type: 'array',
        items: obj({
          headline: leaf, confidence: leaf, detail: leaf, novelty: leaf, perishable_until: leaf, suggested_action: leaf,
          for_whom: leaf, technical_note: leaf, relevance: leaf, competitor: leaf, channel: leaf, category: leaf,
          lead: obj(Object.fromEntries(['name', 'type', 'client', 'contractor', 'consultant', 'location', 'scope', 'stage', 'deadline', 'timing'].map(k => [k, leaf])), ['name']),
          event: obj(Object.fromEntries(['name', 'start_date', 'end_date', 'venue', 'city', 'organizer', 'url', 'exhibitor_deadline', 'competitors_exhibiting'].map(k => [k, leaf])), ['name']),
          sources: { type: 'array', items: obj({ url: leaf, title: leaf, quote: leaf }, ['url']) },
        }, ['headline', 'confidence']),
      },
    }, ['findings'])
    expect(countOptional(legacy)).toBe(32)
  })

  it('the lens findings schema', async () => {
    // Imported here rather than at the top: _lenses.js is server code and
    // pulls in the Supabase client, which reads env at import time.
    globalThis.process.env.SUPABASE_URL ||= 'https://stub.invalid'
    globalThis.process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub'
    const { FINDINGS_SCHEMA } = await import('../../../api/agent/_lenses.js')
    const n = countOptional(FINDINGS_SCHEMA.schema)
    expect(n).toBeLessThanOrEqual(BUDGET)
    expect(n).toBeLessThan(API_LIMIT)
  })

  it('the synthesis brief schema has no optional fields at all', () => {
    // Stricter than the lens schema, because this is the one that hit the
    // compiled-grammar size limit even at six optional fields — the same count
    // it had compiled with before the three-reader sections were added.
    expect(countOptional(BRIEF_SCHEMA.schema)).toBe(BRIEF_BUDGET)
  })

  it('the synthesis brief schema stays at a size known to compile', () => {
    expect(countProperties(BRIEF_SCHEMA.schema)).toBeLessThanOrEqual(BRIEF_PROPERTY_CEILING)
  })
})
