import { describe, it, expect } from 'vitest'
import {
  OBSERVANCES, FIXED_NATIONAL_DAYS, COUNTRY_NAMES,
  countryOf, fromAladhanDate, isoFor, daysUntil, inWindow,
  withLeadTime, rankEvents, hijriMonthsBetween, calendarNote,
  findingsFromEvents, marketOf, COUNTRY_LABELS,
} from './calendar'
import { runCalendarLens } from '../../../api/agent/_lenses.js'

const NOW = new Date('2026-09-12T09:00:00Z')

// One fully-shaped event, as withLeadTime() emits them. Shared by the guarantee
// block below so those tests read as assertions about the lens rather than
// about fixture construction.
const EVENT = {
  name: 'Saudi National Day', kind: 'national', date: '2026-09-23',
  act_by: '2026-09-02', days_until: 11, days_until_act_by: -10,
  window_open: true, passed: false, source: 'built-in',
  note: 'The largest civic moment of the Saudi year.',
}

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

describe('THE GUARANTEE: the calendar cannot lose its dates', () => {
  // The property this rewrite exists to establish, and the way it is held has
  // changed. It used to be DEFENDED: the computed half ran first, and
  // mergeCalendarResult made sure a model failure could not take the dates
  // down with it. That defence was needed because the lens that came before
  // threw away a confirmed Saudi National Day when its seventh search failed,
  // and reported success.
  //
  // It is now STRUCTURAL. There is no model call in this lens at all, so there
  // is nothing left that can fail and take the dates with it. These tests
  // assert the structure rather than the defence, because a defence nobody can
  // breach is better expressed as an absence.

  it('produces its findings from arithmetic alone — no model, no network', () => {
    const out = runCalendarLens({ calendar: { events: [EVENT], sources: [], note: '' } })
    expect(out.ok).toBe(true)
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0].confidence).toBe(1)
    expect(out.cost).toBe(0)
  })

  it('is synchronous, which is the proof there is nothing to await', () => {
    // A Promise here would mean something asynchronous crept back in — a model
    // call, a fetch, a retry. The type is the guardrail.
    expect(runCalendarLens({ calendar: { events: [] } })).not.toBeInstanceOf(Promise)
  })

  it('reports a quiet window as checked-and-quiet, never as failed', () => {
    // A window with no dated moment in it is a real answer. If this came back
    // ok:false the brief would say "the Calendar lens failed" on every quiet
    // week, and a reader who sees that twice stops believing the other five.
    const out = runCalendarLens({ calendar: { events: [], sources: [], note: '' } })
    expect(out.ok).toBe(true)
    expect(out.findings).toEqual([])
    expect(out.error).toBe('')
  })

  it('carries the calendar note through so a guessed country is still said out loud', () => {
    const out = runCalendarLens({
      calendar: { events: [EVENT], sources: [], note: 'Assumed SA from the description.' },
    })
    expect(out.note).toMatch(/Assumed SA/)
  })

  it('de-duplicates its sources', () => {
    const out = runCalendarLens({
      calendar: { events: [EVENT], sources: ['https://a.com', 'https://a.com'], note: '' },
    })
    expect(out.sources).toEqual(['https://a.com'])
  })

  it('survives being handed nothing at all', () => {
    const out = runCalendarLens({})
    expect(out.ok).toBe(true)
    expect(out.findings).toEqual([])
  })
})

describe('naming the market every lens researches', () => {
  // Before this existed, only the calendar knew where a brand sold. Every
  // other lens was handed `customFields.geography`, which is empty on all
  // three live workspaces, so they researched an unnamed market — and it
  // showed: 99 pages came back about the category in general rather than
  // about the country the brand actually operates in.

  it('prefers what a person actually wrote, verbatim', () => {
    // "Riyadh and the Eastern Province" says more than "SA" ever will, so a
    // written geography is never flattened to a country code.
    const out = marketOf({ profile: { customFields: { geography: 'Riyadh and the Eastern Province' } } })
    expect(out.label).toBe('Riyadh and the Eastern Province')
    expect(out.source).toMatch(/custom field/)
  })

  it('falls back to the brand\'s own prose, and says that is what it did', () => {
    const out = marketOf({ ctx: { brandDescriptor: "Saudi Arabia's leading lighting company" } })
    expect(out.label).toBe('Saudi Arabia')
    expect(out.source).toBe('brand description')
  })

  it('answers with a readable name, not an ISO code', () => {
    // A prompt is read by a model, not by a holiday API. "Market: SA" is
    // terse enough to be mistaken for something else entirely.
    expect(marketOf({ ctx: { brandDescriptor: 'a spa in Dubai' } }).label)
      .toBe('United Arab Emirates')
  })

  it('returns nothing rather than defaulting to anywhere', () => {
    // Defaulting to Saudi Arabia here would be the exact domain-lock this
    // whole system is built to avoid. An unknown market must be reported.
    const out = marketOf({ profile: { customFields: {} }, ctx: {} })
    expect(out.label).toBe('')
    expect(out.code).toBeNull()
  })

  it('survives being handed nothing at all', () => {
    expect(marketOf().label).toBe('')
  })

  it('has a label for every country it can possibly resolve', () => {
    // Adding a country to one table and not the other would silently degrade
    // to an ISO code in a prompt, which is the kind of thing nobody notices.
    const codes = [...new Set(Object.values(COUNTRY_NAMES))]
    expect(codes.filter(c => !COUNTRY_LABELS[c])).toEqual([])
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
