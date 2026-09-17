import { describe, it, expect } from 'vitest'
import { businessView, losing, board, moved, unknown, verdict, linesOf } from './businessView'

const rival = (subject, o = {}) => ({ subject, domain: `${subject.toLowerCase()}.com`, lines: ['lighting'], kinds: [], city: '', tier: null, resolution: 'company', ...o })
const signal = (competitor, o = {}) => ({ competitor, summary: 'did a thing', category: 'project', channel: 'news', relevance: 'medium', source_url: 'https://x', first_seen_at: '2026-09-10', last_seen_at: '2026-09-10', ...o })
const deal = (o = {}) => ({ project: 'P', competitor: 'Rival A', line: 'lighting', outcome: 'lost', decided_by: 'price', value_sar: 0, ...o })
const NOW = new Date('2026-09-16T00:00:00Z')

describe('linesOf', () => {
  it('reads the lines off the watchlist, because a line with no rival has no board', () => {
    expect(linesOf([rival('A', { lines: ['controls'] }), rival('B', { lines: ['lighting', 'controls'] })]))
      .toEqual(['controls', 'lighting'])
  })

  it('gives an unassigned rival a page rather than dropping it silently', () => {
    expect(linesOf([rival('A', { lines: [] })])).toEqual([''])
  })
})

describe('losing', () => {
  it('refuses to guess who we lose to when no bid has been recorded', () => {
    const out = losing([], 'lighting')
    expect(out.established).toBe(false)
    expect(out.why).toContain('No bid has been recorded')
  })

  it('does not infer a loser from web signals — a busy rival is not a winning one', () => {
    // Signals are not an argument to this function at all, and that is the
    // point: activity on the web says nothing about who took the job.
    const out = losing([], 'lighting')
    expect(out.established).toBe(false)
    expect(out.rows).toBeUndefined()
  })

  it('ranks by losses and names what decided them', () => {
    const out = losing([
      deal({ competitor: 'Al Nasser', decided_by: 'agency_rights' }),
      deal({ competitor: 'Al Nasser', decided_by: 'agency_rights' }),
      deal({ competitor: 'Huda', decided_by: 'price' }),
    ], 'lighting')
    expect(out.rows[0].competitor).toBe('Al Nasser')
    expect(out.rows[0].lost).toBe(2)
    expect(out.rows[0].topReason).toBe('agency_rights')
  })

  it('counts wins as contested too, so the log is not only defeats', () => {
    const out = losing([deal({ outcome: 'won', competitor: 'Huda' })], 'lighting')
    expect(out.established).toBe(true)
    expect(out.rows[0].won).toBe(1)
    expect(out.lost).toBe(0)
  })

  it('keeps the lines apart', () => {
    expect(losing([deal({ line: 'controls' })], 'lighting').established).toBe(false)
  })
})

describe('board', () => {
  const watchlist = [rival('A'), rival('B'), rival('C', { lines: ['controls'] })]

  it('shows only the rivals in this line', () => {
    expect(board({ watchlist, line: 'lighting', now: NOW }).rows.map(r => r.name)).toEqual(['A', 'B'])
  })

  it('marks a rival nobody has looked at as unresearched, not as quiet', () => {
    const out = board({ watchlist, signals: [signal('A')], line: 'lighting', now: NOW })
    expect(out.rows.find(r => r.name === 'A').researched).toBe(true)
    expect(out.rows.find(r => r.name === 'B').researched).toBe(false)
    expect(out.researched).toBe(1)
  })

  it('carries the brands a rival holds, which is what decides a lighting bid', () => {
    const out = board({
      watchlist, line: 'lighting',
      brands: [{ competitor: 'A', brand: 'Berker', relationship: 'exclusive', line: '' }], now: NOW,
    })
    expect(out.rows.find(r => r.name === 'A').brands[0].brand).toBe('Berker')
  })

  it('puts a tiered rival above an untiered one without pretending the untiered is tier 3', () => {
    const out = board({ watchlist: [rival('A'), rival('B', { tier: 1 })], line: 'lighting', now: NOW })
    expect(out.rows[0].name).toBe('B')
    expect(out.rows[1].tier).toBeNull()
  })

  it('says so when no rival is assigned to the line', () => {
    expect(board({ watchlist, line: 'tailoring', now: NOW }).established).toBe(false)
  })
})

describe('moved', () => {
  const watchlist = [rival('A')]

  it('reports a quiet month as quiet rather than padding', () => {
    const out = moved({ watchlist, signals: [], line: 'lighting', now: NOW })
    expect(out.established).toBe(false)
    expect(out.why).toContain('Nothing new')
  })

  it('caps at three and says how many it held back', () => {
    const many = Array.from({ length: 6 }, (_, i) => signal('A', { summary: `thing ${i}` }))
    const out = moved({ watchlist, signals: many, line: 'lighting', now: NOW })
    expect(out.rows).toHaveLength(3)
    expect(out.more).toBe(3)
  })

  it('ignores anything older than the window', () => {
    const out = moved({ watchlist, signals: [signal('A', { first_seen_at: '2026-01-01' })], line: 'lighting', now: NOW })
    expect(out.established).toBe(false)
  })

  it('puts high relevance first', () => {
    const out = moved({
      watchlist,
      signals: [signal('A', { summary: 'low one', relevance: 'low' }), signal('A', { summary: 'high one', relevance: 'high' })],
      line: 'lighting', now: NOW,
    })
    expect(out.rows[0].summary).toBe('high one')
  })
})

describe('unknown', () => {
  it('is the longest block on a new install, and that is correct', () => {
    const out = unknown({ watchlist: [rival('A', { domain: '' }), rival('B', { resolution: 'unresolvable', domain: '' })], line: 'lighting' })
    const gaps = out.map(u => u.gap).join(' | ')
    expect(gaps).toContain('no confirmed domain')
    expect(gaps).toContain('could not be identified')
    expect(gaps).toContain('never returned a single finding')
    expect(gaps).toContain('No rival has a tier')
    expect(gaps).toContain('No contested bid')
  })

  it('every gap names who can close it', () => {
    for (const u of unknown({ watchlist: [rival('A')], line: 'lighting' })) expect(u.ask).toBeTruthy()
  })

  it('drops a gap once it is closed', () => {
    const out = unknown({
      watchlist: [rival('A', { tier: 1 })],
      signals: [signal('A')],
      deals: [deal()],
      line: 'lighting',
    })
    expect(out).toEqual([])
  })
})

describe('verdict', () => {
  it('never claims more than the blocks behind it established', () => {
    const v = verdict({
      lose: { established: false },
      brd: { established: true, rows: [1, 2, 3], researched: 0 },
      line: 'controls',
    })
    expect(v).toContain('none has turned up anything yet')
    expect(v).toContain('not going to make something up')
  })

  it('says activity is not position while no bid is recorded', () => {
    const v = verdict({
      lose: { established: false },
      brd: { established: true, rows: [1, 2], researched: 2 },
      mv: { established: true, rows: [1] },
      line: 'lighting',
    })
    expect(v).toContain('not who is winning')
  })

  it('leads with the loss record once there is one', () => {
    const v = verdict({
      lose: { established: true, contested: 4, lost: 3, rows: [{ competitor: 'Al Nasser', topReason: 'agency_rights' }] },
      line: 'controls',
    })
    expect(v).toContain('lost 3')
    expect(v).toContain('agency rights')
  })
})

describe('businessView', () => {
  it('produces one page per line', () => {
    const pages = businessView({ watchlist: [rival('A'), rival('B', { lines: ['controls'] })], now: NOW })
    expect(pages.map(p => p.line)).toEqual(['controls', 'lighting'])
    expect(pages[0].label).toBe('Controls')
  })

  it('produces an honest page from nothing at all', () => {
    const [page] = businessView({ watchlist: [rival('A')], now: NOW })
    expect(page.losing.established).toBe(false)
    expect(page.moved.established).toBe(false)
    expect(page.board.established).toBe(true)
    expect(page.unknown.length).toBeGreaterThan(0)
    expect(page.verdict).toContain('not going to make something up')
  })
})
