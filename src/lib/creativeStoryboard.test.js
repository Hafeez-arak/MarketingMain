import { describe, it, expect } from 'vitest'
import { normalizeStoryboard, staleSeams } from './creativeStoryboard'

// ─── Seams after a draft is finished ───────────────────────────────────────
// A chained clip is "stale" when the clip before it was re-rendered after it
// was made — its first frame no longer matches anything. Making the previous
// clip 1080p mints a NEWER row for it, but it is the same take (the upscaler
// enlarges the footage rather than rolling new footage), so the seam still
// joins. Reading it as broken would push the team to re-render a
// clip that was fine, at full price.

const board = {
  model: 'seedance-2.5',
  clips: [
    { key: 'a', prompt: 'one', continueFromPrevious: false },
    { key: 'b', prompt: 'two', continueFromPrevious: true },
  ],
}

const draft = { id: 'd1', kind: 'video', clip_index: 0, created_at: '2026-10-13T10:00:00Z' }
const clip2 = { id: 'c2', kind: 'video', clip_index: 1, created_at: '2026-10-13T10:05:00Z' }

describe('staleSeams', () => {
  it('keeps a seam joined when the clip before it was only made 1080p', () => {
    const finished = {
      id: 'f1', kind: 'video', clip_index: 0, parent_version_id: 'd1',
      created_at: '2026-10-13T10:10:00Z', model: 'topaz-upscale',
    }
    const seams = staleSeams(board, [finished, clip2], [draft, clip2, finished])
    expect(seams.size).toBe(0)
  })

  it('still flags a seam when the clip before it was genuinely re-rendered', () => {
    const rerender = { id: 'r1', kind: 'video', clip_index: 0, parent_version_id: 'd1',
      created_at: '2026-10-13T10:10:00Z' }
    const seams = staleSeams(board, [rerender, clip2], [draft, clip2, rerender])
    expect([...seams]).toEqual([1])
  })
})

describe('normalizeStoryboard', () => {
  it('opens a board saved on a retired model on the model that replaced it', () => {
    const sb = normalizeStoryboard({ model: 'kling-2.5-turbo-pro', clips: [{ prompt: 'x', duration: '10' }] })
    expect(sb.model).toBe('kling-3-pro')
  })
})
