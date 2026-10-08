import { describe, it, expect } from 'vitest'
import { lookupDomain, dohResolver, unquoteTxt } from './_dns.js'

const absent = () => Object.assign(new Error('no'), { code: 'ENODATA' })
const timeout = () => Object.assign(new Error('slow'), { code: 'ETIMEOUT' })

/** A resolver answering from a table: name → { txt, mx, cname }; a function value throws. */
function fake(table) {
  const get = (name, k) => {
    const v = table[name]?.[k]
    if (typeof v === 'function') throw v()
    if (v === undefined) throw absent()
    return v
  }
  return {
    resolveTxt: async n => get(n, 'txt').map(s => [s]),
    resolveMx: async n => get(n, 'mx').map(exchange => ({ priority: 0, exchange })),
    resolveCname: async n => get(n, 'cname'),
  }
}

describe('lookupDomain', () => {
  it('follows SPF includes like a receiver does (GoDaddy → Microsoft)', async () => {
    const r = await lookupDomain('clb-sa.com', 'microsoft', { resolver: fake({
      'clb-sa.com': { mx: ['clbsa-com0i.mail.protection.outlook.com'], txt: ['v=spf1 include:secureserver.net -all', 'MS=ms123'] },
      'secureserver.net': { txt: ['v=spf1 include:spf-0.secureserver.net -all'] },
      'spf-0.secureserver.net': { txt: ['v=spf1 ip4:1.2.3.0/24 include:spf.protection.outlook.com -all'] },
      'spf.protection.outlook.com': { txt: ['v=spf1 ip4:40.92.0.0/15 -all'] },
      '_dmarc.clb-sa.com': { txt: ['v=DMARC1; p=none; rua=mailto:info@clb-sa.com'] },
    }) })
    expect(r.spf).toEqual(['v=spf1 include:secureserver.net -all'])
    expect(r.spfIncludes).toContain('spf.protection.outlook.com')
    expect(r.spfComplete).toBe(true)
    expect(r.blocking).toEqual(['clb-sa.com has no DKIM record, so its emails are unsigned.'])
  })

  it('finds DKIM behind Microsoft\'s CNAME, and a CNAME with no key as pending', async () => {
    const ok = await lookupDomain('arak-sa.com', 'microsoft', { resolver: fake({
      'arak-sa.com': { mx: ['x.mail.protection.outlook.com'], txt: ['v=spf1 include:spf.protection.outlook.com -all'] },
      'spf.protection.outlook.com': { txt: ['v=spf1 -all'] },
      'selector1._domainkey.arak-sa.com': { txt: ['v=DKIM1; k=rsa; p=MIIBIjANBg'] },
      'selector2._domainkey.arak-sa.com': { txt: ['v=DKIM1; k=rsa; p=MIIBIjANBh'] },
      '_dmarc.arak-sa.com': { txt: ['v=DMARC1; p=none;'] },
    }) })
    expect(ok.dkim).toEqual(['selector1', 'selector2'])
    expect(ok.blocking).toEqual([])

    const pending = await lookupDomain('new.sa', 'microsoft', { resolver: fake({
      'new.sa': { mx: ['new-sa.mail.protection.outlook.com'], txt: ['v=spf1 include:spf.protection.outlook.com -all'] },
      'spf.protection.outlook.com': { txt: ['v=spf1 -all'] },
      'selector1._domainkey.new.sa': { cname: ['selector1-new-sa._domainkey.x.dkim.mail.microsoft'] },
    }) })
    expect(pending.dkimPending).toEqual(['selector1'])
    expect(pending.blocking[0]).toMatch(/no key is published there yet/)
  })

  it('a revoked DKIM key (p= empty) is no key', async () => {
    const r = await lookupDomain('x.sa', 'microsoft', { resolver: fake({
      'x.sa': { mx: ['x-sa.mail.protection.outlook.com'], txt: ['v=spf1 include:spf.protection.outlook.com -all'] },
      'spf.protection.outlook.com': { txt: ['v=spf1 -all'] },
      'selector1._domainkey.x.sa': { txt: ['v=DKIM1; p='] },
    }) })
    expect(r.dkim).toEqual([])
  })

  it('timeouts are reported as failed lookups, never as missing records', async () => {
    const r = await lookupDomain('slow.sa', 'microsoft', { resolver: fake({
      'slow.sa': { mx: timeout, txt: timeout },
      'selector1._domainkey.slow.sa': { txt: timeout },
      'selector2._domainkey.slow.sa': { txt: timeout },
      '_dmarc.slow.sa': { txt: timeout },
    }) })
    expect(r.failed.sort()).toEqual(['dkim', 'dmarc', 'mx', 'spf'])
    expect(r.blocking).toEqual([])
  })

  it('stops following SPF after the standard\'s 10 lookups', async () => {
    const table = { 'loop.sa': { mx: ['m'], txt: ['v=spf1 include:a0.sa -all'] } }
    for (let i = 0; i < 15; i++) table[`a${i}.sa`] = { txt: [`v=spf1 include:a${i + 1}.sa -all`] }
    const r = await lookupDomain('loop.sa', 'other', { resolver: fake(table) })
    expect(r.spfComplete).toBe(false)
  })
})

describe('dohResolver', () => {
  const answer = (rows, status = 0) => new Response(JSON.stringify({ Status: status, Answer: rows }), { status: 200 })

  it('joins TXT strings split by DNS, and reads MX and CNAME answers', async () => {
    const seen = []
    const r = dohResolver({ fetch: async url => {
      seen.push(String(url))
      if (/type=TXT/.test(url)) return answer([{ type: 5, data: 'x.dkim.mail.microsoft.' }, { type: 16, data: '"v=DKIM1; k=rsa; p=MIIB" "IjANBg"' }])
      if (/type=MX/.test(url)) return answer([{ type: 15, data: '10 mx1.hostinger.com.' }])
      return answer([{ type: 5, data: 'target.example.com.' }])
    } })
    expect(await r.resolveTxt('selector1._domainkey.arak-sa.com')).toEqual([['v=DKIM1; k=rsa; p=MIIBIjANBg']])
    expect(await r.resolveMx('ghusnsa.com')).toEqual([{ priority: 10, exchange: 'mx1.hostinger.com' }])
    expect(await r.resolveCname('a.b')).toEqual(['target.example.com'])
    expect(seen[0]).toMatch(/^https:\/\/dns\.google\/resolve\?name=selector1\._domainkey\.arak-sa\.com&type=TXT$/)
  })

  it('a name that does not exist, or has no such record, is "absent"', async () => {
    const nx = dohResolver({ fetch: async () => answer(undefined, 3) })
    await expect(nx.resolveMx('araklighting.com')).rejects.toMatchObject({ code: 'ENOTFOUND' })
    const empty = dohResolver({ fetch: async () => answer([]) })
    await expect(empty.resolveTxt('x.sa')).rejects.toMatchObject({ code: 'ENODATA' })
  })

  it('asks Cloudflare when Google fails, and reports a failure only when both do', async () => {
    const hosts = []
    const r = dohResolver({ fetch: async url => {
      hosts.push(new URL(url).hostname)
      if (hosts.length === 1) throw new TypeError('fetch failed')
      return answer([{ type: 16, data: '"v=spf1 -all"' }])
    } })
    expect(await r.resolveTxt('x.sa')).toEqual([['v=spf1 -all']])
    expect(hosts).toEqual(['dns.google', 'cloudflare-dns.com'])

    const down = dohResolver({ fetch: async () => { throw new TypeError('fetch failed') } })
    await expect(down.resolveTxt('x.sa')).rejects.toMatchObject({ code: 'ETIMEOUT' })
  })

  it('unquotes escaped quotes inside TXT data', () => {
    expect(unquoteTxt('"a \\"b\\"" "c"')).toBe('a "b"c')
    expect(unquoteTxt('plain')).toBe('plain')
  })
})
