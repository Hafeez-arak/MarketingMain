import { describe, it, expect } from 'vitest'
import { blockReason, cleanContact, isValidEmail, normalizeEmail, pickRecipients } from './contacts.js'
import { applyMergeTags, marketingProblems, renderEmail, toPlainText, unknownMergeTags } from './render.js'
import { dailyCap, healthOf, warmupStep } from './warmup.js'
import { contactsToCsv, parseCsv, rowsToContacts } from './csv.js'

const contact = (over = {}) => ({
  id: 'c1', email: 'a@x.com', first_name: 'Sara', audience: 'marketing',
  consent: 'customer', status: 'active', replied_at: null, ...over,
})

describe('addresses', () => {
  it('normalises the shapes spreadsheets hold', () => {
    expect(normalizeEmail('  Mailto:Ali@Arak-SA.com ')).toBe('ali@arak-sa.com')
    expect(normalizeEmail('<ali@x.com>')).toBe('ali@x.com')
  })
  it('rejects the typos that bounce', () => {
    expect(isValidEmail('ali@x.com')).toBe(true)
    expect(isValidEmail('ali@x')).toBe(false)
    expect(isValidEmail('ali x@x.com')).toBe(false)
    expect(isValidEmail('ali@x.com,')).toBe(false)
  })
})

describe('who may be emailed', () => {
  it('keeps the two lanes apart', () => {
    expect(blockReason(contact({ audience: 'cold' }), 'marketing')).toMatch(/Cold contact/)
    expect(blockReason(contact(), 'cold')).toMatch(/Marketing contact/)
  })
  it('never sends to someone who left, bounced or complained', () => {
    for (const status of ['unsubscribed', 'bounced', 'complained']) {
      expect(blockReason(contact({ status }), 'marketing')).not.toBe('')
    }
  })
  it('stops cold follow-ups after a reply', () => {
    expect(blockReason(contact({ audience: 'cold', consent: 'none', replied_at: '2026-09-01' }), 'cold'))
      .toBe('Already replied')
  })
  it('picks each person once across overlapping groups and says why others were skipped', () => {
    const contacts = [contact(), contact({ id: 'c2', email: 'b@x.com', status: 'unsubscribed' }), contact({ id: 'c3', email: 'c@x.com' })]
    const memberships = [
      { group_id: 'g1', contact_id: 'c1' }, { group_id: 'g2', contact_id: 'c1' },
      { group_id: 'g1', contact_id: 'c2' }, { group_id: 'g3', contact_id: 'c3' },
    ]
    const { eligible, skipped } = pickRecipients({ contacts, memberships, groupIds: ['g1', 'g2'], audience: 'marketing' })
    expect(eligible.map(c => c.id)).toEqual(['c1'])
    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toBe('Unsubscribed')
  })
  it('can keep a campaign to the contacts who prefer its language', () => {
    const contacts = [contact({ language: 'en' }), contact({ id: 'c2', email: 'b@x.com', language: 'ar' })]
    const memberships = [{ group_id: 'g1', contact_id: 'c1' }, { group_id: 'g1', contact_id: 'c2' }]
    const only = pickRecipients({ contacts, memberships, groupIds: ['g1'], audience: 'marketing', language: 'en' })
    expect(only.eligible.map(c => c.id)).toEqual(['c1'])
    expect(only.skipped[0].reason).toBe('Prefers Arabic')
    expect(pickRecipients({ contacts, memberships, groupIds: ['g1'], audience: 'marketing' }).eligible).toHaveLength(2)
  })
  it('files a cold contact with no consent, whatever the form said', () => {
    expect(cleanContact({ email: 'X@Y.com', audience: 'cold', consent: 'customer' })).toMatchObject({
      email: 'x@y.com', audience: 'cold', consent: 'none',
    })
  })
})

describe('rendering', () => {
  it('fills merge tags, uses fallbacks, and tidies what an empty one leaves', () => {
    expect(applyMergeTags('Hi {{first_name}},', { first_name: 'Sara' })).toBe('Hi Sara,')
    expect(applyMergeTags('Hi {{first_name}},', {})).toBe('Hi,')
    expect(applyMergeTags('Hi {{ first_name | there }}!', {})).toBe('Hi there!')
  })
  it('leaves an unknown tag visible so the typo shows in the preview', () => {
    expect(applyMergeTags('Hi {{frist_name}}', {})).toBe('Hi {{frist_name}}')
    expect(unknownMergeTags('Hi {{frist_name}} {{company}}')).toEqual(['frist_name'])
  })
  it('puts the unsubscribe link, address and reason in every marketing footer', () => {
    const { html, text } = renderEmail({
      audience: 'marketing', subject: 'News', body: 'Hello **there**\n\n- one\n- two',
      sender: { from_name: 'Arak Lighting', company_address: 'Riyadh, KSA' },
      unsubscribeUrl: 'https://app/u?t=1',
    })
    expect(html).toContain('<strong>there</strong>')
    expect(html).toContain('<li')
    expect(html).toContain('https://app/u?t=1')
    expect(html).toContain('Riyadh, KSA')
    expect(text).toContain('https://app/u?t=1')
  })
  it('escapes what a person typed and drops non-web links', () => {
    const { html } = renderEmail({
      audience: 'marketing', subject: 's', body: '<script>x</script> [go](javascript:alert(1)) [ok](https://a.com?x=1&y=2)',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="https://a.com?x=1&amp;y=2"')
  })
  it('writes Arabic right to left', () => {
    expect(renderEmail({ audience: 'marketing', subject: 's', body: 'مرحبا', language: 'ar' }).html).toContain('dir="rtl"')
  })
  it('keeps cold email plain, with an opt-out sentence and no template', () => {
    const { html, text } = renderEmail({ audience: 'cold', subject: 'Quick question', body: 'Hi {{first_name}}', contact: { first_name: 'Omar' } })
    expect(html).not.toContain('<table')
    expect(text).toContain('Hi Omar')
    expect(text).toMatch(/reply "stop"/)
  })
  it('turns formatting into readable plain text', () => {
    expect(toPlainText('See [our site](https://a.com) **now**')).toBe('See our site (https://a.com) now')
  })
  it('refuses to call a campaign ready without sender and address', () => {
    expect(marketingProblems({ subject: 'a', body: 'b', sender: {} })).toHaveLength(2)
    expect(marketingProblems({ subject: 'a', body: 'b', sender: { from_email: 'x@y.com', company_address: 'R' } })).toEqual([])
  })
})

describe('warm-up', () => {
  const settings = { warmup_enabled: true, warmup_started_on: '2026-09-01', provider_daily_limit: 100, provider_monthly_limit: 3000 }
  it('climbs by days since the first send', () => {
    expect(warmupStep(0).perDay).toBe(30)
    expect(warmupStep(8).perDay).toBe(100)
    expect(dailyCap({ settings, today: '2026-09-01' }).cap).toBe(30)
    expect(dailyCap({ settings, today: '2026-09-05' }).cap).toBe(50)
  })
  it('never exceeds the provider limits', () => {
    const r = dailyCap({ settings, today: '2026-10-20' })
    expect(r.cap).toBe(100)
    expect(r.limitedBy).toBe('provider daily limit')
    const m = dailyCap({ settings, today: '2026-10-20', sentThisMonth: 2990, sentToday: 0 })
    expect(m.cap).toBe(10)
  })
  it('counts what went out today against today', () => {
    expect(dailyCap({ settings, today: '2026-09-01', sentToday: 12, sentThisMonth: 12 }).remaining).toBe(18)
  })
  it('pauses on complaints and holds on bounces, but not on a tiny sample', () => {
    expect(healthOf({ sent: 10, complained: 5 }).state).toBe('ok')
    expect(healthOf({ sent: 400, complained: 2 }).state).toBe('paused')
    expect(healthOf({ sent: 100, bounced: 3 }).state).toBe('hold')
    expect(dailyCap({ settings, today: '2026-10-20', recent: { sent: 400, complained: 2 } }).cap).toBe(0)
  })
})

describe('CSV', () => {
  it('reads quoted fields and semicolon files', () => {
    expect(parseCsv('a,b\n"x, y","He said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'He said "hi"']])
    expect(parseCsv('Email;Name\na@x.com;Ali')).toEqual([['Email', 'Name'], ['a@x.com', 'Ali']])
  })
  it('maps common headers, splits a full name, and reports every rejected row', () => {
    const rows = parseCsv('Full Name,E-mail Address,Company,Lang\nAli Hassan,ali@x.com,ACME,Arabic\nBad,not-an-email,,\nDup,ALI@x.com,,\nOld,old@x.com,,')
    const { contacts, rejected } = rowsToContacts(rows, { audience: 'marketing' }, new Set(['old@x.com']))
    expect(contacts).toHaveLength(1)
    expect(contacts[0]).toMatchObject({ email: 'ali@x.com', first_name: 'Ali', last_name: 'Hassan', company: 'ACME', language: 'ar', source: 'import' })
    expect(rejected.map(r => r.reason)).toEqual(['Not a valid email address', 'Duplicate in this file', 'Already in your contacts'])
  })
  it('accepts a bare list of addresses with no header', () => {
    const { contacts } = rowsToContacts(parseCsv('a@x.com\nb@x.com'), {})
    expect(contacts.map(c => c.email)).toEqual(['a@x.com', 'b@x.com'])
  })
  it('exports with a BOM and quotes what needs quoting', () => {
    const csv = contactsToCsv([{ email: 'a@x.com', company: 'A, B' }], () => ['VIP'])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"A, B"')
    expect(csv).toContain('VIP')
  })
})
