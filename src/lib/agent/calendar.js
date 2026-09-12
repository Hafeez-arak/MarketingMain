// ─── The calendar, as data rather than as research ─────────────────────────
// This module exists because of a specific, expensive failure.
//
// The calendar lens used to ask a model "what is coming in the next 8 weeks?"
// and required it to verify every date with a web search. On 2026-09-12 that
// run cost $0.28, took 49 seconds, issued four searches — two of them the SAME
// query — then hit max_uses_exceeded seven times in a row and returned an
// EMPTY findings array. It had already confirmed Saudi National Day and the
// Big 5 Saudi dates in its first three searches. It threw them away, because
// the prompt told it "if you cannot confirm a date, leave it out" and it had
// run out of budget mid-verification.
//
// The lesson is not "raise the budget". It is that a date lookup is not
// research. Stage 0 already commits measured Instagram numbers before a single
// model token is spent, precisely so a failed investigation cannot cost the
// user their numbers. Dates deserve the same treatment: they are facts with
// canonical sources, they do not require judgement, and a model asked to
// recall them will sometimes be wrong in a way nobody catches until a month of
// content has gone out on the wrong week.
//
// So: this module computes what is coming. The model is then asked the only
// question that actually needs a model — what should THIS brand do about it.
//
// ── WHAT IS DELIBERATELY NOT HERE ──
//
// Trade shows and industry exhibitions. There is no API for "when is Big 5
// Saudi 2026", the answer changes yearly, and it is genuinely a search
// problem. Those stay with the model — but now as its ONLY search job, with
// the whole budget, instead of competing with date lookups it should never
// have been doing.

/**
 * Islamic observances, by Hijri month and day.
 *
 * `leadWeeks` is the part that matters and the part a calendar app will not
 * tell you: the window BEFORE the date when the buying, booking and planning
 * actually happen. Publishing on the day itself is almost always too late —
 * for Ramadan the category decisions are made weeks ahead, and a brand that
 * starts posting on day one has missed the season it was preparing for.
 *
 * `day: null` means the whole month is the event (Ramadan), so the useful date
 * is when it STARTS.
 */
export const OBSERVANCES = [
  {
    key: 'ramadan',
    name: 'Ramadan',
    month: 9,
    day: null,
    leadWeeks: 6,
    note: 'The single largest shift in daily rhythm, spending and media consumption in Muslim-majority markets. Working hours shorten, evenings become primetime, and category buying is decided well before it begins.',
  },
  {
    key: 'eid_al_fitr',
    name: 'Eid al-Fitr',
    month: 10,
    day: 1,
    leadWeeks: 4,
    note: 'Gifting, travel, new clothes, family gatherings. Demand builds through the last third of Ramadan.',
  },
  {
    key: 'hajj',
    name: 'Hajj',
    month: 12,
    day: 8,
    leadWeeks: 8,
    note: 'Mass travel and a national logistics event in Saudi Arabia. Hospitality, transport and retail plan around it months out.',
  },
  {
    key: 'eid_al_adha',
    name: 'Eid al-Adha',
    month: 12,
    day: 10,
    leadWeeks: 4,
    note: 'The second Eid. Extended public holiday across the Gulf; most B2B decision-making stops.',
  },
  {
    key: 'islamic_new_year',
    name: 'Islamic New Year',
    month: 1,
    day: 1,
    leadWeeks: 2,
    note: 'A public holiday across the Gulf. Modest commercial significance, real scheduling significance.',
  },
  {
    key: 'ashura',
    name: 'Ashura',
    month: 1,
    day: 10,
    leadWeeks: 2,
    note: 'Observed differently across communities. Tone matters more than opportunity here.',
  },
  {
    key: 'mawlid',
    name: 'Mawlid al-Nabi',
    month: 3,
    day: 12,
    leadWeeks: 2,
    note: 'Observed in some markets and not others, including not officially in Saudi Arabia.',
  },
]

/**
 * Fixed-date national days for the countries the free holiday APIs do not
 * cover.
 *
 * This table is small and deliberately so. Nager.Date is free, needs no key
 * and covers 204 countries — but it does NOT include Saudi Arabia, the UAE, or
 * any GCC state, which was discovered by asking it rather than by assuming.
 * For the markets this app actually serves, that gap is the whole calendar.
 *
 * Everything here is a FIXED Gregorian date. Moving religious holidays are
 * computed from the Hijri calendar above, not listed here, because a hardcoded
 * Gregorian date for Ramadan is wrong within a year and wrong silently.
 */
export const FIXED_NATIONAL_DAYS = {
  SA: [
    { name: 'Saudi National Day', month: 9, day: 23, leadWeeks: 3, note: 'The largest civic moment of the Saudi year. Brand participation is expected, heavily green, and very crowded — being late reads worse than being absent.' },
    { name: 'Saudi Founding Day', month: 2, day: 22, leadWeeks: 3, note: 'Distinct from National Day and increasingly prominent. Heritage and craft framing rather than the National Day palette.' },
  ],
  AE: [
    { name: 'UAE National Day', month: 12, day: 2, leadWeeks: 3, note: 'Union Day. Major civic and retail moment across the Emirates.' },
    { name: 'UAE Commemoration Day', month: 11, day: 30, leadWeeks: 2, note: 'Solemn in tone and immediately before National Day — the two need different treatment.' },
  ],
  QA: [{ name: 'Qatar National Day', month: 12, day: 18, leadWeeks: 3, note: '' }],
  KW: [{ name: 'Kuwait National Day', month: 2, day: 25, leadWeeks: 3, note: 'Followed immediately by Liberation Day on 26 February; the two run as one period.' }],
  BH: [{ name: 'Bahrain National Day', month: 12, day: 16, leadWeeks: 3, note: '' }],
  OM: [{ name: 'Oman National Day', month: 11, day: 18, leadWeeks: 3, note: '' }],
}

/**
 * Country names to ISO codes, for reading a country out of brand prose.
 *
 * Only needed because `geography` is empty on every workspace in practice —
 * see countryOf(). Ordered longest-first at match time so "Saudi Arabia" wins
 * over a bare "Saudi" and "United Arab Emirates" is not shadowed by "Emirates".
 */
export const COUNTRY_NAMES = {
  'saudi arabia': 'SA', ksa: 'SA', 'kingdom of saudi arabia': 'SA', saudi: 'SA',
  'united arab emirates': 'AE', uae: 'AE', emirates: 'AE', dubai: 'AE', 'abu dhabi': 'AE',
  qatar: 'QA', doha: 'QA',
  kuwait: 'KW',
  bahrain: 'BH', manama: 'BH',
  oman: 'OM', muscat: 'OM',
  egypt: 'EG', cairo: 'EG',
  jordan: 'JO', amman: 'JO',
  lebanon: 'LB', beirut: 'LB',
  'united kingdom': 'GB', uk: 'GB', britain: 'GB', england: 'GB', london: 'GB',
  'united states': 'US', usa: 'US', america: 'US',
  canada: 'CA', australia: 'AU', germany: 'DE', france: 'FR', spain: 'ES',
  italy: 'IT', netherlands: 'NL', india: 'IN', pakistan: 'PK',
  turkey: 'TR', türkiye: 'TR', malaysia: 'MY', indonesia: 'ID', singapore: 'SG',
}

/** Cities that pin a country even when the country itself is never named. */
const CITY_HINTS = {
  riyadh: 'SA', jeddah: 'SA', dammam: 'SA', khobar: 'SA', mecca: 'SA', makkah: 'SA',
  medina: 'SA', madinah: 'SA', neom: 'SA', dhahran: 'SA',
  sharjah: 'AE', ajman: 'AE',
}

/**
 * Work out which country's calendar applies.
 *
 * The fallback chain exists because the obvious field is empty. Every one of
 * the three live workspaces has `customFields.geography === undefined`, so a
 * calendar lens that trusted it would have run with no country at all — and
 * did, for as long as this lens has existed. It appeared to work only because
 * Arak's descriptor prose happens to open with "Saudi Arabia's leading...".
 * A brand whose descriptor does not name a country got a calendar with no
 * location and nobody noticed, because the failure is silent.
 *
 * Returns `{ code, source }` so a caller can tell a configured answer from a
 * guess, and `{ code: null }` when there is genuinely nothing to go on — which
 * must be reported, not defaulted. Defaulting to Saudi Arabia here would be
 * the exact domain-lock this whole system is built to avoid.
 *
 * @returns {{code: string|null, source: string}}
 */
export function countryOf({ profile = {}, ctx = {} } = {}) {
  const fields = profile?.customFields || {}

  // 1. Somebody set it explicitly. Believe them.
  for (const key of ['country_code', 'countryCode']) {
    const raw = String(fields[key] || '').trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(raw)) return { code: raw, source: `custom field ${key}` }
  }
  for (const key of ['geography', 'country', 'market', 'location']) {
    const hit = matchCountry(fields[key])
    if (hit) return { code: hit, source: `custom field ${key}` }
  }

  // 2. Read it out of the brand's own prose. Lower confidence, still better
  //    than nothing, and labelled as prose so the brief can say so.
  const prose = [
    ctx?.brandDescriptor, fields.brand_descriptor,
    profile?.marketContext, profile?.positioning, profile?.targetPersonas,
  ].filter(Boolean).join(' ')
  const hit = matchCountry(prose)
  if (hit) return { code: hit, source: 'brand description' }

  return { code: null, source: '' }
}

/** Longest-name-first search, so "Saudi Arabia" beats "Saudi". */
function matchCountry(text) {
  const s = String(text || '').toLowerCase()
  if (!s.trim()) return null
  const names = Object.keys(COUNTRY_NAMES).sort((a, b) => b.length - a.length)
  for (const name of names) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(s)) return COUNTRY_NAMES[name]
  }
  for (const city of Object.keys(CITY_HINTS).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${city}\\b`).test(s)) return CITY_HINTS[city]
  }
  return null
}

// ─── Dates ─────────────────────────────────────────────────────────────────

/**
 * Aladhan answers in DD-MM-YYYY. Everything else in this codebase is ISO, and
 * a silent DD/MM vs MM/DD mix-up is wrong for eleven days of every month and
 * plausible for the other twenty — so the conversion is explicit and tested
 * rather than done inline with a split().
 */
export function fromAladhanDate(raw) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(raw || '').trim())
  if (!m) return null
  const [, dd, mm, yyyy] = m
  const iso = `${yyyy}-${mm}-${dd}`
  return Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime()) ? null : iso
}

/** An ISO date for a fixed month/day in a given year. */
export function isoFor(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Whole days from `now` until `iso`.
 *
 * Both sides are floored to UTC midnight first. Comparing a date against a
 * timestamp makes "today" come out as -1 whenever the run happens after
 * midday, which reads as an event that has already passed.
 */
export function daysUntil(iso, now = new Date()) {
  const then = new Date(`${iso}T00:00:00Z`).getTime()
  if (Number.isNaN(then)) return null
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((then - today) / 86_400_000)
}

/** Is `iso` inside [from, to]? Inclusive at both ends. */
export function inWindow(iso, from, to) {
  if (!iso) return false
  return iso >= from && iso <= to
}

/**
 * Annotate one dated event with the thing the brief actually needs.
 *
 * `actBy` is the date the preparation window OPENS — the point after which a
 * brand starting from scratch is already behind. It is what should drive the
 * "act now" section, not the event date, and getting this backwards is how a
 * brief tells you about Ramadan the week it starts.
 */
export function withLeadTime(event, now = new Date()) {
  const leadDays = Math.round((Number(event.leadWeeks) || 0) * 7)
  const date = event.date
  const actBy = date
    ? new Date(new Date(`${date}T00:00:00Z`).getTime() - leadDays * 86_400_000).toISOString().slice(0, 10)
    : null
  const until = daysUntil(date, now)
  const untilActBy = actBy ? daysUntil(actBy, now) : null

  return {
    ...event,
    act_by: actBy,
    days_until: until,
    days_until_act_by: untilActBy,
    // Has this already happened? Needed as its own field because a recurring
    // date is generated for several years at once and the past ones must be
    // recognisable rather than merely sorted last.
    passed: until !== null && until < 0,
    // The preparation window is open when it has STARTED and the event has not
    // yet happened. Both halves are load-bearing. Testing only the first marks
    // every past event as urgent — Saudi Founding Day, 202 days behind us, came
    // out top of the brief as ACT NOW, because a date in the past trivially
    // satisfies "preparation has begun".
    window_open: untilActBy !== null && untilActBy <= 0 && until !== null && until >= 0,
  }
}

/**
 * Order events the way a brief should read them.
 *
 * Anything whose preparation window is already open comes first regardless of
 * how far away the event is — that is the actionable set. Everything else
 * sorts by date.
 */
export function rankEvents(events = []) {
  return [...events].sort((a, b) => {
    if (a.window_open !== b.window_open) return a.window_open ? -1 : 1
    return String(a.date || '9999').localeCompare(String(b.date || '9999'))
  })
}

/**
 * Which (Hijri month, Hijri year) pairs the search window touches.
 *
 * Walks forward from the start month rather than subtracting, because the
 * Hijri year rolls over at month 12 and arithmetic that ignores that produces
 * month 13 — which the API answers for, with the wrong dates.
 */
export function hijriMonthsBetween(start, end) {
  const out = []
  let { month, year } = start
  for (let i = 0; i < 24; i += 1) {
    out.push({ month, year })
    if (month === end.month && year === end.year) break
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return out
}

// ─── Turning computed dates into findings ──────────────────────────────────
// Pure, and separated from the executor on purpose: this is the half of the
// calendar lens that must survive a model failure, so it is the half that most
// needs to be testable without a network.

/**
 * The raw findings a computed event produces, before normalisation.
 *
 * confidence is 1 and `sources` is empty for a built-in date. That is correct
 * rather than sloppy — the provenance is an arithmetic conversion, not a page
 * somebody read — and the citation filter must not mistake it for an
 * unsupported claim.
 */
export function findingsFromEvents(events = []) {
  return events.map(e => ({
    headline: e.window_open
      ? `${e.name} is ${e.days_until} days away and the preparation window is already open.`
      : `${e.name} falls on ${e.date}, ${e.days_until} days away.`,
    detail: [
      e.ends_on ? `Runs ${e.date} to ${e.ends_on}.` : `Date: ${e.date}.`,
      e.hijri ? `Hijri: ${e.hijri}.` : '',
      e.act_by ? `Work should start by ${e.act_by}.` : '',
      e.note,
      'Computed from the calendar, not researched — this date is not an estimate.',
    ].filter(Boolean).join(' '),
    confidence: 1,
    novelty: 'continuing',
    // The opportunity closes when the event arrives, not after it.
    perishable_until: e.date,
    // Deliberately generic, and only load-bearing when the model half fails.
    // This lens's own standard is that a finding with no action is trivia
    // however true it is, so a computed date that survives a model failure
    // still has to say what to do.
    suggested_action: e.window_open
      ? `Decide this week whether ${e.name} is worth posting for. If it is, the work starts now — the preparation window opened ${Math.abs(e.days_until_act_by ?? 0)} days ago.`
      : `Plan for ${e.name} by ${e.act_by}.`,
    evidence: {
      kind: e.kind, date: e.date, act_by: e.act_by,
      days_until: e.days_until, window_open: e.window_open,
    },
    sources: e.source && e.source !== 'built-in' ? [{ url: e.source, title: `${e.name} date` }] : [],
  }))
}

/**
 * Combine the computed half with whatever the model returned.
 *
 * THE GUARANTEE THIS FUNCTION EXISTS TO MAKE: computed dates are never lost.
 * Not when the model refuses, not when it runs out of searches, not when its
 * JSON fails to parse, not when the API is down.
 *
 * That is the same argument stage 0 makes one level up — gather() commits
 * measured numbers before any model token is spent so a failed investigation
 * cannot cost the user their numbers. A date converted from the Hijri calendar
 * deserves the same protection, and the lens that preceded this one proved why
 * by throwing away a confirmed Saudi National Day because its seventh search
 * failed.
 *
 * `ok` follows the dates, not the model: a lens that returned real dates and
 * lost only its commentary has not failed, and reporting it as failed would
 * put "the Calendar lens failed" in a brief that visibly contains calendar
 * findings.
 */
export function mergeCalendarResult({ computed = [], modelOut = {}, note = '', calendarSources = [] } = {}) {
  const base = {
    lens: 'calendar',
    findings: computed,
    sources: [...new Set(calendarSources)],
    cost: modelOut.cost || 0,
  }

  if (!modelOut.ok) {
    return {
      ...base,
      ok: computed.length > 0,
      error: computed.length ? '' : (modelOut.error || 'The calendar lens produced nothing.'),
      note: [
        note,
        `The calendar's reasoning step failed (${modelOut.error || 'unknown error'}), so this ` +
        'lens reports the confirmed dates without brand-specific actions.',
      ].filter(Boolean).join(' '),
    }
  }

  return {
    ...base,
    // Computed dates lead: they are certain, and the model's additions are not.
    findings: [...computed, ...(modelOut.findings || [])],
    sources: [...new Set([...calendarSources, ...(modelOut.sources || [])])],
    ok: true,
    error: '',
    note,
  }
}

/**
 * A one-line note about what the calendar could not establish.
 *
 * Silent when everything worked. A note that appears every week is a note
 * nobody reads — the same rule webHealthNote follows.
 */
export function calendarNote({ country = null, countrySource = '', failures = [] } = {}) {
  const notes = []
  if (!country) {
    notes.push(
      'No country could be determined for this brand, so public holidays were skipped. ' +
      'Set `geography` or `country_code` in the Brand Brain to fix this.',
    )
  } else if (countrySource === 'brand description') {
    notes.push(
      `The calendar assumed ${country} by reading the brand description, because no ` +
      'geography field is set. Set one if that is wrong.',
    )
  }
  for (const f of failures) notes.push(f)
  return notes.join(' ')
}
