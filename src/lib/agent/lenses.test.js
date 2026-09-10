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

  it('the free lenses really are free', () => {
    // Calendar is mostly a lookup and Ourselves reads our own tables. Two of
    // six costing almost nothing is what makes six affordable.
    expect(lensByKey('ourselves').budget.searches).toBe(0)
    expect(lensByKey('calendar').budget.searches).toBeLessThanOrEqual(4)
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

describe('the calendar lens must not answer from memory', () => {
  it('demands a search for every date', () => {
    // The first live run failed exactly here. A date lookup feels like
    // something the model already knows, so it answered without searching,
    // produced no citations, and the source filter correctly dropped every
    // finding — silently killing the most valuable lens in the set.
    const p = calendarPrompt(
      { brandName: 'X', descriptor: 'y', audience: 'z', geography: 'Riyadh' },
      { from: '2026-09-10', to: '2026-11-05' },
    )
    expect(p).toMatch(/VERIFY EVERY DATE WITH A SEARCH/)
    expect(p).toMatch(/leave it out rather than reporting it unconfirmed/i)
  })

  it('has the budget to actually do it', () => {
    // Two searches could not verify a religious date, two national dates and
    // an exhibition. The instruction and the budget have to agree.
    expect(lensByKey('calendar').budget.searches).toBeGreaterThanOrEqual(4)
  })
})
