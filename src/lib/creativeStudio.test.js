import { describe, it, expect } from 'vitest'
import { buildBranches } from './creativeStudio.js'

// ─── buildBranches ─────────────────────────────────────────────────────────
//
// The invariant the Creative Studio is built on: a generate session shows ONE
// lane per model, and nothing a marketer can do from the screen adds a third.
// Retrying a failed candidate used to add one every time, because a round-0
// row has no parent and so nothing recorded that the retry replaced it.

const v = (id, over = {}) => ({
  id,
  round: 0,
  kind: 'generate',
  provider: 'gemini',
  status: 'ready',
  media_type: 'image',
  parent_version_id: null,
  clip_index: null,
  clip_role: null,
  created_at: `2026-09-16T11:11:${String(over.sec ?? 0).padStart(2, '0')}Z`,
  ...over,
})

describe('buildBranches', () => {
  it('gives a plain round a lane per provider', () => {
    const branches = buildBranches([
      v('a', { provider: 'openai', sec: 6 }),
      v('b', { provider: 'gemini', sec: 6 }),
    ])
    expect(branches.map(b => b.provider)).toEqual(['openai', 'gemini'])
  })

  // The session that prompted the fix: bed07832, 2026-09-16. One ChatGPT
  // candidate, one Gemini candidate, three failed Gemini retries and a fourth
  // attempt that worked — five parentless rows where the screen allows two.
  it('keeps retries of a failed candidate inside that provider\'s lane', () => {
    const branches = buildBranches([
      v('gpt-ok',   { provider: 'openai', sec: 6 }),
      v('gem-1',    { status: 'failed', sec: 6 }),
      v('gem-2',    { status: 'failed', sec: 22 }),
      v('gem-3',    { status: 'failed', sec: 29 }),
      v('gem-ok',   { sec: 40 }),
    ])
    expect(branches).toHaveLength(2)
    const gem = branches.find(b => b.provider === 'gemini')
    expect(gem.versions.map(x => x.id)).toEqual(['gem-1', 'gem-2', 'gem-3', 'gem-ok'])
    // The working attempt is what the lane acts on, not the first failure.
    expect(gem.latest.id).toBe('gem-ok')
    // A lane that merged retries is still "Gemini", never "Gemini 1".
    expect(gem.variantIndex).toBe(0)
  })

  it('leaves a lane pending while a retry is in flight', () => {
    const [lane] = buildBranches([
      v('gem-1', { status: 'failed', sec: 6 }),
      v('gem-2', { status: 'pending', sec: 22 }),
    ])
    expect(lane.pending).toBe(true)
    expect(lane.latest).toBe(null)
  })

  // Edits and animations descend from a parent, so they were never the
  // problem — but they must still land in the lane they were made from.
  it('keeps an edit in the lane of the image it was made from', () => {
    const branches = buildBranches([
      v('gpt', { provider: 'openai', sec: 6 }),
      v('gem', { sec: 6 }),
      v('gem-edit', { round: 1, kind: 'edit', parent_version_id: 'gem', sec: 50 }),
    ])
    expect(branches).toHaveLength(2)
    expect(branches.find(b => b.provider === 'gemini').versions.map(x => x.id))
      .toEqual(['gem', 'gem-edit'])
  })

  // A retry of a retry: the second replacement has no parent either, and has
  // to find the same lane rather than a third one.
  it('merges a retry of a retry', () => {
    const branches = buildBranches([
      v('gem-1', { status: 'failed', sec: 6 }),
      v('gem-2', { status: 'failed', sec: 22 }),
      v('gem-3', { status: 'failed', sec: 29 }),
    ])
    expect(branches).toHaveLength(1)
    expect(branches[0].latest).toBe(null)
  })

  // The exemption that keeps multi-clip sessions working. Every storyboard
  // clip is parentless and every one is provider 'seedance' — merging them by
  // provider would collapse a four-shot reel into one lane.
  it('keeps storyboard clips apart even though they share a provider', () => {
    const clip = (id, i) => v(id, {
      provider: 'seedance', kind: 'video', media_type: 'video', clip_index: i, sec: i,
    })
    const branches = buildBranches([clip('c0', 0), clip('c1', 1), clip('c2', 2), clip('c3', 3)])
    expect(branches).toHaveLength(4)
  })

  it('keeps a stitch row out of the clip lanes', () => {
    const branches = buildBranches([
      v('c0', { provider: 'seedance', kind: 'video', media_type: 'video', clip_index: 0, sec: 1 }),
      v('st', { provider: 'manual', kind: 'video', media_type: 'video', round: 1, clip_role: 'stitch', sec: 2 }),
    ])
    expect(branches).toHaveLength(2)
  })

  // A single-video session is one lane; a retried render must not turn it into
  // a side-by-side comparison of a dead row and a live one.
  it('merges retried renders in a single-video session', () => {
    const branches = buildBranches([
      v('r1', { provider: 'seedance', kind: 'video', media_type: 'video', status: 'failed', sec: 6 }),
      v('r2', { provider: 'seedance', kind: 'video', media_type: 'video', sec: 40 }),
    ])
    expect(branches).toHaveLength(1)
    expect(branches[0].latest.id).toBe('r2')
  })

  it('survives a version whose parent is missing from the list', () => {
    const branches = buildBranches([
      v('orphan', { round: 1, kind: 'edit', parent_version_id: 'deleted-long-ago', sec: 9 }),
    ])
    expect(branches).toHaveLength(1)
    expect(branches[0].versions.map(x => x.id)).toEqual(['orphan'])
  })
})
