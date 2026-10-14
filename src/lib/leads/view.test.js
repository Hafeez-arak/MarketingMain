import { describe, it, expect } from 'vitest'
import { effectiveVerdict, monthStats, sheetHealth, modelName, verdictFilter, pageRange, pageLabel, pageCount, leadFilters, EMPTY_FILTERS, outlookLink, projectOf } from './view.js'

const now = new Date('2026-10-20T10:00:00Z')
const lead = (o) => ({ received_at: '2026-10-05T10:00:00Z', created_at: '2026-10-06T10:00:00Z', cost_usd: 0.0002, ...o })

describe('effectiveVerdict', () => {
  it('a person\'s correction wins; no verdict yet reads as pending', () => {
    expect(effectiveVerdict(lead({ verdict: 'unqualified', human_verdict: 'qualified' }))).toBe('qualified')
    expect(effectiveVerdict(lead({ verdict: 'qualified' }))).toBe('qualified')
    expect(effectiveVerdict(lead({ verdict: null, error: 'x' }))).toBe('pending')
  })
})

describe('monthStats', () => {
  it('counts by arrival month, spend by when it was spent, and corrections', () => {
    const s = monthStats([
      lead({ verdict: 'qualified' }),
      lead({ verdict: 'unqualified', human_verdict: 'qualified' }),
      lead({ verdict: 'needs_review', human_verdict: 'needs_review' }),
      lead({ verdict: 'duplicate' }),
      // A backfilled August enquiry: not this month's count, but this month's spend.
      lead({ verdict: 'qualified', received_at: '2026-08-27T17:00:00Z' }),
    ], now)
    expect(s).toMatchObject({ total: 4, qualified: 2, needs_review: 1, duplicate: 1, reviewed: 2, corrected: 1 })
    expect(s.spend).toBeCloseTo(0.001, 6)
  })
})

describe('sheetHealth', () => {
  it('never, fresh and stale', () => {
    expect(sheetHealth(null, now).state).toBe('never')
    expect(sheetHealth('2026-10-20T09:56:00Z', now)).toEqual({ state: 'ok', label: 'Checked 4 min ago' })
    expect(sheetHealth('2026-10-20T07:00:00Z', now)).toEqual({ state: 'stale', label: 'Last checked 3 h ago' })
  })
})

describe('modelName', () => {
  it('names the model plainly', () => {
    expect(modelName('openai/gpt-6-luna')).toBe('GPT-6 Luna')
    expect(modelName('z-ai/glm-5.3-flash')).toBe('glm-5.3-flash')
  })
})

describe('paging', () => {
  it('turns a tab into a filter on the effective verdict', () => {
    expect(verdictFilter('all')).toBeNull()
    expect(verdictFilter('qualified')).toBe('human_verdict.eq.qualified,and(human_verdict.is.null,verdict.eq.qualified)')
    expect(verdictFilter('pending')).toBe('and(human_verdict.is.null,verdict.is.null)')
  })

  it('ranges, labels and counts pages', () => {
    expect(pageRange(0, 25)).toEqual({ from: 0, to: 24 })
    expect(pageRange(2, 25)).toEqual({ from: 50, to: 74 })
    expect(pageLabel(0, 25, 542)).toBe('1–25 of 542')
    expect(pageLabel(21, 25, 542)).toBe('526–542 of 542')
    expect(pageLabel(0, 25, 0)).toBe('0 of 0')
    expect(pageCount(542, 25)).toBe(22)
    expect(pageCount(0, 25)).toBe(1)
  })
})

describe('criteriaLabels', () => {
  it('names what is known, in a fixed order, and nothing for leads read before the criteria', async () => {
    const { criteriaLabels } = await import('./view.js')
    expect(criteriaLabels({ criteria_version: 2, sender_type: 'contractor', source_check: 'verified', project_type: 'tender', request_type: 'requirement', philips: 'or_equivalent', folder: 'junk', email_kind: 'free' }))
      .toEqual(['Contractor', 'Verified', 'Tender', 'Requirement', 'Philips or equivalent', 'Junk', 'Free email'])
    expect(criteriaLabels({ criteria_version: 2, sender_type: 'trader', source_check: 'not_verified', project_type: '', philips: 'none', folder: 'inbox', email_kind: 'company' }))
      .toEqual(['Trader', 'Not verified'])
    expect(criteriaLabels({ sender_type: 'contractor' })).toEqual([])
  })
})

describe('leadFilters', () => {
  it('"Leads" means qualified or needs review, a person\'s verdict first', async () => {
    const { leadFilters, EMPTY_FILTERS } = await import('./view.js')
    expect(leadFilters(EMPTY_FILTERS)).toEqual({
      ors: ['human_verdict.in.(qualified,needs_review),and(human_verdict.is.null,verdict.in.(qualified,needs_review))'],
      eqs: [],
    })
    expect(leadFilters({ ...EMPTY_FILTERS, show: 'all' }).ors).toEqual([])
    expect(leadFilters({ ...EMPTY_FILTERS, show: 'unqualified' }).ors[0]).toContain('verdict.eq.unqualified')
  })
  it('turns each criteria filter into an exact match; "not stated" is the empty phase', async () => {
    const { leadFilters, EMPTY_FILTERS } = await import('./view.js')
    const f = leadFilters({ ...EMPTY_FILTERS, sender: 'trader', project: 'none', request: 'requirement', folder: 'junk', emailKind: 'free' })
    expect(f.eqs).toEqual([['sender_type', 'trader'], ['project_final', ''], ['request_type', 'requirement'], ['folder', 'junk'], ['email_kind', 'free']])
  })
  it('searches the words across company, sender, subject and message, with PostgREST syntax stripped', async () => {
    const { leadFilters, EMPTY_FILTERS, activeFilterCount } = await import('./view.js')
    const f = leadFilters({ ...EMPTY_FILTERS, search: ' Nour, (contracting) ' })
    expect(f.ors[1]).toBe('company.ilike.*Nour contracting*,name.ilike.*Nour contracting*,email.ilike.*Nour contracting*,subject.ilike.*Nour contracting*,summary.ilike.*Nour contracting*,message.ilike.*Nour contracting*')
    expect(activeFilterCount({ ...EMPTY_FILTERS, search: 'x', folder: 'junk' })).toBe(2)
  })
  it('Owner: mine, no one\'s yet, or one person\'s', async () => {
    const { leadFilters, EMPTY_FILTERS, activeFilterCount } = await import('./view.js')
    const ME = '44444444-4444-4444-8444-444444444444'
    const OMAR = '55555555-5555-4555-8555-555555555555'
    expect(leadFilters({ ...EMPTY_FILTERS, owner: 'me' }, { me: ME }).eqs).toEqual([['assigned_to', ME]])
    expect(leadFilters({ ...EMPTY_FILTERS, owner: 'me' }).eqs).toEqual([])
    expect(leadFilters({ ...EMPTY_FILTERS, owner: 'none' }).ors).toContain('assigned_to.is.null')
    expect(leadFilters({ ...EMPTY_FILTERS, owner: OMAR }).eqs).toEqual([['assigned_to', OMAR]])
    expect(activeFilterCount({ ...EMPTY_FILTERS, owner: 'none' })).toBe(1)
  })
})

describe('who works a lead', () => {
  it('says You, a first name, Unassigned, or Someone else', async () => {
    const { ownerLabel, shortName } = await import('./view.js')
    const team = [{ user_id: 'a', full_name: 'Omar Saleh', email: 'omar@example.com' }, { user_id: 'b', full_name: '', email: 'huda.k@example.com' }]
    expect(ownerLabel({ assigned_to: null }, team, 'a')).toBe('Unassigned')
    expect(ownerLabel({ assigned_to: 'a' }, team, 'a')).toBe('You')
    expect(ownerLabel({ assigned_to: 'a' }, team, 'z')).toBe('Omar')
    expect(ownerLabel({ assigned_to: 'b' }, team)).toBe('huda.k')
    expect(ownerLabel({ assigned_to: 'gone' }, team)).toBe('Someone else')
    expect(shortName(null)).toBe('')
  })
})

describe('where a lead came in', () => {
  it('says Arak website, Arak email or CLB email', async () => {
    const { channelLabel, brandOf } = await import('./view.js')
    expect(channelLabel({ source: 'website_form' })).toBe('Arak website')
    expect(channelLabel({ source: 'email', mailbox: 'info@arak-sa.com' })).toBe('Arak email')
    expect(channelLabel({ source: 'email', mailbox: 'info@clb-sa.com' })).toBe('CLB email')
    expect(brandOf('info@ghusn.com')).toBe('Ghusn')
  })
  it('filters by the website or one mailbox', async () => {
    const { leadFilters, EMPTY_FILTERS } = await import('./view.js')
    expect(leadFilters({ ...EMPTY_FILTERS, channel: 'website' }).eqs).toEqual([['source', 'website_form']])
    expect(leadFilters({ ...EMPTY_FILTERS, channel: 'info@clb-sa.com' }).eqs).toEqual([['mailbox', 'info@clb-sa.com']])
  })
  it('lists the stored phones, else the form\'s phone', async () => {
    const { phonesOf } = await import('./view.js')
    expect(phonesOf({ phones: ['055 1', '011 2'], phone: 'x' })).toEqual(['055 1', '011 2'])
    expect(phonesOf({ phones: [], phone: '0550000000' })).toEqual(['0550000000'])
    expect(phonesOf({})).toEqual([])
  })
})

describe('the Outlook link', () => {
  const mailboxes = [{ email: 'a.rak@example.sa', label: 'info@example.sa' }, { email: 'info@other.sa', label: 'info@other.sa' }]
  const owa = 'https://outlook.office365.com/owa/?ItemID=AAMkAG%2Fx%2By%3D&exvsurl=1&viewmodel=ReadMessageItem'
  it('opens in the mailbox it arrived in, by the mailbox\'s real address, not its alias', () => {
    expect(outlookLink({ link: owa, mailbox: 'info@example.sa' }, mailboxes))
      .toBe('https://outlook.office.com/mail/a.rak%40example.sa/deeplink?ItemID=AAMkAG%2Fx%2By%3D&exvsurl=1')
    expect(outlookLink({ link: owa, mailbox: 'INFO@other.sa' }, mailboxes))
      .toBe('https://outlook.office.com/mail/info%40other.sa/deeplink?ItemID=AAMkAG%2Fx%2By%3D&exvsurl=1')
  })
  it('falls back to the stored link when the mailbox is unknown, and gives nothing without one', () => {
    expect(outlookLink({ link: owa, mailbox: 'gone@example.sa' }, mailboxes)).toBe(owa)
    expect(outlookLink({ link: '', mailbox: 'info@example.sa' }, mailboxes)).toBe('')
  })
})

describe('the review and CRM filters', () => {
  it('Corrected by a person and Approved / in CRM', () => {
    expect(leadFilters({ ...EMPTY_FILTERS, show: 'corrected' })).toEqual({ ors: [], eqs: [['corrected', true]] })
    expect(leadFilters({ ...EMPTY_FILTERS, show: 'approved' })).toEqual({ ors: ['approved_at.not.is.null'], eqs: [] })
  })
})

describe('the project phase', () => {
  it('the team\'s choice wins, \'none\' means not stated, otherwise the agent\'s', () => {
    expect(projectOf({ project_type: 'tender' })).toBe('tender')
    expect(projectOf({ project_type: '', human_project_type: 'jih' })).toBe('jih')
    expect(projectOf({ project_type: 'tender', human_project_type: 'none' })).toBe('')
    expect(projectOf({ project_type: 'tender', human_project_type: 'maintenance', project_final: 'maintenance' })).toBe('maintenance')
    expect(projectOf({})).toBe('')
  })
})
