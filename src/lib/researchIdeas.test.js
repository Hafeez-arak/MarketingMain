import { describe, it, expect } from 'vitest'
import {
  alreadySent, researchIdeaToPlanIdea, promotable, promotionNote, RESEARCH_SOURCE,
} from './researchIdeas'

const idea = (title, extra = {}) => ({ title, rationale: 'because finding X', ...extra })

describe('researchIdeaToPlanIdea', () => {
  const row = researchIdeaToPlanIdea(
    idea('Ramadan lighting', { angle: 'warm domestic scenes', suggested_format: 'carousel' }),
    { workspaceId: 'ws', planId: 'plan', position: 3 },
  )

  it('lands as proposed — the agent gets a seat, not a vote', () => {
    // Same status the planner's own generated ideas arrive in, so it faces the
    // same approve/reject that already exists. No new approval surface.
    expect(row.status).toBe('proposed')
  })

  it('is traceable back to the research that suggested it', () => {
    expect(row.source).toBe(RESEARCH_SOURCE)
    expect(row.rationale).toBe('because finding X')
  })

  it('belongs to a plan, because the table requires one', () => {
    expect(row.plan_id).toBe('plan')
    expect(row.workspace_id).toBe('ws')
  })

  it('does not guess the fields the planner owns', () => {
    // A guessed default is indistinguishable from a chosen one on the planner
    // screen, and someone will ship it.
    expect(row.format).toBeUndefined()
    expect(row.aspect_ratio).toBeUndefined()
    expect(row.image_mode).toBeUndefined()
    expect(row.caption_en).toBeUndefined()
  })

  it('falls back to the angle when there is no title', () => {
    const r = researchIdeaToPlanIdea({ angle: 'only an angle' }, { workspaceId: 'w', planId: 'p' })
    expect(r.title).toBe('only an angle')
  })

  it('survives a malformed idea without throwing', () => {
    expect(() => researchIdeaToPlanIdea(null, {})).not.toThrow()
    expect(researchIdeaToPlanIdea(undefined, {}).title).toBe('')
  })
})

describe('alreadySent', () => {
  it('matches on title regardless of case and spacing', () => {
    expect(alreadySent(idea('Ramadan Lighting'), [{ title: '  ramadan lighting ' }])).toBe(true)
  })

  it('matches a research title against a planner topic too', () => {
    expect(alreadySent(idea('Ramadan Lighting'), [{ topic: 'Ramadan Lighting' }])).toBe(true)
  })

  it('does not match a different idea', () => {
    expect(alreadySent(idea('Ramadan Lighting'), [{ title: 'Eid lighting' }])).toBe(false)
  })

  it('treats an untitled idea as unsent rather than as a match for everything', () => {
    expect(alreadySent({ title: '' }, [{ title: '' }])).toBe(false)
  })
})

describe('promotable', () => {
  const ideas = [idea('A'), idea('B'), idea('C')]

  it('appends after what the plan already holds', () => {
    // Colliding at 0 scrambles the order on reload, which sorts by position.
    const { rows } = promotable(ideas, [{ position: 0 }, { position: 4 }], { workspaceId: 'w', planId: 'p' })
    expect(rows.map(r => r.position)).toEqual([5, 6, 7])
  })

  it('starts at 0 for an empty plan', () => {
    const { rows } = promotable(ideas, [], { workspaceId: 'w', planId: 'p' })
    expect(rows.map(r => r.position)).toEqual([0, 1, 2])
  })

  it('skips what is already in that plan, and says which', () => {
    const { rows, skipped } = promotable(ideas, [{ title: 'B', position: 0 }], { workspaceId: 'w', planId: 'p' })
    expect(rows.map(r => r.title)).toEqual(['A', 'C'])
    expect(skipped).toEqual(['B'])
  })

  it('leaves no gap in position when it skips one', () => {
    const { rows } = promotable(ideas, [{ title: 'B', position: 0 }], { workspaceId: 'w', planId: 'p' })
    expect(rows.map(r => r.position)).toEqual([1, 2])
  })

  it('drops an idea with neither title nor angle rather than writing a blank row', () => {
    const { rows } = promotable([{ rationale: 'x' }], [], { workspaceId: 'w', planId: 'p' })
    expect(rows).toEqual([])
  })

  it('survives nonsense', () => {
    expect(() => promotable(null, null, {})).not.toThrow()
    expect(promotable(null, null, {}).rows).toEqual([])
  })
})

describe('promotionNote', () => {
  it('tells the three outcomes apart', () => {
    // "nothing happened" and "it was all already there" look identical to
    // someone who just clicked, and only one of them is a problem.
    expect(promotionNote({ sent: 2, planName: 'September' })).toContain('Sent 2')
    expect(promotionNote({ sent: 0, skipped: 3 })).toContain('Already in that plan')
    expect(promotionNote({ sent: 0, skipped: 0 })).toBe('Nothing to send.')
  })

  it('reports a partial send as both halves', () => {
    const note = promotionNote({ sent: 1, skipped: 2 })
    expect(note).toContain('Sent 1')
    expect(note).toContain('2 was already there')
  })
})
