import { describe, it, expect } from 'vitest'
import {
  LENSES, lensByKey, lensesFor, searchBudgetFor, motionOf, MOTIONS,
  makeFinding, daysLeft, rankFindings, lensSummary,
  PERISHABLE, SLOW,
} from './lenses'
import { calendarPrompt, openingsPrompt, demandPrompt, rivalsPrompt, LENS_PROMPTS } from './lensPrompts'
import { volatileFragment } from './prompt'

// The three real workspaces. Any framework that only works for one is wrong,
// so every generality claim below is asserted against all three.
const ARAK = {
  customFields: { brand_descriptor: "Saudi Arabia's leading architectural lighting and smart-building company" },
  positioning: 'certified partner of 20+ international lighting brands, trusted on landmark projects',
  targetPersonas: 'Architects and interior designers specifying lighting\nMEP contractors and engineering firms',
}
const AQEEQ = {
  customFields: { brand_descriptor: "an at-home spa and beauty service in Riyadh — massage, nails, hair delivered to the client's home" },
  positioning: 'A luxurious escape without leaving home',
  targetPersonas: 'Women aged 25–45 in Riyadh\nWorking professionals with limited free time',
}
const ALO = {
  customFields: { brand_descriptor: 'an on-demand tailoring and alterations service in Riyadh — garments collected by driver' },
  positioning: 'Convenient, professional tailoring that comes to you',
  targetPersonas: 'Women in Riyadh who own evening wear and abayas needing alteration',
}

describe('the lens set is general, not lighting-shaped', () => {
  it('every lens is universal — none is domain-specific', () => {
    // The failure this guards: adding a "tenders" lens that only Arak can use.
    // A domain-specific lens belongs as a TARGET inside a general lens, not as
    // a lens of its own.
    for (const l of LENSES) expect(l.universal, l.key).toBe(true)
  })

  it('names no industry anywhere in the registry', () => {
    const text = JSON.stringify(LENSES).toLowerCase()
    for (const word of ['lighting', 'spa', 'tailor', 'tender', 'instagram', 'saudi']) {
      expect(text, word).not.toContain(word)
    }
  })

  it('covers the six questions and no more', () => {
    expect(LENSES.map(l => l.key).sort())
      .toEqual(['calendar', 'craft', 'demand', 'openings', 'ourselves', 'rivals'])
  })
})

describe('how a brand sells decides what leads', () => {
  it('reads professional buyers as a specification sale', () => {
    // Architects and contractors do not buy the way consumers do, and the
    // audience field is the strongest signal available.
    expect(motionOf(ARAK)).toEqual({ motion: 'specification', explicit: false })
  })

  it('reads both Riyadh services as local service', () => {
    expect(motionOf(AQEEQ).motion).toBe('local_service')
    expect(motionOf(ALO).motion).toBe('local_service')
  })

  it('an explicit setting always beats the guess', () => {
    // The guess exists only so the system is not useless before someone sets
    // the field. It must never override them.
    const out = motionOf({ ...AQEEQ, customFields: { ...AQEEQ.customFields, sales_motion: 'product' } })
    expect(out).toEqual({ motion: 'product', explicit: true })
  })

  it('flags a guess as a guess', () => {
    // So a caller can tell an inference from a decision, and so the brief can
    // say "assuming you sell this way" rather than asserting it.
    expect(motionOf(ARAK).explicit).toBe(false)
  })

  it('an unknown motion falls back rather than throwing', () => {
    expect(motionOf({}).motion).toBe('local_service')
    expect(motionOf(null).motion).toBe('local_service')
  })
})

describe('ordering puts deadlines above observations', () => {
  it('perishable lenses lead for every motion', () => {
    for (const motion of Object.keys(MOTIONS)) {
      const order = lensesFor({ motion })
      expect(order[0].perishability, motion).toBe(PERISHABLE)
    }
  })

  it('a specification brand gets Openings before Calendar', () => {
    // Both perishable, so the motion breaks the tie: projects matter more to
    // Arak than the seasonal calendar does.
    const keys = lensesFor({ motion: 'specification' }).map(l => l.key)
    expect(keys.indexOf('openings')).toBeLessThan(keys.indexOf('calendar'))
  })

  it('a local service gets Calendar before Openings', () => {
    // And the reverse for Aqeeq: Ramadan moves their week more than a new
    // development does.
    const keys = lensesFor({ motion: 'local_service' }).map(l => l.key)
    expect(keys.indexOf('calendar')).toBeLessThan(keys.indexOf('openings'))
  })

  it('the slow lens is always last', () => {
    for (const motion of Object.keys(MOTIONS)) {
      const order = lensesFor({ motion, cadence: 'monthly' })
      expect(order[order.length - 1].perishability, motion).toBe(SLOW)
    }
  })
})

describe('cadence keeps a monthly question off a weekly bill', () => {
  it('a weekly run skips the monthly lens', () => {
    // Craft's answer moves quarterly. Asking it weekly pays four times for one
    // answer.
    expect(lensesFor({ cadence: 'weekly' }).map(l => l.key)).not.toContain('craft')
  })

  it('a monthly run includes everything', () => {
    expect(lensesFor({ cadence: 'monthly' }).map(l => l.key)).toContain('craft')
  })

  it('a weekly run is cheaper than a monthly one', () => {
    expect(searchBudgetFor(lensesFor({ cadence: 'weekly' })))
      .toBeLessThan(searchBudgetFor(lensesFor({ cadence: 'monthly' })))
  })

  it('the free lens really is free', () => {
    // Ourselves reads our own tables and never calls a model at all.
    expect(lensByKey('ourselves').budget.searches).toBe(0)
  })

  it('keeps the whole weekly search budget within reach of the cost target', () => {
    // The guard that actually protects the ~$1-2/run target. It used to be
    // spelled as a per-lens cap on calendar, which stopped meaning anything
    // once calendar's lookups moved out of the model entirely: its dates now
    // cost $0.00 and zero searches, and its search budget buys trade-show
    // research instead. Capping the total is the honest version of the same
    // intent.
    expect(searchBudgetFor(lensesFor({ cadence: 'weekly' }))).toBeLessThanOrEqual(24)
  })
})

describe('a finding knows when it stops mattering', () => {
  const at = iso => new Date(iso)

  it('no date means evergreen, not expired', () => {
    // The trap: treating null as 0 would sort every undated finding to the top
    // as overdue, which is the opposite of what it means.
    expect(daysLeft(makeFinding('demand', { headline: 'x' }))).toBeNull()
  })

  it('live deadlines lead, soonest first', () => {
    const ranked = rankFindings([
      makeFinding('a', { headline: 'evergreen', confidence: 0.9 }),
      makeFinding('b', { headline: 'in 20 days', perishable_until: '2026-09-30' }),
      makeFinding('c', { headline: 'in 5 days', perishable_until: '2026-09-15' }),
    ], at('2026-09-10'))
    expect(ranked.map(f => f.headline)).toEqual(['in 5 days', 'in 20 days', 'evergreen'])
  })

  it('an expired finding sinks but is not deleted', () => {
    // It may explain why something was missed, which is worth keeping.
    const ranked = rankFindings([
      makeFinding('a', { headline: 'expired', perishable_until: '2026-09-01' }),
      makeFinding('b', { headline: 'evergreen', confidence: 0.5 }),
    ], at('2026-09-10'))
    expect(ranked[ranked.length - 1].headline).toBe('expired')
    expect(ranked).toHaveLength(2)
  })

  it('confidence orders everything that has no deadline', () => {
    const ranked = rankFindings([
      makeFinding('a', { headline: 'weak', confidence: 0.2 }),
      makeFinding('b', { headline: 'strong', confidence: 0.9 }),
    ], at('2026-09-10'))
    expect(ranked[0].headline).toBe('strong')
  })

  it('a nonsense date is treated as no date', () => {
    expect(daysLeft(makeFinding('a', { perishable_until: 'soon' }))).toBeNull()
  })
})

describe('quiet and broken never look the same', () => {
  it('separates found, quiet and failed', () => {
    // The distinction that decides whether a brief is trusted or skimmed: a
    // lens that checked and found nothing is a result; a lens that crashed is
    // a gap. Reporting them identically hides the gap.
    const summary = lensSummary([
      { lens: 'calendar', ok: true, findings: [1, 2] },
      { lens: 'demand', ok: true, findings: [] },
      { lens: 'rivals', ok: false, findings: [], error: 'API access blocked.' },
    ])
    expect(summary.map(s => s.state)).toEqual(['found', 'quiet', 'failed'])
    expect(summary[2].error).toMatch(/blocked/)
    expect(summary[0].label).toBe('Calendar')
  })
})

describe('the prompts are grounded in the brand, not in an industry', () => {
  const facts = b => ({
    brandName: 'X',
    descriptor: b.customFields.brand_descriptor,
    audience: b.targetPersonas,
    geography: 'Riyadh, Saudi Arabia',
  })

  it('every lens has a prompt builder', () => {
    for (const l of LENSES) {
      if (l.key === 'ourselves') continue   // computed, no prompt
      expect(LENS_PROMPTS[l.key], l.key).toBeTypeOf('function')
    }
  })

  it('the same builder produces different prompts for different brands', () => {
    // The generality claim, made concrete: one function, three businesses.
    const a = calendarPrompt(facts(ARAK), { from: '2026-09-10', to: '2026-11-05' })
    const b = calendarPrompt(facts(AQEEQ), { from: '2026-09-10', to: '2026-11-05' })
    expect(a).not.toBe(b)
    expect(a).toContain('architectural lighting')
    expect(b).toContain('at-home spa')
  })

  it('openings changes what it looks for by sales motion', () => {
    const spec = openingsPrompt(facts(ARAK), { motion: 'specification' })
    const local = openingsPrompt(facts(AQEEQ), { motion: 'local_service' })
    expect(spec).toMatch(/tenders|DESIGN stage/)
    expect(local).toMatch(/residential|developments/)
    expect(spec).not.toBe(local)
  })

  it('every prompt permits an empty answer explicitly', () => {
    // Without this a model asked to research something will find something,
    // and a padded brief teaches the reader to skim.
    for (const build of [
      () => calendarPrompt(facts(ARAK), { from: 'a', to: 'b' }),
      () => openingsPrompt(facts(ARAK), { motion: 'specification' }),
      () => demandPrompt(facts(AQEEQ), { competitors: ['A'] }),
      () => rivalsPrompt(facts(ALO), { competitors: [], board: [], movements: [] }),
    ]) {
      expect(build()).toMatch(/empty findings array|found nothing/i)
    }
  })

  it('every prompt forbids inventing a deadline', () => {
    // perishable_until drives the "act now" section, so a hallucinated date
    // does not merely add noise — it outranks real work.
    expect(calendarPrompt(facts(ARAK), { from: 'a', to: 'b' })).toMatch(/never invent/i)
    expect(openingsPrompt(facts(ARAK), { motion: 'specification' })).toMatch(/never invent|guessing/i)
  })

  it('rivals states the measured numbers as given facts', () => {
    const p = rivalsPrompt(facts(ARAK), {
      competitors: ['Technolight'],
      board: [{ name: 'Technolight', handle: 'technolight', followers: 1522, activity: 'no NEW posts this period' }],
      movements: [],
    })
    expect(p).toMatch(/do not recompute/i)
    expect(p).toContain('1522')
  })

  it('no prompt carries a timestamp that would break the cache', () => {
    // A prompt builder is exactly where a "today is" line gets added without
    // thinking, and caching fails silently when it happens.
    for (const text of [
      calendarPrompt(facts(ARAK), { from: '2026-09-10', to: '2026-11-05' }),
      openingsPrompt(facts(AQEEQ), { motion: 'local_service' }),
      demandPrompt(facts(ALO), { competitors: ['A', 'B'] }),
    ]) {
      expect(volatileFragment(text)).toBeNull()
    }
  })
})

describe('the calendar lens does not look dates up any more', () => {
  // This describe block used to assert the opposite — that the prompt demanded
  // a search for every date — and both of its assertions were removed on
  // purpose. That instruction was the bug.
  //
  // Live run, 2026-09-12: the lens spent 4 searches (two on an identical
  // query), hit max_uses_exceeded seven times, then returned {"findings":[]}
  // having already confirmed Saudi National Day. It discarded that work
  // because the prompt said "if you cannot confirm a date, leave it out" and
  // it had run out of budget mid-verification. $0.28 and 49 seconds for
  // nothing, and the run looked successful.
  //
  // Dates now arrive computed. The prompt's job changed, so these assertions
  // changed with it.

  const facts2 = { brandName: 'X', descriptor: 'y', audience: 'z' }
  const events = [{
    name: 'Saudi National Day', date: '2026-09-23', days_until: 11,
    act_by: '2026-09-02', window_open: true, kind: 'national', note: 'Civic moment.',
  }]

  it('hands the dates over as given facts rather than asking for them', () => {
    const p = calendarPrompt(facts2, { from: '2026-09-10', to: '2026-11-05', events, country: 'SA' })
    expect(p).toMatch(/CONFIRMED DATES/)
    expect(p).toMatch(/Saudi National Day/)
    expect(p).toMatch(/2026-09-23/)
    expect(p).toMatch(/given facts/i)
  })

  it('tells the model not to spend searches re-verifying them', () => {
    // The whole saving. Re-verifying a computed date is how the budget got
    // burned before anything useful was asked.
    const p = calendarPrompt(facts2, { from: '2026-09-10', to: '2026-11-05', events, country: 'SA' })
    expect(p).toMatch(/do not search\s*\n?\s*to confirm them/i)
  })

  it('points the searches at what no API answers', () => {
    const p = calendarPrompt(facts2, { from: '2026-09-10', to: '2026-11-05', events })
    expect(p).toMatch(/Trade shows, exhibitions and conferences/)
  })

  it('names the country when one was resolved', () => {
    expect(calendarPrompt(facts2, { from: 'a', to: 'b', events, country: 'SA' }))
      .toMatch(/Country whose calendar applies: SA/)
  })

  it('still reads as a prompt when nothing is coming', () => {
    // An empty calendar is common and must not produce a dangling header.
    const p = calendarPrompt(facts2, { from: 'a', to: 'b', events: [] })
    expect(p).toMatch(/nothing dated falls in this window/i)
  })

  it('surfaces an open preparation window in words, not just a date', () => {
    expect(calendarPrompt(facts2, { from: 'a', to: 'b', events }))
      .toMatch(/PREPARATION WINDOW IS OPEN/)
  })
})

describe('no lens may throw away work it already did', () => {
  it('tells every lens what to do when the search budget runs out', () => {
    // The instruction whose absence cost a whole lens. Asserted on the shared
    // closing so a new lens cannot be added without it.
    for (const p of [
      calendarPrompt({ brandName: 'X' }, { from: 'a', to: 'b', events: [] }),
      openingsPrompt({ brandName: 'X' }, { motion: 'local_service' }),
      demandPrompt({ brandName: 'X' }, { competitors: [] }),
    ]) {
      expect(p).toMatch(/IF YOU RUN OUT OF SEARCHES, REPORT WHAT YOU ALREADY CONFIRMED/)
      expect(p).toMatch(/never repeat a query/i)
    }
  })

  it('gives the calendar room to plan rather than recall', () => {
    // effort:'low' was a recall budget. The duplicate query was a symptom of
    // a model given no room to plan its four searches.
    const budget = lensByKey('calendar').budget
    expect(budget.effort).not.toBe('low')
    expect(budget.searches).toBeGreaterThanOrEqual(4)
  })
})
