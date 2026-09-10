import { describe, it, expect } from 'vitest'
import {
  parseYMD, startOfWeek, formatTime, groupByWeek, monthOptions,
  buildCalendarCells, normalizeAiIdea,
} from './planModel'

// None of this was reachable from a test while it lived inside a 1,490-line
// component. Every case below is one where being wrong produces something
// plausible-looking rather than an error — a week label off by one, a post
// stored at an aspect ratio the platform rejects at publish time.

describe('parseYMD', () => {
  // `new Date('2026-03-01')` parses as UTC midnight, which is Feb 28 for
  // anyone west of Greenwich — so a plan starting on the 1st would render a
  // calendar beginning the day before it does.
  it('parses as a local date, not UTC', () => {
    const d = parseYMD('2026-03-01')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(1)
  })

  it('returns null for anything unparseable rather than an Invalid Date', () => {
    expect(parseYMD('')).toBeNull()
    expect(parseYMD(null)).toBeNull()
    expect(parseYMD('not-a-date')).toBeNull()
  })
})

describe('startOfWeek', () => {
  // Monday-based: a content week reads Monday-to-Sunday to the people planning
  // it. The month GRID is Sunday-based instead — different question, not a
  // disagreement.
  it('snaps back to Monday', () => {
    // 2026-03-04 is a Wednesday.
    expect(startOfWeek(parseYMD('2026-03-04')).getDate()).toBe(2)
  })

  it('leaves a Monday alone', () => {
    expect(startOfWeek(parseYMD('2026-03-02')).getDate()).toBe(2)
  })

  // The off-by-one that a naive `getDay()` produces: Sunday is day 0, so
  // subtracting it leaves Sunday as its own week start and splits the weekend
  // across two groups.
  it('puts Sunday at the END of its week, not the start', () => {
    // 2026-03-08 is a Sunday; its Monday is the 2nd.
    expect(startOfWeek(parseYMD('2026-03-08')).getDate()).toBe(2)
  })
})

describe('formatTime', () => {
  it('renders 24-hour input as 12-hour with a period', () => {
    expect(formatTime('19:30')).toBe('7:30 PM')
    expect(formatTime('09:05')).toBe('9:05 AM')
  })

  // Both boundaries, because 0 and 12 are where the modulo goes wrong.
  it('handles midnight and noon', () => {
    expect(formatTime('00:00')).toBe('12:00 AM')
    expect(formatTime('12:00')).toBe('12:00 PM')
  })

  // This renders straight onto an idea card. A half-typed time should read as
  // blank, not as 'NaN:NaN PM'.
  it('returns empty for anything unparseable', () => {
    expect(formatTime('')).toBe('')
    expect(formatTime('nonsense')).toBe('')
    expect(formatTime(null)).toBe('')
  })
})

describe('groupByWeek', () => {
  const idea = (id, date) => ({ id, date })

  it('groups ideas into Monday-based weeks, oldest first', () => {
    const groups = groupByWeek([
      idea('c', '2026-03-10'), idea('a', '2026-03-02'), idea('b', '2026-03-08'),
    ])
    expect(groups.map(g => g.label)).toEqual(['Mar 2 – 8', 'Mar 9 – 15'])
    // The 8th is a Sunday, so it belongs to the week that starts on the 2nd.
    expect(groups[0].ideas.map(i => i.id)).toEqual(['a', 'b'])
    expect(groups[1].ideas.map(i => i.id)).toEqual(['c'])
  })

  // Repeating the month when it has not changed is noise on every row.
  it('repeats the month in the label only when the week spans two', () => {
    expect(groupByWeek([idea('a', '2026-03-31')])[0].label).toBe('Mar 30 – Apr 5')
  })

  // Undated goes last: the plan reads as a sequence of weeks, and a pile of
  // unplaced ideas at the top would push the actual month below the fold.
  it('collects undated ideas at the end under Unscheduled', () => {
    const groups = groupByWeek([idea('u', ''), idea('a', '2026-03-02')])
    expect(groups.map(g => g.key)).toEqual([String(startOfWeek(parseYMD('2026-03-02')).getTime()), 'undated'])
    expect(groups[1].ideas.map(i => i.id)).toEqual(['u'])
  })

  // An unparseable date would otherwise become an Invalid Date whose
  // getTime() is NaN — it sorts unpredictably and renders a week labelled
  // "NaN NaN".
  it('treats an unparseable date as undated rather than making a NaN week', () => {
    const groups = groupByWeek([idea('bad', 'garbage')])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('undated')
  })

  it('returns nothing for no ideas', () => {
    expect(groupByWeek([])).toEqual([])
    expect(groupByWeek(null)).toEqual([])
  })
})

describe('monthOptions', () => {
  it('offers six months starting from the given one', () => {
    const opts = monthOptions(new Date(2026, 10, 15))   // Nov 2026
    expect(opts).toHaveLength(6)
    expect(opts[0]).toMatchObject({ value: '2026-11', label: 'November 2026', start: '2026-11-01', end: '2026-11-30' })
  })

  // The year rollover, which an approach based on incrementing the month
  // number gets wrong.
  it('rolls into the next year', () => {
    const opts = monthOptions(new Date(2026, 10, 15))
    expect(opts[2]).toMatchObject({ value: '2027-01', label: 'January 2027', end: '2027-01-31' })
  })

  // Day 0 of the next month is the last day of this one — no month-length
  // table, and February is right in leap years.
  it('gets February right in a leap year', () => {
    expect(monthOptions(new Date(2028, 1, 1))[0].end).toBe('2028-02-29')
  })

  it('gets February right in a common year', () => {
    expect(monthOptions(new Date(2026, 1, 1))[0].end).toBe('2026-02-28')
  })
})

describe('buildCalendarCells', () => {
  it('pads the range out to whole Sunday-based weeks', () => {
    const cells = buildCalendarCells('2026-03-01', '2026-03-31')
    // March 2026 starts on a Sunday and ends on a Tuesday, so the grid runs
    // Mar 1 to Apr 4 — five whole weeks.
    expect(cells).toHaveLength(35)
    expect(cells[0].key).toBe('2026-03-01')
    expect(cells[cells.length - 1].key).toBe('2026-04-04')
    expect(cells.length % 7).toBe(0)
  })

  // The padding days are returned so the caller can grey them, rather than
  // having to compute the offsets itself.
  it('marks which cells are actually inside the plan', () => {
    const cells = buildCalendarCells('2026-03-01', '2026-03-31')
    expect(cells.filter(c => c.inRange)).toHaveLength(31)
    expect(cells.find(c => c.key === '2026-04-01').inRange).toBe(false)
  })

  it('returns nothing when the range is missing or inverted', () => {
    expect(buildCalendarCells('', '2026-03-31')).toEqual([])
    expect(buildCalendarCells('2026-03-01', '')).toEqual([])
    expect(buildCalendarCells('2026-03-31', '2026-03-01')).toEqual([])
  })
})

describe('normalizeAiIdea', () => {
  it('keeps a reel on Instagram, where it means something', () => {
    const out = normalizeAiIdea({ platform: 'instagram', format: 'reel' })
    expect(out.postFormat).toBe('reel')
    expect(out.mediaType).toBe('video')
  })

  // The guard that matters. 'reel' is meaningful on Instagram and meaningless
  // on LinkedIn — and a post row claiming to be a LinkedIn reel fails at
  // publish, long after anyone remembers approving it.
  it('falls back to the platform default for a format that platform has no idea about', () => {
    const out = normalizeAiIdea({ platform: 'linkedin', format: 'reel' })
    expect(out.postFormat).not.toBe('reel')
  })

  it('carries a carousel through and gives it a slide count', () => {
    const out = normalizeAiIdea({ platform: 'instagram', format: 'carousel' })
    expect(out.postFormat).toBe('carousel')
    expect(out.slideCount).toBeGreaterThan(1)
  })

  it('gives a non-carousel exactly one slide', () => {
    expect(normalizeAiIdea({ platform: 'instagram', format: 'post' }).slideCount).toBe(1)
  })

  // Same shape of guard as the format one: an aspect ratio outside the valid
  // set is silently accepted by us and rejected by the platform.
  it('refuses an aspect ratio the platform does not offer', () => {
    const out = normalizeAiIdea({ platform: 'instagram', format: 'post', suggestedAspectRatio: '21:9' })
    expect(out.aspectRatio).not.toBe('21:9')
    expect(out.aspectRatio).toBeTruthy()
  })

  it('keeps a valid suggested aspect ratio', () => {
    const valid = normalizeAiIdea({ platform: 'instagram', format: 'post' }).aspectRatio
    expect(normalizeAiIdea({ platform: 'instagram', format: 'post', suggestedAspectRatio: valid }).aspectRatio)
      .toBe(valid)
  })

  // The AI planner's own fields have to survive the translation — this runs
  // before anything is saved, so anything dropped here is gone.
  it('preserves the idea it was given', () => {
    const out = normalizeAiIdea({ platform: 'instagram', format: 'post', title: 'Warm light', date: '2026-03-02' })
    expect(out.title).toBe('Warm light')
    expect(out.date).toBe('2026-03-02')
    expect(out.wantsCaption).toBe(true)
    expect(out.postKind).toBeTruthy()
  })
})
