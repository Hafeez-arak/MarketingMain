import { describe, it, expect } from 'vitest'
import {
  LENSES, lensByKey, lensesFor, searchBudgetFor, motionOf, MOTIONS,
  makeFinding, daysLeft, rankFindings, lensSummary, agendaFilterFor,
  isTechnicalOnly, FOR_WHOM,
  PERISHABLE, SLOW,
} from './lenses'
import {
  openingsPrompt, eventsPrompt, demandPrompt, categoryPrompt, rivalsPrompt, craftPrompt, LENS_PROMPTS,
} from './lensPrompts'
import { SYNTHESISE_PROMPT } from './brief'
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

  it('covers the eight questions and no more', () => {
    expect(LENSES.map(l => l.key).sort())
      .toEqual(['calendar', 'category', 'craft', 'demand', 'events', 'openings', 'ourselves', 'rivals'])
  })

  it('the weekly run covers growth AND what competitors are doing', () => {
    // 2026-09-12 demoted rivals to monthly because it asked what they POSTED,
    // and SME rivals mostly post nothing. 2026-09-15 brought it back weekly
    // asking what they are DOING across every channel — the traces a brand
    // signing, a hire or a booked stand leave every week. Growth lenses stay.
    const weekly = lensesFor({ cadence: 'weekly' }).map(l => l.key)
    expect(weekly).toContain('openings')    // who is about to buy
    expect(weekly).toContain('demand')      // what buyers want
    expect(weekly).toContain('category')    // what is changing around us
    expect(weekly).toContain('rivals')      // what competitors are doing
    expect(weekly).not.toContain('craft')   // still monthly
  })

  it('never lets the competitor lens be about follower counts', () => {
    const text = rivalsPrompt({ brandName: 'X' }, { competitors: ['A'] }).toLowerCase()
    expect(text).toContain('linkedin')
    expect(text).toContain('job')
    expect(text).not.toMatch(/followers?,/)
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
    // intent. Raised 24 → 26 on 2026-09-15 when the competitor lens went
    // weekly; demand gave up two searches to keep the rise that small.
    // Raised 26 → 30 the same day for the events lens (6); openings gave up
    // two, since events were the job it was spending them on.
    expect(searchBudgetFor(lensesFor({ cadence: 'weekly' }))).toBeLessThanOrEqual(30)
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

describe('a finding knows whose problem it is', () => {
  // The case this whole field exists for. A SASO certification deadline is a
  // technical subject AND the strongest post available — "we are already
  // compliant, here is what specifiers must check" — and the failure mode is
  // filing it under its subject so marketing never sees the angle.
  const SASO = {
    headline: 'Mandatory SASO certification for low-voltage lighting from 1 December 2026.',
    perishable_until: '2026-12-01',
  }

  it('belongs to marketing unless something says otherwise', () => {
    expect(makeFinding('demand', SASO).for_whom).toBe('marketing')
  })

  it('keeps a publishable finding in the marketing flow however technical it sounds', () => {
    const f = makeFinding('demand', {
      ...SASO,
      for_whom: 'both',
      suggested_action: 'Post the compliance checklist for specifiers.',
      technical_note: 'Confirm every SKU has a valid certificate before November.',
    })
    expect(f.for_whom).toBe('both')
    expect(isTechnicalOnly(f)).toBe(false)
    expect(f.technical_note).toBe('Confirm every SKU has a valid certificate before November.')
  })

  it('refuses a technical label that carries no reason', () => {
    // THE GUARD. The moment there is a bucket labelled "not marketing's
    // problem", anything hard to turn into an action drifts into it, and the
    // brief thins out weekly while still reporting the same finding count.
    // A bare "technical" is a shrug, and a shrug goes back in front of a
    // person who can judge it.
    const f = makeFinding('demand', { ...SASO, for_whom: 'technical' })
    expect(f.for_whom).toBe('marketing')
    expect(isTechnicalOnly(f)).toBe(false)
  })

  it('accepts a technical label that explains itself', () => {
    const f = makeFinding('demand', {
      ...SASO,
      for_whom: 'technical',
      technical_note: 'Lab retest of the 40 affected SKUs. Nothing to publish — the rule is identical for every importer.',
    })
    expect(isTechnicalOnly(f)).toBe(true)
  })

  it('never hangs a technical note on a purely marketing finding', () => {
    // Otherwise every card grows an empty "for the technical team" line.
    const f = makeFinding('craft', { headline: 'Carousels outperform stills.', technical_note: 'stray' })
    expect(f.technical_note).toBe('')
  })

  it('treats an unknown audience as marketing rather than dropping the finding', () => {
    expect(makeFinding('demand', { ...SASO, for_whom: 'legal' }).for_whom).toBe('marketing')
    expect(FOR_WHOM).toEqual(['marketing', 'sales', 'both', 'technical'])
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

  it('every lens that calls a model has a prompt builder', () => {
    for (const l of LENSES) {
      // A lens with no search budget makes no model call, so it needs no
      // prompt. Two are computed: `ourselves` reads our own tables, and
      // `calendar` computes its dates from free APIs.
      if (l.budget.searches === 0) continue
      expect(LENS_PROMPTS[l.key], l.key).toBeTypeOf('function')
    }
  })

  it('the computed lenses cost nothing and have no prompt', () => {
    for (const key of ['ourselves', 'calendar']) {
      expect(lensByKey(key).budget.searches, key).toBe(0)
      expect(LENS_PROMPTS[key], key).toBeUndefined()
    }
  })

  it('the same builder produces different prompts for different brands', () => {
    // The generality claim, made concrete: one function, three businesses.
    const a = categoryPrompt(facts(ARAK), {})
    const b = categoryPrompt(facts(AQEEQ), {})
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
      () => categoryPrompt(facts(ARAK), {}),
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
    expect(categoryPrompt(facts(ARAK), {})).toMatch(/never invent/i)
    expect(openingsPrompt(facts(ARAK), { motion: 'specification' })).toMatch(/never invent|guessing/i)
  })

  it('the competitor lens is handed what rivals posted about, never how many follow them', () => {
    // 2026-09-15: the team does not care about followers. What a rival posted
    // ABOUT is a trace of what they are doing; a follower count is not a move.
    const p = rivalsPrompt(facts(ARAK), {
      competitors: ['Technolight'],
      board: [{ name: 'Technolight', handle: 'technolight', followers: 1522, activity: 'no NEW posts this period',
        top_posts: [{ hook: 'Handover at King Salman Park' }] }],
      movements: [],
    })
    expect(p).toContain('no NEW posts this period')
    expect(p).toContain('Handover at King Salman Park')
    expect(p).not.toContain('1522')
  })

  it('shows every searching lens what the team already tracks', () => {
    const intel = 'LEADS ALREADY TRACKED\n- Mondrian Riyadh'
    for (const p of [
      openingsPrompt(facts(ARAK), { motion: 'specification', intel }),
      categoryPrompt(facts(ARAK), { intel }),
      rivalsPrompt(facts(ARAK), { competitors: ['A'], intel }),
    ]) expect(p).toContain('Mondrian Riyadh')
  })

  it('asks for a lead\'s own name, because the store keys on it', () => {
    expect(openingsPrompt(facts(ARAK), { motion: 'specification' })).toMatch(/OWN\s+name/)
  })

  it('no prompt carries a timestamp that would break the cache', () => {
    // A prompt builder is exactly where a "today is" line gets added without
    // thinking, and caching fails silently when it happens.
    for (const text of [
      categoryPrompt(facts(ARAK), {}),
      openingsPrompt(facts(AQEEQ), { motion: 'local_service' }),
      demandPrompt(facts(ALO), { competitors: ['A', 'B'] }),
    ]) {
      expect(volatileFragment(text)).toBeNull()
    }
  })
})

describe('the calendar lens makes no model call at all', () => {
  // This block has now been rewritten twice, and the direction of travel is
  // the point.
  //
  // It first asserted that the prompt demanded a search for every date. That
  // instruction was the bug: on 2026-09-12 the lens spent 4 searches (two on
  // an identical query), hit max_uses_exceeded seven times, then returned
  // {"findings":[]} having already confirmed Saudi National Day — discarded,
  // because the prompt said "if you cannot confirm a date, leave it out" and
  // the budget ran out mid-verification. $0.28 for nothing, reported as success.
  //
  // Then the dates were computed and handed over as given facts, leaving the
  // model two jobs: judge what the brand should DO, and hunt trade shows. On
  // the very next run the model half hit its 150s wall-clock budget and was
  // stopped, producing nothing, while the free computed half produced the only
  // real finding in the brief.
  //
  // So both jobs moved — judgement to synthesis, trade shows to openings — and
  // the model call is gone. These assertions are what stops it coming back.

  it('has no prompt builder, because it has no prompt', () => {
    expect(LENS_PROMPTS.calendar).toBeUndefined()
  })

  it('is budgeted at zero searches and zero tokens', () => {
    const budget = lensByKey('calendar').budget
    expect(budget.searches).toBe(0)
    expect(budget.maxTokens).toBe(0)
  })

  it('still runs every week — it is free, and it is the most reliable lens there is', () => {
    // Zero budget must never be read as "disabled". This lens produced the
    // only finding in the 2026-09-12 brief.
    expect(lensesFor({ cadence: 'weekly' }).map(l => l.key)).toContain('calendar')
    expect(lensByKey('calendar').universal).toBe(true)
  })

  it('leads the brief, because a date is the most perishable thing in it', () => {
    expect(lensByKey('calendar').perishability).toBe(PERISHABLE)
  })

  it('hands its trade-show job to a lens that actually searches', () => {
    // The half that genuinely needed a model did not get deleted, it moved —
    // twice now. Openings carried it as a leftover job and, told that finding
    // no events was fine, found none; every brief listed one public holiday.
    // Since 2026-09-15 the events lens owns it with its own budget.
    const p = eventsPrompt({ brandName: 'X' }, { motion: 'specification' })
    expect(p).toMatch(/trade shows/i)
    expect(p).toMatch(/exhibitions/i)
    expect(lensByKey('events').budget.searches).toBeGreaterThan(0)
    expect(openingsPrompt({ brandName: 'X' }, { motion: 'specification' })).toMatch(/procurement or budget\s+cycles/i)
  })
})

describe('the standing questions actually steer the search', () => {
  // AGENT.md §5b calls research_agenda the steering wheel: the list a person
  // edits to say what they want watched. It was loaded every run and handed
  // ONLY to synthesis — which reads what the lenses already found and has no
  // search tool. So "watch for tunnel-lighting tenders" could change how the
  // week was written up and could never change what was looked for. The one
  // thing the feature exists for was the one thing it could not do.

  const AGENDA = [
    { subject: 'Is anyone pushing tunnel lighting in the Kingdom?', why: 'We have stock' },
    { subject: 'When is the next Big 5 Saudi?' },
  ]
  // Local to this block: the fixture in the grounding suite below is scoped
  // to its own describe, and reaching across would couple two unrelated tests.
  const facts = b => ({
    brandName: 'X',
    descriptor: b.customFields.brand_descriptor,
    audience: b.targetPersonas,
    geography: 'Riyadh, Saudi Arabia',
  })

  it('reaches every lens that searches', () => {
    const built = [
      openingsPrompt(facts(ARAK), { motion: 'specification', agenda: AGENDA }),
      demandPrompt(facts(ARAK), { competitors: [], agenda: AGENDA }),
      categoryPrompt(facts(ARAK), { agenda: AGENDA }),
      rivalsPrompt(facts(ARAK), { agenda: AGENDA }),
      craftPrompt(facts(ARAK), { agenda: AGENDA }),
    ]
    for (const p of built) {
      expect(p).toMatch(/STANDING QUESTIONS/)
      expect(p).toMatch(/tunnel lighting/)
    }
  })

  it('carries the reason a question was asked, which is what judges the answer', () => {
    expect(openingsPrompt(facts(ARAK), { motion: 'specification', agenda: AGENDA }))
      .toMatch(/why it matters: We have stock/)
  })

  it('tells a lens to ignore the questions that are not its job', () => {
    // Every lens sees every question, because asking a person to tag each one
    // with a lens key means teaching them a concept they have no reason to
    // know. The filtering is the model's job, and it has to be told so — or
    // five lenses spend real searches on one calendar question.
    const p = craftPrompt(facts(ARAK), { agenda: AGENDA })
    expect(p).toMatch(/ignore them/i)
    expect(p).toMatch(/they come first/i)
  })

  it('says nothing at all when nobody has asked for anything', () => {
    // Today every workspace has zero active standing questions, so an empty
    // agenda is the common case and must not leave a dangling header.
    const p = openingsPrompt(facts(ARAK), { motion: 'specification', agenda: [] })
    expect(p).not.toMatch(/STANDING QUESTIONS/)
    expect(openingsPrompt(facts(ARAK), { motion: 'specification' })).not.toMatch(/STANDING QUESTIONS/)
  })

  it('skips malformed rows rather than rendering a blank bullet', () => {
    const p = demandPrompt(facts(ARAK), { competitors: [], agenda: [{ why: 'no subject' }, null] })
    expect(p).not.toMatch(/STANDING QUESTIONS/)
  })

  it('caps the list, because an agenda is not a budget', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ subject: `question ${i}` }))
    const p = categoryPrompt(facts(ARAK), { agenda: many })
    expect(p).toMatch(/question 9/)
    expect(p).not.toMatch(/question 10\b/)
  })

  it('a monthly question is not asked every week', () => {
    // research_agenda.cadence has existed since the table did and nothing read
    // it, so a question marked monthly was asked weekly anyway — spending
    // searches re-answering something whose answer moves quarterly.
    expect(agendaFilterFor('weekly')).toBe('&cadence=eq.weekly')
  })

  it('a monthly run asks everything, weekly questions included', () => {
    // Same rule the lens set follows: monthly is a superset, not a swap.
    expect(agendaFilterFor('monthly')).toBe('')
  })

  it('defaults to the narrower set when the cadence is missing or junk', () => {
    // Erring narrow costs a question one week. Erring wide spends real money
    // every week on questions someone deliberately marked monthly.
    expect(agendaFilterFor()).toBe('&cadence=eq.weekly')
    expect(agendaFilterFor('nonsense')).toBe('&cadence=eq.weekly')
  })

  it('the brief still owes an answer for every question asked', () => {
    // Half two: reaching the lenses is not enough. A watch list that silently
    // stops being watched is worse than none, so synthesis must name the ones
    // it could not answer.
    expect(SYNTHESISE_PROMPT).toMatch(/STANDING QUESTIONS ARE A PROMISE/)
    expect(SYNTHESISE_PROMPT).toMatch(/unanswered/)
  })
})

describe('the market is searched in its own language, not only in English', () => {
  // Fixing the instruction that made four lenses report nothing exposed what
  // was underneath it: all 99 pages they had read were in English. For Saudi
  // Arabia that is a ceiling, not a preference — tender portals, municipal
  // announcements and contract awards publish in Arabic first and in English
  // late, partially, or never. That is precisely the government half of the
  // market where a specification business finds work.

  const facts = () => ({ brandName: 'X', descriptor: 'lighting', geography: 'Saudi Arabia' })

  it('tells every searching lens to use the local language too', () => {
    for (const p of [
      openingsPrompt(facts(), { motion: 'specification', language: 'Arabic' }),
      demandPrompt(facts(), { competitors: [], language: 'Arabic' }),
      categoryPrompt(facts(), { language: 'Arabic' }),
      rivalsPrompt(facts(), { language: 'Arabic' }),
      craftPrompt(facts(), { language: 'Arabic' }),
    ]) {
      expect(p).toMatch(/SEARCH IN ARABIC AS WELL AS ENGLISH/)
    }
  })

  it('says WHY, because a rule without a reason gets traded away under budget pressure', () => {
    const p = openingsPrompt(facts(), { motion: 'specification', language: 'Arabic' })
    expect(p).toMatch(/publish there first/i)
    expect(p).toMatch(/tenders, awards, permits and policy/i)
  })

  it('forbids silently translating a quote into something the page does not say', () => {
    // Citations are checked against the URLs a tool actually returned. A quote
    // quietly rendered into English is unverifiable against its own source.
    expect(categoryPrompt(facts(), { language: 'Arabic' })).toMatch(/do not silently\s*\n?\s*translate/i)
  })

  it('says nothing when the market already speaks English', () => {
    // An instruction telling an English-speaking model to search in English is
    // noise, and noise in a prompt is not free.
    const p = openingsPrompt(facts(), { motion: 'specification', language: '' })
    expect(p).not.toMatch(/AS WELL AS ENGLISH/)
    expect(openingsPrompt(facts(), { motion: 'specification' })).not.toMatch(/AS WELL AS ENGLISH/)
  })

  it('names no country and no website, so it still works for a fourth brand', () => {
    // The whole claim of this file is that it hardcodes no industry and no
    // place. A list of Saudi tender portals would work for one workspace and
    // rot for every other.
    //
    // The brand fixture here is deliberately NOT Saudi: the first version of
    // this test used the Saudi facts and passed "Saudi Arabia" straight into
    // the prompt through `who()`, so it was asserting against its own input
    // rather than against the template.
    const turkish = { brandName: 'X', descriptor: 'lighting', geography: 'Türkiye' }
    const p = openingsPrompt(turkish, { motion: 'specification', language: 'Turkish' })
    expect(p).toMatch(/SEARCH IN TURKISH/)
    expect(p).not.toMatch(/etimad|saudi|arabic|\.sa\b/i)
  })
})

describe('no lens may throw away work it already did', () => {
  it('tells every lens what to do when the search budget runs out', () => {
    // The instruction whose absence cost a whole lens. Asserted on the shared
    // closing so a new lens cannot be added without it.
    for (const p of [
      openingsPrompt({ brandName: 'X' }, { motion: 'local_service' }),
      demandPrompt({ brandName: 'X' }, { competitors: [] }),
      categoryPrompt({ brandName: 'X' }, {}),
      rivalsPrompt({ brandName: 'X' }, {}),
    ]) {
      expect(p).toMatch(/IF YOU RUN OUT OF SEARCHES, REPORT WHAT YOU ALREADY CONFIRMED/)
      expect(p).toMatch(/never repeat a query/i)
    }
  })

  it('gives every SEARCHING lens room to plan rather than recall', () => {
    // effort:'low' is a recall budget, and the duplicate query that started
    // all of this was a symptom of a model given no room to plan. Craft is
    // exempt: it is a monthly scepticism check, not a hunt.
    for (const l of LENSES) {
      if (l.budget.searches === 0 || l.key === 'craft') continue
      expect(l.budget.effort, l.key).not.toBe('low')
      expect(l.budget.searches, l.key).toBeGreaterThanOrEqual(4)
    }
  })

  it('REPORTS what it found instead of deciding the reader cannot handle it', () => {
    // The instruction that cost every finding. It used to read "return an
    // empty findings array if you found nothing worth reporting", and it was
    // obeyed: four lenses read 99 pages between them — MEED, Construction
    // Week, MEP Middle East, Arab News — and reported nothing at all.
    //
    // A/B on the same week, same lens, same sources, only the closing changed:
    //   before  0 findings from 37 sources
    //   after   3 findings from 20 sources, one of them a 300-key Waldorf
    //           Astoria conversion sitting in DESIGN phase — a live
    //           specification window, thrown away by an instruction.
    //
    // The mistake was asking for a binary report/don't-report call when the
    // schema already has a confidence field. A reader can discount a 0.35;
    // they cannot discount silence, and silence is indistinguishable from
    // never having looked.
    for (const p of [
      openingsPrompt({ brandName: 'X' }, { motion: 'specification' }),
      demandPrompt({ brandName: 'X' }, { competitors: [] }),
      categoryPrompt({ brandName: 'X' }, {}),
    ]) {
      expect(p).toMatch(/REPORT WHAT YOU FOUND/)
      expect(p).toMatch(/that is what the confidence score is for/i)
      expect(p).not.toMatch(/correct and common answer/i)
    }
  })
})

describe('openings reports the project even when it cannot reach the date', () => {
  // The lens that mattered most returned nothing. On 2026-09-12 it read 63
  // sources — tendersontime, globaltenders, tendersarabia, tenderimpulse's
  // Saudi lighting tenders, The Avenues Riyadh, 45 hotels in the pipeline —
  // and reported ZERO findings, status ok, no error, no timeout.
  //
  // The cause was not the closing instruction (demand and category share it
  // and both produced findings that run). It was that this prompt opened with
  // "An opening is only useful if it is still open" and required
  // perishable_until to be the window's closing date — making a VERIFIABLE
  // DATE a precondition for reporting anything.
  //
  // Which is fatal here specifically: tender portals put deadlines behind a
  // login, so the date is the single hardest thing in this lens to establish.
  // It found the work and discarded it for want of a closing date — the
  // calendar bug again, one lens over.

  const p = () => openingsPrompt({ brandName: 'X', descriptor: 'lighting' }, { motion: 'specification' })

  it('no longer makes "still open" a precondition for reporting', () => {
    expect(p()).not.toMatch(/only useful if it is still open/i)
  })

  it('says a project found is a finding, and its date a separate question', () => {
    expect(p()).toMatch(/IS a finding/)
    expect(p()).toMatch(/SEPARATE question and never a reason to leave it out/i)
  })

  it('names the paywall, so an unreachable deadline reads as a source limit', () => {
    // Naming the actual obstacle matters more than loosening the rule: the
    // model has to know that a missing date is expected here, not a failure
    // on its part.
    expect(p()).toMatch(/behind a login/i)
    expect(p()).toMatch(/fact about the source, not a reason to discard/i)
  })

  it('offers all three timing states, not just the open one', () => {
    for (const state of ['OPEN', 'CLOSED', 'TIMING UNCONFIRMED']) {
      expect(p(), state).toContain(state)
    }
  })

  it('tells it NOT to invent a perishable_until for an undated project', () => {
    // The loosening must not leak into the act-now queue. A guessed deadline
    // does not merely add noise, it outranks real dated work.
    expect(p()).toMatch(/Do NOT set\s*\n?\s*perishable_until/)
  })

  it('ranks the jobs instead of listing them flat', () => {
    // Eight equal jobs against eight searches meant one search each and
    // nothing left to verify with. Design-stage projects are worth more than
    // the rest combined, and the prompt now says so.
    expect(p()).toMatch(/order of value/i)
    expect(p()).toMatch(/1\. Projects entering DESIGN/)
    expect(p()).toMatch(/single most valuable thing you can find/i)
  })

  it('spends none of its searches on expos any more — the events lens has them', () => {
    const text = p()
    expect(text).not.toMatch(/correct trade and not a failure/)
    expect(text).toMatch(/separate events lens/)
  })
})

describe('the events lens looks where the buyers are, not only at our own industry', () => {
  const facts = { brandName: 'X', descriptor: 'a specification supplier', geography: 'Riyadh, Saudi Arabia' }

  it('asks for the buyers\' own expos and the conferences that shape demand', () => {
    // The two events the team named on 2026-09-15 were a property developer's
    // own expo and a technology conference — neither is an industry trade show,
    // and a lens looking only for those would never have found them.
    const p = eventsPrompt(facts, { motion: 'specification' })
    expect(p).toMatch(/developers' and real-estate expos/)
    expect(p).toMatch(/single developer's\s+own launch/)
    expect(p).toMatch(/technology, smart-city/)
  })

  it('reports editions that already happened, and the next edition\'s dates', () => {
    const p = eventsPrompt(facts, { motion: 'specification' })
    expect(p).toMatch(/ENDED in the last nine months/)
    expect(p).toMatch(/next edition/)
  })

  it('names no specific event and no industry — the rings come from who gathers', () => {
    const p = eventsPrompt({ brandName: 'X' }, { motion: 'local_service' }).toLowerCase()
    for (const word of ['leap', 'big 5', 'lighting', 'saudi build', 'cityscape']) expect(p).not.toContain(word)
  })

  it('looks for competitors on exhibitor lists, and is shown what is already tracked', () => {
    const p = eventsPrompt(facts, { motion: 'specification', competitors: ['Technolight'], intel: 'EVENTS ALREADY TRACKED\n- Expo A 2026' })
    expect(p).toContain('Technolight')
    expect(p).toContain('Expo A 2026')
  })

  it('runs every week and leads for a specification business', () => {
    expect(lensesFor({ cadence: 'weekly' }).map(l => l.key)).toContain('events')
    expect(MOTIONS.specification.leads).toContain('events')
  })
})

describe('a lens that read and reported nothing is not a quiet one', () => {
  it('separates the discarded pass from the still market, and carries the effort', () => {
    const rows = lensSummary([
      { lens: 'openings', ok: true, findings: [{ headline: 'x' }], sources: ['https://a', 'https://b'] },
      // The 15 Sep case: 40 sources read, nothing kept.
      { lens: 'category', ok: true, findings: [], sources: Array.from({ length: 40 }, (_, i) => `https://s${i}`) },
      { lens: 'ourselves', ok: true, findings: [], sources: [] },
      { lens: 'rivals', ok: false, findings: [], sources: [], error: 'timed out' },
    ])
    expect(rows.map(r => r.state)).toEqual(['found', 'searched', 'quiet', 'failed'])
    expect(rows[1]).toMatchObject({ sources: 40, allowance: 6 })
  })
})
