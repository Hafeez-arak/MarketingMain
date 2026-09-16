import { describe, it, expect } from 'vitest'
import { runHealth, scheduleNeverRan, silentLensNote, STALE_DAYS, STUCK_MINUTES, SILENT_SOURCE_FLOOR } from './runHealth.js'

const NOW = new Date('2026-09-13T12:00:00Z')
const run = (extra = {}) => ({
  status: 'complete', trigger: 'manual',
  started_at: '2026-09-12T14:54:00Z', finished_at: '2026-09-12T14:58:00Z',
  ...extra,
})

describe('runHealth', () => {
  it('says nothing when the last run completed recently', () => {
    // Returning null rather than an "all good" object, so a caller renders
    // nothing without having to decide what fine means.
    expect(runHealth([run()], NOW)).toBeNull()
  })

  it('does not cry wolf at a workspace that has never run', () => {
    // New is not broken. A staleness warning on day one is the false alarm
    // that teaches people to ignore the banner.
    expect(runHealth([], NOW)).toBeNull()
    expect(runHealth(null, NOW)).toBeNull()
  })

  it('reports a failed last run, with its error', () => {
    const h = runHealth([run({ status: 'failed', error: 'Instagram refused' })], NOW)
    expect(h.level).toBe('failed')
    expect(h.detail).toContain('Instagram refused')
  })

  it('points a failed run at what it did manage', () => {
    // Stage 0 commits before any model spend, so a failed investigation still
    // leaves a complete board. "Run it again" alone would walk someone past it.
    expect(runHealth([run({ status: 'failed' })], NOW).action).toContain('did manage')
  })

  it('leaves a genuinely in-progress run alone', () => {
    const h = runHealth([run({ status: 'running', started_at: '2026-09-13T11:55:00Z', finished_at: null })], NOW)
    expect(h).toBeNull()
  })

  it('calls out a run that has been going too long', () => {
    const h = runHealth([run({ status: 'running', started_at: '2026-09-13T11:00:00Z', finished_at: null })], NOW)
    expect(h.level).toBe('stuck')
    expect(h.headline).toContain('60 minutes')
    expect(STUCK_MINUTES).toBe(20)
  })

  it('reassures that a stuck run is not still spending', () => {
    const h = runHealth([run({ status: 'running', started_at: '2026-09-13T10:00:00Z', finished_at: null })], NOW)
    expect(h.detail).toContain('Nothing is being spent')
  })

  it('warns when nothing has completed for a long time', () => {
    const h = runHealth([run({ finished_at: '2026-08-20T09:36:00Z' })], NOW)
    expect(h.level).toBe('stale')
    expect(h.headline).toContain('24 days')
  })

  it('tolerates a week plus slack before calling it stale', () => {
    // Weekly cadence plus a holiday plus a Monday deploy must not trip this.
    const h = runHealth([run({ finished_at: '2026-09-05T09:00:00Z' })], NOW)
    expect(h).toBeNull()
    expect(STALE_DAYS).toBe(10)
  })

  it('judges by the newest run, whatever order it arrives in', () => {
    const h = runHealth([
      run({ finished_at: '2026-08-01T09:00:00Z' }),
      run({ status: 'failed', finished_at: '2026-09-13T09:00:00Z', error: 'boom' }),
    ], NOW)
    expect(h.level).toBe('failed')
  })

  it('looks past a failed run for the last COMPLETE one when judging staleness', () => {
    // A run that failed this morning is a failure, not staleness — those are
    // different diagnoses and the failure is the one to show.
    const h = runHealth([
      run({ status: 'failed', finished_at: '2026-09-13T09:00:00Z' }),
      run({ finished_at: '2026-09-12T09:00:00Z' }),
    ], NOW)
    expect(h.level).toBe('failed')
  })
})

describe('scheduleNeverRan', () => {
  it('is true when every run was started by hand', () => {
    // The live case: a schedule written, committed, and never imported looks
    // from inside the app exactly like a schedule that works.
    expect(scheduleNeverRan([run(), run(), run()])).toBe(true)
  })

  it('is false once anything ran on a schedule', () => {
    expect(scheduleNeverRan([run(), run({ trigger: 'scheduled' })])).toBe(false)
  })

  it('stays quiet on a workspace with barely any history', () => {
    // One manual run proves nothing about the schedule.
    expect(scheduleNeverRan([run()])).toBe(false)
    expect(scheduleNeverRan([])).toBe(false)
  })
})

describe('silentLensNote', () => {
  const res = (findings, sources, extra = {}) => ({
    ok: true,
    findings: Array.from({ length: findings }, (_, i) => ({ headline: `f${i}` })),
    sources: Array.from({ length: sources }, (_, i) => `https://x/${i}`),
    ...extra,
  })

  it('flags the 2026-09-15 failure: many sources read, nothing reported', () => {
    // events (54), demand (31) and category (45) all recorded status ok.
    for (const n of [54, 31, 45]) {
      expect(silentLensNote(res(0, n))).toMatch(/^Suspect: read \d+ sources and returned no findings\./)
    }
  })

  it('says nothing when the lens reported findings', () => {
    expect(silentLensNote(res(5, 66))).toBe('')
  })

  it('does not cry wolf over a lens that barely searched', () => {
    expect(silentLensNote(res(0, SILENT_SOURCE_FLOOR - 1))).toBe('')
    expect(silentLensNote(res(0, 0))).toBe('')
  })

  it('flags exactly at the floor', () => {
    expect(silentLensNote(res(0, SILENT_SOURCE_FLOOR))).not.toBe('')
  })

  it('leaves a failed lens alone — it already carries an error', () => {
    expect(silentLensNote({ ...res(0, 40), ok: false })).toBe('')
  })

  it('survives a malformed or missing result', () => {
    expect(silentLensNote(null)).toBe('')
    expect(silentLensNote({ ok: true })).toBe('')
  })

  it('never flags the free lenses, which read no sources by design', () => {
    // calendar and ourselves compute rather than search.
    expect(silentLensNote(res(1, 0))).toBe('')
    expect(silentLensNote(res(0, 0))).toBe('')
  })
})
