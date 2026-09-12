import {
  OBSERVANCES, FIXED_NATIONAL_DAYS, countryOf, fromAladhanDate, isoFor,
  inWindow, withLeadTime, rankEvents, hijriMonthsBetween, calendarNote,
} from '../../src/lib/agent/calendar.js'

// ─── Fetching the calendar ─────────────────────────────────────────────────
// Three sources, none of which needs an API key:
//
//   Aladhan      api.aladhan.com   Hijri <-> Gregorian conversion. Free, no
//                                  key, no advertised rate limit. This is the
//                                  authority for Ramadan, the two Eids and
//                                  Hajj, whose Gregorian dates move ~11 days
//                                  earlier every year.
//
//   Nager.Date   date.nager.at     Public holidays, free, no key, 204
//                                  countries — but NOT Saudi Arabia and NOT
//                                  any GCC state. Verified by asking it, not
//                                  assumed. For everywhere it does cover it is
//                                  the best free source there is.
//
//   Built-in     calendar.js       The fixed-date national days for the Gulf,
//                                  which is exactly the gap Nager leaves and
//                                  exactly the market this app serves.
//
// Every one of them is allowed to fail. A calendar that returns four events
// instead of six is still worth having; a calendar that throws takes the whole
// research run with it, and the entire point of the lens architecture is that
// no single source can do that.

const TIMEOUT_MS = 10_000

/** One request, with a timeout, that resolves to null rather than throwing. */
async function getJson(url) {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: abort.signal, headers: { accept: 'application/json' } })
    if (!res.ok) return null
    // Nager answers 200 with an empty body for a country it does not know,
    // which is not JSON and throws in res.json(). That is a real case — it is
    // how Saudi Arabia comes back — so it must not look like a crash.
    const text = await res.text()
    if (!text.trim()) return null
    return JSON.parse(text)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Gregorian ISO date -> { month, year } in the Hijri calendar. */
async function toHijri(iso) {
  const [y, m, d] = iso.split('-')
  const body = await getJson(`https://api.aladhan.com/v1/gToH?date=${d}-${m}-${y}`)
  const h = body?.data?.hijri
  const month = Number(h?.month?.number)
  const year = Number(h?.year)
  return Number.isFinite(month) && Number.isFinite(year) ? { month, year } : null
}

/**
 * The Gregorian dates of the Islamic observances that matter to this window.
 *
 * Only the Hijri months the window actually touches are fetched — typically
 * three or four, of which usually zero or one carry an observance. Asking for
 * all twelve would be twelve calls to answer a question about eight weeks.
 *
 * The window is widened by the longest lead time in the set before deciding
 * which months to look at. Hajj carries eight weeks of lead, so an event that
 * falls just past the window's end is still the most important thing in the
 * brief — dropping it because the event date is one day outside is exactly the
 * mistake this lens exists to prevent.
 */
export async function islamicDates({ from, to }) {
  const maxLeadDays = Math.max(...OBSERVANCES.map(o => o.leadWeeks)) * 7
  const extendedTo = new Date(new Date(`${to}T00:00:00Z`).getTime() + maxLeadDays * 86_400_000)
    .toISOString().slice(0, 10)

  const [start, end] = await Promise.all([toHijri(from), toHijri(extendedTo)])
  if (!start || !end) {
    return { events: [], error: 'The Hijri calendar service did not answer, so religious dates were skipped.' }
  }

  const months = hijriMonthsBetween(start, end)
  const wanted = OBSERVANCES
    .map(o => ({ o, slot: months.find(m => m.month === o.month) }))
    .filter(x => x.slot)

  const events = []
  await Promise.all(wanted.map(async ({ o, slot }) => {
    const body = await getJson(`https://api.aladhan.com/v1/hToGCalendar/${o.month}/${slot.year}`)
    const days = body?.data
    if (!Array.isArray(days) || !days.length) return

    // day: null means the month itself is the event, so the date that matters
    // is when it starts.
    const target = o.day === null ? days[0] : days.find(d => Number(d?.hijri?.day) === o.day)
    const date = fromAladhanDate(target?.gregorian?.date)
    if (!date) return

    const ends = o.day === null ? fromAladhanDate(days[days.length - 1]?.gregorian?.date) : null

    events.push({
      name: o.name,
      key: o.key,
      kind: 'religious',
      date,
      ends_on: ends,
      leadWeeks: o.leadWeeks,
      note: o.note,
      source: `https://api.aladhan.com/v1/hToGCalendar/${o.month}/${slot.year}`,
      hijri: `${o.day === null ? '' : `${o.day} `}${target?.hijri?.month?.en || ''} ${slot.year}`.trim(),
    })
  }))

  return { events, error: '' }
}

/**
 * Public holidays for a country, from whichever source knows it.
 *
 * Nager first because it is real data maintained by someone else; the built-in
 * table second because it covers the countries Nager does not. They are not
 * merged — a country is served by one or the other — because merging two
 * holiday lists produces duplicates under slightly different names, and a
 * brief that lists Saudi National Day twice reads as broken.
 */
export async function publicHolidays(country, years) {
  if (!country) return { events: [], error: '' }

  const fromNager = (await Promise.all(
    years.map(y => getJson(`https://date.nager.at/api/v3/PublicHolidays/${y}/${country}`)),
  )).flat().filter(Boolean)

  if (fromNager.length) {
    return {
      events: fromNager.map(h => ({
        name: h.localName && h.localName !== h.name ? `${h.name} (${h.localName})` : h.name,
        key: `nager_${h.date}`,
        kind: 'public_holiday',
        date: h.date,
        // Nager knows dates, not commercial lead times. Three weeks is the
        // honest default for a civic date and is labelled as a default rather
        // than presented as researched.
        leadWeeks: 3,
        note: h.global === false ? 'Regional rather than nationwide.' : '',
        source: `https://date.nager.at/api/v3/PublicHolidays/${years[0]}/${country}`,
      })),
      error: '',
    }
  }

  const fixed = FIXED_NATIONAL_DAYS[country]
  if (!fixed) {
    return {
      events: [],
      error: `No free holiday source covers ${country}, so only religious dates are in this calendar.`,
    }
  }

  const events = []
  for (const y of years) {
    for (const f of fixed) {
      events.push({
        name: f.name,
        key: `${f.name}_${y}`.replace(/\s+/g, '_').toLowerCase(),
        kind: 'national',
        date: isoFor(y, f.month, f.day),
        leadWeeks: f.leadWeeks,
        note: f.note,
        source: 'built-in',
      })
    }
  }
  return { events, error: '' }
}

/**
 * Everything dated that this brand should know about, computed rather than
 * researched.
 *
 * Never throws and never returns null: a failure here must degrade the brief,
 * not end the run.
 *
 * @returns {{events: Array, country: string|null, note: string, sources: string[]}}
 */
export async function gatherCalendar({ profile, ctx, window: win, now = new Date() }) {
  try {
    const { code: country, source: countrySource } = countryOf({ profile, ctx })

    // A window can straddle a new year, and a lead time can reach into the
    // next one. Both years get fetched or December is permanently invisible.
    const years = [...new Set([
      Number(win.from.slice(0, 4)),
      Number(win.to.slice(0, 4)),
      Number(win.to.slice(0, 4)) + 1,
    ])]

    const [islamic, holidays] = await Promise.all([
      islamicDates(win),
      publicHolidays(country, years),
    ])

    const failures = [islamic.error, holidays.error].filter(Boolean)
    const all = [...islamic.events, ...holidays.events].map(e => withLeadTime(e, now))

    // Keep an event when the EVENT is in the window, or when its preparation
    // window has already opened. The second clause is the one that earns its
    // keep: Ramadan six weeks out is not in an eight-week window of events
    // worth mentioning — it is the single most important thing in the brief,
    // because the work to be ready for it starts now.
    //
    // `passed` is filtered first and separately. Recurring dates are generated
    // for two or three years at a time, so roughly half of what arrives here is
    // already behind us, and a past event satisfies "in the window" whenever
    // the window itself has moved on.
    const relevant = all.filter(e => !e.passed && (inWindow(e.date, win.from, win.to) || e.window_open))

    return {
      events: rankEvents(relevant),
      country,
      country_source: countrySource,
      note: calendarNote({ country, countrySource, failures }),
      sources: [...new Set(relevant.map(e => e.source).filter(s => s && s !== 'built-in'))],
    }
  } catch (err) {
    return {
      events: [],
      country: null,
      country_source: '',
      note: `The calendar could not be computed: ${String(err?.message || err).slice(0, 200)}`,
      sources: [],
    }
  }
}
