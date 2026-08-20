import { describe, it, expect } from 'vitest'
import {
  competitorRowsFrom, isSnapshotable, cleanHandle, summariseResolve,
} from './research'

// ─── Research agenda helpers ───────────────────────────────────────────────
// The directory fixtures below are the SHAPE of the live Arak and Aqeeq
// competitor sections, checked 2026-08-20 — including the blank row Arak
// actually has and the fact that neither workspace holds a single Instagram
// handle. Tests written against a tidier imaginary directory would not have
// caught either.

const arakSchema = {
  sections: [
    { key: 'competitors', title: 'Competitor Watch', kind: 'directory', enabled: true },
    { key: 'suppliers', title: 'Suppliers', kind: 'directory', enabled: true },
  ],
  columns: [
    { section_key: 'competitors', key: 'name', label: 'Name', in_prompt: true },
    { section_key: 'competitors', key: 'positioning', label: 'Positioning', in_prompt: true },
    { section_key: 'competitors', key: 'strengths', label: 'Strengths', in_prompt: true },
    { section_key: 'competitors', key: 'how_we_differ', label: 'How We Differ', in_prompt: true },
    { section_key: 'competitors', key: 'watch_url', label: 'Watch URL', in_prompt: true },
    { section_key: 'suppliers', key: 'name', label: 'Name', in_prompt: true },
  ],
}

const arakDirectory = {
  rowsBySection: {
    competitors: [
      { id: 'r1', data: { name: 'Technolight', positioning: 'Architectural lighting supplier', watch_url: 'https://technolight-ksa.com/' } },
      { id: 'r2', data: { name: 'Alnasser Lighting', positioning: 'Retail lighting', watch_url: '' } },
      { id: 'r7', data: { name: '', positioning: '', watch_url: '' } },   // the blank row that really exists
    ],
    suppliers: [{ id: 's1', data: { name: 'Not a competitor' } }],
  },
}

describe('competitorRowsFrom', () => {
  it('reads the competitor section by title, not by a hardcoded key', () => {
    const rows = competitorRowsFrom(arakSchema, arakDirectory)
    expect(rows.map(r => r.name)).toEqual(['Technolight', 'Alnasser Lighting'])
  })

  it('carries the website through, because it is the one conclusive signal', () => {
    const [tech] = competitorRowsFrom(arakSchema, arakDirectory)
    expect(tech.website).toBe('https://technolight-ksa.com/')
    expect(tech.positioning).toBe('Architectural lighting supplier')
    expect(tech.source_row_id).toBe('r1')
  })

  it('drops the blank row rather than trying to research nothing', () => {
    const rows = competitorRowsFrom(arakSchema, arakDirectory)
    expect(rows.every(r => r.name)).toBe(true)
  })

  it('ignores directory sections that are not competitors', () => {
    const rows = competitorRowsFrom(arakSchema, arakDirectory)
    expect(rows.find(r => r.name === 'Not a competitor')).toBeUndefined()
  })

  it('de-duplicates a rival listed twice, which would otherwise split its history', () => {
    const dir = { rowsBySection: { competitors: [
      { id: 'a', data: { name: 'Ozee' } },
      { id: 'b', data: { name: 'ozee' } },
    ] } }
    expect(competitorRowsFrom(arakSchema, dir)).toHaveLength(1)
  })

  it('returns nothing for a workspace with no competitor section at all', () => {
    // Alo Kheyatah, today.
    const schema = { sections: [{ key: 'alterations', title: 'Alterations & Pricing', kind: 'directory', enabled: true }], columns: [] }
    expect(competitorRowsFrom(schema, { rowsBySection: {} })).toEqual([])
  })
})

describe('isSnapshotable', () => {
  it('accepts a verified handle', () => {
    expect(isSnapshotable({ ig_handle: 'technolight', ig_status: 'resolved' })).toBe(true)
  })

  it('accepts a handle a person set', () => {
    expect(isSnapshotable({ ig_handle: 'technolight', ig_status: 'human_set' })).toBe(true)
  })

  it('REFUSES a suggested handle that was never verified', () => {
    // The load-bearing one. The resolve step stores a weak candidate so a
    // human has something to accept — reading the handle without the status
    // is exactly how a guess reaches the numbers.
    expect(isSnapshotable({ ig_handle: 'ozee_app', ig_status: 'unresolved' })).toBe(false)
  })

  it('refuses an empty handle whatever the status says', () => {
    expect(isSnapshotable({ ig_handle: '', ig_status: 'resolved' })).toBe(false)
  })
})

describe('cleanHandle', () => {
  it('strips a leading @', () => {
    expect(cleanHandle('@lumina')).toBe('lumina')
  })

  it('takes the handle out of a pasted profile URL', () => {
    expect(cleanHandle('https://www.instagram.com/technolight/')).toBe('technolight')
  })

  it('drops query junk from a shared link', () => {
    expect(cleanHandle('instagram.com/technolight?igsh=abc123')).toBe('technolight')
  })

  it('leaves a bare handle alone', () => {
    expect(cleanHandle('technolight')).toBe('technolight')
  })
})

describe('summariseResolve', () => {
  it('says plainly when nothing could be verified, instead of reading like success', () => {
    const msg = summariseResolve({ ok: true, seeded: 5, resolved: 0, suggested: 2, notFound: 3 })
    expect(msg).toMatch(/no competitor has a verified handle yet/i)
  })

  it('does not add that warning once something is verified', () => {
    const msg = summariseResolve({ ok: true, seeded: 0, resolved: 2, suggested: 1, notFound: 0 })
    expect(msg).toMatch(/verified 2 handles/)
    expect(msg).not.toMatch(/stay empty/i)
  })

  it('passes a skip reason through unchanged', () => {
    expect(summariseResolve({ ok: true, skipped: true, reason: 'No competitors listed.' }))
      .toBe('No competitors listed.')
  })
})
