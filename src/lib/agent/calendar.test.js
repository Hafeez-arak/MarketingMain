import { describe, it, expect } from 'vitest'
import {
  OBSERVANCES, FIXED_NATIONAL_DAYS, COUNTRY_NAMES,
  countryOf, fromAladhanDate, isoFor, daysUntil, inWindow,
  withLeadTime, rankEvents, hijriMonthsBetween, calendarNote,
  findingsFromEvents, mergeCalendarResult,
} from './calendar'

const NOW = new Date('2026-09-12T09:00:00Z')

describe('reading the country out of a brand', () => {
  // This matters more than it looks. Every live workspace has
  // customFields.geography === undefined, so the fallback chain is not a
  // safety net here — it is the only path that ever runs.

  it('believes an explicit ISO code', () => {
    expect(countryOf({ profile: { customFields: { country_code: 'ae' } } }))
      .toEqual({ code: 'AE', source: 'custom field country_code' })
  })

  it('reads a named country from the geography field', () => {
    expect(countryOf({ profile: { customFields: { geography: 'Saudi Arabia' } } }).code).toBe('SA')
  })

  it('falls back to the brand description, and says that is what it did', () => {
    // The real Arak case: no geography anywhere, descriptor opens with the
    // country. It worked by luck for months and nobody knew it was luck.
    const out = countryOf({
      profile: { customFields: {} },
      ctx: { brandDescriptor: "Saudi Arabia's leading architectural lighting company" },
    })
    expect(out.code).toBe('SA')
    expect(out.source).toBe('brand description')
  })

  it('prefers the longer country name over a prefix of it', () => {
    // "Saudi" is a substring of "Saudi Arabia" and both are in the table. A
    // naive first-match loop can resolve the wrong entry.
    expect(countryOf({ ctx: { brandDescriptor: 'based in Saudi Arabia' } }).code).toBe('SA')
    expect(countryOf({ ctx: { brandDescriptor: 'the United Arab Emirates market' } }).code).toBe('AE')
  })

  it('pins a country from a city when the country is never named', () => {
    expect(countryOf({ ctx: { brandDescriptor: 'an at-home spa service in Riyadh' } }).code).toBe('SA')
  })

  it('returns null rather than defaulting when there is nothing to go on', () => {
    // Defaulting to Saudi Arabia here would be exactly the domain-lock this
    // system exists to avoid — a German brand would get a Gulf calendar and
    // the brief would look confident about it.
    expect(countryOf({ profile: {}, ctx: { brandDescriptor: 'a widget company' } }).code).toBeNull()
  })

  it('does not match a country name inside a longer word', () => {
    expect(countryOf({ ctx: { brandDescriptor: 'we make omani-style ukulele straps' } }).code).not.toBe('OM')
  })
})

describe('the date conversion that is wrong for eleven days a month', () => {
  it('reads Aladhan DD-MM-YYYY as ISO', () => {
    expect(fromAladhanDate('16-05-2027')).toBe('2027-05-16')
    // The one that catches a DD/MM vs MM/DD mix-up: day > 12.
    expect(fromAladhanDate('23-09-2026')).toBe('2026-09-23')
  })

  it('refuses anything that is not that shape', () => {
    expect(fromAladhanDate('2027-05-16')).toBeNull()
    expect(fromAladhanDate('')).toBeNull()
    expect(fromAladhanDate(null)).toBeNull()
  })

  it('pads a fixed month and day', () => {
    expect(isoFor(2026, 9, 23)).toBe('2026-09-23')
    expect(isoFor(2026, 12, 2)).toBe('2026-12-02')
  })
})

describe('counting days without an off-by-one', () => {
  it('floors both sides to midnight', () => {
    // A run at 09:00 comparing against a date must not report today as -1.
    expect(daysUntil('2026-09-12', NOW)).toBe(0)
    expect(daysUntil('2026-09-23', NOW)).toBe(11)
    expect(daysUntil('2026-09-11', NOW)).toBe(-1)
  })

  it('gives the same answer late in the day', () => {
    expect(daysUntil('2026-09-23', new Date('2026-09-12T23:45:00Z'))).toBe(11)
  })

  it('is inclusive at both window edges', () => {
    expect(inWindow('2026-09-12', '2026-09-12', '2026-11-07')).toBe(true)
    expect(inWindow('2026-11-07', '2026-09-12', '2026-11-07')).toBe(true)
    expect(inWindow('2026-11-08', '2026-09-12', '2026-11-07')).toBe(false)
  })
})

describe('lead time is the finding, not the date', () => {
  it('opens the window leadWeeks before the event', () => {
    const e = withLeadTime({ name: 'Saudi National Day', date: '2026-09-23', leadWeeks: 3 }, NOW)
    expect(e.act_by).toBe('2026-09-02')
    expect(e.days_until).toBe(11)
    expect(e.window_open).toBe(true)
  })

  it('keeps the window shut while preparation has not started', () => {
    const e = withLeadTime({ name: 'Founding Day', date: '2027-02-22', leadWeeks: 3 }, NOW)
    expect(e.window_open).toBe(false)
    expect(e.days_until_act_by).toBeGreaterThan(0)
  })

  it('does NOT call a past event urgent', () => {
    // The bug this assertion exists for. window_open was once just
    // "preparation has begun", which every past date satisfies — so Saudi
    // Founding Day, 202 days behind us, sorted to the top of the brief as
    // ACT NOW.
    const e = withLeadTime({ name: 'Founding Day', date: '2026-02-22', leadWeeks: 3 }, NOW)
    expect(e.passed).toBe(true)
    expect(e.window_open).toBe(false)
  })

  it('marks the event on the day itself as still open, not passed', () => {
    const e = withLeadTime({ name: 'Today', date: '2026-09-12', leadWeeks: 1 }, NOW)
    expect(e.passed).toBe(false)
    expect(e.window_open).toBe(true)
  })

  it('survives an event with no lead time set', () => {
    const e = withLeadTime({ name: 'X', date: '2026-09-23' }, NOW)
    expect(e.act_by).toBe('2026-09-23')
  })
})

describe('ordering a brief', () => {
  it('puts an open preparation window above a nearer date that is not open yet', () => {
    const events = [
      withLeadTime({ name: 'Soon but not yet actionable', date: '2026-09-20', leadWeeks: 0 }, NOW),
      withLeadTime({ name: 'Further off but act now', date: '2026-10-30', leadWeeks: 8 }, NOW),
    ].map(e => e)
    const [first] = rankEvents(events)
    expect(first.name).toBe('Further off but act now')
  })

  it('sorts by date within the same urgency', () => {
    const a = withLeadTime({ name: 'A', date: '2026-10-01', leadWeeks: 0 }, NOW)
    const b = withLeadTime({ name: 'B', date: '2026-09-20', leadWeeks: 0 }, NOW)
    expect(rankEvents([a, b]).map(e => e.name)).toEqual(['B', 'A'])
  })
})

describe('walking the Hijri calendar', () => {
  it('rolls the year over at month 12 instead of inventing month 13', () => {
    // Arithmetic that ignores the rollover asks the API for month 13, which
    // answers — with the wrong dates.
    const months = hijriMonthsBetween({ month: 11, year: 1447 }, { month: 2, year: 1448 })
    expect(months).toEqual([
      { month: 11, year: 1447 }, { month: 12, year: 1447 },
      { month: 1, year: 1448 }, { month: 2, year: 1448 },
    ])
    expect(months.every(m => m.month >= 1 && m.month <= 12)).toBe(true)
  })

  it('handles a window inside one month', () => {
    expect(hijriMonthsBetween({ month: 4, year: 1448 }, { month: 4, year: 1448 }))
      .toEqual([{ month: 4, year: 1448 }])
  })

  it('terminates rather than looping forever on a backwards range', () => {
    expect(hijriMonthsBetween({ month: 5, year: 1448 }, { month: 1, year: 1400 }).length).toBe(24)
  })
})

describe('the note only speaks when something is wrong', () => {
  it('is silent when the country was configured', () => {
    expect(calendarNote({ country: 'SA', countrySource: 'custom field geography' })).toBe('')
  })

  it('says so when the country was inferred from prose', () => {
    const note = calendarNote({ country: 'SA', countrySource: 'brand description' })
    expect(note).toMatch(/assumed SA/)
    expect(note).toMatch(/geography/)
  })

  it('says so when no country could be found at all', () => {
    expect(calendarNote({ country: null })).toMatch(/No country could be determined/)
  })

  it('passes source failures through', () => {
    expect(calendarNote({ country: 'SA', countrySource: 'custom field geography', failures: ['Hijri service down.'] }))
      .toMatch(/Hijri service down/)
  })
})

describe('a computed date is a finding in its own right', () => {
  const open = withLeadTime({
    name: 'Saudi National Day', date: '2026-09-23', leadWeeks: 3,
    kind: 'national', note: 'Civic moment.', source: 'built-in',
  }, NOW)

  it('says the window is open rather than just giving a date', () => {
    const [f] = findingsFromEvents([open])
    expect(f.headline).toMatch(/preparation window is already open/)
    expect(f.confidence).toBe(1)
  })

  it('carries an action even with no model involved', () => {
    // The lens's own standard: a finding with no action is trivia however true
    // it is. A computed date that survives a model failure still has to say
    // what to do about it.
    const [f] = findingsFromEvents([open])
    expect(f.suggested_action).toBeTruthy()
  })

  it('expires when the event arrives, not after it', () => {
    expect(findingsFromEvents([open])[0].perishable_until).toBe('2026-09-23')
  })

  it('claims no source for a built-in date instead of inventing one', () => {
    // Its provenance is arithmetic, not a page someone read. Fabricating a URL
    // here would launder a computed value into a cited one.
    expect(findingsFromEvents([open])[0].sources).toEqual([])
  })

  it('cites the API when the date came from one', () => {
    const e = withLeadTime({
      name: 'Ramadan', date: '2027-02-08', leadWeeks: 6,
      source: 'https://api.aladhan.com/v1/hToGCalendar/9/1448', hijri: 'Ramaḍān 1448',
    }, NOW)
    expect(findingsFromEvents([e])[0].sources[0].url).toMatch(/aladhan/)
  })

  it('says the date was computed, so a reader knows not to re-check it', () => {
    expect(findingsFromEvents([open])[0].detail).toMatch(/not researched/)
  })
})

describe('THE GUARANTEE: computed dates survive a model failure', () => {
  // The property this whole rewrite exists to establish. The lens that came
  // before threw away a confirmed Saudi National Day because its seventh
  // search failed, and the run reported success.

  const computed = [{ headline: 'Saudi National Day is 11 days away.', confidence: 1 }]

  it('keeps the dates when the model refuses', () => {
    const out = mergeCalendarResult({
      computed, modelOut: { ok: false, error: 'The model declined (refusal).', cost: 0.01 },
    })
    expect(out.findings).toEqual(computed)
  })

  it('keeps the dates when the model returns unparseable JSON', () => {
    const out = mergeCalendarResult({
      computed, modelOut: { ok: false, error: 'Findings did not parse: Unexpected token' },
    })
    expect(out.findings).toHaveLength(1)
  })

  it('keeps the dates when the model returns nothing at all', () => {
    // The exact 2026-09-12 failure: ok, but an empty findings array.
    const out = mergeCalendarResult({ computed, modelOut: { ok: true, findings: [] } })
    expect(out.findings).toEqual(computed)
    expect(out.ok).toBe(true)
  })

  it('does NOT report the lens as failed when it returned real dates', () => {
    // Otherwise the brief says "the Calendar lens failed" directly above a
    // list of calendar findings.
    const out = mergeCalendarResult({ computed, modelOut: { ok: false, error: 'boom' } })
    expect(out.ok).toBe(true)
    expect(out.error).toBe('')
  })

  it('DOES report a failure when there is genuinely nothing to show', () => {
    const out = mergeCalendarResult({ computed: [], modelOut: { ok: false, error: 'boom' } })
    expect(out.ok).toBe(false)
    expect(out.error).toBe('boom')
  })

  it('explains in the note that only the reasoning half was lost', () => {
    const out = mergeCalendarResult({ computed, modelOut: { ok: false, error: 'timeout' } })
    expect(out.note).toMatch(/reasoning step failed/)
    expect(out.note).toMatch(/timeout/)
  })

  it('keeps an existing note alongside the failure note', () => {
    const out = mergeCalendarResult({
      computed, modelOut: { ok: false, error: 'timeout' }, note: 'Assumed SA from the description.',
    })
    expect(out.note).toMatch(/Assumed SA/)
    expect(out.note).toMatch(/reasoning step failed/)
  })

  it('puts computed dates before model findings when both worked', () => {
    // Certain things first; the model's additions are not certain.
    const out = mergeCalendarResult({
      computed, modelOut: { ok: true, findings: [{ headline: 'A trade show.' }], sources: ['https://x.com'] },
    })
    expect(out.findings[0].confidence).toBe(1)
    expect(out.findings).toHaveLength(2)
  })

  it('merges sources from both halves without duplicating', () => {
    const out = mergeCalendarResult({
      computed,
      modelOut: { ok: true, findings: [], sources: ['https://a.com', 'https://b.com'] },
      calendarSources: ['https://a.com'],
    })
    expect(out.sources.sort()).toEqual(['https://a.com', 'https://b.com'])
  })

  it('still charges for a failed model call', () => {
    // The ledger must record spend that happened, whatever the outcome.
    expect(mergeCalendarResult({ computed, modelOut: { ok: false, error: 'x', cost: 0.04 } }).cost).toBe(0.04)
  })

  it('survives being handed nothing at all', () => {
    const out = mergeCalendarResult()
    expect(out.ok).toBe(false)
    expect(out.findings).toEqual([])
  })
})

describe('the tables themselves', () => {
  it('covers the Gulf states Nager.Date does not', () => {
    // Verified by asking date.nager.at, not assumed: it lists 204 countries
    // and none of the GCC is among them.
    for (const code of ['SA', 'AE', 'QA', 'KW', 'BH', 'OM']) {
      expect(FIXED_NATIONAL_DAYS[code], code).toBeTruthy()
    }
  })

  it('lists only fixed Gregorian dates, never a moving religious one', () => {
    // A hardcoded Gregorian date for Ramadan is wrong within a year, silently.
    const names = Object.values(FIXED_NATIONAL_DAYS).flat().map(d => d.name.toLowerCase())
    expect(names.some(n => /ramadan|eid|hajj|ashura|mawlid/.test(n))).toBe(false)
  })

  it('gives every observance a lead time', () => {
    for (const o of OBSERVANCES) {
      expect(o.leadWeeks, o.key).toBeGreaterThan(0)
      expect(o.month, o.key).toBeGreaterThanOrEqual(1)
      expect(o.month, o.key).toBeLessThanOrEqual(12)
    }
  })

  it('treats Ramadan as a month rather than a day', () => {
    expect(OBSERVANCES.find(o => o.key === 'ramadan').day).toBeNull()
  })

  it('maps every country name to a two-letter code', () => {
    for (const [name, code] of Object.entries(COUNTRY_NAMES)) {
      expect(code, name).toMatch(/^[A-Z]{2}$/)
    }
  })
})
