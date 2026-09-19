import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./supabaseClient', () => ({ SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon' }))
const { readPlanGeneration, insertIdeas, PLAN_GENERATION_TIMEOUT_MS } = await import('./contentPlans')
const { ideasFromReport, answersLabel } = await import('./researchIdeas')

afterEach(() => vi.unstubAllGlobals())

// ─── readPlanGeneration ────────────────────────────────────────────────────
// The plan row is the ONLY handle on a running generation now, so these five
// outcomes are the whole contract. Confusing any two of them reintroduces the
// bug this replaced: a month that was paid for and thrown away.

function rowReturning(row) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => (row ? [row] : []) })))
}

describe('readPlanGeneration', () => {
  it('keeps waiting while n8n still has it', async () => {
    rowReturning({ status: 'generating', generation_started_at: new Date().toISOString() })
    expect((await readPlanGeneration('w', 't', 'p')).state).toBe('working')
  })

  it('reports ready once posts are on the row', async () => {
    rowReturning({ status: 'generating', generation_result: { posts: [{ topic: 'a' }] } })
    const out = await readPlanGeneration('w', 't', 'p')
    expect(out.state).toBe('ready')
    expect(out.result.posts).toHaveLength(1)
  })

  // n8n writes the error AND flips status back to 'draft' in one PATCH. Read
  // the status first and a failed run looks like a finished one.
  it('reports the failure, not the status, when both changed at once', async () => {
    rowReturning({ status: 'draft', generation_error: 'Claude rejected the request', generation_result: null })
    const out = await readPlanGeneration('w', 't', 'p')
    expect(out.state).toBe('failed')
    expect(out.error).toMatch(/rejected/)
  })

  it('gives up on a run that has been generating past the timeout', async () => {
    rowReturning({
      status: 'generating',
      generation_started_at: new Date(Date.now() - PLAN_GENERATION_TIMEOUT_MS - 1000).toISOString(),
    })
    expect((await readPlanGeneration('w', 't', 'p')).state).toBe('stale')
  })

  it('does not call a run dead just because one read failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => [] })))
    // 'unknown', never 'failed'/'stale' — the caller keeps waiting. A dropped
    // request must not cost someone a month that is still being written.
    expect((await readPlanGeneration('w', 't', 'p')).state).toBe('unknown')
  })

  it('says gone when the workspace does not own that plan', async () => {
    rowReturning(null)
    expect((await readPlanGeneration('w', 't', 'p')).state).toBe('gone')
  })

  // An empty posts array is not a result. Treating it as one writes a blank
  // board and reports success.
  it('does not treat an empty slate as a finished one', async () => {
    rowReturning({ status: 'generating', generation_result: { posts: [] }, generation_started_at: new Date().toISOString() })
    expect((await readPlanGeneration('w', 't', 'p')).state).toBe('working')
  })
})

// ─── insertIdeas + source ──────────────────────────────────────────────────
// PostgREST refuses a bulk insert whose rows do not share the same keys, so
// `source` is all-or-none across a batch exactly like platform_options.

async function sent(ideas) {
  let body
  vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
    body = JSON.parse(opts.body)
    return { ok: true, json: async () => body }
  }))
  await insertIdeas('ws-1', 'tok', 'plan-1', ideas)
  return body
}

describe('insertIdeas — research provenance', () => {
  it('leaves source out entirely when nothing came from research', async () => {
    const rows = await sent([{ topic: 'a' }, { topic: 'b' }])
    expect(rows.every(r => !('source' in r))).toBe(true)
  })

  it('names source on EVERY row once any idea came from research', async () => {
    const rows = await sent([{ topic: 'a', fromResearch: 'Ramadan guide' }, { topic: 'b' }])
    expect(rows.every(r => 'source' in r)).toBe(true)
    expect(rows[0].source).toBe('research')
    expect(rows[1].source).toBe('planner')
  })
})

// ─── ideasFromReport ───────────────────────────────────────────────────────

describe('ideasFromReport', () => {
  const report = {
    gaps: [{ id: 'G1', gap: 'No Ramadan content while rivals all run it' }],
    proposed_ideas: [
      { title: 'Ramadan lighting guide', angle: 'Warm evening scenes', rationale: 'Closes G1', answers_ref: { kind: 'gap', id: 'G1' }, suggested_format: 'carousel' },
      { title: 'Spec explainer', answers_ref: { kind: 'finding', ref: 'F2', headline: 'Buyers ask for spec sheets' } },
    ],
  }

  it('carries the reason each idea exists, not just its title', () => {
    const [ramadan, spec] = ideasFromReport(report)
    expect(ramadan.answers).toBe('No Ramadan content while rivals all run it')
    expect(spec.answers).toBe('Buyers ask for spec sheets')
  })

  it('keys on the normalised title, matching alreadySent', () => {
    expect(ideasFromReport(report)[0].key).toBe('ramadan lighting guide')
  })

  it('drops a duplicate title rather than rendering two rows that tick apart', () => {
    const dupe = { proposed_ideas: [{ title: 'Same' }, { title: 'same' }] }
    expect(ideasFromReport(dupe)).toHaveLength(1)
  })

  it('falls back to the angle when an idea has no title', () => {
    expect(ideasFromReport({ proposed_ideas: [{ angle: 'An angle' }] })[0].title).toBe('An angle')
  })

  it('is empty, not broken, for a workspace that never ran research', () => {
    expect(ideasFromReport({})).toEqual([])
    expect(ideasFromReport()).toEqual([])
  })

  // Old reports predate `answers` entirely. They must still list.
  it('lists an unbound idea with no reason rather than hiding it', () => {
    const out = ideasFromReport({ proposed_ideas: [{ title: 'Old idea' }] })
    expect(out).toHaveLength(1)
    expect(out[0].answers).toBe('')
  })
})

describe('answersLabel', () => {
  it('is empty when the reference points at a gap that is gone', () => {
    expect(answersLabel({ answers_ref: { kind: 'gap', id: 'G9' } }, [{ id: 'G1', gap: 'x' }])).toBe('')
  })
})
