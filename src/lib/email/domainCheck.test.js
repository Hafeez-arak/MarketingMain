import { describe, it, expect } from 'vitest'
import { judgeDomain, isDnsStale, dnsBlockReason, providerKind } from './domainCheck.js'
import { mailboxReadiness, mailboxCap, HARD_MAX_TOTAL_PER_MAILBOX, warmupDaysOf } from './cold.js'

// What a domain set up for Microsoft 365 looks like (arak-sa.com, 2026-10-08).
const GOOD = {
  domain: 'arak-sa.com', mx: ['araksa-com01b.mail.protection.outlook.com'],
  spf: ['v=spf1 include:spf.protection.outlook.com -all'], spfIncludes: ['spf.protection.outlook.com'], spfComplete: true,
  dkim: ['selector1', 'selector2'], dkimPending: [], dmarc: 'v=DMARC1; p=none;', failed: [],
}

describe('judgeDomain', () => {
  it('a domain set up for Microsoft 365 passes with nothing to say', () => {
    expect(judgeDomain(GOOD, 'microsoft')).toEqual({ blocking: [], warnings: [] })
  })

  it('no DKIM blocks: clb-sa.com and ghusnsa.com on 2026-10-08', () => {
    const r = judgeDomain({ ...GOOD, domain: 'clb-sa.com', dkim: [] }, 'microsoft')
    expect(r.blocking).toEqual(['clb-sa.com has no DKIM record, so its emails are unsigned.'])
  })

  it('DKIM records pointing at Microsoft with no key there say to switch signing on', () => {
    const r = judgeDomain({ ...GOOD, dkim: [], dkimPending: ['selector1'] }, 'microsoft')
    expect(r.blocking[0]).toMatch(/switch DKIM signing on in Microsoft 365/)
  })

  it('an unregistered domain blocks on MX, SPF and DKIM, and warns on DMARC (araklighting.com before purchase)', () => {
    const r = judgeDomain({ domain: 'araklighting.com', mx: [], spf: [], spfIncludes: [], spfComplete: true, dkim: [], dkimPending: [], dmarc: '', failed: [] }, 'microsoft')
    expect(r.blocking).toHaveLength(3)
    expect(r.blocking.join(' ')).toMatch(/no MX.*no SPF.*no DKIM/)
    expect(r.warnings.join(' ')).toMatch(/no DMARC/)
  })

  it('SPF that does not allow the mailbox\'s provider blocks, once the walk finished', () => {
    const r = judgeDomain({ ...GOOD, spf: ['v=spf1 include:_spf.google.com -all'], spfIncludes: ['_spf.google.com'] }, 'microsoft')
    expect(r.blocking[0]).toMatch(/does not allow Microsoft 365.*include:spf\.protection\.outlook\.com/)
  })

  it('SPF reached through another include counts (GoDaddy\'s secureserver.net → outlook)', () => {
    const r = judgeDomain({ ...GOOD, spf: ['v=spf1 include:secureserver.net -all'], spfIncludes: ['secureserver.net', 'spf-0.secureserver.net', 'spf.protection.outlook.com'] }, 'microsoft')
    expect(r.blocking).toEqual([])
  })

  it('an SPF walk that did not finish only warns', () => {
    const r = judgeDomain({ ...GOOD, spfIncludes: ['secureserver.net'], spfComplete: false }, 'microsoft')
    expect(r.blocking).toEqual([])
    expect(r.warnings[0]).toMatch(/could not be followed to the end/)
  })

  it('two SPF records block: receivers treat that as none', () => {
    expect(judgeDomain({ ...GOOD, spf: ['v=spf1 a -all', 'v=spf1 mx -all'] }, 'microsoft').blocking[0]).toMatch(/2 SPF records/)
  })

  it('mail servers split between providers only warn (ghusnsa.com: Outlook plus Hostinger)', () => {
    const r = judgeDomain({ ...GOOD, domain: 'ghusnsa.com', mx: ['ghusnsa-com.mail.protection.outlook.com', 'mx1.hostinger.com'] }, 'microsoft')
    expect(r.blocking).toEqual([])
    expect(r.warnings[0]).toMatch(/also lists mx1\.hostinger\.com/)
  })

  it('a lookup that failed is never read as a missing record', () => {
    const r = judgeDomain({ ...GOOD, mx: [], dkim: [], failed: ['mx', 'dkim'] }, 'microsoft')
    expect(r.blocking).toEqual([])
    expect(r.warnings).toHaveLength(2)
  })

  it('a custom mailbox needs SPF but no particular include', () => {
    expect(judgeDomain({ ...GOOD, spf: ['v=spf1 a mx -all'], spfIncludes: [], mx: ['mx.example.com'] }, 'other').blocking).toEqual([])
  })
})

describe('the domain check in the sending rules', () => {
  const blocked = { status: 'active', provider: 'microsoft', warmup_started_on: null, dns_check: { checked_at: '2026-10-08T10:00:00Z', blocking: ['clb-sa.com has no DKIM record, so its emails are unsigned.'] } }

  it('a blocking problem stops the mailbox, whatever else is ready', () => {
    const r = mailboxReadiness(blocked, '2026-10-08')
    expect(r).toMatchObject({ ready: false, dns: true })
    expect(r.reason).toMatch(/not ready for outreach: clb-sa\.com has no DKIM/)
  })

  it('warnings alone do not', () => {
    expect(mailboxReadiness({ ...blocked, dns_check: { checked_at: 'x', blocking: [], warnings: ['no DMARC'] } }, '2026-10-08').ready).toBe(true)
  })

  it('a mailbox never checked is not stopped by the rule itself (the run checks it first)', () => {
    expect(dnsBlockReason({ dns_check: {} })).toBe('')
    expect(mailboxReadiness({ ...blocked, dns_check: {} }, '2026-10-08').ready).toBe(true)
  })

  it('is looked up again after 12 hours', () => {
    const now = new Date('2026-10-08T12:00:00Z')
    expect(isDnsStale({ dns_checked_at: null }, now)).toBe(true)
    expect(isDnsStale({ dns_checked_at: '2026-10-08T01:00:00Z' }, now)).toBe(false)
    expect(isDnsStale({ dns_checked_at: '2026-10-07T23:59:00Z' }, now)).toBe(true)
  })

  it('knows the provider from the mailbox', () => {
    expect(providerKind({ provider: 'microsoft' })).toBe('microsoft')
    expect(providerKind({ provider: 'smtp', smtp_host: 'smtp.gmail.com' })).toBe('google')
    expect(providerKind({ provider: 'smtp', smtp_host: 'mail.example.com' })).toBe('other')
  })
})

describe('warm-up service volume and length', () => {
  const mb = { daily_limit: 40, first_sent_on: '2026-01-01' }

  it('warm-up emails count against the day: 20 warm-up leaves 30 for outreach', () => {
    expect(mailboxCap({ ...mb, warmup_per_day: 20 }, '2026-10-08')).toMatchObject({ cap: HARD_MAX_TOTAL_PER_MAILBOX - 20, warmup: 20, warmupLimits: true })
  })

  it('below the total, the mailbox\'s own limit and the ramp still decide', () => {
    expect(mailboxCap({ daily_limit: 15, first_sent_on: '2026-01-01', warmup_per_day: 20 }, '2026-10-08')).toMatchObject({ cap: 15, warmupLimits: false })
    expect(mailboxCap({ daily_limit: 15, first_sent_on: null, warmup_per_day: 20 }, '2026-10-08').cap).toBe(5)
  })

  it('a bad warm-up number cannot raise the cap', () => {
    expect(mailboxCap({ ...mb, warmup_per_day: -50 }, '2026-10-08').cap).toBe(40)
    expect(mailboxCap({ ...mb, warmup_per_day: 'x' }, '2026-10-08').cap).toBe(40)
  })

  it('a brand-new domain waits 28 days, not 14', () => {
    const fresh = { status: 'active', provider: 'microsoft', warmup_started_on: '2026-10-01', warmup_days: 28 }
    expect(mailboxReadiness(fresh, '2026-10-20')).toMatchObject({ ready: false, readyOn: '2026-10-29' })
    expect(mailboxReadiness(fresh, '2026-10-29').ready).toBe(true)
  })

  it('warm-up length is kept between 14 and 60 days', () => {
    expect(warmupDaysOf({ warmup_days: 3 })).toBe(14)
    expect(warmupDaysOf({ warmup_days: 400 })).toBe(60)
    expect(warmupDaysOf({})).toBe(14)
  })
})
